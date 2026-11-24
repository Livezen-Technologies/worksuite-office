import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, serialize, parse } from "../apps/project/core/project.js";
import { reportError, sortRows, REPORT_COLUMNS } from "../apps/project/core/reports.js";

test("custom report layouts: saved with the project, replaced by id, removed; bad layouts are refused", () => {
  const m = new ProjectModel();
  const r = { id: "r1", name: "Late work", columns: ["name", "finish", "owner"], filter: "late", group: "none", sort: { key: "finish", dir: "asc" } };
  m.saveReport(r);
  assert.deepEqual(parse(serialize(m.doc)).reports, [r]);
  m.saveReport({ ...r, name: "Late work by person", group: "person", sort: null });
  assert.equal(m.doc.reports.length, 1, "the same id replaces it");
  assert.equal(m.doc.reports[0].group, "person");
  m.undo();
  assert.equal(m.doc.reports[0].name, "Late work", "one undo step");
  m.removeReport("r1");
  assert.equal(m.doc.reports, undefined);
  assert.throws(() => m.saveReport({ ...r, columns: [] }), /at least one column/);
  assert.throws(() => m.saveReport({ ...r, columns: ["name", "colour"] }), /no column colour/);
  assert.throws(() => m.saveReport({ ...r, filter: "fun" }), /unknown filter/);
  assert.throws(() => m.saveReport({ ...r, sort: { key: "name", dir: "up" } }), /sort/);
  assert.equal(reportError({ ...r, columns: ["c:f1"] }, [{ key: "f1" }]), "", "custom field columns");
  assert.equal(REPORT_COLUMNS[1][0], "name");
});

test("sorting a report: numbers and text, blanks last, ties keep their order, either way", () => {
  const rows = [{ n: "b", v: 3 }, { n: "a", v: "" }, { n: "c", v: 1 }, { n: "d", v: 3 }];
  const val = (r, k) => r[k];
  assert.deepEqual(sortRows(rows, { key: "v", dir: "asc" }, val).map((r) => r.n), ["c", "b", "d", "a"]);
  assert.deepEqual(sortRows(rows, { key: "v", dir: "desc" }, val).map((r) => r.n), ["b", "d", "c", "a"]);
  assert.deepEqual(sortRows(rows, { key: "n", dir: "asc" }, val).map((r) => r.n), ["a", "b", "c", "d"]);
  assert.equal(sortRows(rows, null, val), rows);
});
