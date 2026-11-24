/*
 * WorkSuite Project: custom report layouts (roadmap stage 5). Pure ES module, no DOM.
 *
 * A report is saved with the project in `reports`: { id, name, columns (keys, in order), filter (views.js FILTERS key),
 * group (views.js GROUPS key), sort: { key, dir: "asc" | "desc" } | null }. Column keys are the grid's own
 * (name, duration, start, …) and "c:<custom field key>" for custom fields.
 */

export const REPORT_COLUMNS = [
  ["wbs", "WBS"], ["name", "Task name"], ["duration", "Duration"], ["work", "Work"], ["cost", "Cost"], ["fixedCost", "Fixed cost"],
  ["start", "Start"], ["finish", "Finish"], ["deadline", "Deadline"], ["progress", "% done"], ["owner", "Owner"], ["priority", "Priority"],
];
const FILTER_KEYS = ["all", "incomplete", "completed", "critical", "milestones", "late", "deadline", "active"];
const GROUP_KEYS = ["none", "phase", "person", "status", "priority", "critical"];

/** Why a report is wrong, or "". fields: the project's custom fields. */
export function reportError(r, fields = []) {
  if (!r || typeof r.id !== "string" || !r.id) return "a report needs an id";
  if (typeof r.name !== "string" || !r.name.trim()) return "a report needs a name";
  const known = new Set([...REPORT_COLUMNS.map(([k]) => k), ...fields.map((f) => "c:" + f.key)]);
  if (!Array.isArray(r.columns) || !r.columns.length) return `report ${r.name}: choose at least one column`;
  const bad = r.columns.find((c) => !known.has(c));
  if (bad) return `report ${r.name}: there is no column ${bad}`;
  if (!FILTER_KEYS.includes(r.filter) && !String(r.filter).startsWith("person:")) return `report ${r.name}: unknown filter ${r.filter}`;
  if (!GROUP_KEYS.includes(r.group)) return `report ${r.name}: unknown grouping ${r.group}`;
  if (r.sort != null && (!known.has(r.sort.key) || !["asc", "desc"].includes(r.sort.dir))) return `report ${r.name}: the sort is a column, up or down`;
  return "";
}

/** Rows sorted by a column (blanks last), keeping the original order for ties. value(row, key) gives what to compare. */
export function sortRows(rows, sort, value) {
  if (!sort) return rows;
  const k = (v) => (v === "" || v == null ? null : v);
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    const x = k(value(a, sort.key)), y = k(value(b, sort.key));
    if (x === null || y === null) return x === y ? i - j : x === null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return (sort.dir === "desc" ? -c : c) || i - j;
  }).map(([r]) => r);
}
