// Remove hidden information from a PDF (Acrobat's "Sanitize document"): what a reader does not see on the page
// but a recipient can still pull out of the file. Works on a loaded document; tools.ts sanitizeJob saves the
// copy. The caller loads with updateMetadata:false, so pdf-lib writes no Producer or dates of its own.
//
// Removed: the document information dictionary and every XMP stream; JavaScript (document scripts, the open
// action, additional actions, JavaScript links and form actions); embedded files and file-attachment annotations;
// comments (markup annotations and their pop-ups - links and form fields stay); page thumbnails; application
// private data (PieceInfo). Then everything nothing refers to any more is dropped, and the file is written
// whole, so earlier saved revisions do not survive either.
//
// Not touched: hidden layers (optional content). Their content is in the page streams; dropping it safely means
// rewriting those streams, so it is reported (hiddenLayers) rather than half done.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from "@cantoo/pdf-lib";

export interface SanitizeReport {
  metadata: number; // info dictionaries and XMP streams
  scripts: number; // JavaScript entries and actions
  attachments: number; // embedded files and file-attachment annotations
  comments: number; // markup annotations and pop-ups
  thumbnails: number;
  privateData: number; // PieceInfo dictionaries
  unreferenced: number; // objects nothing referred to after the clean-up
  hiddenLayers: boolean; // the file has optional content, which is left as it is
}

const N = (s: string) => PDFName.of(s);
// annotations that are part of what the page is, not comments on it
const KEEP_ANNOTS = new Set(["Link", "Widget", "PrinterMark", "TrapNet", "Watermark", "3D", "RichMedia", "Screen", "Movie", "Sound"]);

function dictOf(o: PDFObject | undefined, doc: PDFDocument): PDFDict | undefined {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o;
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

function isJavaScriptAction(o: PDFObject | undefined, doc: PDFDocument): boolean {
  const d = dictOf(o, doc);
  return !!d && d.get(N("S")) === N("JavaScript");
}

/** Every dictionary in the file, stream dictionaries included, plus the catalog and page tree. */
function allDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  const walk = (o: PDFObject | undefined) => {
    if (o instanceof PDFDict) { out.push(o); for (const [, v] of o.entries()) if (!(v instanceof PDFRef)) walk(v); }
    else if (o instanceof PDFArray) { for (const v of o.asArray()) if (!(v instanceof PDFRef)) walk(v); }
    else if (o instanceof PDFStream) walk(o.dict);
  };
  for (const [, o] of doc.context.enumerateIndirectObjects()) walk(o);
  return out;
}

export function sanitizePdf(doc: PDFDocument): SanitizeReport {
  const r: SanitizeReport = { metadata: 0, scripts: 0, attachments: 0, comments: 0, thumbnails: 0, privateData: 0, unreferenced: 0, hiddenLayers: false };
  const catalog = doc.catalog;
  r.hiddenLayers = catalog.has(N("OCProperties"));

  // document information dictionary (Author, Creator, Producer, dates, custom keys)
  if (doc.context.trailerInfo.Info) { doc.context.trailerInfo.Info = undefined; r.metadata++; }

  // names: document-level JavaScript and embedded files
  const names = dictOf(catalog.get(N("Names")), doc);
  if (names?.has(N("JavaScript"))) { names.delete(N("JavaScript")); r.scripts++; }
  if (names?.has(N("EmbeddedFiles"))) { names.delete(N("EmbeddedFiles")); r.attachments++; }

  // pages: comments, attachments, thumbnails
  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.has(N("Thumb"))) { node.delete(N("Thumb")); r.thumbnails++; }
    const annots = node.lookupMaybe(N("Annots"), PDFArray);
    if (!annots) continue;
    const kept: PDFObject[] = [];
    for (const a of annots.asArray()) {
      const d = dictOf(a, doc);
      const sub = d?.get(N("Subtype"));
      const name = sub instanceof PDFName ? sub.decodeText() : "";
      if (name === "FileAttachment") { r.attachments++; continue; }
      if (d && !KEEP_ANNOTS.has(name)) { r.comments++; continue; }
      kept.push(a);
    }
    if (kept.length === annots.size()) continue;
    if (kept.length) node.set(N("Annots"), doc.context.obj(kept));
    else node.delete(N("Annots"));
  }

  // every dictionary: XMP, private data, actions that run JavaScript, attached-file references
  for (const d of allDicts(doc)) {
    if (d.has(N("Metadata"))) { d.delete(N("Metadata")); r.metadata++; }
    if (d.has(N("PieceInfo"))) { d.delete(N("PieceInfo")); r.privateData++; }
    if (d.has(N("LastModified"))) d.delete(N("LastModified"));
    if (d.has(N("AA"))) { d.delete(N("AA")); r.scripts++; }
    for (const key of ["A", "OpenAction", "Next"]) {
      if (isJavaScriptAction(d.get(N(key)), doc)) { d.delete(N(key)); r.scripts++; }
    }
    if (d.has(N("AF"))) { d.delete(N("AF")); r.attachments++; }
  }

  r.unreferenced = dropUnreferenced(doc);
  return r;
}

/** Deletes every indirect object that cannot be reached from the catalog; returns how many. */
export function dropUnreferenced(doc: PDFDocument): number {
  const seen = new Set<string>();
  const stack: (PDFObject | undefined)[] = [doc.context.trailerInfo.Root, doc.context.trailerInfo.Info];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      stack.push(doc.context.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let n = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) { doc.context.delete(ref); n++; }
  }
  return n;
}

/** References to objects the parser could not read (pdf-lib drops what it cannot parse). A copy written from
 * such a document would point at nothing, so the caller refuses it rather than hand back a damaged file. */
export function unreadableRefs(doc: PDFDocument): number {
  let n = 0;
  const seen = new Set<string>();
  const visit = (o: PDFObject | undefined) => {
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) return;
      seen.add(o.tag);
      if (doc.context.lookup(o) === undefined) n++;
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) visit(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) visit(v);
    } else if (o instanceof PDFStream) {
      visit(o.dict);
    }
  };
  for (const [, o] of doc.context.enumerateIndirectObjects()) visit(o);
  return n;
}
