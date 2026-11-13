// /v1/pdf/sanitize: a copy with the hidden information removed. The input carries every kind under a
// SECRET-* marker; afterwards no SECRET string may remain anywhere in the file (every stream decoded), while
// the pages, the drawn content and plain links stay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePDFRawStream, PDFArray, PDFRef, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";

let h: Harness;
let dir: string;

const N = (s: string) => PDFName.of(s);

async function planted(): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("SECRET-AUTHOR");
  doc.setTitle("SECRET-TITLE");
  doc.setKeywords(["SECRET-KEYWORD"]);
  const page = doc.addPage([400, 400]);
  page.drawText("Visible page text", { x: 40, y: 300, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  const ctx = doc.context;

  doc.catalog.set(N("Metadata"), ctx.register(ctx.flateStream("<x:xmpmeta>SECRET-XMP</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" })));
  doc.addJavaScript("hello", 'app.alert("SECRET-DOCJS")');
  doc.catalog.set(N("OpenAction"), ctx.obj({ S: "JavaScript", JS: PDFString.of('app.alert("SECRET-OPENJS")') }));
  await doc.attach(Buffer.from("SECRET-ATTACHMENT-BODY"), "secret.txt", { mimeType: "text/plain", description: "SECRET-ATTACH-DESC" });

  page.node.set(N("Thumb"), ctx.register(ctx.flateStream("SECRET-THUMB")));
  page.node.set(N("PieceInfo"), ctx.obj({ App: { Private: PDFString.of("SECRET-PIECE") } }));
  page.node.set(N("AA"), ctx.obj({ O: { S: "JavaScript", JS: PDFString.of("SECRET-PAGEJS") } }));

  const annots = [
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], Contents: PDFString.of("SECRET-COMMENT"), T: PDFString.of("SECRET-REVIEWER") })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Highlight", Rect: [40, 290, 200, 320], Contents: PDFString.of("SECRET-HIGHLIGHT") })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [50, 10, 70, 30],
      FS: { Type: "Filespec", F: PDFString.of("SECRET-ANNOT-FILE.txt") } })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 50, 100, 70], A: { S: "URI", URI: PDFString.of("https://worksuitecloud.com/") } })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 80, 100, 100], A: { S: "JavaScript", JS: PDFString.of("SECRET-LINKJS") } })),
  ];
  page.node.set(N("Annots"), ctx.obj(annots));

  const p = join(dir, "report.pdf");
  writeFileSync(p, await doc.save({ useObjectStreams: false }));
  return p;
}

/** Every string and decoded stream in the file, as one searchable text. */
async function everything(path: string): Promise<{ text: string; doc: PDFDocument }> {
  const doc = await PDFDocument.load(readFileSync(path), { updateMetadata: false });
  const parts: string[] = [];
  const walk = (o: unknown) => {
    if (o instanceof PDFString || o instanceof PDFHexString) parts.push(o.decodeText());
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) walk(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) walk(v);
    else if (o instanceof PDFRawStream) { walk(o.dict); try { parts.push(Buffer.from(decodePDFRawStream(o).decode()).toString("latin1")); } catch { parts.push(Buffer.from(o.contents).toString("latin1")); } }
    else if (o instanceof PDFStream) walk(o.dict);
  };
  for (const [, o] of doc.context.enumerateIndirectObjects()) walk(o);
  if (doc.context.trailerInfo.Info) walk(doc.context.lookup(doc.context.trailerInfo.Info));
  return { text: parts.join("\n"), doc };
}

async function sanitize(body: unknown) {
  const r = await h.call("POST", "/v1/pdf/sanitize", body);
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  return h.svc.jobs.wait(r.json.jobId);
}

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-sanitize-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("pdf sanitize", () => {
  it("the planted file really carries every secret (the test would prove nothing otherwise)", async () => {
    const { text } = await everything(await planted());
    for (const s of ["AUTHOR", "TITLE", "KEYWORD", "XMP", "DOCJS", "OPENJS", "ATTACHMENT-BODY", "ATTACH-DESC", "THUMB", "PIECE",
      "PAGEJS", "COMMENT", "REVIEWER", "HIGHLIGHT", "ANNOT-FILE", "LINKJS"]) expect(text, s).toContain(`SECRET-${s}`);
  });

  it("removes all of it, keeps the page, its content and plain links, and leaves the original alone", async () => {
    const src = await planted();
    const before = readFileSync(src);
    const j = await sanitize({ path: src });
    expect(j.state, JSON.stringify(j.error)).toBe("done");
    const res = j.result as { file: string; pages: number; removed: Record<string, number | boolean> };
    expect(res.file).toBe(join(dir, "report (sanitized).pdf"));
    expect(res.pages).toBe(1);
    expect(readFileSync(src).equals(before)).toBe(true);

    const { text, doc } = await everything(res.file);
    expect(text).not.toMatch(/SECRET/);
    expect(doc.context.trailerInfo.Info).toBeUndefined();

    const page = doc.getPage(0);
    expect(page.node.get(N("Contents"))).toBeDefined();
    const kept = (page.node.lookup(N("Annots"), PDFArray)).asArray().map((a) => doc.context.lookup(a) as PDFDict);
    expect(kept.map((a) => (a.get(N("Subtype")) as PDFName).decodeText())).toEqual(["Link", "Link"]);
    expect(kept[0].lookup(N("A"), PDFDict).get(N("URI"))).toBeDefined(); // the web link still works
    expect(kept[1].get(N("A"))).toBeUndefined(); // the JavaScript link no longer runs anything

    expect(res.removed).toMatchObject({ hiddenLayers: false });
    for (const k of ["metadata", "scripts", "attachments", "comments", "thumbnails", "privateData", "unreferenced"])
      expect(res.removed[k], k).toBeGreaterThan(0);
  });

  it("writes no Producer or dates of its own", async () => {
    const j = await sanitize({ path: await planted() });
    const out = readFileSync((j.result as { file: string }).file).toString("latin1");
    expect(out).not.toMatch(/\/Producer|\/CreationDate|\/ModDate|pdf-lib/);
  });

  it("reports hidden layers instead of claiming to remove them", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const ocg = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of("Draft") }));
    doc.catalog.set(N("OCProperties"), doc.context.obj({ OCGs: [ocg], D: { OFF: [ocg] } }));
    const p = join(dir, "layers.pdf");
    writeFileSync(p, await doc.save());
    const j = await sanitize({ path: p });
    expect((j.result as { removed: { hiddenLayers: boolean } }).removed.hiddenLayers).toBe(true);
  });

  it("refuses a file with parts that could not be read rather than writing a damaged copy", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.node.set(N("Annots"), doc.context.obj([PDFRef.of(999, 0)])); // points at an object the file does not have
    const p = join(dir, "broken.pdf");
    writeFileSync(p, await doc.save());
    const j = await sanitize({ path: p });
    expect(j.state).toBe("failed");
    expect(j.error).toMatchObject({ code: "unsupported_media", detail: { reason: "unreadable_parts" } });
  });

  it("refuses a missing file and a non-PDF path", async () => {
    expect((await h.call("POST", "/v1/pdf/sanitize", { path: "relative.pdf" })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/sanitize", { path: join(dir, "notes.txt") })).status).toBe(415);
    const j = await sanitize({ path: join(dir, "missing.pdf") });
    expect(j.state).toBe("failed");
  });
});
