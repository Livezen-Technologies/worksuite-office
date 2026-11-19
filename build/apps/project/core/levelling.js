/*
 * WorkSuite Project: resource levelling (roadmap stage 5). Pure ES module, no DOM.
 *
 * Over-allocations are resolved by delaying tasks, never by changing their work or people: day by day from the
 * earliest clash, one of the tasks running that day is pushed back a working day (its levelDelay, which the
 * scheduler adds after the task's links), and the plan is scheduled again, until nobody is over 100% or nothing
 * more can move. Nothing else moves: every task is held at its current start (as a "start no earlier than"
 * when it has no constraint of its own), so levelling only ever delays. The task that waits is the one with the lowest priority (0-1000, 500 when not set); between
 * equals, the one that starts later, then the one further down the plan. A task with a "must start on" date is
 * never moved.
 */
import { schedule } from "./schedule.js";
import { overallocations } from "./resources.js";
import { toDay, fromDay } from "./project.js";

const MAX_ROUNDS = 5000;

/**
 * Levels a document's tasks on a calendar. Returns { delays: Map id → working days, moved: [ids], unresolved:
 * [{ name, from, to }] (clashes no delay could fix), finish (before → after) }. The document is not changed.
 */
export function level(doc, cal) {
  const delays = new Map(doc.tasks.filter((t) => t.levelDelay > 0).map((t) => [t.id, 0])); // start again from none
  // each task held where it is now, less any earlier levelling delay: levelling delays, it does not reschedule
  const work = { ...doc, tasks: doc.tasks.map((t) => ({ ...t, levelDelay: 0, constraint: t.constraint || { type: "SNET", date: unlevelledStart(t, cal) } })) };
  const before = schedule(work, cal).finish;
  const byId = new Map(work.tasks.map((t) => [t.id, t]));
  const order = new Map(work.tasks.map((t, i) => [t.id, i]));
  const stuck = new Set(); // a clash (person|day) no task could be moved out of
  let result = schedule(work, cal), rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    // the plan as scheduled, for the workload: every leaf at its scheduled start
    const view = { ...work, tasks: work.tasks.map((t) => (result.tasks[t.id] && !result.tasks[t.id].summary ? { ...t, start: result.tasks[t.id].start } : t)) };
    const clash = overallocations(view, cal.isWork).find((o) => !stuck.has(o.name + "|" + o.from));
    if (!clash) break;
    const day = toDay(clash.from);
    const running = clash.tasks.filter((id) => { const r = result.tasks[id]; return r && toDay(r.start) <= day && day <= toDay(r.finish); });
    const movable = running.filter((id) => byId.get(id).constraint?.type !== "MSO");
    if (running.length < 2 || !movable.length) { stuck.add(clash.name + "|" + clash.from); continue; }
    // keep the most important where it is; of the rest, the lowest priority waits
    const prio = (id) => byId.get(id).priority ?? 500;
    movable.sort((a, b) => prio(a) - prio(b) || (result.tasks[b].start > result.tasks[a].start ? 1 : result.tasks[b].start < result.tasks[a].start ? -1 : 0) || order.get(b) - order.get(a));
    const keep = [...running].sort((a, b) => prio(b) - prio(a) || (result.tasks[a].start < result.tasks[b].start ? -1 : result.tasks[a].start > result.tasks[b].start ? 1 : 0) || order.get(a) - order.get(b))[0];
    const victim = movable.find((id) => id !== keep) ?? movable[0];
    byId.get(victim).levelDelay += 1;
    delays.set(victim, byId.get(victim).levelDelay);
    result = schedule(work, cal);
  }
  const unresolved = [...stuck].map((k) => { const [name, from] = k.split("|"); return { name, from }; });
  const starts = new Map(Object.entries(result.tasks).filter(([, r]) => !r.summary).map(([id, r]) => [id, r.start]));
  return { delays, starts, moved: [...delays].filter(([, d]) => d > 0).map(([id]) => id), unresolved, finish: { before, after: result.finish }, rounds };
}

/** A task's start before levelling delayed it: its start moved back by its levelling delay, in working days. */
export function unlevelledStart(t, cal) {
  let d = toDay(t.start), left = t.levelDelay || 0, guard = 0;
  while (left > 0 && guard++ < 40000) { d--; if (cal.isWork(d)) left--; }
  return fromDay(d);
}
