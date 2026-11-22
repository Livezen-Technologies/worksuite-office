/*
 * Custom fields (stage 5): columns the user names, of a type; values live in each task's `custom` by field key.
 * A field with a `formula` is worked out instead (formula.js), and one with `indicators` shows an icon by its value.
 */
import { parseFormula, evaluate, parseIndicators, indicatorFor, ICONS } from "./formula.js";

export const FIELD_TYPES = [
  { key: "text", title: "Text" },
  { key: "number", title: "Number" },
  { key: "date", title: "Date" },
  { key: "flag", title: "Yes / no" },
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What is wrong with a field definition, or null. */
export function fieldError(f) {
  if (!f || typeof f.key !== "string" || !/^f\d+$/.test(f.key)) return "a custom field needs a key like f1";
  if (typeof f.name !== "string" || !f.name.trim()) return "a custom field needs a name";
  if (!FIELD_TYPES.some((t) => t.key === f.type)) return `a custom field's type is one of ${FIELD_TYPES.map((t) => t.key).join(", ")}`;
  if (f.formula !== undefined) { try { parseFormula(f.formula); } catch (e) { return `${f.name}'s formula: ${e.message}`; } }
  if (f.indicators !== undefined) { try { parseIndicators(f.indicators); } catch (e) { return `${f.name}'s indicators: ${e.message}`; } }
  return null;
}

/** What is wrong with a value for a field of this type, or null. */
export function valueError(type, v) {
  if (v === undefined) return null;
  if (type === "text") return typeof v === "string" ? null : "must be text";
  if (type === "number") return Number.isFinite(v) ? null : "must be a number";
  if (type === "date") return typeof v === "string" && DATE.test(v) ? null : "must be a date";
  if (type === "flag") return typeof v === "boolean" ? null : "must be yes or no";
  return "has an unknown type";
}

/** Typed text as a value: { value } (undefined clears it) or { error }. */
export function parseValue(type, text) {
  const s = String(text ?? "").trim();
  if (!s) return { value: undefined };
  if (type === "text") return { value: s };
  if (type === "number") { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? { value: n } : { error: "Type a number" }; }
  if (type === "date") return DATE.test(s) ? { value: s } : { error: "Type a date" };
  if (type === "flag") {
    if (/^(y|yes|true|1|✓)$/i.test(s)) return { value: true };
    if (/^(n|no|false|0)$/i.test(s)) return { value: undefined };
    return { error: "Type yes or no" };
  }
  return { error: "Unknown field type" };
}

/** A value as the grid shows it. */
export function formatValue(type, v, fmtDate = (d) => d) {
  if (v === undefined || v === null) return "";
  if (type === "flag") return v ? "✓" : "";
  if (type === "date") return fmtDate(v);
  if (type === "number") return String(v);
  return String(v);
}

/** The next free field key. */
export const nextFieldKey = (fields = []) => "f" + (fields.reduce((m, f) => Math.max(m, Number(f.key.slice(1)) || 0), 0) + 1);

/* ---- formula fields ---- */
/** The fields a formula can read, besides custom fields (by their names): what the grid shows for the task. */
export const FORMULA_FIELDS = ["Name", "Duration", "Work", "Cost", "Fixed cost", "Start", "Finish", "Deadline", "% Complete", "Priority", "Owner"];

/**
 * A field's value for a task: as typed, or worked out by its formula. `env` gives what the document alone does not:
 * { finish(t), cost(t), work(t) }. Returns { value } or { error } (a formula that cannot be worked out).
 */
export function fieldValue(doc, t, f, env = {}, seen = new Set()) {
  if (!f.formula) return { value: t.custom?.[f.key] };
  if (seen.has(f.key)) return { error: `${f.name} refers to itself` };
  try {
    const tree = parseFormula(f.formula);
    const get = (name) => {
      const n = name.toLowerCase();
      switch (n) {
        case "name": return t.name;
        case "duration": return t.duration;
        case "work": return env.work ? env.work(t) : t.work ?? 0;
        case "cost": return env.cost ? env.cost(t) : 0;
        case "fixed cost": return t.fixedCost || 0;
        case "start": return t.start;
        case "finish": return env.finish ? env.finish(t) : t.start;
        case "deadline": return t.deadline ?? "";
        case "% complete": case "% done": case "percent complete": return t.progress || 0;
        case "priority": return t.priority ?? 500;
        case "owner": return t.owner || "";
      }
      const other = (doc.fields || []).find((x) => x.name.toLowerCase() === n);
      if (!other) throw new Error(`there is no field called ${name}`);
      const r = fieldValue(doc, t, other, env, new Set([...seen, f.key]));
      if (r.error) throw new Error(r.error);
      return r.value ?? (other.type === "number" ? 0 : other.type === "flag" ? false : "");
    };
    let v = evaluate(tree, get);
    if (v === null || v === undefined || (v === "" && f.type !== "text")) return { value: undefined }; // nothing to work out from, e.g. no deadline
    if (f.type === "number") { v = Number(v); if (!Number.isFinite(v)) return { error: "the result is not a number" }; v = Math.round(v * 100) / 100; }
    else if (f.type === "flag") v = !!v;
    else if (f.type === "date") { if (v !== null && v !== "" && !DATE.test(String(v).slice(0, 10))) return { error: "the result is not a date" }; v = v ? String(v).slice(0, 10) : undefined; }
    else v = v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
    return { value: v };
  } catch (e) { return { error: e.message }; }
}

/** The indicator icon (an emoji) for a field's value, or null when it has none. */
export function fieldIcon(f, v) {
  if (!f.indicators) return null;
  try { const k = indicatorFor(parseIndicators(f.indicators), v); return k ? ICONS[k] : null; } catch { return null; }
}
