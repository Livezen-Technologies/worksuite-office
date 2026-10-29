// /v1/pdf/sign, verify, crop, resize and /v1/versions on real files in a temporary folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { PDFDocument } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";
import { readP12 } from "../src/pdf/sign";

let h: Harness;
let dir: string;

/** A self-signed signing certificate as a .p12, valid from yesterday for the given days. */
function makeP12(password: string, days = 30): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + days * 86400e3);
  const attrs = [{ name: "commonName", value: "Nimal Perera" }, { name: "organizationName", value: "Livezen" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

async function pdf(name: string, pages = 2, size: [number, number] = [612, 792]): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size).drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

async function run(op: string, body: unknown) {
  const r = await h.call("POST", `/v1/pdf/${op}`, body);
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  return h.svc.jobs.wait(r.json.jobId, 60000);
}

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-pdf-sign-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("signatures", () => {
  it("signs with a .p12 and verifies the signature; a changed byte breaks it", async () => {
    const cert = join(dir, "me.p12");
    writeFileSync(cert, makeP12("pw"));
    const p = await pdf("contract.pdf");
    const j = await run("sign", { path: p, certificate: cert, certificatePassword: "pw", reason: "Approved", visiblePage: 2 });
    expect(j.state, JSON.stringify(j.error)).toBe("done");
    const out = (j.result as { file: string; signer: { name: string } });
    expect(out.file).toBe(join(dir, "contract (signed).pdf"));
    expect(out.signer.name).toBe("Nimal Perera");
    const v = (await h.call("POST", "/v1/pdf/verify", { path: out.file })).json;
    expect(v.signatures).toEqual([expect.objectContaining({ field: 1, signer: "Nimal Perera", reason: "Approved", intact: true, coversWholeFile: true })]);
    const bytes = readFileSync(out.file);
    bytes[150] ^= 1;
    const bad = join(dir, "tampered.pdf");
    writeFileSync(bad, bytes);
    expect((await h.call("POST", "/v1/pdf/verify", { path: bad })).json.signatures[0].intact).toBe(false);
    expect((await h.call("POST", "/v1/pdf/verify", { path: p })).json.signatures).toEqual([]);
  });

  it("refuses a wrong password and an expired certificate", async () => {
    const cert = join(dir, "me2.p12");
    writeFileSync(cert, makeP12("pw"));
    const p = await pdf("c2.pdf");
    expect((await run("sign", { path: p, certificate: cert, certificatePassword: "nope" })).error?.detail).toEqual(expect.objectContaining({ reason: "password_incorrect" }));
    expect(() => readP12(readFileSync(cert), "pw", new Date(Date.now() + 90 * 86400e3))).toThrow(/not valid today/);
  });
});

describe("crop and resize", () => {
  it("crops margins off the chosen pages", async () => {
    const p = await pdf("crop.pdf", 2);
    const j = await run("crop", { path: p, margins: { top: 72, left: 36 }, pages: [2] });
    const doc = await PDFDocument.load(readFileSync((j.result as { file: string }).file));
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    expect(doc.getPage(1).getCropBox()).toEqual({ x: 36, y: 0, width: 576, height: 720 });
    expect((await run("crop", { path: p, margins: { left: 600 } })).error?.code).toBe("bad_request");
  });

  it("resizes to A4, keeping landscape pages landscape", async () => {
    const p = await pdf("letter.pdf", 1);
    const j = await run("resize", { path: p, size: "A4" });
    expect((await PDFDocument.load(readFileSync((j.result as { file: string }).file))).getPage(0).getSize()).toEqual({ width: 595, height: 842 });
    const wide = await pdf("wide.pdf", 1, [792, 612]);
    const w = await run("resize", { path: wide, size: "A4" });
    expect((await PDFDocument.load(readFileSync((w.result as { file: string }).file))).getPage(0).getSize()).toEqual({ width: 842, height: 595 });
    expect((await h.call("POST", "/v1/pdf/resize", { path: p, size: "B9" })).status).toBe(400);
  });
});

describe("versions", () => {
  it("keeps distinct versions, newest first, and restores one next to the file", async () => {
    const p = join(dir, "notes.pdf");
    writeFileSync(p, "v1");
    expect((await h.call("POST", "/v1/versions", { path: p })).json.created).toBe(true);
    expect((await h.call("POST", "/v1/versions", { path: p })).json.created).toBe(false);
    writeFileSync(p, "v2");
    await new Promise((r) => setTimeout(r, 1100));
    const second = (await h.call("POST", "/v1/versions", { path: p, note: "after review" })).json.version;
    const list = (await h.call("GET", `/v1/versions?path=${encodeURIComponent(p)}`)).json.versions;
    expect(list.map((v: { note?: string }) => v.note)).toEqual(["after review", undefined]);
    const restored = (await h.call("POST", "/v1/versions/restore", { path: p, id: list[1].id })).json.file;
    expect(restored).toMatch(/notes \(version \d{4}-\d\d-\d\d \d\d-\d\d\)\.pdf$/);
    expect(readFileSync(restored, "utf8")).toBe("v1");
    expect(readFileSync(p, "utf8")).toBe("v2");
    expect(second.size).toBe(2);
    expect((await h.call("DELETE", `/v1/versions?path=${encodeURIComponent(p)}`)).json.removed).toBe(2);
    expect((await h.call("GET", "/v1/versions?path=relative.pdf")).status).toBe(400);
  });
});
