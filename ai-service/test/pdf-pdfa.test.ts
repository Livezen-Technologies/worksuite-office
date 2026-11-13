// /v1/pdf/check-pdfa: the main PDF/A-2b requirements the file's structure shows (src/pdf/pdfa.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";

let h: Harness;
let dir: string;
const N = (s: string) => PDFName.of(s);

const XMP_ATTR = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta>';
const XMP_ELEM = XMP_ATTR.replace('pdfaid:part="2" pdfaid:conformance="B"/>', '><pdfaid:part>3</pdfaid:part><pdfaid:conformance>U</pdfaid:conformance></rdf:Description>');

/** A file that meets every structural requirement: no fonts, XMP id, an output intent with a profile, an ID,
 * and a printable link. */
async function conforming(xmp = XMP_ATTR): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 300]);
  page.drawRectangle({ x: 20, y: 20, width: 100, height: 50, color: rgb(0.1, 0.4, 0.8) });
  const ctx = doc.context;
  doc.catalog.set(N("Metadata"), ctx.register(ctx.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
  const icc = ctx.register(ctx.stream(new Uint8Array(128), { N: 3 }));
  doc.catalog.set(N("OutputIntents"), ctx.obj([{ Type: "OutputIntent", S: "GTS_PDFA1", OutputConditionIdentifier: PDFString.of("sRGB"), DestOutputProfile: icc }]));
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of("00112233"), PDFHexString.of("00112233")]);
  page.node.set(N("Annots"), ctx.obj([ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [20, 20, 120, 70], F: 4,
    A: { S: "URI", URI: PDFString.of("https://worksuitecloud.com/") } }))]));
  return doc;
}

async function save(doc: PDFDocument, name: string): Promise<string> {
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

async function check(path: string, password?: string) {
  const r = await h.call("POST", "/v1/pdf/check-pdfa", password ? { path, password } : { path });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as { claimed: string | null; passed: boolean; scope: string; pages: number | null;
    issues: { code: string; severity: string; count: number; detail?: string[] }[] };
}
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code).sort();

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-pdfa-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("pdf/a check", () => {
  it("passes a file that meets every structural requirement, and reads its claimed level", async () => {
    const r = await check(await save(await conforming(), "ok.pdf"));
    expect(r).toMatchObject({ claimed: "2b", passed: true, issues: [], scope: "structure", pages: 1 });
  });

  it("reads the level from element-style XMP too", async () => {
    expect((await check(await save(await conforming(XMP_ELEM), "ok3.pdf"))).claimed).toBe("3u");
  });

  it("lists every problem of a file that breaks the rules", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 300]);
    page.drawText("Not embedded", { x: 20, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    const ctx = doc.context;
    doc.addJavaScript("x", "app.alert(1)");
    doc.catalog.set(N("OpenAction"), ctx.obj({ S: "Launch", F: PDFString.of("calc.exe") }));
    page.node.set(N("Annots"), ctx.obj([
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], Contents: PDFString.of("note") })), // no print flag, no appearance
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 40, 60, 60], F: 4 | 2 })), // hidden
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Sound", Rect: [10, 70, 30, 90], F: 4 })),
    ]));
    const res = page.node.Resources()!;
    res.set(N("ExtGState"), ctx.obj({ G0: { Type: "ExtGState", TR: "Identity" } }));
    res.set(N("XObject"), ctx.obj({ X0: ctx.register(ctx.stream("x", { Type: "XObject", Subtype: "PS" })),
      X1: ctx.register(ctx.stream("x", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], Filter: "LZWDecode" })) }));
    await doc.attach(Buffer.from("data"), "data.txt", { mimeType: "text/plain" });
    doc.catalog.set(N("AcroForm"), ctx.obj({ Fields: [], NeedAppearances: true, XFA: PDFString.of("<xdp/>") }));
    const r = await check(await save(doc, "bad.pdf"));
    expect(r.passed).toBe(false);
    expect(r.claimed).toBeNull();
    expect(codes(r)).toEqual(["annotation_no_appearance", "annotation_not_printable", "embedded_files", "file_id_missing",
      "font_not_embedded", "forbidden_action", "forbidden_annotation", "javascript", "lzw", "need_appearances",
      "output_intent_missing", "pdfa_id_missing", "postscript", "transfer_function", "xfa"]);
    const by = Object.fromEntries(r.issues.map((i) => [i.code, i]));
    expect(by.font_not_embedded.detail).toEqual(["Helvetica"]);
    expect(by.forbidden_action.detail).toEqual(["Launch"]);
    expect(by.forbidden_annotation.detail).toEqual(["Sound"]);
    expect(by.annotation_not_printable.count).toBe(2);
    expect(by.embedded_files.severity).toBe("warning");
    expect(r.issues.findIndex((i) => i.severity === "warning")).toBe(r.issues.length - 1); // errors first
  });

  it("ignores objects nothing refers to (a leftover non-embedded font is not a problem)", async () => {
    const doc = await conforming();
    doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
    expect((await check(await save(doc, "leftover.pdf"))).passed).toBe(true);
  });

  it("Protect explains that a PDF/A file cannot have a password", async () => {
    const r = await h.call("POST", "/v1/pdf/protect", { path: await save(await conforming(), "archive.pdf"), userPassword: "pw" });
    const job = await h.svc.jobs.wait(r.json.jobId);
    expect(job.state).toBe("failed");
    expect(job.error).toMatchObject({ code: "bad_request", detail: { reason: "pdfa" } });
  });

  it("fails an encrypted file on that alone, and checks it fully with its password", async () => {
    // a file that does not claim PDF/A (pdf-lib refuses to encrypt one that does)
    const src = await save(await conforming("<x:xmpmeta/>"), "plain.pdf");
    const r = await h.call("POST", "/v1/pdf/protect", { path: src, userPassword: "pw" });
    const job = await h.svc.jobs.wait(r.json.jobId);
    expect(job.state, JSON.stringify(job.error)).toBe("done");
    const locked = (job.result as { file: string }).file;
    expect(await check(locked)).toMatchObject({ passed: false, issues: [{ code: "encrypted" }], pages: null });
    const withPw = await check(locked, "pw");
    expect(withPw.passed).toBe(false);
    expect(withPw.issues[0].code).toBe("encrypted");
    expect(withPw.pages).toBe(1);
  });

  it("refuses a relative or non-PDF path", async () => {
    expect((await h.call("POST", "/v1/pdf/check-pdfa", { path: "a.pdf" })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/check-pdfa", { path: join(dir, "a.txt") })).status).toBe(415);
  });
});
