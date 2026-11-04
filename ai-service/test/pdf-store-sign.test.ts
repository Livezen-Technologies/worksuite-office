// Signing with the computer's certificates (src/pdf/os-certs.ts): the store's lists, and a whole signature through a
// stand-in for Windows' SignedCms (the runner seam), checked as any other signature.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import forge from "node-forge";
import { PDFDocument } from "@cantoo/pdf-lib";
import { listStoreCertificates, parseMacIdentities, parseWindowsList, StoreSigner, useRunner } from "../src/pdf/os-certs";
import { checkSignatures, signPdf } from "../src/pdf/sign";

const THUMB = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678";

/** A key and self-signed certificate, as a smart card would hold them. */
function identity(name: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86400e3);
  cert.setSubject([{ name: "commonName", value: name }]);
  cert.setIssuer([{ name: "commonName", value: "Test CA" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { key: keys.privateKey, cert };
}

afterEach(() => useRunner(null));

describe("the computer's certificates", () => {
  it("reads Windows' list and macOS identities", () => {
    expect(parseWindowsList(`{"id":"${THUMB.toLowerCase()}","name":"Nimal Perera","issuer":"LankaSign CA","notAfter":"2027-10-01T00:00:00.0000000Z"}`))
      .toEqual([{ id: THUMB, name: "Nimal Perera", issuer: "LankaSign CA", notAfter: "2027-10-01T00:00:00.0000000Z", source: "windows" }]);
    expect(parseWindowsList("")).toEqual([]);
    expect(parseWindowsList(`[{"id":"nope","name":"x"}]`)).toEqual([]);
    const mac = `  1) ${THUMB} "Nimal Perera"\n  2) ${THUMB} "Nimal Perera"\n  3) 0000000000000000000000000000000000000000 "Apple Development: Kasun (ABC)"\n     3 valid identities found`;
    expect(parseMacIdentities(mac).map((c) => c.name)).toEqual(["Nimal Perera", "Apple Development: Kasun (ABC)"]);
  });

  it("asks PowerShell on Windows and security on macOS; nothing elsewhere", async () => {
    const calls: string[] = [];
    useRunner(async (cmd) => { calls.push(cmd); return cmd.includes("powershell") ? "[]" : ""; });
    expect(await listStoreCertificates("win32")).toEqual([]);
    expect(await listStoreCertificates("darwin")).toEqual([]);
    expect(await listStoreCertificates("linux")).toEqual([]);
    expect(calls).toEqual(["powershell.exe", "/usr/bin/security"]);
    expect(() => new StoreSigner(THUMB, "x", "linux")).toThrow(/Windows and macOS/);
    expect(() => new StoreSigner("not-a-thumbprint", "x", "win32")).toThrow(/thumbprint/);
  });

  it("signs a PDF through the store, and the signature checks out with the store's certificate", async () => {
    const who = identity("Nimal Perera");
    // what SignedCms does on Windows: a detached CMS over WS_IN, SHA-256, signing time, into WS_OUT
    useRunner(async (_cmd, _args, env) => {
      expect(env?.WS_THUMB).toBe(THUMB);
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(readFileSync(env!.WS_IN).toString("binary"));
      p7.addCertificate(who.cert);
      p7.addSigner({ key: who.key, certificate: who.cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.signingTime, value: new Date() as unknown as string }, { type: forge.pki.oids.messageDigest },
      ] });
      p7.sign({ detached: true });
      writeFileSync(env!.WS_OUT, Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary"));
      return "";
    });
    const doc = await PDFDocument.create();
    doc.addPage();
    const signer = new StoreSigner(THUMB, "Nimal Perera", "win32");
    const { pdf, signer: info } = await signPdf(doc, { signer, certificate: { name: "Nimal Perera", issuer: "", notBefore: "", notAfter: "" } }, { reason: "Approved", visible: { page: 1 } });
    expect(info).toMatchObject({ name: "Nimal Perera", issuer: "Test CA" });
    expect(checkSignatures(pdf)).toEqual([expect.objectContaining({ signer: "Nimal Perera", intact: true, coversWholeFile: true, reason: "Approved" })]);
  });

  it("says when the person cancelled the PIN, and when the store failed", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    useRunner(async () => { throw new Error("The operation was canceled by the user."); });
    await expect(signPdf(doc, { signer: new StoreSigner(THUMB, "x", "win32"), certificate: { name: "x", issuer: "", notBefore: "", notAfter: "" } })).rejects.toMatchObject({ code: "cancelled" });
    useRunner(async () => { throw new Error("Keyset does not exist"); });
    const doc2 = await PDFDocument.create();
    doc2.addPage();
    await expect(signPdf(doc2, { signer: new StoreSigner(THUMB, "x", "win32"), certificate: { name: "x", issuer: "", notBefore: "", notAfter: "" } })).rejects.toMatchObject({ code: "internal" });
  });
});
