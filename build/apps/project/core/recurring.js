/*
 * WorkSuite Project: recurring tasks (roadmap stage 5). Pure ES module, no DOM.
 *
 * A recurring task is a summary with one subtask per occurrence, as in professional planners, and the summary
 * keeps the pattern (task.recurring) so it can be shown and edited:
 *   { every: "day" | "week" | "month", interval (1+), weekdays?: [1..7] (Mon=1, weekly only),
 *     count?: n | until?: "YYYY-MM-DD" }
 * Occurrences that fall on a non-working day move to the next working day (with a calendar).
 */
import { toDay, fromDay } from "./project.js";

export const MAX_OCCURRENCES = 260;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a pattern; returns an error text or null. */
export function patternError(p) {
  if (!p || !["day", "week", "month"].includes(p.every)) return "Choose how often: daily, weekly or monthly";
  if (!(Number.isInteger(p.interval) && p.interval >= 1 && p.interval <= 99)) return "Repeat every 1 to 99 days, weeks or months";
  if (p.every === "week" && (!Array.isArray(p.weekdays) || !p.weekdays.length || p.weekdays.some((d) => !(Number.isInteger(d) && d >= 1 && d <= 7)))) return "Choose at least one weekday";
  if (p.count === undefined && p.until === undefined) return "Say how many times, or until when";
  if (p.count !== undefined && !(Number.isInteger(p.count) && p.count >= 1 && p.count <= MAX_OCCURRENCES)) return `It can repeat 1 to ${MAX_OCCURRENCES} times`;
  if (p.until !== undefined && !DATE.test(p.until)) return "The end is a date";
  return null;
}

/** The occurrence dates from `start`: at most MAX_OCCURRENCES, in order, each on a working day when isWork is given. */
export function occurrences(start, p, isWork = null) {
  const err = patternError(p);
  if (err) throw new Error(err);
  const s = toDay(start), until = p.until ? toDay(p.until) : Infinity, max = p.count ?? MAX_OCCURRENCES;
  const out = [];
  const push = (d) => {
    if (d < s || d > until || out.length >= max) return;
    let w = d, guard = 0;
    while (isWork && !isWork(w) && guard++ < 30) w++;
    if (!out.length || w > toDay(out[out.length - 1])) out.push(fromDay(w));
  };
  if (p.every === "day") {
    for (let d = s; d <= until && out.length < max; d += p.interval) push(d);
  } else if (p.every === "week") {
    const monday = s - ((new Date(s * 86400000).getUTCDay() + 6) % 7);
    const days = [...new Set(p.weekdays)].sort((a, b) => a - b);
    for (let w = monday, n = 0; out.length < max && w <= until && n < 5000; w += 7 * p.interval, n++) for (const wd of days) push(w + wd - 1);
  } else {
    const d0 = new Date(s * 86400000), dom = d0.getUTCDate();
    for (let k = 0; out.length < max && k < 1200; k += p.interval) {
      const y = d0.getUTCFullYear(), m = d0.getUTCMonth() + k;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // the 31st in a short month is its last day
      const d = toDay(new Date(Date.UTC(y, m, Math.min(dom, last))).toISOString().slice(0, 10));
      if (d > until) break;
      push(d);
    }
  }
  return out;
}

/** A short description of a pattern: "Every 2 weeks on Mon, Thu, 6 times". */
export function describe(p) {
  const unit = { day: "day", week: "week", month: "month" }[p.every];
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let s = p.interval === 1 ? `Every ${unit}` : `Every ${p.interval} ${unit}s`;
  if (p.every === "week") s += " on " + [...p.weekdays].sort((a, b) => a - b).map((d) => names[d]).join(", ");
  return s + (p.count ? `, ${p.count} time${p.count === 1 ? "" : "s"}` : `, until ${p.until}`);
}
