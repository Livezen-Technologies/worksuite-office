// Stage 5: resource levelling.
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { schedule, applyLevelling, clearLevelling, STANDARD } from "../apps/project/core/schedule.js";
import { level, unlevelledStart } from "../apps/project/core/levelling.js";
import { overallocations } from "../apps/project/core/resources.js";

function clashing() {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  m.isWork = STANDARD.isWork;
  const a = m.addTask({ name: "Wiring", start: "2026-01-05", duration: 3, owner: "Ravi" });
  const b = m.addTask({ name: "Cameras", start: "2026-01-05", duration: 2, owner: "Ravi" }, a);
  const c = m.addTask({ name: "Report", start: "2026-01-05", duration: 1, owner: "Nimal" }, b);
  const d = m.addTask({ name: "Sign-off", start: "2026-01-05", duration: 1, owner: "Nimal" }, c);
  m.link(b, d);
  return { m, a, b, c, d };
}

test("levelling delays the later or lower-priority task until nobody is over 100%", () => {
  const { m, a, b, d } = clashing();
  const plan = applyLevelling(m, STANDARD, level);
  assert.deepEqual(plan.moved, [b], "Cameras waits for Wiring");
  assert.equal(m.task(b).levelDelay, 3);
  assert.equal(m.task(b).start, "2026-01-08");
  assert.equal(m.task(d).start, "2026-01-12", "its successor follows");
  assert.equal(m.task(a).start, "2026-01-05");
  assert.deepEqual(overallocations(m.doc, STANDARD.isWork), []);
  assert.deepEqual(plan.finish, { before: "2026-01-07", after: "2026-01-12" });
  assert.equal(m.undoStack.at(-1) !== undefined, true);
});

test("priority decides who waits; a must-start-on task never moves", () => {
  const { m, a, b } = clashing();
  m.set(b, { priority: 900 });
  applyLevelling(m, STANDARD, level);
  assert.equal(m.task(a).levelDelay, 2, "the higher-priority Cameras goes first");
  assert.equal(m.task(b).levelDelay, undefined);
  const k = clashing();
  k.m.set(k.b, { constraint: { type: "MSO", date: "2026-01-05" } });
  applyLevelling(k.m, STANDARD, level);
  assert.equal(k.m.task(k.b).levelDelay, undefined);
  assert.ok(k.m.task(k.a).levelDelay > 0);
});

test("clearing levelling puts every task back; part-time people share a day without a delay", () => {
  const { m, b } = clashing();
  applyLevelling(m, STANDARD, level);
  clearLevelling(m, STANDARD, unlevelledStart);
  assert.equal(m.task(b).levelDelay, undefined);
  assert.equal(m.task(b).start, "2026-01-05");
  const p = new ProjectModel(newProject("P", "2026-01-05"));
  p.addTask({ name: "X", start: "2026-01-05", duration: 2, owner: "Ravi 50%" });
  p.addTask({ name: "Y", start: "2026-01-05", duration: 2, owner: "Ravi 50%" });
  assert.deepEqual(level(p.doc, STANDARD).moved, []);
});

test("priority and levelling delay are checked", () => {
  const { m, a } = clashing();
  assert.throws(() => m.set(a, { priority: 1001 }), /priority must be/);
  assert.throws(() => m.set(a, { levelDelay: 1.5 }), /levelling delay/);
  assert.equal(schedule({ ...m.doc, tasks: m.doc.tasks.map((t) => (t.id === a ? { ...t, levelDelay: 2 } : t)) }, STANDARD).tasks[a].start, "2026-01-07");
});

test("priority and levelling delay go through Project XML", async () => {
  const { fromProjectXml, toProjectXml } = await import("../apps/project/core/projectxml.js");
  const { m, a, b } = clashing();
  m.set(a, { priority: 800 });
  applyLevelling(m, STANDARD, level);
  const back = fromProjectXml(toProjectXml(m.doc)).doc;
  assert.equal(back.tasks[0].priority, 800);
  assert.equal(back.tasks[1].levelDelay, m.task(b).levelDelay);
  assert.equal(back.tasks[2].priority, undefined, "500 is the default and is not stored");
});

test("levelling only delays: tasks placed by hand and not in a clash stay where they are", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  m.isWork = STANDARD.isWork;
  const late = m.addTask({ name: "Later on its own", start: "2026-02-02", duration: 2, owner: "Ayesha" });
  const a = m.addTask({ name: "A", start: "2026-01-12", duration: 2, owner: "Ravi" }, late);
  const b = m.addTask({ name: "B", start: "2026-01-12", duration: 2, owner: "Ravi" }, a);
  applyLevelling(m, STANDARD, level);
  assert.equal(m.task(late).start, "2026-02-02");
  assert.equal(m.task(a).start, "2026-01-12");
  assert.equal(m.task(b).start, "2026-01-14");
  clearLevelling(m, STANDARD, unlevelledStart);
  assert.equal(m.task(b).start, "2026-01-12", "back by exactly its delay");
  assert.equal(m.task(late).start, "2026-02-02");
});

test("clearing also brings back the tasks linked after a delayed one", () => {
  const { m, b, d } = clashing();
  applyLevelling(m, STANDARD, level);
  assert.equal(m.task(d).start, "2026-01-12");
  clearLevelling(m, STANDARD, unlevelledStart);
  assert.equal(m.task(b).start, "2026-01-05");
  assert.equal(m.task(d).start, "2026-01-07", "Sign-off follows Cameras back");
});
