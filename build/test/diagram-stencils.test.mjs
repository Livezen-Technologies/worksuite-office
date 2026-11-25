// My shapes (stencils.js) and Visio stencils (.vssx): shapes kept from the page, saved as a stencil, opened again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { stencilError, entryFrom, shapeFrom } from "../apps/diagram/core/stencils.js";
import { fromVssx, toVssx, fromVsdx } from "../apps/diagram/core/vsdx.js";
import { shapePath } from "../apps/diagram/editor/geometry.js";

test("shapes go into My shapes, travel with the file, and come out as copies", () => {
  const m = new DiagramModel(newDiagram("S"));
  const a = m.addShape({ type: "diamond", x: 100, y: 80, w: 120, h: 70, text: "Check\nsecond line", style: { fill: "#fef3c7" }, data: [{ label: "Owner", value: "Asha" }] });
  const b = m.addShape({ type: "vessel", x: 300, y: 80, w: 70, h: 130, text: "" });
  assert.throws(() => m.addToStencil([]), /Select the shapes/);
  const ids = m.addToStencil([a, b]);
  const st = m.doc.stencil;
  assert.equal(st.name, "My shapes");
  assert.deepEqual(st.shapes.map((e) => e.name), ["Check", "vessel"]);
  assert.equal(st.shapes[0].shape.x, undefined, "no place kept");
  assert.deepEqual(st.shapes[0].shape.data, [{ label: "Owner", value: "Asha" }]);
  const back = new DiagramModel(parse(serialize(m.doc)));
  assert.equal(back.doc.stencil.shapes.length, 2);
  const fresh = back.id("s");
  assert.ok(!ids.includes(fresh), "new ids never reuse a stencil id");
  const fields = shapeFrom(back.doc.stencil.shapes[0], { x: 500, y: 300 });
  assert.deepEqual([fields.x, fields.y, fields.w, fields.type], [440, 265, 120, "diamond"]);
  m.removeFromStencil(ids[0]);
  m.removeFromStencil(ids[1]);
  assert.equal(m.doc.stencil, undefined, "an empty stencil goes away");
  m.undo();
  assert.equal(m.doc.stencil.shapes.length, 1);
  assert.match(stencilError({ name: "x", shapes: [{ id: "k1", name: "a", shape: { type: "rect", w: 0, h: 1 } }] }), /type and a size/);
  assert.equal(entryFrom({ type: "rect", w: 10, h: 10, text: "" }, "k9").name, "rect");
});

test("a stencil saved as .vssx opens again with its shapes, and a drawing is not a stencil", async () => {
  const st = { name: "Plant", shapes: [
    { id: "k1", name: "Tank", shape: { type: "vessel", w: 70, h: 130, text: "T-1", style: { fill: "#f1f5f9", line: "#334155" } } },
    { id: "k2", name: "Valve", shape: { type: "valve", w: 36, h: 20, text: "", style: {} } },
  ] };
  const bytes = toVssx(st, (s) => shapePath(s.type, s.w, s.h, s.path));
  const { stencil, problems } = await fromVssx(bytes);
  assert.deepEqual(problems, []);
  assert.equal(stencil.name, "Plant");
  assert.deepEqual(stencil.shapes.map((e) => e.name), ["Tank", "Valve"]);
  assert.equal(stencil.shapes[0].shape.type, "path");
  assert.deepEqual([stencil.shapes[0].shape.w, stencil.shapes[0].shape.h, stencil.shapes[0].shape.text], [70, 130, "T-1"]);
  assert.equal(stencil.shapes[0].shape.style.fill, "#f1f5f9");
  assert.equal(stencilError(stencil), "");
  await assert.rejects(fromVsdx(bytes), /no pages/, "a stencil has no pages to open as a drawing");
  const m = new DiagramModel(newDiagram("S"));
  m.setStencil(stencil);
  assert.equal(m.doc.stencil.shapes.length, 2);
  const shape = m.addShape({ ...shapeFrom(m.doc.stencil.shapes[1], { x: 100, y: 100 }) });
  assert.ok(shapePath("path", 36, 20, m.doc.pages[0].items.find((i) => i.id === shape).path).length > 10);
});
