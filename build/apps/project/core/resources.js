/*
 * WorkSuite Project: resources, workload and over-allocation (#86, roadmap stage 4). Pure ES module, no DOM.
 *
 * A task's people are its `owner` text, names separated by commas ("Nimal, Priya"); each works the task full
 * time. A person's workload on a day is how many of their tasks run that day (summaries and milestones do not
 * count); more than one is over-allocated.
 */
import { toDay, fromDay, finishOf } from "./project.js";

/** The names in a task's owner text. */
export const ownersOf = (t) => (t.owner ? t.owner.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Every person named on a task, sorted, with their task count. */
export function resourceList(doc) {
  const n = new Map();
  for (const t of doc.tasks) for (const r of ownersOf(t)) n.set(r, (n.get(r) || 0) + 1);
  return [...n].sort((a, b) => a[0].localeCompare(b[0])).map(([name, tasks]) => ({ name, tasks }));
}

const isSummaryAt = (tasks, i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

/**
 * Workload: Map name → Map day number → [task ids], counting working days only (isWork(day), or every day).
 */
export function workload(doc, isWork = null) {
  const out = new Map();
  doc.tasks.forEach((t, i) => {
    if (t.duration <= 0 || isSummaryAt(doc.tasks, i)) return;
    const people = ownersOf(t);
    if (!people.length) return;
    const s = toDay(t.start), f = toDay(finishOf(t, isWork));
    for (let d = s; d <= f; d++) {
      if (isWork && !isWork(d)) continue;
      for (const r of people) {
        if (!out.has(r)) out.set(r, new Map());
        const days = out.get(r);
        if (!days.has(d)) days.set(d, []);
        days.get(d).push(t.id);
      }
    }
  });
  return out;
}

/**
 * Over-allocations: one entry per person and run of consecutive over-allocated days,
 * { name, from, to (ISO dates), days, tasks: [ids] }, sorted by date then name.
 */
export function overallocations(doc, isWork = null) {
  const out = [];
  for (const [name, days] of workload(doc, isWork)) {
    const over = [...days].filter(([, ids]) => ids.length > 1).sort((a, b) => a[0] - b[0]);
    let run = null;
    for (const [d, ids] of over) {
      // consecutive: no working day between this and the run's last day
      let gap = false;
      if (run) for (let x = run.last + 1; x < d; x++) if (!isWork || isWork(x)) { gap = true; break; }
      if (!run || gap) { if (run) out.push(close(run)); run = { name, first: d, last: d, days: 0, tasks: new Set() }; }
      run.last = d; run.days++; ids.forEach((id) => run.tasks.add(id));
    }
    if (run) out.push(close(run));
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}
const close = (r) => ({ name: r.name, from: fromDay(r.first), to: fromDay(r.last), days: r.days, tasks: [...r.tasks] });

/** Weekly totals for the workload view: [{ name, weeks: [{ start (Monday ISO), days, peak }] }]. */
export function weeklyLoad(doc, isWork = null) {
  const rows = [];
  for (const [name, days] of [...workload(doc, isWork)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const weeks = new Map();
    for (const [d, ids] of days) {
      const mon = d - ((new Date(d * 86400000).getUTCDay() + 6) % 7);
      const w = weeks.get(mon) || { start: fromDay(mon), days: 0, peak: 0 };
      w.days += ids.length; w.peak = Math.max(w.peak, ids.length);
      weeks.set(mon, w);
    }
    rows.push({ name, weeks: [...weeks].sort((a, b) => a[0] - b[0]).map(([, w]) => w) });
  }
  return rows;
}
