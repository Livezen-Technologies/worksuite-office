// Stage 5: WBS codes, deadlines, inactive tasks.
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject, wbsCodes, serialize, parse } from "../apps/project/core/project.js";
import { schedule, criticalPath, STANDARD } from "../apps/project/core/schedule.js";
import { pastDeadline, behindSchedule } from "../apps/project/core/progress.js";
import { workload } from "../apps/project/core/resources.js";
import { fromProjectXml, toProjectXml } from "../apps/project/core/projectxml.js";

function plan() {
  const d = newProject("P", "2026-01-05");
  d.tasks = [
    { id: "s", name: "Phase", level: 0, start: "2026-01-05", duration: 8, progress: 0 },
    { id: "a", name: "A", level: 1, start: "2026-01-05", duration: 3, progress: 0, owner: "Nimal", deadline: "2026-01-06" },
    { id: "x", name: "Optional", level: 1, start: "2026-01-05", duration: 20, progress: 0, owner: "Nimal", inactive: true },
    { id: "b", name: "B", level: 1, start: "2026-01-08", duration: 2, progress: 0 },
    { id: "t", name: "Two", level: 0, start: "2026-01-12", duration: 1, progress: 0 },
    { id: "u", name: "Sub", level: 1, start: "2026-01-12", duration: 1, progress: 0 },
    { id: "v", name: "Deep", level: 2, start: "2026-01-12", duration: 1, progress: 0 },
  ];
  d.links = [{ from: "a", to: "x", type: "FS", lag: 0 }, { from: "x", to: "b", type: "FS", lag: 0 }];
  return d;
}

test("WBS codes follow the outline", () => {
  assert.deepEqual([...wbsCodes(plan().tasks).values()], ["1", "1.1", "1.2", "1.3", "2", "2.1", "2.1.1"]);
});

test("an inactive task is not scheduled, rolled up, linked, loaded or counted as behind", () => {
  const d = plan();
  const r = schedule(d, STANDARD);
  assert.equal(r.tasks.x, undefined);
  assert.equal(r.tasks.b.start, "2026-01-05", "its links are ignored, so B is free to start");
  assert.ok(!r.problems.some((p) => /summary/.test(p)), "no misleading summary warning");
  assert.ok(!criticalPath(r).includes("x"));
  const m = new ProjectModel(d); m.isWork = STANDARD.isWork;
  assert.equal(m.view("s").finish, "2026-01-09", "the 20-day inactive task does not stretch its phase");
  assert.equal(workload(d, STANDARD.isWork).get("Nimal").size, 3);
  d.statusDate = "2026-02-27";
  assert.ok(!behindSchedule(d, d.statusDate, STANDARD.isWork).some((x) => x.id === "x"));
});

test("a missed deadline is flagged by the scheduler and listed", () => {
  const d = plan();
  assert.ok(schedule(d, STANDARD).problems.some((p) => /"A" finishes after its deadline, 2026-01-06/.test(p)));
  assert.deepEqual(pastDeadline(d, STANDARD.isWork), [{ id: "a", name: "A", deadline: "2026-01-06", finish: "2026-01-07" }]);
  d.tasks[1].deadline = "2026-01-07";
  assert.deepEqual(pastDeadline(d, STANDARD.isWork), []);
});

test("deadlines and inactive tasks save, validate and go through Project XML", () => {
  const d = plan();
  assert.equal(parse(serialize(d)).tasks[2].inactive, true);
  assert.throws(() => new ProjectModel({ ...d, tasks: d.tasks.map((t, i) => (i === 1 ? { ...t, deadline: "soon" } : t)) }), /deadline must be a date/);
  const back = fromProjectXml(toProjectXml(d)).doc;
  assert.equal(back.tasks[1].deadline, "2026-01-06");
  assert.equal(back.tasks[2].inactive, true);
  assert.equal(back.tasks[3].inactive, undefined);
});
