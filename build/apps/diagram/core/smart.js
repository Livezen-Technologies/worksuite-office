/*
 * WorkSuite Diagram: smart shapes — shape data formulas and text fields (roadmap stage 6). Pure ES module, no DOM.
 *
 * A shape data value that starts with "=" is a formula, in the same language as Project's custom fields
 * (project/core/formula.js): "=[Qty] * [Price]", "=IIf([Status] = "Late", "Chase", "")". It reads the shape's other
 * data by name, and Width, Height (in real units when the page has a drawing scale), Text and Page.
 * Shape text can show data: "{Name}\n{Role}" shows those values, so a shape's label follows its data.
 * A formula that refers to itself, directly or through others, shows #CYCLE; one that cannot be read shows #ERROR.
 */

import { parseFormula, evaluate } from "../../project/core/formula.js";
import { toReal } from "./scale.js";
import { formatDataValue } from "./shapedata.js";

export const isFormula = (v) => typeof v === "string" && v.trim().startsWith("=");

/** Why a formula cannot be read, or "". */
export function formulaError(v) {
  if (!isFormula(v)) return "";
  try { parseFormula(v.trim().slice(1)); return ""; } catch (e) { return e.message; }
}

const round = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);

/**
 * The shape's data with formulas worked out: [{ label, value, formula? }], value the result (or "#CYCLE" / "#ERROR …").
 * page gives the drawing scale and name for Width, Height and Page.
 */
export function computeData(shape, page = {}) {
  const data = shape.data || [];
  const byName = new Map(data.map((d) => [d.label.toLowerCase(), d]));
  const builtins = {
    width: () => round(toReal(shape.w, page.scale)), height: () => round(toReal(shape.h, page.scale)),
    text: () => String(shape.text || ""), page: () => String(page.name || ""),
  };
  const done = new Map(), busy = new Set();
  const valueOf = (name) => {
    const key = String(name).toLowerCase();
    const d = byName.get(key);
    if (!d) {
      if (builtins[key]) return builtins[key]();
      throw new Error(`no data called ${name}`);
    }
    if (done.has(key)) return done.get(key);
    if (!isFormula(d.value)) { done.set(key, d.value); return d.value; }
    if (busy.has(key)) throw new CycleError();
    busy.add(key);
    try {
      const v = round(evaluate(parseFormula(d.value.trim().slice(1)), valueOf));
      done.set(key, v);
      return v;
    } finally { busy.delete(key); }
  };
  return data.map((d) => {
    if (!isFormula(d.value)) return { label: d.label, value: d.value };
    let value;
    try { value = valueOf(d.label); } catch (e) { value = e instanceof CycleError ? "#CYCLE" : `#ERROR ${e.message}`; }
    return { label: d.label, value, formula: d.value };
  });
}
class CycleError extends Error { constructor() { super("cycle"); } }

/** The text a shape shows: {Name} fields replaced by its (worked out) data; unknown fields are left as typed. */
export function shapeText(shape, page = {}) {
  const text = String(shape.text || "");
  if (!text.includes("{")) return text;
  const values = new Map(computeData(shape, page).map((d) => [d.label.toLowerCase(), d.value]));
  const extra = { width: toReal(shape.w, page.scale), height: toReal(shape.h, page.scale), page: page.name || "" };
  return text.replace(/\{([^{}\n]{1,60})\}/g, (m, name) => {
    const k = name.trim().toLowerCase();
    if (values.has(k)) return formatDataValue(values.get(k));
    if (k in extra) return formatDataValue(typeof extra[k] === "number" ? round(Math.round(extra[k] * 100) / 100) : extra[k]);
    return m;
  });
}

/** A shape with its data worked out, for data graphics, tooltips and export. */
export const withComputed = (shape, page) => (shape.data?.some((d) => isFormula(d.value)) ? { ...shape, data: computeData(shape, page).map(({ label, value }) => ({ label, value })) } : shape);
