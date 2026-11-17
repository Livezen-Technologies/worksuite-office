import test from "node:test";
import assert from "node:assert/strict";
import { assignmentsOf, ownerText, ownersOf, resourceList, workload, overallocations, weeklyLoad } from "../apps/project/core/resources.js";
import { newProject } from "../apps/project/core/project.js";
import { STANDARD } from "../apps/project/core/schedule.js";

function doc() {
  const d = newProject("T", "2026-01-05");
  d.tasks = [
    { id: "s", name: "Phase", level: 0, start: "2026-01-05", duration: 10, progress: 0, owner: "Nimal" },
    { id: "a", name: "A", level: 1, start: "2026-01-05", duration: 3, progress: 0, owner: "Nimal, Priya" },
    { id: "b", name: "B", level: 1, start: "2026-01-07", duration: 2, progress: 0, owner: "Nimal" },
    { id: "m", name: "Done", level: 1, start: "2026-01-09", duration: 0, progress: 0, owner: "Nimal" },
    { id: "c", name: "C", level: 0, start: "2026-01-09", duration: 2, progress: 0, owner: "Nimal" },
  ];
  return d;
}

test("owners are split on commas and listed with task counts", () => {
  assert.deepEqual(ownersOf({ owner: " Nimal ,Priya,," }), ["Nimal", "Priya"]);
  assert.deepEqual(resourceList(doc()), [{ name: "Nimal", tasks: 5 }, { name: "Priya", tasks: 1 }]);
});

test("workload skips summaries and milestones and counts working days", () => {
  const w = workload(doc(), STANDARD.isWork);
  const n = w.get("Nimal");
  // A Mon-Wed, B Wed-Thu, C Fri + Mon (weekend skipped)
  assert.equal(n.size, 6);
  assert.equal([...n.values()].filter((ids) => ids.length > 1).length, 1); // only Wednesday
  assert.equal(w.get("Priya").size, 3);
});

test("over-allocations are runs of days with more than one task", () => {
  const o = overallocations(doc(), STANDARD.isWork);
  assert.deepEqual(o, [{ name: "Nimal", from: "2026-01-07", to: "2026-01-07", days: 1, peak: 2, tasks: ["a", "b"] }]);
  const d = doc(); d.tasks[2].duration = 4; // B Wed-Mon now overlaps C on Fri and Mon, across the weekend
  const o2 = overallocations(d, STANDARD.isWork);
  assert.equal(o2.length, 2);
  assert.deepEqual(o2[1], { name: "Nimal", from: "2026-01-09", to: "2026-01-12", days: 2, peak: 2, tasks: ["b", "c"] });
});

test("weekly load sums task-days per week with the peak day", () => {
  const rows = weeklyLoad(doc(), STANDARD.isWork);
  assert.equal(rows[0].name, "Nimal");
  assert.deepEqual(rows[0].weeks, [{ start: "2026-01-05", days: 6, peak: 2 }, { start: "2026-01-12", days: 1, peak: 1 }]);
});

test("a percentage after a name is a part-time assignment", () => {
  assert.deepEqual(assignmentsOf({ owner: "Nimal, Priya 50%, Ravi 12.5 %" }), [
    { name: "Nimal", units: 1 }, { name: "Priya", units: 0.5 }, { name: "Ravi", units: 0.125 }]);
  assert.deepEqual(assignmentsOf({ owner: "Team 2026" }), [{ name: "Team 2026", units: 1 }]); // no % sign: part of the name
  assert.equal(ownerText([{ name: "Nimal", units: 1 }, { name: "Priya", units: 0.5 }]), "Nimal, Priya 50%");
});

test("two half-time tasks fit in a day; more than 100% is over-allocated", () => {
  const d = doc();
  d.tasks[1].owner = "Nimal 50%, Priya"; d.tasks[2].owner = "Nimal 50%";
  assert.deepEqual(overallocations(d, STANDARD.isWork), []);
  assert.deepEqual(weeklyLoad(d, STANDARD.isWork)[0].weeks[0], { start: "2026-01-05", days: 3.5, peak: 1 });
  d.tasks[2].owner = "Nimal 60%";
  assert.equal(overallocations(d, STANDARD.isWork)[0].peak, 1.1);
});
