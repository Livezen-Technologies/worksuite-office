// /v1/pdf/compare: the later version marked with what changed since the earlier one (src/pdf/compare.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";
import { alignBounded } from "../src/pdf/compare";

let h: Harness;
let dir: string;
const N = (s: string) => PDFName.of(s);

/** A PDF whose pages carry the given lines of text, top to bottom. */
async function pdf(name: string, pages: string[][], extra?: (doc: PDFDocument) => void, size = 12): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([500, 700]);
    lines.forEach((l, i) => page.drawText(l, { x: 20, y: 680 - i * size * 2, size, font }));
  }
  extra?.(doc);
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

type Result = { file: string; pages: number; summary: { identical: boolean; added: number; removed: number; changes: number; pages: number[]; noText: boolean; byPage: boolean };
  changes: { type: string; page: number; before: string; after: string }[] };

async function compare(path: string, other: string): Promise<Result> {
  const r = await h.call("POST", "/v1/pdf/compare", { path, other });
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  const j = await h.svc.jobs.wait(r.json.jobId);
  expect(j.state, JSON.stringify(j.error)).toBe("done");
  return j.result as Result;
}

async function annots(file: string, page = 0) {
  const doc = await PDFDocument.load(readFileSync(file));
  const arr = doc.getPage(page).node.lookupMaybe(N("Annots"), PDFArray);
  return (arr ? arr.asArray() : []).map((a) => {
    const d = doc.context.lookup(a) as PDFDict;
    const c = d.get(N("Contents"));
    return { subtype: (d.get(N("Subtype")) as PDFName).decodeText(), contents: c instanceof PDFHexString || c instanceof PDFString ? c.decodeText() : "",
      hasAppearance: !!d.lookupMaybe(N("AP"), PDFDict) };
  });
}

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-compare-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("pdf compare", () => {
  it("finds no change between identical texts and adds no marks", async () => {
    const lines = [["The quarterly report covers sales.", "Revenue grew in every region."]];
    const r = await compare(await pdf("a2.pdf", lines), await pdf("a1.pdf", lines));
    expect(r.summary).toMatchObject({ identical: true, changes: 0, noText: false, byPage: false });
    expect(await annots(r.file)).toEqual([]);
  });

  it("does not count text that only moved to the next page or line", async () => {
    const earlier = await pdf("m1.pdf", [["One two three four five", "six seven eight"]]);
    const later = await pdf("m2.pdf", [["One two three"], ["four five six", "seven eight"]]);
    expect((await compare(later, earlier)).summary.identical).toBe(true);
  });

  it("marks a replaced word, an added sentence and a removed sentence", async () => {
    const earlier = await pdf("v1.pdf", [["The budget is 120000 dollars.", "This line goes away.", "Closing words stay."]]);
    const later = await pdf("v2.pdf", [["The budget is 150000 dollars.", "Closing words stay.", "A brand new line arrives."]]);
    const r = await compare(later, earlier);
    expect(r.file).toBe(join(dir, "v2 (compared).pdf"));
    expect(r.summary).toMatchObject({ identical: false, changes: 3, pages: [1] });
    expect(r.changes).toEqual([
      { type: "changed", page: 1, before: "120000", after: "150000" },
      { type: "removed", page: 1, before: "This line goes away.", after: "" },
      { type: "added", page: 1, before: "", after: "A brand new line arrives." },
    ]);
    const marks = await annots(r.file);
    expect(marks).toEqual(expect.arrayContaining([
      { subtype: "Highlight", contents: "Was: 120000", hasAppearance: true },
      { subtype: "Text", contents: "Removed: This line goes away.", hasAppearance: true },
      { subtype: "Highlight", contents: "Added", hasAppearance: true },
    ]));
  });

  it("joins a change split by a word or two, but not across the end of a sentence", async () => {
    const earlier = await pdf("j1.pdf", [["This sentence will be removed now. Total 10 units."]]);
    const later = await pdf("j2.pdf", [["A new sentence was added today. Total 12 units."]]);
    const r = await compare(later, earlier);
    expect(r.changes.map((c) => [c.before, c.after])).toEqual([
      ["This sentence will be removed now.", "A new sentence was added today."],
      ["10", "12"],
    ]);
  });

  it("puts the marks on the page where the change is", async () => {
    const earlier = await pdf("p1.pdf", [["Page one text."], ["Page two says hello."]]);
    const later = await pdf("p2.pdf", [["Page one text."], ["Page two says goodbye."]]);
    const r = await compare(later, earlier);
    expect(r.summary.pages).toEqual([2]);
    expect(await annots(r.file, 0)).toEqual([]);
    expect((await annots(r.file, 1)).map((a) => a.contents)).toEqual(["Was: hello."]);
  });

  it("keeps the later PDF's own annotations", async () => {
    const earlier = await pdf("k1.pdf", [["Alpha beta."]]);
    const later = await pdf("k2.pdf", [["Alpha gamma."]], (doc) => {
      doc.getPage(0).node.set(N("Annots"), doc.context.obj([doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10] })]));
    });
    expect((await annots((await compare(later, earlier)).file)).map((a) => a.subtype)).toEqual(["Link", "Highlight"]);
  });

  it("says when a PDF has no text to compare (scanned)", async () => {
    const r = await compare(await pdf("s2.pdf", [[]]), await pdf("s1.pdf", [["Some text."]]));
    expect(r.summary).toMatchObject({ noText: true, identical: false });
  });

  it("refuses to compare a file with itself, and bad paths", async () => {
    const p = await pdf("same.pdf", [["x"]]);
    expect((await h.call("POST", "/v1/pdf/compare", { path: p, other: p })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/compare", { path: p })).status).toBe(400);
    expect((await h.call("POST", "/v1/pdf/compare", { path: p, other: join(dir, "x.txt") })).status).toBe(415);
  });
});

describe("bounded alignment", () => {
  it("aligns within the bound and gives up beyond it", () => {
    const a = "a b c d e f".split(" "), b = "a x c d y f z".split(" ");
    const ops = alignBounded(a, b, 10)!;
    expect(ops.filter((o) => o.kind === "eq").map((o) => a[o.a!])).toEqual(["a", "c", "d", "f"]);
    expect(alignBounded(a, b, 2)).toBeNull();
  });

  it("falls back to page by page when two long documents are too different", async () => {
    // 1600 different words a side, small enough to stay on the page: too far apart to align at once
    const words = (seed: string) => Array.from({ length: 80 }, (_, i) => Array.from({ length: 20 }, (_, j) => `${seed}${i}x${j}`).join(" "));
    const earlier = await pdf("big1.pdf", [words("a").slice(0, 40), words("a").slice(40)], undefined, 4);
    const later = await pdf("big2.pdf", [words("b").slice(0, 40), words("b").slice(40)], undefined, 4);
    const r = await compare(later, earlier);
    expect(r.summary.byPage).toBe(true);
    expect(r.summary.pages).toEqual([1, 2]);
  });
});
