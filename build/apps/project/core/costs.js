/*
 * WorkSuite Project: costs (roadmap stage 5). Pure ES module, no DOM.
 *
 * The Resource Sheet (doc.resources) gives each person a rate per hour and a cost per use, by name: the names
 * are the ones in the tasks' Owner text. A task's cost is each person's hours (the task's work, shared by their
 * units) × their rate, plus their cost per use, plus the task's fixed cost. A summary costs what its tasks do,
 * plus its own fixed cost; inactive tasks cost nothing. People with no row on the sheet cost nothing yet.
 */
import { assignmentsOf, resourceList } from "./resources.js";
import { workOf, unitsOf } from "./tasktypes.js";

const money = (n) => Math.round(n * 100) / 100;

/** A person's sheet row, or a blank one. */
export function resourceOf(doc, name) {
  const r = (doc.resources || []).find((x) => x.name === name);
  return { name, rate: r?.rate || 0, costPerUse: r?.costPerUse || 0 };
}

/** One task's own cost (not counting subtasks). */
export function ownCost(doc, t) {
  if (t.inactive) return 0;
  let cost = t.fixedCost || 0;
  const list = assignmentsOf(t), U = unitsOf(t), W = workOf(t);
  for (const a of list) {
    const r = resourceOf(doc, a.name);
    cost += (U > 0 ? (W * a.units) / U : 0) * r.rate + r.costPerUse;
  }
  return money(cost);
}

/** Every task's cost (summaries include their subtasks) and the project's total: { byId: Map, total }. */
export function costs(doc) {
  const tasks = doc.tasks, byId = new Map();
  const isSummary = (i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;
  // from the bottom up: each task adds its cost to its parent's
  const sums = new Array(tasks.length).fill(0);
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    sums[i] = money((isSummary(i) ? sums[i] : 0) + (isSummary(i) ? (t.inactive ? 0 : t.fixedCost || 0) : ownCost(doc, t)));
    byId.set(t.id, sums[i]);
    for (let j = i - 1; j >= 0; j--) if (tasks[j].level < t.level) { if (tasks[j].level === t.level - 1) sums[j] += sums[i]; break; }
  }
  const total = money(tasks.reduce((s, t, i) => s + (t.level === 0 ? sums[i] : 0), 0));
  return { byId, total };
}

/** The Resource Sheet: everyone named on a task, with their rate, cost per use, work (hours) and cost. */
export function resourceSheet(doc) {
  const out = new Map(resourceList(doc).map((r) => [r.name, { ...resourceOf(doc, r.name), tasks: r.tasks, work: 0, cost: 0 }]));
  for (const r of doc.resources || []) if (!out.has(r.name)) out.set(r.name, { ...resourceOf(doc, r.name), tasks: 0, work: 0, cost: 0 });
  doc.tasks.forEach((t, i) => {
    const summary = i + 1 < doc.tasks.length && doc.tasks[i + 1].level > t.level;
    if (summary || t.inactive) return;
    const U = unitsOf(t), W = workOf(t);
    for (const a of assignmentsOf(t)) {
      const row = out.get(a.name), h = U > 0 ? (W * a.units) / U : 0;
      row.work = money(row.work + h);
      row.cost = money(row.cost + h * row.rate + row.costPerUse);
    }
  });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 1234.5 → "1,234.50". */
export const formatMoney = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
