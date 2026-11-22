import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { readTableFile, readXlsxRows, matchRows, mergeRow, colOf } from "../apps/diagram/core/linkdata.js";
import { xlsx } from "../apps/common/zip.js";

const rows = [["Step", "Owner", "Status", "Done %"], ["Ship", "Ravi", "Late", "40"], ["pay", "Nimal", "On track", "90"], ["Audit", "Priya", "At risk", "10"]];

test("link data: rows to shapes by their data or text, columns typed into shape data, the rest added on request", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const a = m.addShape({ type: "rect", x: 10, y: 10, text: "Ship\nto customer" });
  const b = m.addShape({ type: "rect", x: 200, y: 10, text: "Payment" });
  m.setData(b, [{ label: "Step", value: "Pay" }, { label: "Note", value: "keep" }]);
  const lanes = m.addLanes(["Ship"]);
  const r = matchRows(m.page().items, rows, "step");
  assert.deepEqual(r.matches.map((x) => x.id), [a, b], "by first line of text, and by data whatever the case; lanes never");
  assert.equal(r.unmatched.length, 1);
  const out = m.linkData(rows, "Step", { source: "steps.csv", addMissing: true, at: "2026-11-22" });
  assert.deepEqual(out, { updated: 2, added: 1, unmatched: 0 });
  assert.deepEqual(m.item(a).data, [{ label: "Step", value: "Ship" }, { label: "Owner", value: "Ravi" }, { label: "Status", value: "Late" }, { label: "Done %", value: 40 }]);
  assert.deepEqual(m.item(b).data.find((d) => d.label === "Note"), { label: "Note", value: "keep" }, "other data stays");
  const added = m.page().items.at(-1);
  assert.deepEqual([added.text, added.data.find((d) => d.label === "Owner").value], ["Audit", "Priya"]);
  assert.deepEqual(parse(serialize(m.doc)).pages[0].link, { source: "steps.csv", key: "Step", at: "2026-11-22" });
  assert.equal(m.item(lanes[0]).data, undefined);
  m.undo();
  assert.equal(m.item(a).data, undefined, "one undo takes it all back");
  assert.throws(() => m.linkData(rows, "Nope"), /no column called Nope/);
  assert.deepEqual(mergeRow([{ label: "Owner", value: "x" }], ["Owner", "Cost"], ["", "5"]), [{ label: "Owner", value: "x" }, { label: "Cost", value: 5 }], "empty cells clear nothing");
});

test("link data reads CSV and the first sheet of an XLSX file", async () => {
  assert.equal(colOf("A1"), 0); assert.equal(colOf("AB7"), 27);
  const csv = new TextEncoder().encode('﻿Step,Owner\n"Ship, fast",Ravi\n');
  assert.deepEqual(await readTableFile(csv), [["Step", "Owner"], ["Ship, fast", "Ravi"]]);
  const book = xlsx(rows, "Steps");
  assert.deepEqual(await readXlsxRows(book), rows);
  assert.deepEqual(await readTableFile(book), rows);
});
