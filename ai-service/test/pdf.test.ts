// /v1/pdf/*: jobs on real files in a temporary folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";

let h: Harness;
let dir: string;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function makePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

async function run(op: string, body: unknown) {
  const r = await h.call("POST", `/v1/pdf/${op}`, body);
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  return h.svc.jobs.wait(r.json.jobId);
}

const pages = async (p: string, password?: string) => (await PDFDocument.load(readFileSync(p), password ? { password } : {})).getPageCount();

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-pdf-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("pdf", () => {
  it("lists pdf in the capabilities", async () => {
    expect((await h.call("GET", "/v1/info")).json.capabilities).toContain("pdf");
  });

  it("merges, never overwriting", async () => {
    const a = await makePdf("a.pdf", 2), b = await makePdf("b.pdf", 3);
    const j = await run("merge", { paths: [a, b] });
    expect(j.state).toBe("done");
    expect(j.result).toEqual({ file: join(dir, "a (merged).pdf"), files: [join(dir, "a (merged).pdf")], contentType: "application/pdf", pages: 5 });
    expect((await run("merge", { paths: [a, b] })).result).toEqual(expect.objectContaining({ file: join(dir, "a (merged) (2).pdf") }));
    const f = await h.call("GET", `/v1/jobs/${j.id}/file`);
    expect(f.status).toBe(200);
  });

  it("splits by parts and every N pages", async () => {
    const s = await makePdf("s.pdf", 5);
    const j = await run("split", { path: s, parts: [[1, 2], [5]] });
    expect((j.result as { files: string[] }).files).toEqual([join(dir, "s (part 1).pdf"), join(dir, "s (part 2).pdf")]);
    expect(await pages(join(dir, "s (part 2).pdf"))).toBe(1);
    const e = await run("split", { path: s, every: 2 });
    expect((e.result as { files: string[] }).files).toHaveLength(3);
    expect((await run("split", { path: s, parts: [[9]] })).error?.code).toBe("bad_request");
  });

  it("rotates", async () => {
    const r = await makePdf("r.pdf", 2);
    const j = await run("rotate", { path: r, angle: 90, pages: [2] });
    const doc = await PDFDocument.load(readFileSync((j.result as { file: string }).file));
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90]);
    expect((await h.call("POST", "/v1/pdf/rotate", { path: r, angle: 45 })).status).toBe(400);
  });

  it("protects with AES-256 and unprotects with the password", async () => {
    const p = await makePdf("p.pdf", 1);
    const j = await run("protect", { path: p, userPassword: "open-me", ownerPassword: "owner", permissions: { printing: "low", copying: false } });
    const out = (j.result as { file: string }).file;
    expect(out).toBe(join(dir, "p (protected).pdf"));
    const raw = readFileSync(out).toString("latin1");
    expect(raw).toMatch(/\/Encrypt/);
    expect(raw).toMatch(/\/V 5/);
    expect((await h.call("POST", "/v1/pdf/info", { path: out })).json).toEqual({ pages: null, encrypted: true, size: expect.any(Number) });
    expect(await pages(out, "open-me")).toBe(1);
    const bad = await run("unprotect", { path: out, password: "nope" });
    expect(bad.error).toEqual(expect.objectContaining({ code: "bad_request", detail: expect.objectContaining({ reason: "password_incorrect" }) }));
    const u = await run("unprotect", { path: out, password: "open-me" });
    expect(await pages((u.result as { file: string }).file)).toBe(1);
  });

  it("refuses permissions without an owner password", async () => {
    const p = await makePdf("q.pdf", 1);
    expect((await h.call("POST", "/v1/pdf/protect", { path: p, userPassword: "x", permissions: { copying: false } })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/protect", { path: p })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/protect", { path: "relative.pdf", userPassword: "x" })).status).toBe(400);
  });

  it("makes a PDF from images", async () => {
    const img = join(dir, "dot.png");
    writeFileSync(img, PNG_1PX);
    const j = await run("images-to-pdf", { paths: [img, img] });
    expect(j.result).toEqual(expect.objectContaining({ file: join(dir, "dot.pdf"), pages: 2 }));
  });

  it("reports a missing file as not_found", async () => {
    expect((await run("rotate", { path: join(dir, "none.pdf"), angle: 90 })).error?.code).toBe("not_found");
  });
});
