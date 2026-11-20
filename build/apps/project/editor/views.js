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

/* ---- the Network Diagram ---- */

export const NODE = { w: 190, h: 76, gapX: 56, gapY: 22 };

/**
 * The Network Diagram's layout: a box per task (summaries and inactive tasks left out), in columns by the
 * longest chain of links before it, rows in plan order within a column; links as orthogonal routes.
 * Returns { nodes: [{ id, n, name, start, finish, duration, owner, milestone, x, y }], edges: [{ from, to, points }],
 * width, height }.
 */
export function network(doc, isWork = null) {
  const tasks = doc.tasks;
  const index = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const leaves = tasks.filter((t, i) => !(i + 1 < tasks.length && tasks[i + 1].level > t.level) && !t.inactive);
  const ids = new Set(leaves.map((t) => t.id));
  const links = doc.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  const preds = new Map(leaves.map((t) => [t.id, []]));
  for (const l of links) preds.get(l.to).push(l.from);
  const col = new Map();
  const depth = (id, seen = new Set()) => {
    if (col.has(id)) return col.get(id);
    if (seen.has(id)) return 0; // a loop (the model refuses them): stop
    seen.add(id);
    const d = preds.get(id).reduce((m, p) => Math.max(m, depth(p, seen) + 1), 0);
    col.set(id, d);
    return d;
  };
  const rows = [];
  const nodes = leaves.map((t) => {
    const c = depth(t.id), r = (rows[c] = (rows[c] || 0) + 1) - 1;
    return { id: t.id, n: index.get(t.id), name: t.name, start: t.start, finish: finishOf(t, isWork), duration: t.duration, owner: t.owner || "", milestone: t.duration === 0,
      x: 16 + c * (NODE.w + NODE.gapX), y: 16 + r * (NODE.h + NODE.gapY) };
  });
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges = links.map((l) => {
    const a = at.get(l.from), b = at.get(l.to);
    const x1 = a.x + NODE.w, y1 = a.y + NODE.h / 2, x2 = b.x, y2 = b.y + NODE.h / 2, mx = x1 + NODE.gapX / 2;
    const points = x2 > x1 ? [[x1, y1], [mx, y1], [mx, y2], [x2, y2]] : [[x1, y1], [x1 + 12, y1], [x1 + 12, Math.max(a.y, b.y) + NODE.h + 10], [x2 - 12, Math.max(a.y, b.y) + NODE.h + 10], [x2 - 12, y2], [x2, y2]];
    return { from: l.from, to: l.to, type: l.type, points };
  });
  const width = Math.max(0, ...nodes.map((n) => n.x + NODE.w)) + 16;
  const height = Math.max(0, ...nodes.map((n) => n.y + NODE.h)) + 26;
  return { nodes, edges, width, height };
}
