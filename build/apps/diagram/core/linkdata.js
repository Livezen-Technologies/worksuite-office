/*
 * WorkSuite Diagram: link data to shapes (roadmap stage 6), Visio's Link Data. Pure ES module, no DOM.
 *
 * A table (CSV or the first sheet of an XLSX file, the first row naming the columns) is matched to the page's shapes
 * by a key column: a row belongs to the shape whose shape data has that column's value, or else whose text (its first
 * line) is that value, letters' case aside. Every column of the row then becomes the shape's data (shapedata.js),
 * numbers and yes/no kept as such. Rows with no shape can be added as new shapes. The page remembers the source's
 * name and key column, so Refresh Data can apply a newer copy of the file the same way.
 */
import { parseTable } from "./fromtable.js";
import { parseDataValue } from "./shapedata.js";
import { unzipAsync } from "../../common/zip.js";
import { parseXml } from "../../project/core/projectxml.js";

const local = (n) => n.replace(/^.*:/, "");
const kids = (el, name) => (el ? el.children.filter((c) => local(c.name) === name) : []);
const kid = (el, name) => kids(el, name)[0];
const textOf = (el) => (el ? el.text + el.children.map(textOf).join("") : "");

/** The column index of a cell reference: A1 → 0, AB7 → 27. */
export const colOf = (ref) => [...String(ref).replace(/\d+$/, "").toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The rows of the first sheet of an XLSX file, as text. */
export async function readXlsxRows(bytes) {
  const files = await unzipAsync(bytes), dec = new TextDecoder();
  const read = (n) => (files[n] ? dec.decode(files[n]) : null);
  const shared = read("xl/sharedStrings.xml") ? kids(parseXml(read("xl/sharedStrings.xml")), "si").map((si) => kids(si, "t").length ? kids(si, "t").map((t) => t.text).join("") : kids(si, "r").map((r) => kid(r, "t")?.text || "").join("")) : [];
  // the first sheet: the workbook's first <sheet>, through its relationship; else the first worksheet file
  let path = null;
  const wb = read("xl/workbook.xml"), rels = read("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = kid(kid(parseXml(wb), "sheets"), "sheet"), rid = first && (first.attrs["r:id"] || Object.entries(first.attrs).find(([k]) => /:id$/.test(k))?.[1]);
    const rel = kids(parseXml(rels), "Relationship").find((r) => r.attrs.Id === rid);
    if (rel) path = "xl/" + rel.attrs.Target.replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  if (!path || !files[path]) path = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!path) throw new Error("the workbook has no sheet");
  const rows = [];
  for (const r of kids(kid(parseXml(read(path)), "sheetData"), "row")) {
    const row = [];
    for (const c of kids(r, "c")) {
      const i = c.attrs.r ? colOf(c.attrs.r) : row.length, t = c.attrs.t;
      const v = kid(c, "v")?.text ?? "";
      row[i] = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? textOf(kid(c, "is")) : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
    }
    rows.push(Array.from(row, (x) => (x ?? "").trim()));
  }
  return rows.filter((r) => r.some(Boolean));
}

/** A table from a file's bytes: XLSX by its zip signature, else CSV or tab-separated text. */
export async function readTableFile(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsxRows(bytes);
  return parseTable(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Matches rows to shapes: { header, matches: [{ id, row }], unmatched: [row] }. `rows` include the header row first.
 * Lanes are never matched.
 */
export function matchRows(items, rows, key) {
  const [header, ...body] = rows, k = header.findIndex((h) => norm(h) === norm(key));
  if (k < 0) throw new Error(`there is no column called ${key}`);
  const shapes = items.filter((i) => i.kind === "shape" && i.type !== "lane");
  const byData = new Map(), byText = new Map();
  for (const s of shapes) {
    const d = (s.data || []).find((x) => norm(x.label) === norm(header[k]));
    if (d && !byData.has(norm(d.value))) byData.set(norm(d.value), s.id);
    const t = norm(String(s.text || "").split("\n")[0]);
    if (t && !byText.has(t)) byText.set(t, s.id);
  }
  const matches = [], unmatched = [], used = new Set();
  for (const row of body) {
    const v = norm(row[k]);
    if (!v) continue;
    const id = byData.get(v) || byText.get(v);
    if (id && !used.has(id)) { matches.push({ id, row }); used.add(id); } else if (!id) unmatched.push(row);
  }
  return { header, keyIndex: k, matches, unmatched };
}

/** A shape's data with a row's columns written over it (empty cells clear nothing). */
export function mergeRow(data = [], header, row) {
  const out = data.map((d) => ({ ...d }));
  header.forEach((h, i) => {
    const label = String(h || "").trim(), cell = row[i];
    if (!label || cell === undefined || cell === "") return;
    const value = parseDataValue(cell), at = out.findIndex((d) => norm(d.label) === norm(label));
    if (at >= 0) out[at].value = value; else out.push({ label, value });
  });
  return out;
}
