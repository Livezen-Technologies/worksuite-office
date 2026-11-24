/*
 * WorkSuite Diagram: reports on shape data (roadmap stage 6). Pure ES module, no DOM.
 *
 * shapeReport(doc, options) lists the shapes that have data (or every shape), one row each, with a column per data
 * name, formulas worked out (smart.js), and totals for number columns. It goes to a table on screen, CSV or XLSX.
 * options: { pages: "all" | page id, onlyWithData (default true), types (shape types to keep; default all) }.
 */

import { computeData, shapeText } from "./smart.js";
import { formatDataValue } from "./shapedata.js";

const STRUCTURE = new Set(["lane", "container", "callout", "dimension"]);

export function shapeReport(doc, { pages = "all", onlyWithData = true, types = null } = {}) {
  const rows = [], columns = [], seen = new Set();
  for (const page of doc.pages) {
    if (pages !== "all" && page.id !== pages) continue;
    for (const s of page.items) {
      if (s.kind !== "shape" || STRUCTURE.has(s.type) || (types && !types.includes(s.type))) continue;
      if (onlyWithData && !s.data?.length) continue;
      const values = {};
      for (const d of computeData(s, page)) {
        const key = d.label.trim();
        if (!seen.has(key.toLowerCase())) { seen.add(key.toLowerCase()); columns.push(key); }
        values[columns.find((c) => c.toLowerCase() === key.toLowerCase())] = d.value;
      }
      rows.push({ page: page.name, id: s.id, shape: shapeText(s, page).split("\n")[0] || s.type, type: s.type, values });
    }
  }
  const totals = {};
  for (const c of columns) {
    const nums = rows.map((r) => r.values[c]).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (nums.length && nums.length === rows.filter((r) => r.values[c] !== undefined && r.values[c] !== "").length) totals[c] = Math.round(nums.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
  }
  return { columns, rows, totals };
}

/** The report as table rows (header first, totals last), for CSV and XLSX. */
export function reportTable(rep) {
  const head = ["Page", "Shape", "Type", ...rep.columns];
  const body = rep.rows.map((r) => [r.page, r.shape, r.type, ...rep.columns.map((c) => (r.values[c] === undefined ? "" : typeof r.values[c] === "number" ? r.values[c] : formatDataValue(r.values[c])))]);
  const out = [head, ...body];
  if (Object.keys(rep.totals).length) out.push(["Total", "", "", ...rep.columns.map((c) => (c in rep.totals ? rep.totals[c] : ""))]);
  return out;
}

/** CSV with quoting where needed. */
export const toCsv = (table) => table.map((row) => row.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n") + "\r\n";
