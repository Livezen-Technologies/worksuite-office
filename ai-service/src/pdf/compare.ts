// Compare two PDFs by their text (Acrobat's "Compare files", text part). The words of the earlier and the later
// version are diffed over the whole document, so text that only moved to another page or line is not a change.
// The result is a copy of the later PDF: added words highlighted, each removed or replaced passage marked with
// a note ("Removed: ..." / "Was: ..."). Annotations, not drawn text, so any script survives and the changes show
// in the comments panel. Pictures and layout are not compared; scanned pages have no text to compare (noText).
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFPage, PDFRef } from "@cantoo/pdf-lib";
import type { PageText } from "./text";

/** A word and its box in the page's PDF coordinates (x, y the lower left, y up). */
export interface Word { t: string; page: number; x: number; y: number; w: number; h: number }
export interface Change { type: "added" | "removed" | "changed"; page: number; before: string; after: string }
export interface CompareSummary {
  identical: boolean;
  added: number; // words added
  removed: number; // words removed
  changes: number; // passages changed (each added, removed or replaced run)
  pages: number[]; // 1-based pages of the later version with changes
  noText: boolean; // one of the PDFs has no text at all (scanned?), so nothing could be compared
  byPage: boolean; // too many differences to align the whole text: compared page by page
}

const MAX_D_DOCUMENT = 3000; // edit distance up to which the whole text is aligned
const MAX_D_PAGE = 2000;
const MAX_NOTES = 2000; // annotations written; the summary still counts everything
const MAX_TEXT = 2000; // characters of a passage quoted in a note

/** A character's rough width relative to the others (Latin proportional fonts), to place a word inside a run of
 * text: pdf.js gives the run's box, not each character's. */
function charWidth(c: string): number {
  if (/\s/.test(c)) return 0.28;
  if (/[iljI.,:;'|!`]/.test(c)) return 0.27;
  if (/[ftr()[\]\-]/.test(c)) return 0.36;
  if (/[mw]/.test(c)) return 0.82;
  if (/[MW@%]/.test(c)) return 0.9;
  if (/[0-9]/.test(c)) return 0.55;
  if (/[A-Z]/.test(c)) return 0.67;
  if (/[a-z]/.test(c)) return 0.52;
  return 0.6;
}

export function words(pages: PageText[]): Word[] {
  const out: Word[] = [];
  pages.forEach((p, page) => {
    for (const it of p.items) {
      const len = it.str.length;
      if (!len) continue;
      const px = it.px ?? it.x, pw = it.pw ?? it.w, ph = it.ph ?? it.h;
      const base = it.py ?? p.height - it.y - it.h;
      const chars = Array.from(it.str), offs: number[] = [0];
      for (const c of chars) offs.push(offs[offs.length - 1] + charWidth(c));
      const total = offs[offs.length - 1] || 1;
      // UTF-16 index -> width before it
      const before = new Map<number, number>();
      for (let i = 0, u = 0; i <= chars.length; i++) { before.set(u, offs[i]); u += chars[i] ? chars[i].length : 0; }
      const re = /\S+/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(it.str))) {
        // control characters some fonts' text maps produce are not text (zero-width joiners are, and stay)
        const t = m[0].replace(/\p{Cc}/gu, "");
        if (!t) continue;
        // a word's share of the run, by characters; below the baseline for descenders
        const x0 = before.get(m.index) ?? (total * m.index) / len, x1 = before.get(m.index + m[0].length) ?? (total * (m.index + m[0].length)) / len;
        out.push({ t, page, x: px + (pw * x0) / total, y: base - ph * 0.22, w: (pw * (x1 - x0)) / total, h: ph * 1.2 });
      }
    }
  });
  return out;
}

type Op = { kind: "eq" | "del" | "ins"; a?: number; b?: number };

/** Myers O(ND) word alignment, or null when the edit distance exceeds maxD (memory grows with D squared). */
export function alignBounded(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length, m = b.length, off = maxD + 1;
  const v = new Int32Array(2 * maxD + 3).fill(-1);
  v[off + 1] = 0;
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= Math.min(n + m, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) return null;
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d], k = x - y;
    if (d === 0) { while (x > 0 && y > 0) { ops.push({ kind: "eq", a: --x, b: --y }); } break; }
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = vv[off + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ kind: "eq", a: --x, b: --y });
    if (x === prevX) ops.push({ kind: "ins", b: --y }); else ops.push({ kind: "del", a: --x });
  }
  return ops.reverse();
}

/** The alignment of the whole text, or page by page when the documents differ too much to align at once. */
function align(A: Word[], B: Word[]): { ops: Op[]; byPage: boolean } {
  const whole = alignBounded(A.map((w) => w.t), B.map((w) => w.t), MAX_D_DOCUMENT);
  if (whole) return { ops: whole, byPage: false };
  const ops: Op[] = [];
  const pages = Math.max(A.length ? A[A.length - 1].page + 1 : 0, B.length ? B[B.length - 1].page + 1 : 0);
  let ia = 0, ib = 0;
  for (let p = 0; p < pages; p++) {
    const a0 = ia, b0 = ib;
    while (ia < A.length && A[ia].page === p) ia++;
    while (ib < B.length && B[ib].page === p) ib++;
    const part = alignBounded(A.slice(a0, ia).map((w) => w.t), B.slice(b0, ib).map((w) => w.t), MAX_D_PAGE);
    if (part) for (const o of part) ops.push({ kind: o.kind, a: o.a === undefined ? undefined : o.a + a0, b: o.b === undefined ? undefined : o.b + b0 });
    else { for (let i = a0; i < ia; i++) ops.push({ kind: "del", a: i }); for (let i = b0; i < ib; i++) ops.push({ kind: "ins", b: i }); }
  }
  return { ops, byPage: true };
}

interface Run { del: number[]; ins: number[]; anchor: number } // anchor: the later version's word next to a removal

const JOIN_GAP = 2; // changes this few unchanged words apart read as one replaced passage

export function diffWords(A: Word[], B: Word[]): { runs: Run[]; byPage: boolean } {
  const { ops, byPage } = align(A, B);
  const runs: Run[] = [];
  let cur: Run | null = null, lastB = -1;
  let gap: Op[] = []; // the unchanged words since the last run
  for (const o of ops) {
    if (o.kind === "eq") {
      if (cur) { if (cur.anchor < 0) cur.anchor = o.b!; runs.push(cur); cur = null; gap = []; }
      gap.push(o);
      lastB = o.b!;
      continue;
    }
    if (!cur) {
      const prev = runs[runs.length - 1];
      // ... but never across the end of a sentence
      const ends = (w: Word | undefined) => !!w && /[.!?।。]$/u.test(w.t);
      const prevEnds = prev && (ends(B[prev.ins[prev.ins.length - 1]]) || ends(A[prev.del[prev.del.length - 1]]));
      if (prev && !prevEnds && gap.length && gap.length <= JOIN_GAP && !gap.some((g) => ends(B[g.b!]))) {
        // "This sentence will go" -> "A new sentence was added": one replacement, not three
        runs.pop();
        for (const g of gap) { prev.del.push(g.a!); prev.ins.push(g.b!); }
        cur = prev;
      } else cur = { del: [], ins: [], anchor: -1 };
      gap = [];
    }
    if (o.kind === "del") cur.del.push(o.a!); else cur.ins.push(o.b!);
    if (cur.anchor < 0 && lastB >= 0 && o.kind === "del") cur.anchor = lastB;
  }
  if (cur) { if (cur.anchor < 0) cur.anchor = lastB; runs.push(cur); }
  for (const r of runs) { r.del.sort((x, y) => x - y); r.ins.sort((x, y) => x - y); }
  return { runs, byPage };
}

const text = (ws: Word[], idx: number[]) => idx.map((i) => ws[i].t).join(" ");
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…" : s);

/** Highlights over the given words of one page: adjacent words on a line become one quad. */
function highlight(doc: PDFDocument, page: PDFPage, ws: Word[], contents: string): PDFRef {
  const quads: number[][] = [];
  for (const w of ws) {
    const q = quads[quads.length - 1];
    if (q && Math.abs(q[1] - w.y) < w.h * 0.5 && w.x - q[2] < w.h) { q[2] = w.x + w.w; q[3] = Math.max(q[3], w.y + w.h); q[1] = Math.min(q[1], w.y); }
    else quads.push([w.x, w.y, w.x + w.w, w.y + w.h]);
  }
  const x1 = Math.min(...quads.map((q) => q[0])), y1 = Math.min(...quads.map((q) => q[1]));
  const x2 = Math.max(...quads.map((q) => q[2])), y2 = Math.max(...quads.map((q) => q[3]));
  const ctx = doc.context;
  const draw = quads.map((q) => `${(q[0] - x1).toFixed(2)} ${(q[1] - y1).toFixed(2)} ${(q[2] - q[0]).toFixed(2)} ${(q[3] - q[1]).toFixed(2)} re f`).join("\n");
  const ap = ctx.register(ctx.stream(`q /G0 gs 0.55 0.9 0.55 rg\n${draw}\nQ`, {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, x2 - x1, y2 - y1], Matrix: [1, 0, 0, 1, x1, y1],
    Resources: { ExtGState: { G0: { Type: "ExtGState", BM: "Multiply" } } },
  }));
  return ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Highlight", Rect: [x1, y1, x2, y2], F: 4, C: [0.55, 0.9, 0.55], P: page.ref,
    QuadPoints: quads.flatMap((q) => [q[0], q[3], q[2], q[3], q[0], q[1], q[2], q[1]]),
    Contents: PDFHexString.fromText(contents), T: PDFHexString.fromText("WorkSuite Compare"), AP: { N: ap },
  }));
}

/** A small red note at a point, carrying the removed text. */
function note(doc: PDFDocument, page: PDFPage, x: number, y: number, contents: string): PDFRef {
  const ctx = doc.context, s = 14;
  const ap = ctx.register(ctx.stream(`0.86 0.2 0.2 rg 0 0 ${s} ${s} re f 1 1 1 rg 3 6 8 2 re f`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, s, s] }));
  return ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Text", Rect: [x, y, x + s, y + s], F: 4 | 8 | 16, C: [0.86, 0.2, 0.2], Name: "Comment", P: page.ref,
    Contents: PDFHexString.fromText(contents), T: PDFHexString.fromText("WorkSuite Compare"), AP: { N: ap },
  }));
}

/** Marks the differences on `later` (the later version's pdf-lib document) and returns what changed. */
export function markChanges(later: PDFDocument, earlierText: PageText[], laterText: PageText[]): { summary: CompareSummary; changes: Change[] } {
  const A = words(earlierText), B = words(laterText);
  const noText = !A.length || !B.length;
  const { runs, byPage } = noText ? { runs: [], byPage: false } : diffWords(A, B);
  const pages = later.getPages();
  const annots = new Map<number, PDFRef[]>();
  const add = (p: number, r: PDFRef) => { if (!annots.has(p)) annots.set(p, []); annots.get(p)!.push(r); };
  const changes: Change[] = [];
  const changedPages = new Set<number>();
  let added = 0, removed = 0, written = 0;
  for (const run of runs) {
    added += run.ins.length; removed += run.del.length;
    const before = text(A, run.del), after = text(B, run.ins);
    const type = run.ins.length && run.del.length ? "changed" : run.ins.length ? "added" : "removed";
    const at = run.ins.length ? B[run.ins[0]] : run.anchor >= 0 ? B[run.anchor] : null;
    const page = at ? at.page : 0;
    changes.push({ type, page: page + 1, before, after });
    if (written >= MAX_NOTES || !pages[page]) continue;
    if (run.ins.length) {
      // one highlight per page the inserted run touches
      const byP = new Map<number, Word[]>();
      for (const i of run.ins) { const w = B[i]; if (!byP.has(w.page)) byP.set(w.page, []); byP.get(w.page)!.push(w); }
      for (const [p, ws] of byP) {
        if (!pages[p]) continue;
        add(p, highlight(later, pages[p], ws, type === "changed" ? `Was: ${clip(before)}` : "Added"));
        changedPages.add(p + 1);
        written++;
      }
    } else if (at) {
      add(page, note(later, pages[page], Math.max(0, at.x - 16), at.y + at.h, `Removed: ${clip(before)}`));
      changedPages.add(page + 1);
      written++;
    }
  }
  for (const [p, refs] of annots) {
    const node = pages[p].node;
    const existing = node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (existing) for (const r of refs) existing.push(r);
    else node.set(PDFName.of("Annots"), later.context.obj(refs));
  }
  const summary: CompareSummary = {
    identical: !noText && runs.length === 0, added, removed, changes: runs.length,
    pages: [...changedPages].sort((a, b) => a - b), noText, byPage,
  };
  return { summary, changes };
}
