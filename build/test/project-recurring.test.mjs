// Stage 5: recurring tasks.
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject, serialize, parse } from "../apps/project/core/project.js";
import { occurrences, describe, patternError } from "../apps/project/core/recurring.js";
import { STANDARD, SRI_LANKA } from "../apps/project/core/schedule.js";

test("weekly on chosen days, a number of times", () => {
  assert.deepEqual(occurrences("2026-01-05", { every: "week", interval: 1, weekdays: [1, 4], count: 5 }),
    ["2026-01-05", "2026-01-08", "2026-01-12", "2026-01-15", "2026-01-19"]);
  assert.deepEqual(occurrences("2026-01-07", { every: "week", interval: 2, weekdays: [1], count: 2 }), ["2026-01-19", "2026-02-02"], "from the next Monday on");
});

test("daily and monthly, until a date; the 31st in a short month is its last day", () => {
  assert.deepEqual(occurrences("2026-01-05", { every: "day", interval: 2, until: "2026-01-11" }), ["2026-01-05", "2026-01-07", "2026-01-09", "2026-01-11"]);
  assert.deepEqual(occurrences("2026-01-31", { every: "month", interval: 1, count: 3 }), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("an occurrence on a non-working day moves to the next working day", () => {
  assert.deepEqual(occurrences("2026-01-31", { every: "month", interval: 1, count: 2 }, STANDARD.isWork), ["2026-02-02", "2026-03-02"], "Sat 31 Jan → Mon; Sat 28 Feb → Mon");
  assert.equal(occurrences("2026-02-02", { every: "week", interval: 1, weekdays: [3], count: 1 }, SRI_LANKA.isWork)[0], "2026-02-05", "Wed 4 Feb is Independence Day");
});

test("a recurring task is a summary keeping its pattern, with one subtask per occurrence; one undo step", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  const before = m.undoStack.length;
  const id = m.addRecurring("Status meeting", "2026-01-05", { every: "week", interval: 1, weekdays: [1], count: 4 }, { owner: "Nimal" });
  assert.equal(m.undoStack.length, before + 1);
  assert.deepEqual(m.tasks.map((t) => [t.name, t.level, t.start]), [["Status meeting", 0, "2026-01-05"], ["Status meeting 1", 1, "2026-01-05"], ["Status meeting 2", 1, "2026-01-12"], ["Status meeting 3", 1, "2026-01-19"], ["Status meeting 4", 1, "2026-01-26"]]);
  assert.equal(m.tasks[2].owner, "Nimal");
  assert.equal(m.view(id).finish, "2026-01-26");
  assert.equal(describe(m.task(id).recurring), "Every week on Mon, 4 times");
  assert.equal(parse(serialize(m.doc)).tasks[0].recurring.count, 4);
});

test("bad patterns are refused with a reason", () => {
  assert.match(patternError({ every: "week", interval: 1, weekdays: [], count: 2 }), /weekday/);
  assert.match(patternError({ every: "day", interval: 1 }), /how many times/);
  assert.throws(() => new ProjectModel(newProject("P", "2026-01-05")).addRecurring("X", "2026-01-05", { every: "year", interval: 1, count: 2 }), /how often/);
});
