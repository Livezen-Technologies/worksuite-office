/*
 * WorkSuite Diagram: shape data (roadmap stage 6), Visio's Shape Data. Pure ES module, no DOM.
 *
 * A shape's `data` is a list of named values: [{ label, value }], value text, a number or true/false, labels unique.
 * In a Visio file each one is a row of the shape's Property section: Prop.<name> with Label, Value and Type
 * (0 text, 2 number, 3 yes/no).
 */

/** What is wrong with a shape's data, or null. */
export function dataError(data) {
  if (data === undefined) return null;
  if (!Array.isArray(data)) return "shape data must be a list";
  const seen = new Set();
  for (const d of data) {
    if (!d || typeof d.label !== "string" || !d.label.trim()) return "shape data needs a label";
    if (!["string", "number", "boolean"].includes(typeof d.value) || (typeof d.value === "number" && !Number.isFinite(d.value))) return `${d.label}: the value must be text, a number or yes/no`;
    const k = d.label.trim().toLowerCase();
    if (seen.has(k)) return `${d.label} is in the shape data twice`;
    seen.add(k);
  }
  return null;
}

/** Typed text as a value: a number when it reads as one, true/false for yes/no, else the text. */
export function parseDataValue(text) {
  const s = String(text ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, "")) && s !== "") return Number(s.replace(/,/g, ""));
  if (/^(yes|true)$/i.test(s)) return true;
  if (/^(no|false)$/i.test(s)) return false;
  return s;
}

/** A value as shown: yes/no for true/false. */
export const formatDataValue = (v) => (v === true ? "Yes" : v === false ? "No" : String(v ?? ""));

/** A Visio row name for a label: letters, digits and underscores (Prop.Owner, Prop.Due_date). */
export const propName = (label, i) => (label.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || `Row_${i + 1}`);

/** Shape data as the rows of a Visio Property section (cell() writes one cell, esc() escapes). */
export function toPropertySection(data, cell) {
  if (!data?.length) return "";
  const used = new Set();
  const rows = data.map((d, i) => {
    let n = propName(d.label, i);
    while (used.has(n.toLowerCase())) n += "_";
    used.add(n.toLowerCase());
    const type = typeof d.value === "number" ? 2 : typeof d.value === "boolean" ? 3 : 0;
    const v = type === 3 ? (d.value ? "TRUE" : "FALSE") : d.value;
    return `<Row N="Prop.${n}">${cell("Label", d.label)}${cell("Value", v)}${cell("Type", type)}</Row>`;
  });
  return `<Section N="Property">${rows.join("")}</Section>`;
}

/** Shape data from a Visio Property section's rows: [{ attrs, cells }] with cells by name (V attribute values). */
export function fromPropertyRows(rows) {
  const out = [], seen = new Set();
  for (const { attrs, cells } of rows) {
    if (cells.Del === "1") continue;
    const label = (cells.Label || String(attrs.N || "").replace(/^Prop\./, "")).trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const raw = cells.Value ?? "", type = Number(cells.Type || 0);
    const value = type === 2 || type === 7 ? (Number.isFinite(Number(raw)) && raw !== "" ? Number(raw) : String(raw)) : type === 3 ? /^(1|true)$/i.test(String(raw)) : String(raw);
    out.push({ label, value });
  }
  return out;
}
