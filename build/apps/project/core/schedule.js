/*
 * WorkSuite Project: working calendars and automatic scheduling (#83, stage 3 of #71).
 * Pure ES module, no DOM. Works on a project document from core/project.js.
 *
 * Calendar: working weekdays and holidays. Durations count working days; a task starts on a working day and
 * finishes on its last working day (a milestone, duration 0, sits on its start day).
 *
 * Scheduling is the critical path method over the leaf tasks, in working-day numbers:
 *   forward pass   earliest start/finish from the project start, the links and the constraints
 *   backward pass  latest start/finish from the project finish (or a "finish no later than" constraint)
 *   total slack    latest start − earliest start; critical when slack ≤ 0
 * Links (lag in working days, may be negative):
 *   FS  successor starts after the predecessor finishes      SS  successor starts when the predecessor starts
 *   FF  successor finishes when the predecessor finishes     SF  successor finishes when the predecessor starts
 * Constraints (task.constraint = { type, date }):
 *   ASAP (default) · SNET start no earlier than · MSO must start on · FNLT finish no later than (reported when missed)
 * Summary tasks are not scheduled themselves; they roll up their subtasks.
 */
import { toDay, fromDay } from "./project.js";

/* ---- calendars ---- */

/**
 * Sri Lankan public holidays on fixed dates. Poya days, Thai Pongal, Deepavali, Ramazan and Hadji festivals and
 * Good Friday move every year: add each year's gazetted dates with calendar.holidays (never guessed here).
 */
export const LK_FIXED_HOLIDAYS = [
  ["02-04", "Independence Day"],
  ["04-13", "Day prior to Sinhala and Tamil New Year"],
  ["04-14", "Sinhala and Tamil New Year"],
  ["05-01", "May Day"],
  ["12-25", "Christmas Day"],
];

/** A calendar: workdays (0 Sun … 6 Sat), holidays as "YYYY-MM-DD", and fixed "MM-DD" holidays every year. */
export function makeCalendar({ workdays = [1, 2, 3, 4, 5], holidays = [], yearly = [] } = {}) {
  const work = new Set(workdays), off = new Set(holidays), every = new Set(yearly.map((h) => (Array.isArray(h) ? h[0] : h)));
  if (!work.size) throw new Error("a calendar needs at least one working day");
  const isWork = (day) => {
    const iso = fromDay(day);
    return work.has(new Date(day * 86400000).getUTCDay()) && !off.has(iso) && !every.has(iso.slice(5));
  };
  return { isWork, workdays: [...work], holidays: [...off], yearly: [...every] };
}
export const STANDARD = makeCalendar();
export const SRI_LANKA = makeCalendar({ yearly: LK_FIXED_HOLIDAYS });

/** Working-day numbering: n(day) counts working days from an anchor; date(n) goes back. Cached per calendar. */
function numbering(cal, anchorIso) {
  const anchor = toDay(anchorIso) - 400; // room for negative lags and early constraints
  const days = []; // n → day
  const index = new Map(); // day → n (working days only)
  const extend = (untilDay) => { for (let d = days.length ? days[days.length - 1] + 1 : anchor; d <= untilDay; d++) if (cal.isWork(d)) { index.set(d, days.length); days.push(d); } };
  const extendTo = (n) => { let d = days.length ? days[days.length - 1] + 1 : anchor; while (days.length <= n) { if (cal.isWork(d)) { index.set(d, days.length); days.push(d); } d++; if (d - anchor > 40000) throw new Error("the calendar has too few working days"); } };
  return {
    /** the working-day number of a date, moving forward to the next working day when it is not one */
    n(iso) { let d = toDay(iso); if (d < anchor) throw new Error(`${iso} is too early for this project`); extend(d + 14); while (!index.has(d)) { d++; extend(d + 14); } return index.get(d); },
    date(n) { if (n < 0) throw new Error("before the start of the calendar"); extendTo(n); return fromDay(days[n]); },
  };
}

/** The finish date of `duration` working days from `start` (moved to a working day first). */
export function workFinish(cal, start, duration) {
  const num = numbering(cal, start), s = num.n(start);
  return num.date(s + Math.max(0, duration - 1));
}

/** Working days from `a` to `b` inclusive (0 when b is before a). */
export function workDays(cal, a, b) {
  let n = 0;
  for (let d = toDay(a), e = toDay(b); d <= e; d++) if (cal.isWork(d)) n++;
  return n;
}

/* ---- scheduling ---- */

/**
 * Schedules a project document. Returns:
 *   { tasks: { id: { start, finish, lateStart, lateFinish, slack, critical, summary } }, finish, problems: [] }
 * Nothing in the document changes; applySchedule() writes the new starts back.
 */
export function schedule(doc, cal = STANDARD) {
  const tasks = doc.tasks, num = numbering(cal, doc.start);
  const isSummary = (i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;
  // inactive tasks stay in the plan but are not scheduled, linked or counted (stage 5)
  const leaves = tasks.filter((t, i) => !isSummary(i) && !t.inactive);
  const leafIds = new Set(leaves.map((t) => t.id));
  const links = doc.links.filter((l) => leafIds.has(l.from) && leafIds.has(l.to));
  const problems = [];
  const summaryIds = new Set(tasks.filter((_, i) => isSummary(i)).map((t) => t.id));
  if (doc.links.some((l) => summaryIds.has(l.from) || summaryIds.has(l.to))) problems.push("links to summary tasks are ignored; link their subtasks");

  // topological order over the leaf tasks (the model refuses loops; checked again here)
  const preds = new Map(leaves.map((t) => [t.id, []])), succs = new Map(leaves.map((t) => [t.id, []]));
  for (const l of links) { preds.get(l.to).push(l); succs.get(l.from).push(l); }
  const order = [], indeg = new Map(leaves.map((t) => [t.id, preds.get(t.id).length]));
  const queue = leaves.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length) { const id = queue.shift(); order.push(id); for (const l of succs.get(id)) { indeg.set(l.to, indeg.get(l.to) - 1); if (indeg.get(l.to) === 0) queue.push(l.to); } }
  if (order.length !== leaves.length) throw new Error("the links form a loop");

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const span = (t) => Math.max(0, t.duration - 1); // finish = start + span (a milestone: span 0)
  const projectStart = num.n(doc.start);
  const es = new Map(), ef = new Map();

  // forward pass
  for (const id of order) {
    const t = byId.get(id), d = span(t);
    let s = projectStart;
    for (const l of preds.get(id)) {
      const p = byId.get(l.from), ps = es.get(l.from), pf = ef.get(l.from), milestone = p.duration === 0;
      if (l.type === "FS") s = Math.max(s, pf + (milestone ? 0 : 1) + l.lag);
      else if (l.type === "SS") s = Math.max(s, ps + l.lag);
      else if (l.type === "FF") s = Math.max(s, pf + l.lag - d);
      else if (l.type === "SF") s = Math.max(s, ps + l.lag - d);
    }
    const c = t.constraint;
    if (c && c.type === "SNET") s = Math.max(s, num.n(c.date));
    if (t.levelDelay > 0) s += t.levelDelay; // resource levelling (levelling.js): working days added after the links
    if (c && c.type === "MSO") {
      const must = num.n(c.date);
      if (must < s) problems.push(`"${t.name}" must start on ${c.date}, earlier than its links allow`);
      s = must;
    }
    es.set(id, s); ef.set(id, s + d);
  }
  const finishN = leaves.length ? Math.max(...leaves.map((t) => ef.get(t.id))) : projectStart;

  // backward pass
  const ls = new Map(), lf = new Map();
  for (const id of [...order].reverse()) {
    const t = byId.get(id), d = span(t);
    let f = finishN;
    for (const l of succs.get(id)) {
      const s2 = ls.get(l.to), f2 = lf.get(l.to), milestone = t.duration === 0;
      if (l.type === "FS") f = Math.min(f, s2 - (milestone ? 0 : 1) - l.lag);
      else if (l.type === "SS") f = Math.min(f, s2 - l.lag + d);
      else if (l.type === "FF") f = Math.min(f, f2 - l.lag);
      else if (l.type === "SF") f = Math.min(f, f2 - l.lag + d);
    }
    const c = t.constraint;
    if (t.deadline && ef.get(id) > num.n(t.deadline) - (cal.isWork(toDay(t.deadline)) ? 0 : 1)) problems.push(`"${t.name}" finishes after its deadline, ${t.deadline}`);
    if (c && c.type === "FNLT") {
      const limit = num.n(c.date) - (cal.isWork(toDay(c.date)) ? 0 : 1);
      if (ef.get(id) > limit) problems.push(`"${t.name}" finishes after ${c.date}, its finish no later than date`);
      f = Math.min(f, limit);
    }
    lf.set(id, f); ls.set(id, f - d);
  }

  const out = {};
  for (const t of leaves) {
    const slack = ls.get(t.id) - es.get(t.id);
    out[t.id] = { start: num.date(es.get(t.id)), finish: num.date(ef.get(t.id)), lateStart: num.date(Math.max(0, ls.get(t.id))), lateFinish: num.date(Math.max(0, lf.get(t.id))), slack, critical: slack <= 0, summary: false };
  }
  // summaries span their subtasks
  tasks.forEach((t, i) => {
    if (!isSummary(i)) return;
    let j = i + 1;
    const kids = [];
    while (j < tasks.length && tasks[j].level > t.level) { if (out[tasks[j].id] && !out[tasks[j].id].summary) kids.push(out[tasks[j].id]); j++; }
    if (!kids.length) return; // only inactive tasks under it
    const start = kids.map((k) => k.start).sort()[0], finish = kids.map((k) => k.finish).sort().at(-1);
    out[t.id] = { start, finish, lateStart: start, lateFinish: finish, slack: Math.min(...kids.map((k) => k.slack)), critical: kids.some((k) => k.critical), summary: true };
  });
  return { tasks: out, finish: num.date(finishN), problems };
}

/** The critical path: leaf task ids with no slack, in start order. */
export const criticalPath = (result) => Object.entries(result.tasks).filter(([, v]) => v.critical && !v.summary).sort((a, b) => (a[1].start < b[1].start ? -1 : a[1].start > b[1].start ? 1 : 0)).map(([id]) => id);

/** Levels the plan (levelling.js) and writes the delays and the new starts back: one undo step. */
export function applyLevelling(model, cal = STANDARD, level) {
  const plan = level(model.doc, cal);
  model.edit((d) => {
    for (const t of d.tasks) {
      const n = plan.delays.get(t.id);
      if (n > 0) t.levelDelay = n; else delete t.levelDelay;
      if (plan.starts.has(t.id)) t.start = plan.starts.get(t.id); // only delayed tasks and what follows them move
    }
  });
  return plan;
}

/**
 * Removes every levelling delay: each delayed task goes back by its delay, and the tasks linked after them go
 * back to where their links put them; tasks with no links stay where they were placed. One undo step.
 */
export function clearLevelling(model, cal = STANDARD, unlevelledStart) {
  model.edit((d) => {
    for (const t of d.tasks) if (t.levelDelay) { t.start = unlevelledStart(t, cal); delete t.levelDelay; }
    const linked = new Set(d.links.map((l) => l.to));
    const pinned = { ...d, tasks: d.tasks.map((t) => (t.constraint || linked.has(t.id) ? t : { ...t, constraint: { type: "SNET", date: t.start } })) };
    const r = schedule(pinned, cal);
    for (const t of d.tasks) if (r.tasks[t.id] && !r.tasks[t.id].summary) t.start = r.tasks[t.id].start;
  });
}

/** Writes the scheduled starts back as an edit on a ProjectModel (one undo step); returns the schedule. */
export function applySchedule(model, cal = STANDARD) {
  const result = schedule(model.doc, cal);
  model.edit((d) => { for (const t of d.tasks) { const r = result.tasks[t.id]; if (r && !r.summary) t.start = r.start; } });
  return result;
}
