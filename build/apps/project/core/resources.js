/*
 * WorkSuite Project: resources, workload and over-allocation (#86, roadmap stage 4). Pure ES module, no DOM.
 *
 * A task's people are its `owner` text, names separated by commas ("Nimal, Priya 50%"); a name alone works the
 * task full time, a percentage after it part time. A quantity in brackets ("Cement [20]") is a material or cost
 * resource: an amount (20 bags; a cost of 20), not a share of anyone's time, so it carries no units and no workload. A person's workload on a day is the sum of their tasks'
 * shares that day (summaries and milestones do not count); more than 100% is over-allocated.
 */
import { toDay, fromDay, workDays } from "./project.js";

/** A task's assignments: [{ name, units, amount? }], units 1 = full time, from "Nimal, Priya 50%, Cement [20]". */
export function assignmentsOf(t) {
  if (!t.owner) return [];
  return t.owner.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const q = /^(.*?)\s*\[\s*(\d+(?:\.\d+)?)\s*\]$/.exec(s);
    if (q && q[1]) return { name: q[1], units: 0, amount: Number(q[2]) };
    const m = /^(.*?)\s*(\d+(?:\.\d+)?)\s*%$/.exec(s);
    return m && m[1] ? { name: m[1], units: Math.max(0, Number(m[2])) / 100 } : { name: s, units: 1 };
  });
}
/** Owner text for assignments: the inverse of assignmentsOf. */
export const ownerText = (list) => list.map((a) => (a.amount !== undefined ? `${a.name} [${a.amount}]` : a.units === 1 ? a.name : `${a.name} ${Math.round(a.units * 100)}%`)).join(", ");
/** The names in a task's owner text. */
export const ownersOf = (t) => assignmentsOf(t).map((a) => a.name);
const EPS = 1e-9;

/** Every person named on a task, sorted, with their task count. */
export function resourceList(doc) {
  const n = new Map();
  for (const t of doc.tasks) for (const r of ownersOf(t)) n.set(r, (n.get(r) || 0) + 1);
  return [...n].sort((a, b) => a[0].localeCompare(b[0])).map(([name, tasks]) => ({ name, tasks }));
}

const isSummaryAt = (tasks, i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

/**
 * Workload: Map name → Map day number → [{ id, units }], counting working days only (isWork(day), or every day).
 */
export function workload(doc, isWork = null) {
  const out = new Map();
  doc.tasks.forEach((t, i) => {
    if (t.duration <= 0 || t.inactive || isSummaryAt(doc.tasks, i)) return;
    const people = assignmentsOf(t).filter((a) => a.units > 0);
    if (!people.length) return;
    for (const d of workDays(t, isWork)) { // a split task's pauses are not worked
      for (const a of people) {
        if (!out.has(a.name)) out.set(a.name, new Map());
        const days = out.get(a.name);
        if (!days.has(d)) days.set(d, []);
        days.get(d).push({ id: t.id, units: a.units });
      }
    }
  });
  return out;
}

const load = (list) => list.reduce((s, x) => s + x.units, 0);

/** A resource's availability (Max units): 1 is one person full time, 0.5 half time, 3 a crew of three; 1 when not set. */
export function maxUnitsOf(doc, name) {
  const r = (doc.resources || []).find((x) => x.name === name);
  return r && Number.isFinite(r.maxUnits) && r.maxUnits > 0 ? r.maxUnits : 1;
}

/**
 * Over-allocations: one entry per person and run of consecutive days above their availability (Max units, 100% when
 * not set), { name, from, to (ISO dates), days, peak (units), max, tasks: [ids] }, sorted by date then name.
 */
export function overallocations(doc, isWork = null) {
  const out = [];
  for (const [name, days] of workload(doc, isWork)) {
    const max = maxUnitsOf(doc, name);
    const over = [...days].filter(([, list]) => load(list) > max + EPS).sort((a, b) => a[0] - b[0]);
    let run = null;
    for (const [d, list] of over) {
      // consecutive: no working day between this and the run's last day
      let gap = false;
      if (run) for (let x = run.last + 1; x < d; x++) if (!isWork || isWork(x)) { gap = true; break; }
      if (!run || gap) { if (run) out.push(close(run)); run = { name, max, first: d, last: d, days: 0, peak: 0, tasks: new Set() }; }
      run.last = d; run.days++; run.peak = Math.max(run.peak, load(list)); list.forEach((x) => run.tasks.add(x.id));
    }
    if (run) out.push(close(run));
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}
const close = (r) => ({ name: r.name, from: fromDay(r.first), to: fromDay(r.last), days: r.days, peak: round(r.peak), max: r.max, tasks: [...r.tasks] });
const round = (x) => Math.round(x * 100) / 100;

/** Weekly totals for the workload view: [{ name, max (availability), weeks: [{ start (Monday ISO), days (person-days), peak (units) }] }]. */
export function weeklyLoad(doc, isWork = null) {
  const rows = [];
  for (const [name, days] of [...workload(doc, isWork)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const weeks = new Map();
    for (const [d, list] of days) {
      const mon = d - ((new Date(d * 86400000).getUTCDay() + 6) % 7);
      const w = weeks.get(mon) || { start: fromDay(mon), days: 0, peak: 0 };
      w.days = round(w.days + load(list)); w.peak = round(Math.max(w.peak, load(list)));
      weeks.set(mon, w);
    }
    rows.push({ name, max: maxUnitsOf(doc, name), weeks: [...weeks].sort((a, b) => a[0] - b[0]).map(([, w]) => w) });
  }
  return rows;
}

/**
 * Owner text with `from` swapped for `to` (the Team Planner's drag): `to` takes `from`'s share; if `to` is already on
 * the task, `from` simply leaves. From "" (no one) adds `to` full time; to "" takes `from` off.
 */
export function reassign(owner, from, to) {
  const list = assignmentsOf({ owner });
  if (from === to) return owner || undefined;
  const i = from ? list.findIndex((a) => a.name === from && a.amount === undefined) : -1;
  if (from && i < 0) return owner || undefined;
  const share = i >= 0 ? list[i].units : 1;
  const out = list.filter((_, k) => k !== i);
  if (to && !out.some((a) => a.name === to && a.amount === undefined)) out.splice(i >= 0 ? i : out.length, 0, { name: to, units: share });
  return out.length ? ownerText(out) : undefined;
}
