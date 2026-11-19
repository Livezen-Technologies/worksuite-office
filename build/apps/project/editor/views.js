/*
 * WorkSuite Project: the Task Board and Calendar views (roadmap stage 5). Pure functions, no DOM, so the tests
 * cover them; editor.js draws what they return.
 */
import { toDay, fromDay, finishOf } from "../core/project.js";

export const BOARD_COLUMNS = [
  { key: "todo", title: "Not started" },
  { key: "doing", title: "In progress" },
  { key: "done", title: "Done" },
];

/** A task's board column, by its progress. */
export const columnOf = (t) => (t.progress >= 100 ? "done" : t.progress > 0 ? "doing" : "todo");

/** The progress a card gets when dropped in a column (in progress keeps a part-done task's progress). */
export function progressFor(column, t) {
  if (column === "todo") return 0;
  if (column === "done") return 100;
  return t.progress > 0 && t.progress < 100 ? t.progress : 50;
}

/**
 * The board: { todo: [cards], doing: [...], done: [...] }, cards in start order. Summaries and inactive tasks
 * are left out; a card is { id, name, start, finish, owner, progress, milestone, late, phase }.
 */
export function board(doc, isWork = null, statusDate = null) {
  const out = { todo: [], doing: [], done: [] };
  const tasks = doc.tasks;
  let phase = "";
  tasks.forEach((t, i) => {
    const summary = i + 1 < tasks.length && tasks[i + 1].level > t.level;
    if (t.level === 0) phase = summary ? t.name : "";
    if (summary || t.inactive) return;
    const finish = finishOf(t, isWork);
    out[columnOf(t)].push({ id: t.id, name: t.name, start: t.start, finish, owner: t.owner || "", progress: t.progress, milestone: t.duration === 0,
      late: !!statusDate && t.progress < 100 && finish < statusDate, phase: t.level > 0 ? phase : "" });
  });
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

/**
 * A month for the Calendar view: { title, weeks: [[{ date, inMonth, tasks: [{ id, name, first, last }] }] × 7] },
 * Monday first. A task appears on each working day it runs (every day without a calendar).
 */
export function month(doc, year, monthIndex, isWork = null) {
  const first = Date.UTC(year, monthIndex, 1) / 86400000;
  const start = first - ((new Date(first * 86400000).getUTCDay() + 6) % 7);
  const lastDay = Date.UTC(year, monthIndex + 1, 0) / 86400000;
  const end = lastDay + (6 - ((new Date(lastDay * 86400000).getUTCDay() + 6) % 7));
  const leaves = doc.tasks.filter((t, i) => !(i + 1 < doc.tasks.length && doc.tasks[i + 1].level > t.level) && !t.inactive)
    .map((t) => ({ id: t.id, name: t.name, s: toDay(t.start), f: toDay(finishOf(t, isWork)), milestone: t.duration === 0 }));
  const weeks = [];
  for (let w = start; w <= end; w += 7) {
    const week = [];
    for (let d = w; d < w + 7; d++) {
      const working = !isWork || isWork(d);
      week.push({
        date: fromDay(d), inMonth: d >= first && d <= lastDay, working,
        tasks: leaves.filter((t) => t.s <= d && d <= t.f && (working || t.milestone)).map((t) => ({ id: t.id, name: t.name, first: t.s === d, last: t.f === d, milestone: t.milestone })),
      });
    }
    weeks.push(week);
  }
  const title = new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { title, weeks };
}
