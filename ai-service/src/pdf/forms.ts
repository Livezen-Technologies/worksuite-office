// PDF form data: read every field's value, fill fields from data, and flatten (fields become page content).
// Data travels as JSON ({name: value}), CSV (field,value rows) or XFDF (Adobe's XML form data).
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from "@cantoo/pdf-lib";
import { ApiError } from "../errors";
import { esc } from "./office";

export type FormValue = string | boolean | string[];
export type FormFormat = "json" | "csv" | "xfdf";

/** Field name → value: text, a checkbox's true/false, the chosen option(s). Buttons and signatures are left out. */
export function readForm(doc: PDFDocument): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) out[name] = f.getText() ?? "";
    else if (f instanceof PDFCheckBox) out[name] = f.isChecked();
    else if (f instanceof PDFRadioGroup) out[name] = f.getSelected() ?? "";
    else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      const sel = f.getSelected();
      out[name] = sel.length > 1 ? sel : sel[0] ?? "";
    }
  }
  return out;
}

const truthy = (v: FormValue) => v === true || (typeof v === "string" && /^(true|yes|on|1|x|✓)$/i.test(v.trim()));

/** Sets the fields named in data; unknown names are reported, not fatal. */
export function fillForm(doc: PDFDocument, data: Record<string, FormValue>): { filled: number; unknown: string[] } {
  const form = doc.getForm();
  const fields = new Map(form.getFields().map((f) => [f.getName(), f]));
  let filled = 0;
  const unknown: string[] = [];
  for (const [name, value] of Object.entries(data)) {
    const f = fields.get(name);
    if (!f) { unknown.push(name); continue; }
    // a choice must be one of the field's options (an editable dropdown also takes free text)
    const choice = (options: string[], wanted: string[], free = false) => {
      const bad = wanted.find((w) => w && !options.includes(w));
      if (bad !== undefined && !free) throw new ApiError("bad_request", `"${bad}" is not a value of the field "${name}"`, { field: name, options });
    };
    if (f instanceof PDFRadioGroup) choice(f.getOptions(), [String(value)]);
    if (f instanceof PDFDropdown) choice(f.getOptions(), Array.isArray(value) ? value : [String(value)], f.isEditable());
    if (f instanceof PDFOptionList) choice(f.getOptions(), Array.isArray(value) ? value : [String(value)]);
    try {
      if (f instanceof PDFTextField) f.setText(Array.isArray(value) ? value.join(", ") : String(value));
      else if (f instanceof PDFCheckBox) (truthy(value) ? f.check() : f.uncheck());
      else if (f instanceof PDFRadioGroup) { if (String(value)) f.select(String(value)); else f.clear(); }
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) f.select(Array.isArray(value) ? value : String(value));
      else { unknown.push(name); continue; }
      filled++;
    } catch (e) {
      throw new ApiError("bad_request", `"${String(value)}" is not a value of the field "${name}"`, { field: name, reason: (e as Error).message });
    }
  }
  return { filled, unknown };
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function formatData(data: Record<string, FormValue>, format: FormFormat): string {
  if (format === "json") return JSON.stringify(data, null, 2) + "\n";
  const str = (v: FormValue) => (Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? (v ? "Yes" : "Off") : v);
  if (format === "csv") return "field,value\r\n" + Object.entries(data).map(([k, v]) => `${csvCell(k)},${csvCell(str(v))}`).join("\r\n") + "\r\n";
  return '<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n<fields>\n' +
    Object.entries(data).map(([k, v]) => `<field name="${esc(k)}">` + (Array.isArray(v) ? v : [str(v)]).map((x) => `<value>${esc(x)}</value>`).join("") + "</field>").join("\n") +
    "\n</fields>\n</xfdf>\n";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

const unesc = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) =>
  d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" } as Record<string, string>)[n.toLowerCase()]);

/** Form data from a file's text, by its format. */
export function parseData(text: string, format: FormFormat): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  if (format === "json") {
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new ApiError("bad_request", "The form data is not JSON"); }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new ApiError("bad_request", "The form data must be a JSON object of field names and values");
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === "boolean" ? x : Array.isArray(x) ? x.map(String) : x === null || x === undefined ? "" : String(x);
    }
    return out;
  }
  if (format === "csv") {
    const rows = parseCsv(text.replace(/^﻿/, ""));
    if (rows[0] && /^field$/i.test(rows[0][0]?.trim() || "")) rows.shift();
    for (const r of rows) if (r[0]) out[r[0]] = r[1] ?? "";
    return out;
  }
  const re = /<field\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/field>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const values = [...m[2].matchAll(/<value>([\s\S]*?)<\/value>/g)].map((v) => unesc(v[1]));
    out[unesc(m[1])] = values.length > 1 ? values : values[0] ?? "";
  }
  if (!Object.keys(out).length && !/<xfdf\b/.test(text)) throw new ApiError("bad_request", "The form data is not XFDF");
  return out;
}

export function formatOf(path: string): FormFormat {
  const m = /\.(json|csv|xfdf)$/i.exec(path);
  if (!m) throw new ApiError("unsupported_media", "Form data must be a .json, .csv or .xfdf file", { path });
  return m[1].toLowerCase() as FormFormat;
}
