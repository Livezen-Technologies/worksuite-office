// Stage 5: the Task Board and Calendar views (editor/views.js).
import test from "node:test";
import assert from "node:assert/strict";
import { newProject } from "../apps/project/core/project.js";
import { board, columnOf, progressFor, month } from "../apps/project/editor/views.js";
import { STANDARD } from "../apps/project/core/schedule.js";

function plan() {
  const d = newProject("P", "2026-02-02");
  d.tasks = [
    { id: "p", name: "Fit-out", level: 0, start: "2026-02-02", duration: 5, progress: 0 },
    { id: "a", name: "Wiring", level: 1, start: "2026-02-05", duration: 3, progress: 40, owner: "Ravi" },
    { id: "b", name: "Survey", level: 1, start: "2026-02-02", duration: 2, progress: 100 },
    { id: "c", name: "Paint", level: 1, start: "2026-02-03", duration: 2, progress: 0 },
    { id: "x", name: "Maybe", level: 1, start: "2026-02-03", duration: 2, progress: 0, inactive: true },
    { id: "m", name: "Open", level: 0, start: "2026-02-28", duration: 0, progress: 0 },
  ];
  return d;
}

test("the board sorts tasks into columns by progress, in start order, without summaries or inactive tasks", () => {
  const b = board(plan(), STANDARD.isWork, "2026-02-06");
  assert.deepEqual(b.todo.map((c) => c.name), ["Paint", "Open"]);
  assert.deepEqual(b.doing.map((c) => [c.name, c.phase, c.owner]), [["Wiring", "Fit-out", "Ravi"]]);
  assert.deepEqual(b.done.map((c) => c.name), ["Survey"]);
  assert.equal(b.todo[0].late, true, "Paint should have finished by the status date");
  assert.equal(b.todo[1].milestone, true);
});

test("dropping a card sets its progress", () => {
  assert.equal(columnOf({ progress: 0 }), "todo");
  assert.equal(progressFor("doing", { progress: 0 }), 50);
  assert.equal(progressFor("doing", { progress: 30 }), 30, "a part-done task keeps its progress");
  assert.equal(progressFor("done", { progress: 30 }), 100);
  assert.equal(progressFor("todo", { progress: 100 }), 0);
});

test("a month: Monday-first weeks, tasks on the working days they run, milestones on their day", () => {
  const m = month(plan(), 2026, 1, STANDARD.isWork); // February 2026
  assert.equal(m.title, "February 2026");
  assert.equal(m.weeks[0][0].date, "2026-01-26", "1 Feb 2026 is a Sunday: its week starts on Monday 26 Jan");
  assert.equal(m.weeks[0][0].inMonth, false);
  assert.equal(m.weeks.length, 5);
  const day = (iso) => m.weeks.flat().find((d) => d.date === iso);
  assert.deepEqual(day("2026-02-05").tasks.map((t) => t.name), ["Wiring"]);
  assert.deepEqual(day("2026-02-09").tasks.map((t) => [t.name, t.last]), [["Wiring", true]], "Thu, Fri, Mon: the weekend skipped");
  assert.deepEqual(day("2026-02-07").tasks, []);
  assert.deepEqual(day("2026-02-28").tasks.map((t) => t.name), ["Open"], "a milestone shows even on a Saturday");
  assert.ok(!day("2026-02-03").tasks.some((t) => t.name === "Maybe"));
});

test("the Network Diagram puts each task in the column after its longest chain of links", async () => {
  const { network, NODE } = await import("../apps/project/editor/views.js");
  const d = plan();
  d.links = [{ from: "b", to: "c", type: "FS", lag: 0 }, { from: "c", to: "a", type: "FS", lag: 0 }, { from: "b", to: "a", type: "FS", lag: 0 }];
  const n = network(d, STANDARD.isWork);
  const col = (id) => (n.nodes.find((x) => x.id === id).x - 16) / (NODE.w + NODE.gapX);
  assert.deepEqual(["b", "c", "a", "m"].map(col), [0, 1, 2, 0]);
  assert.equal(n.nodes.find((x) => x.id === "x"), undefined, "inactive tasks are left out");
  assert.equal(n.nodes.find((x) => x.id === "p"), undefined, "summaries too");
  assert.equal(n.edges.length, 3);
  assert.deepEqual(n.edges[0].points[0], [16 + NODE.w, 16 + NODE.h / 2], "a link leaves from the right of its box");
  assert.equal(n.nodes.find((x) => x.id === "a").n, 2, "boxes keep the task's row number");
});

test("usage: hours per week by person (with their tasks) and by task (with its people); over-allocated weeks flagged", async () => {
  const { usage } = await import("../apps/project/editor/views.js");
  const d = newProject("P", "2026-02-02");
  d.tasks = [
    { id: "a", name: "Wiring", level: 0, start: "2026-02-05", duration: 3, progress: 0, owner: "Ravi" }, // Thu Fri | Mon: 16h + 8h
    { id: "b", name: "Cameras", level: 0, start: "2026-02-05", duration: 2, progress: 0, owner: "Ravi 50%, Nimal" }, // 8h Ravi, 16h Nimal
    { id: "x", name: "Maybe", level: 0, start: "2026-02-05", duration: 2, progress: 0, owner: "Ravi", inactive: true },
  ];
  const r = usage(d, STANDARD.isWork, "resource");
  assert.deepEqual(r.weeks, ["2026-02-02", "2026-02-09"]);
  const ravi = r.rows.find((x) => x.name === "Ravi");
  assert.equal(ravi.total, 32);
  assert.deepEqual([...ravi.weeks], [["2026-02-02", 24], ["2026-02-09", 8]]);
  assert.deepEqual([...ravi.over], ["2026-02-02"], "12 hours on Thursday and Friday");
  assert.deepEqual(ravi.children.map((c) => [c.name, c.total]), [["Wiring", 24], ["Cameras", 8]]);
  assert.equal(r.rows.find((x) => x.name === "Nimal").over.size, 0);
  const t = usage(d, STANDARD.isWork, "task");
  assert.deepEqual(t.rows.map((x) => [x.name, x.total, x.children.map((c) => c.name).join("+")]), [["Wiring", 24, "Ravi"], ["Cameras", 24, "Ravi+Nimal"]]);
});

test("filterTasks: matching tasks and the summaries above them; people; all is no filter", async () => {
  const { filterTasks } = await import("../apps/project/editor/views.js");
  const d = newProject("P", "2026-02-02");
  d.tasks = [
    { id: "s", name: "Phase", level: 0, start: "2026-02-02", duration: 5, progress: 50 },
    { id: "a", name: "Done", level: 1, start: "2026-02-02", duration: 2, progress: 100, owner: "Ravi" },
    { id: "b", name: "Open", level: 1, start: "2026-02-04", duration: 3, progress: 0, owner: "Nimal" },
    { id: "m", name: "Go", level: 0, start: "2026-02-09", duration: 0, progress: 0 },
  ];
  assert.equal(filterTasks(d, "all"), null);
  assert.deepEqual([...filterTasks(d, "completed")], ["a", "s"]);
  assert.deepEqual([...filterTasks(d, "incomplete")].sort(), ["b", "m", "s"]);
  assert.deepEqual([...filterTasks(d, "milestones")], ["m"]);
  assert.deepEqual([...filterTasks(d, "critical", { critical: new Set(["b"]) })], ["b", "s"]);
  assert.deepEqual([...filterTasks(d, "person:Nimal")], ["b", "s"]);
});

test("timeline: top-level bars in lanes, milestones with label lanes, month ticks", async () => {
  const { timeline } = await import("../apps/project/editor/views.js");
  const d = newProject("P", "2026-02-02");
  d.tasks = [
    { id: "p1", name: "Plan", level: 0, start: "2026-02-02", duration: 10, progress: 0 },
    { id: "c", name: "Child", level: 1, start: "2026-02-02", duration: 10, progress: 0 },
    { id: "p2", name: "Build", level: 0, start: "2026-02-09", duration: 10, progress: 0 },
    { id: "p3", name: "Ship", level: 0, start: "2026-03-02", duration: 5, progress: 0 },
    { id: "m1", name: "Go", level: 0, start: "2026-02-16", duration: 0, progress: 0 },
    { id: "m2", name: "Gate", level: 1, start: "2026-02-17", duration: 0, progress: 0 },
  ];
  const t = timeline(d, STANDARD.isWork, 1000);
  assert.deepEqual(t.bars.map((b) => [b.id, b.lane]), [["p1", 0], ["p2", 1], ["p3", 0]], "Build overlaps Plan, Ship fits after it");
  assert.deepEqual(t.milestones.map((m) => m.id), ["m1", "m2"]);
  assert.notEqual(t.milestones[0].labelY, t.milestones[1].labelY, "labels a day apart take two lanes");
  assert.deepEqual(t.ticks.map((k) => k.label), ["Feb 2026", "Mar 2026"]);
  assert.equal(t.start, "2026-02-02");
});
