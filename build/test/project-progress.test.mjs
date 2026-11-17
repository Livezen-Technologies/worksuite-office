import test from "node:test";
import assert from "node:assert/strict";
import { expectedProgress, behindSchedule } from "../apps/project/core/progress.js";
import { ProjectModel, newProject, serialize, parse } from "../apps/project/core/project.js";
import { fromProjectXml, toProjectXml } from "../apps/project/core/projectxml.js";
import { STANDARD } from "../apps/project/core/schedule.js";
const W = STANDARD.isWork;

test("expected progress counts the working days passed by the status date", () => {
  const t = { start: "2026-01-05", duration: 5 }; // Mon-Fri
  assert.equal(expectedProgress(t, "2026-01-04", W), 0);
  assert.equal(expectedProgress(t, "2026-01-06", W), 40);
  assert.equal(expectedProgress(t, "2026-01-09", W), 100);
  const u = { start: "2026-01-08", duration: 4 }; // Thu, Fri, Mon, Tue
  assert.equal(expectedProgress(u, "2026-01-10", W), 50); // the weekend adds nothing
});

test("tasks short of their expected progress are behind; past their finish they are late", () => {
  const d = newProject("P", "2026-01-05");
  d.tasks = [
    { id: "s", name: "Phase", level: 0, start: "2026-01-05", duration: 10, progress: 0 },
    { id: "a", name: "A", level: 1, start: "2026-01-05", duration: 5, progress: 60 },
    { id: "b", name: "B", level: 1, start: "2026-01-05", duration: 2, progress: 50 },
    { id: "c", name: "C", level: 1, start: "2026-01-12", duration: 5, progress: 0 },
    { id: "m", name: "Go", level: 1, start: "2026-01-06", duration: 0, progress: 0 },
  ];
  d.statusDate = "2026-01-07";
  assert.deepEqual(behindSchedule(d, d.statusDate, W).map((x) => [x.id, x.behind, x.late]), [["b", 50, true], ["m", 100, true]]);
  assert.deepEqual(behindSchedule({ ...d, statusDate: undefined }), []);
});

test("progress keeps actual dates, and the status date saves", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  m.isWork = W;
  const id = m.addTask({ name: "A", start: "2026-01-08", duration: 3 });
  m.set(id, { progress: 50 });
  assert.equal(m.task(id).actualStart, "2026-01-08");
  assert.equal(m.task(id).actualFinish, undefined);
  m.set(id, { progress: 100 });
  assert.equal(m.task(id).actualFinish, "2026-01-12"); // Thu, Fri, Mon
  m.set(id, { progress: 0 });
  assert.equal(m.task(id).actualStart, undefined);
  m.setStatusDate("2026-01-09");
  assert.equal(parse(serialize(m.doc)).statusDate, "2026-01-09");
  assert.throws(() => m.setStatusDate("soon"), /status date/);
});

test("actual dates and the status date go through Project XML", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  const id = m.addTask({ name: "A", start: "2026-01-05", duration: 2 });
  m.set(id, { progress: 100 });
  m.setStatusDate("2026-01-06");
  const { doc } = fromProjectXml(toProjectXml(m.doc));
  assert.equal(doc.statusDate, "2026-01-06");
  assert.equal(doc.tasks[0].actualStart, "2026-01-05");
  assert.equal(doc.tasks[0].actualFinish, "2026-01-06");
});

test("part-time assignments go through Project XML as Units", () => {
  const d = newProject("P", "2026-01-05");
  d.tasks = [{ id: "a", name: "A", level: 0, start: "2026-01-05", duration: 2, progress: 0, owner: "Nimal, Priya 50%" }];
  const xml = toProjectXml(d);
  assert.match(xml, /<Units>0.5<\/Units>/);
  assert.equal(fromProjectXml(xml).doc.tasks[0].owner, "Nimal, Priya 50%");
});
