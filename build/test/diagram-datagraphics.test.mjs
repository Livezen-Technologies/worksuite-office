import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { graphicFor, graphicsError, dataLabels, TINTS } from "../apps/diagram/core/datagraphics.js";

test("data graphics: colour and icon by rules, a data bar by a number, saved with the page", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const a = m.addShape({ type: "rect", x: 10, y: 10, text: "Ship" }), b = m.addShape({ type: "rect", x: 200, y: 10, text: "Pay" }), c = m.addShape({ type: "rect", x: 400, y: 10, text: "Plain" });
  m.setData(a, [{ label: "Status", value: "Late" }, { label: "Done %", value: 40 }]);
  m.setData(b, [{ label: "status", value: "On track" }, { label: "Done %", value: 150 }]);
  const g = { field: "Status", rules: 'red if = "Late"; yellow if = "At risk"; green', fill: true, icon: true, bar: { field: "Done %", max: 100 } };
  m.setGraphics(g);
  const page = parse(serialize(m.doc)).pages[0];
  assert.deepEqual(page.graphics, g);
  assert.deepEqual(graphicFor(m.item(a), page.graphics), { fill: TINTS.red, icon: "🔴", bar: 0.4, barLabel: "Done %: 40" });
  assert.deepEqual(graphicFor(m.item(b), page.graphics), { fill: TINTS.green, icon: "🟢", bar: 1, barLabel: "Done %: 150" }, "labels match whatever their case; bars stop at full");
  assert.deepEqual(graphicFor(m.item(c), page.graphics), {}, "no data, no change");
  assert.deepEqual(graphicFor(m.item(a), { ...g, fill: false, bar: undefined }), { icon: "🔴" });
  assert.deepEqual(dataLabels(m.page()), ["Done %", "status", "Status"].sort((x, y) => x.localeCompare(y)));
  assert.match(graphicsError({ field: "Status", rules: "purple if > 1" }), /not an icon/);
  assert.match(graphicsError({ bar: { field: "Done %", max: 0 } }), /full value more than 0/);
  assert.throws(() => m.setGraphics({ rules: "red" }), /need the shape data they read/);
  m.setGraphics(null);
  assert.equal(m.page().graphics, undefined);
});
