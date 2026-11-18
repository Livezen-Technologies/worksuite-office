/*
 * WorkSuite Project: progress against the status date (#86, roadmap stage 4). Pure ES module, no DOM.
 *
 * By the status date a task should be as far along as the share of its working days that have passed. A task
 * is behind when its % complete is short of that, and late when it should have finished and has not.
 */
import { toDay, finishOf } from "./project.js";

const isSummaryAt = (tasks, i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

/** The % complete a task should have reached by the end of the status date. */
export function expectedProgress(t, statusDate, isWork = null) {
  const s = toDay(t.start), f = toDay(finishOf(t, isWork)), now = toDay(statusDate);
  if (now < s) return 0;
  if (now >= f) return 100;
  let done = 0, all = 0;
  for (let d = s; d <= f; d++) if (!isWork || isWork(d)) { all++; if (d <= now) done++; }
  return all ? Math.round((done / all) * 100) : 100;
}

/**
 * Each task (summaries excepted) measured at the status date:
 * [{ id, name, expected, progress, behind (% points short), late (should be finished) }], only those behind.
 */
export function behindSchedule(doc, statusDate = doc.statusDate, isWork = null) {
  if (!statusDate) return [];
  const out = [];
  doc.tasks.forEach((t, i) => {
    if (isSummaryAt(doc.tasks, i) || t.progress >= 100 || t.inactive) return;
    const expected = t.duration === 0 ? (toDay(statusDate) >= toDay(t.start) ? 100 : 0) : expectedProgress(t, statusDate, isWork);
    const behind = expected - t.progress;
    if (behind > 0) out.push({ id: t.id, name: t.name, expected, progress: t.progress, behind, late: expected === 100 });
  });
  return out;
}

/** Tasks whose (planned) finish is after their deadline: [{ id, name, deadline, finish }]. Inactive tasks are left out. */
export function pastDeadline(doc, isWork = null) {
  // a summary's finish is its subtasks': they are checked one by one
  return doc.tasks.filter((t, i) => t.deadline && !t.inactive && !isSummaryAt(doc.tasks, i)).map((t) => ({ id: t.id, name: t.name, deadline: t.deadline, finish: finishOf(t, isWork) }))
    .filter((x) => x.finish > x.deadline);
}
