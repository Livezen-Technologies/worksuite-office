// Stage 5: task types and effort-driven scheduling (core/tasktypes.js through ProjectModel.set).
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { workOf, unitsOf } from "../apps/project/core/tasktypes.js";
import { fromProjectXml, toProjectXml } from "../apps/project/core/projectxml.js";

function model(fields) {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  const id = m.addTask({ name: "Paint", start: "2026-01-05", duration: 5, ...fields });
  return { m, id, t: () => m.task(id) };
}

test("work is duration × people × 8 hours, and appears when someone is assigned", () => {
  const { m, id, t } = model({});
  assert.equal(workOf(t()), 0);
  m.set(id, { owner: "Nimal" });
  assert.equal(t().work, 40);
  m.set(id, { owner: undefined });
  assert.equal(t().work, undefined, "no people, no work");
});

test("fixed units: duration moves work; work moves duration; a new person adds work unless effort driven", () => {
  const { m, id, t } = model({ owner: "Nimal" });
  m.set(id, { owner: "Nimal" });
  m.set(id, { duration: 10 });
  assert.equal(t().work, 80);
  m.set(id, { work: 24 });
  assert.equal(t().duration, 3);
  m.set(id, { owner: "Nimal, Priya" });
  assert.deepEqual([t().duration, t().work], [3, 48], "not effort driven: the same days, more work");
  m.set(id, { effortDriven: true, owner: "Nimal" });
  m.set(id, { work: 40 });
  m.set(id, { owner: "Nimal, Priya" });
  assert.deepEqual([t().duration, t().work], [3, 40], "effort driven: the same work, done sooner (40h / 16h a day → 3 days)");
});

test("fixed work: a longer duration lowers the people's share; another person shortens it", () => {
  const { m, id, t } = model({ owner: "Nimal", type: "fixedWork" });
  m.set(id, { owner: "Nimal" }); // 40h
  m.set(id, { duration: 10 });
  assert.equal(t().owner, "Nimal 50%");
  assert.equal(t().work, 40);
  m.set(id, { owner: "Nimal 50%, Priya 50%" });
  assert.deepEqual([t().duration, unitsOf(t())], [5, 1]);
});

test("fixed duration: more work raises the people's share; the dates do not move", () => {
  const { m, id, t } = model({ owner: "Nimal, Priya", type: "fixedDuration" });
  m.set(id, { owner: "Nimal, Priya" }); // 80h over 5 days
  m.set(id, { work: 120 });
  assert.equal(t().duration, 5);
  assert.equal(t().owner, "Nimal 150%, Priya 150%");
  m.set(id, { duration: 10 });
  assert.equal(t().work, 240, "a longer fixed-duration task keeps its people, so its work grows");
});

test("a milestone keeps no work; bad values are refused", () => {
  const { m, id, t } = model({ owner: "Nimal" });
  m.set(id, { duration: 0 });
  assert.equal(t().work, undefined);
  assert.throws(() => m.set(id, { type: "fixedEverything" }), /type must be/);
  assert.throws(() => m.set(id, { work: -1 }), /work must be hours/);
});

test("task type, effort driven and work go through Project XML", () => {
  const { m, id } = model({ owner: "Nimal", type: "fixedWork", effortDriven: true });
  m.set(id, { work: 30 });
  const xml = toProjectXml(m.doc);
  assert.match(xml, /<Type>2<\/Type><IsNull>0<\/IsNull><EffortDriven>1<\/EffortDriven><Work>PT30H0M0S<\/Work>/);
  const t = fromProjectXml(xml).doc.tasks[0];
  assert.deepEqual([t.type, t.effortDriven, t.work], ["fixedWork", true, 30]);
  const plain = fromProjectXml(toProjectXml(model({}).m.doc)).doc.tasks[0];
  assert.equal(plain.type, undefined, "fixed units is the default and is not stored");
});

test("fixed work keeps the work a task already had, even before it was ever stored", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  const id = m.addTask({ name: "Furniture", start: "2026-01-05", duration: 8, owner: "Ayesha, Ravi 50%", type: "fixedWork" }); // 96h, not stored
  m.set(id, { duration: 12 });
  assert.equal(m.task(id).work, 96);
  assert.equal(m.task(id).owner, "Ayesha 67%, Ravi 33%");
});
