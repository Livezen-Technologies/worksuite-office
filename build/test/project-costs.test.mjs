// Stage 5: costs: the Resource Sheet, fixed costs, task and project totals.
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject, serialize, parse } from "../apps/project/core/project.js";
import { costs, ownCost, resourceSheet, formatMoney } from "../apps/project/core/costs.js";
import { fromProjectXml, toProjectXml } from "../apps/project/core/projectxml.js";

function plan() {
  const d = newProject("P", "2026-01-05");
  d.tasks = [
    { id: "s", name: "Phase", level: 0, start: "2026-01-05", duration: 5, progress: 0, fixedCost: 100 },
    { id: "a", name: "A", level: 1, start: "2026-01-05", duration: 2, progress: 0, owner: "Nimal" },          // 16h
    { id: "b", name: "B", level: 1, start: "2026-01-07", duration: 3, progress: 0, owner: "Nimal, Priya 50%", fixedCost: 50 }, // 36h: 24 + 12
    { id: "x", name: "Dropped", level: 1, start: "2026-01-07", duration: 3, progress: 0, owner: "Priya", inactive: true },
    { id: "c", name: "Venue", level: 0, start: "2026-01-12", duration: 1, progress: 0, fixedCost: 1000 },
  ];
  d.resources = [{ name: "Nimal", rate: 20 }, { name: "Priya", rate: 30, costPerUse: 15 }];
  return d;
}

test("a task costs its people's hours at their rates, their cost per use, and its fixed cost", () => {
  const d = plan();
  assert.equal(ownCost(d, d.tasks[1]), 320);
  assert.equal(ownCost(d, d.tasks[2]), 24 * 20 + 12 * 30 + 15 + 50);
  assert.equal(ownCost(d, d.tasks[3]), 0, "inactive costs nothing");
});

test("summaries add up their tasks plus their own fixed cost; the project total adds the top level", () => {
  const { byId, total } = costs(plan());
  assert.equal(byId.get("s"), 100 + 320 + 905);
  assert.equal(byId.get("c"), 1000);
  assert.equal(total, 2325);
  assert.equal(formatMoney(total), "2,325.00");
});

test("the Resource Sheet lists everyone with work and cost; rates are set and cleared through the model", () => {
  const rows = resourceSheet(plan());
  assert.deepEqual(rows.map((r) => [r.name, r.rate, r.work, r.cost]), [["Nimal", 20, 40, 800], ["Priya", 30, 12, 375]]);
  const m = new ProjectModel(plan());
  m.setResource("Ravi", { rate: 25 });
  assert.equal(m.doc.resources.find((r) => r.name === "Ravi").rate, 25);
  m.setResource("Ravi", { rate: "" });
  assert.equal(m.doc.resources.find((r) => r.name === "Ravi"), undefined, "an empty row is dropped");
  assert.throws(() => m.setResource("Nimal", { rate: -1 }), /rate must be 0 or more/);
  assert.equal(parse(serialize(m.doc)).resources.length, 2);
});

test("rates, cost per use and fixed costs go through Project XML", () => {
  const xml = toProjectXml(plan());
  assert.match(xml, /<Name>Priya<\/Name><Type>1<\/Type><StandardRate>30<\/StandardRate><StandardRateFormat>2<\/StandardRateFormat><CostPerUse>15<\/CostPerUse>/);
  const back = fromProjectXml(xml).doc;
  assert.deepEqual(back.resources, [{ name: "Nimal", rate: 20 }, { name: "Priya", rate: 30, costPerUse: 15 }]);
  assert.equal(back.tasks[4].fixedCost, 1000);
  assert.equal(costs(back).total, 2325);
});
