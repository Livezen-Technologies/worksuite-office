// PDF/A check: the main PDF/A-2b requirements (ISO 19005-2) that can be decided from the file's structure.
// Not a full conformance validator - it does not parse page content (colour spaces actually used, glyph
// coverage, transparency groups), so a file that passes here can still fail a certified checker such as veraPDF.
// It says so in its report (scope), and lists every problem it does find with a code, a severity and a count.
//
// Only objects reachable from the catalog are inspected, so unused leftovers do not raise false alarms.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from "@cantoo/pdf-lib";

export type Severity = "error" | "warning";
export interface PdfAIssue { code: string; severity: Severity; count: number; detail?: string[] }
export interface PdfAReport {
  claimed: string | null; // the PDF/A level the file says it meets, e.g. "2b", from its XMP
  passed: boolean; // no errors found (warnings allowed)
  issues: PdfAIssue[];
  scope: "structure"; // what was checked: the structure, not the page content
}

const N = (s: string) => PDFName.of(s);
const FORBIDDEN_ACTIONS = new Set(["Launch", "Sound", "Movie", "ResetForm", "ImportData", "Hide", "SetOCGState", "Rendition", "Trans", "GoTo3DView", "JavaScript"]);
const FORBIDDEN_ANNOTS = new Set(["Sound", "Movie", "Screen", "3D", "RichMedia"]);
const NO_APPEARANCE_NEEDED = new Set(["Popup", "Link"]);
// annotation flags (ISO 32000-1 12.5.3)
const F_INVISIBLE = 1, F_HIDDEN = 2, F_PRINT = 4, F_NOVIEW = 32;

function nameOf(o: PDFObject | undefined): string {
  return o instanceof PDFName ? o.decodeText() : "";
}

/** Every dictionary (stream dictionaries included) reachable from the catalog. */
function reachableDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  const seenRefs = new Set<string>();
  const seen = new Set<PDFObject>();
  const stack: (PDFObject | undefined)[] = [doc.context.trailerInfo.Root];
  while (stack.length) {
    const o = stack.pop();
    if (!o || seen.has(o)) continue;
    if (o instanceof PDFRef) {
      if (seenRefs.has(o.tag)) continue;
      seenRefs.add(o.tag);
      stack.push(doc.context.lookup(o));
      continue;
    }
    seen.add(o);
    if (o instanceof PDFDict) { out.push(o); for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v);
    else if (o instanceof PDFStream) stack.push(o.dict);
  }
  return out;
}

function look<T extends PDFObject>(doc: PDFDocument, o: PDFObject | undefined, type: { prototype: T }): T | undefined {
  const v: PDFObject | undefined = o instanceof PDFRef ? doc.context.lookup(o) : o;
  if (!v) return undefined;
  if (Object.prototype.isPrototypeOf.call(type.prototype, v)) return v as T;
  if ((type as unknown) === PDFDict && v instanceof PDFStream) return v.dict as unknown as T;
  return undefined;
}

/** The part and conformance in the catalog's XMP (pdfaid:part / pdfaid:conformance), e.g. "2b". */
function claimedLevel(doc: PDFDocument): string | null {
  const meta = doc.context.lookup(doc.catalog.get(N("Metadata")) as PDFRef | undefined);
  if (!(meta instanceof PDFRawStream)) return null;
  let xml = "";
  try { xml = Buffer.from(decodePDFRawStream(meta).decode()).toString("utf8"); } catch { xml = Buffer.from(meta.contents).toString("utf8"); }
  const part = /pdfaid:part\s*=\s*["'](\d)["']|<pdfaid:part>\s*(\d)\s*</.exec(xml);
  if (!part) return null;
  const conf = /pdfaid:conformance\s*=\s*["']([A-Za-z])["']|<pdfaid:conformance>\s*([A-Za-z])\s*</.exec(xml);
  return (part[1] || part[2]) + ((conf && (conf[1] || conf[2])) || "").toLowerCase();
}

export function checkPdfA(doc: PDFDocument): PdfAReport {
  const issues = new Map<string, PdfAIssue>();
  const add = (code: string, severity: Severity, detail?: string) => {
    const i = issues.get(code) || { code, severity, count: 0, detail: [] };
    i.count++;
    if (detail && i.detail!.length < 20 && !i.detail!.includes(detail)) i.detail!.push(detail);
    issues.set(code, i);
  };
  const catalog = doc.catalog;

  const claimed = claimedLevel(doc);
  if (!claimed) add("pdfa_id_missing", "error");
  else if (!/^[23]/.test(claimed)) add("pdfa_part_other", "warning", `PDF/A-${claimed}`);

  if (!doc.context.trailerInfo.ID) add("file_id_missing", "error");

  const intents = look(doc, catalog.get(N("OutputIntents")), PDFArray);
  const pdfaIntent = intents?.asArray().map((i) => look(doc, i, PDFDict)).find((d) => d && nameOf(d.get(N("S"))) === "GTS_PDFA1");
  if (!pdfaIntent) add("output_intent_missing", "error");
  else if (!(doc.context.lookup(pdfaIntent.get(N("DestOutputProfile")) as PDFRef | undefined) instanceof PDFStream)) add("output_intent_no_profile", "error");

  const names = look(doc, catalog.get(N("Names")), PDFDict);
  if (names?.has(N("JavaScript"))) add("javascript", "error", "document scripts");
  if (names?.has(N("EmbeddedFiles"))) add("embedded_files", "warning");

  const acro = look(doc, catalog.get(N("AcroForm")), PDFDict);
  if (acro?.has(N("XFA"))) add("xfa", "error");
  if (acro && acro.get(N("NeedAppearances"))?.toString() === "true") add("need_appearances", "error");

  for (const d of reachableDicts(doc)) {
    const type = nameOf(d.get(N("Type")));
    const subtype = nameOf(d.get(N("Subtype")));

    // actions: by their own /S, wherever they sit (A, OpenAction, AA entries, Next)
    const s = nameOf(d.get(N("S")));
    if (s && FORBIDDEN_ACTIONS.has(s) && (type === "" || type === "Action")) {
      if (s === "JavaScript") add("javascript", "error", "actions");
      else add("forbidden_action", "error", s);
    }
    if (d.has(N("AA")) && (d === catalog || type === "Page")) add("additional_actions", "error", type === "Page" ? "page" : "document");

    // streams: no LZW, no external files
    const filters = d.get(N("Filter"));
    const fl = filters instanceof PDFArray ? filters.asArray().map(nameOf) : [nameOf(filters)];
    if (fl.includes("LZWDecode")) add("lzw", "error");
    if (d.has(N("Length")) && d.has(N("F"))) add("external_stream", "error");

    // graphics state and XObjects
    if (type === "ExtGState" && d.has(N("TR"))) add("transfer_function", "error");
    if (type === "ExtGState" && d.has(N("TR2")) && nameOf(d.get(N("TR2"))) !== "Default") add("transfer_function", "error");
    if ((type === "XObject" || d.has(N("Subtype"))) && (subtype === "PS" || nameOf(d.get(N("Subtype2"))) === "PS")) add("postscript", "error");

    // fonts: every one drawn with must carry its font program
    if (type === "Font") {
      const base = nameOf(d.get(N("BaseFont"))) || "(unnamed)";
      if (subtype === "Type3") continue;
      const fontDict = subtype === "Type0" ? look(doc, look(doc, d.get(N("DescendantFonts")), PDFArray)?.get(0), PDFDict) : d;
      const desc = fontDict && look(doc, fontDict.get(N("FontDescriptor")), PDFDict);
      if (!desc || !(desc.has(N("FontFile")) || desc.has(N("FontFile2")) || desc.has(N("FontFile3")))) add("font_not_embedded", "error", base);
    }

  }

  // annotations: printable, visible, with an appearance, of an allowed kind
  for (const page of doc.getPages()) {
    const annots = look(doc, page.node.get(N("Annots")), PDFArray);
    for (const a of annots ? annots.asArray() : []) {
      const d = look(doc, a, PDFDict);
      const subtype = d ? nameOf(d.get(N("Subtype"))) : "";
      if (!d || !subtype || subtype === "Popup") continue;
      if (FORBIDDEN_ANNOTS.has(subtype)) { add("forbidden_annotation", "error", subtype); continue; }
      const f = d.get(N("F"));
      const flags = f instanceof PDFNumber ? f.asNumber() : 0;
      if (!(flags & F_PRINT) || flags & (F_INVISIBLE | F_HIDDEN | F_NOVIEW)) add("annotation_not_printable", "error", subtype);
      if (!NO_APPEARANCE_NEEDED.has(subtype)) {
        const ap = look(doc, d.get(N("AP")), PDFDict);
        if (!ap || !ap.has(N("N"))) add("annotation_no_appearance", "error", subtype);
      }
    }
  }

  const list = [...issues.values()].map((i) => (i.detail!.length ? i : { code: i.code, severity: i.severity, count: i.count }));
  list.sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === "error" ? -1 : 1));
  return { claimed, passed: !list.some((i) => i.severity === "error"), issues: list, scope: "structure" };
}
