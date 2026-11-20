/* Custom fields (stage 5): columns the user names, of a type; values live in each task's `custom` by field key. */

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
