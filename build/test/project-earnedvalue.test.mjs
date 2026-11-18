// Stage 5: earned value against a costed baseline at the status date.
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { earnedValue } from "../apps/project/core/earnedvalue.js";
import { STANDARD } from "../apps/project/core/schedule.js";

function plan() {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  m.isWork = STANDARD.isWork;
  const a = m.addTask({ name: "A", start: "2026-01-05", duration: 5, owner: "Nimal" }); // Mon-Fri, 40h
  const b = m.addTask({ name: "B", start: "2026-01-12", duration: 5, owner: "Nimal" }, a); // next week
  m.setResource("Nimal", { rate: 10 }); // 400 each
  m.saveBaseline("Baseline", "2026-01-02");
  return { m, a, b };
}

test("it needs a status date and a costed baseline", () => {
  const m = new ProjectModel(newProject("P", "2026-01-05"));
  assert.match(earnedValue(m.doc).error, /status date/);
  m.setStatusDate("2026-01-07");
  assert.match(earnedValue(m.doc).error, /baseline/);
});

test("planned, earned and actual value; schedule and cost indexes", () => {
  const { m, a } = plan();
  m.setStatusDate("2026-01-07"); // Wednesday: 3 of A's 5 days planned
  m.set(a, { progress: 40 });      // but only 40% done
  m.setResource("Nimal", { rate: 12.5 }); // and dearer than planned: A now costs 500
  const r = earnedValue(m.doc, { isWork: STANDARD.isWork });
  assert.deepEqual(r.rows[0], { id: a, name: "A", bac: 400, pv: 240, ev: 160, ac: 200, sv: -80, cv: -40, spi: 0.67, cpi: 0.8, eac: 500, vac: -100 });
  assert.equal(r.rows[1].pv, 0, "B is not planned to have started");
  assert.deepEqual([r.total.bac, r.total.pv, r.total.ev, r.total.spi], [800, 240, 160, 0.67]);
});

test("on plan and on budget: indexes of 1", () => {
  const { m, a, b } = plan();
  m.setStatusDate("2026-01-09");
  m.set(a, { progress: 100 });
  const r = earnedValue(m.doc, { isWork: STANDARD.isWork });
  assert.deepEqual([r.total.spi, r.total.cpi, r.total.eac, r.total.vac], [1, 1, 800, 0]);
  assert.equal(r.rows.find((x) => x.id === b).spi, null, "nothing planned yet: no index");
});
