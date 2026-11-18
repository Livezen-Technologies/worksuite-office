// Baselines in build/apps/project/core/project.js (#83): save the plan, compare actual against plan (slip in
// calendar or working days), at most 11, replace by name, clear, validate, undo, and survive a save and reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject, serialize, parse, MAX_BASELINES, validate } from "../apps/project/core/project.js";
import { STANDARD } from "../apps/project/core/schedule.js";

function plan() {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  const ph = m.addTask({ name: "Phase", duration: 1 });
  const a = m.addTask({ name: "A", level: 1, start: "2026-02-02", duration: 3 }, ph);
  const b = m.addTask({ name: "B", start: "2026-02-05", duration: 2 }, a);
  return { m, ph, a, b };
}

test("a baseline keeps every task's start, finish and duration", () => {
  const { m, a, ph } = plan();
  m.saveBaseline("Original", "2026-01-30");
  const bl = m.baseline("Original");
  assert.equal(bl.saved, "2026-01-30");
  assert.deepEqual(bl.tasks[a], { start: "2026-02-02", finish: "2026-02-04", duration: 3, cost: 0 }); // the planned cost too (earned value)
  assert.equal(bl.tasks[ph].finish, "2026-02-06"); // summaries too
});

test("variance: the slip against the baseline, in calendar or working days", () => {
  const { m, b } = plan();
  m.saveBaseline("Original", "2026-01-30");
  m.set(b, { start: "2026-02-09", duration: 3 }); // starts 4 days later, finishes 6 days later
  assert.deepEqual(m.variance(b, "Original"), { start: "2026-02-05", finish: "2026-02-06", duration: 2, startSlip: 4, finishSlip: 5 });
  m.isWork = STANDARD.isWork; // Thu 5 → Mon 9 is 2 working days; Fri 6 → Wed 11 is 3
  assert.equal(m.variance(b, "Original").startSlip, 2);
  assert.equal(m.variance(b, "Original").finishSlip, 3);
  m.set(b, { start: "2026-02-04" }); // earlier than planned: negative
  assert.equal(m.variance(b, "Original").startSlip, -1);
  const c = m.addTask({ name: "New" });
  assert.equal(m.variance(c, "Original"), null); // added after the baseline
});

test("names replace, at most 11, clear removes, undo restores", () => {
  const { m } = plan();
  m.saveBaseline("Original", "2026-01-30");
  m.saveBaseline("Original", "2026-02-10");
  assert.equal(m.doc.baselines.length, 1);
  assert.equal(m.baseline("Original").saved, "2026-02-10");
  for (let i = 2; i <= MAX_BASELINES; i++) m.saveBaseline("B" + i, "2026-02-10");
  assert.equal(m.doc.baselines.length, MAX_BASELINES);
  assert.throws(() => m.saveBaseline("One too many", "2026-02-10"), /at most 11/);
  m.clearBaseline("B2");
  assert.equal(m.doc.baselines.length, MAX_BASELINES - 1);
  assert.ok(m.undo());
  assert.ok(m.baseline("B2"));
});

test("baselines survive a save and reload, and a broken one is refused", () => {
  const { m } = plan();
  m.saveBaseline("Original", "2026-01-30");
  const text = serialize(m.doc);
  assert.deepEqual(new ProjectModel(parse(text)).baseline("Original"), m.baseline("Original"));
  const bad = structuredClone(m.doc);
  bad.baselines[0].tasks[Object.keys(bad.baselines[0].tasks)[0]].finish = "soon";
  assert.throws(() => validate(bad), /incomplete/);
  const none = structuredClone(m.doc);
  delete none.baselines;
  assert.doesNotThrow(() => validate(none)); // projects without baselines stay valid
});
