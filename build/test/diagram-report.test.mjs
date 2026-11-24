import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram } from "../apps/diagram/core/diagram.js";
import { shapeReport, reportTable, toCsv } from "../apps/diagram/core/report.js";

test("shape report: a row per shape with data, a column per data name, formulas worked out, totals for numbers", () => {
  const m = new DiagramModel(newDiagram("Costs"));
  const a = m.addShape({ type: "server", x: 0, y: 0, w: 80, h: 100, text: "Web server" });
  const b = m.addShape({ type: "server", x: 100, y: 0, w: 80, h: 100, text: "Database, main" });
  m.addShape({ type: "rect", x: 300, y: 0, w: 80, h: 50, text: "No data" });
  m.setData(a, [{ label: "Cost", value: 1200 }, { label: "Qty", value: 2 }, { label: "Total", value: "=[Cost] * [Qty]" }, { label: "Owner", value: "IT" }]);
  m.setData(b, [{ label: "cost", value: 3000 }, { label: "Qty", value: 1 }, { label: "Total", value: "=[Cost] * [Qty]" }]);
  const p2 = m.addPage("Branch");
  const c = m.addShape({ type: "server", x: 0, y: 0, w: 80, h: 100, text: "Branch server" }, p2);
  m.setData(c, [{ label: "Cost", value: 800 }], p2);
  const rep = shapeReport(m.doc);
  assert.deepEqual(rep.columns, ["Cost", "Qty", "Total", "Owner"], "names match whatever their case");
  assert.equal(rep.rows.length, 3, "only shapes with data");
  assert.equal(rep.rows[1].values.Total, 3000);
  assert.deepEqual(rep.totals, { Cost: 5000, Qty: 3, Total: 5400 });
  assert.equal(shapeReport(m.doc, { pages: p2 }).rows.length, 1);
  assert.equal(shapeReport(m.doc, { onlyWithData: false }).rows.length, 4);
  const table = reportTable(rep);
  assert.deepEqual(table[0], ["Page", "Shape", "Type", "Cost", "Qty", "Total", "Owner"]);
  assert.deepEqual(table.at(-1), ["Total", "", "", 5000, 3, 5400, ""]);
  const csv = toCsv(table);
  assert.match(csv, /"Database, main"/, "commas are quoted");
  assert.ok(csv.endsWith("\r\n"));
});
