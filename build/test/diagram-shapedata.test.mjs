import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { dataError, parseDataValue, formatDataValue, toPropertySection, fromPropertyRows } from "../apps/diagram/core/shapedata.js";

test("shape data: typed values, unique labels, set and cleared on a shape, saved", () => {
  assert.equal(parseDataValue("1,250"), 1250);
  assert.equal(parseDataValue("yes"), true);
  assert.equal(parseDataValue(" Ravi "), "Ravi");
  assert.equal(formatDataValue(false), "No");
  assert.equal(dataError([{ label: "Owner", value: "Ravi" }, { label: "owner", value: "x" }]), "owner is in the shape data twice");
  assert.match(dataError([{ label: "Cost", value: NaN }]), /must be text, a number or yes\/no/);
  const m = new DiagramModel(newDiagram("Flow"));
  const s = m.addShape({ type: "rect", x: 10, y: 10, text: "Approve" });
  m.setData(s, [{ label: "Owner", value: "Ravi" }, { label: "Cost", value: 1500 }, { label: "Done", value: false }]);
  assert.deepEqual(parse(serialize(m.doc)).pages[0].items[0].data, [{ label: "Owner", value: "Ravi" }, { label: "Cost", value: 1500 }, { label: "Done", value: false }]);
  assert.throws(() => m.setData(s, [{ label: "", value: 1 }]), /needs a label/);
  m.setData(s, []);
  assert.equal(m.item(s).data, undefined);
});

test("shape data as Visio Property rows, out and back", () => {
  const cell = (n, v) => `<Cell N="${n}" V="${v}"/>`;
  const xml = toPropertySection([{ label: "Due date", value: "2026-03-01" }, { label: "Cost", value: 1500 }, { label: "Done", value: true }], cell);
  assert.match(xml, /<Row N="Prop.Due_date"><Cell N="Label" V="Due date"\/><Cell N="Value" V="2026-03-01"\/><Cell N="Type" V="0"\/><\/Row>/);
  assert.match(xml, /<Row N="Prop.Done">.*<Cell N="Value" V="TRUE"\/><Cell N="Type" V="3"\/>/);
  const rows = [...xml.matchAll(/<Row N="([^"]+)">(.*?)<\/Row>/g)].map(([, n, body]) => ({ attrs: { N: n }, cells: Object.fromEntries([...body.matchAll(/<Cell N="([^"]+)" V="([^"]*)"\/>/g)].map(([, k, v]) => [k, v])) }));
  assert.deepEqual(fromPropertyRows(rows), [{ label: "Due date", value: "2026-03-01" }, { label: "Cost", value: 1500 }, { label: "Done", value: true }]);
});

test("shape data goes through a .vsdx file", async () => {
  const { toVsdx, fromVsdx } = await import("../apps/diagram/core/vsdx.js");
  const { shapePath } = await import("../apps/diagram/editor/geometry.js");
  const m = new DiagramModel(newDiagram("Flow"));
  const s = m.addShape({ type: "rect", x: 10, y: 10, w: 120, h: 60, text: "Approve" });
  m.setData(s, [{ label: "Owner", value: "Ravi & Co" }, { label: "Cost", value: 1500 }]);
  const back = await fromVsdx(toVsdx(m.doc, (x) => shapePath(x.type, x.w, x.h, x.path), () => []));
  const doc = back.doc || back;
  assert.deepEqual(doc.pages[0].items.find((i) => i.text === "Approve").data, [{ label: "Owner", value: "Ravi & Co" }, { label: "Cost", value: 1500 }]);
  assert.ok(!(back.problems || []).some((p) => /shape data/.test(p)));
});
