// build/apps/diagram/core/diagram.js: the WorkSuite Diagram document (.wsdiagram, schema 1) and its shape model
// (#78): validation, migration, canonical save, shapes, glued connectors that follow their shapes, groups,
// layers, order, hit-testing, undo and redo, and a 300-shape round trip that saves to the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP, SCHEMA_VERSION, newDiagram, validate, migrate, serialize, parse, pointOn, DiagramModel } from "../apps/diagram/core/diagram.js";

function leaveFlow() {
  const m = new DiagramModel(newDiagram("Leave approval"));
  const ask = m.addShape({ type: "terminator", x: 300, y: 20, w: 160, h: 40, text: "Employee requests leave" });
  const form = m.addShape({ x: 295, y: 100, w: 170, h: 46, text: "Fill in leave form" });
  const ok = m.addShape({ type: "diamond", x: 295, y: 190, w: 170, h: 90, text: "Manager approves?" });
  const c1 = m.connect(ask, form);
  const c2 = m.connect(form, ok);
  return { m, ask, form, ok, c1, c2 };
}

test("a new diagram is valid, with one page and one layer", () => {
  const d = newDiagram("D");
  assert.equal(d.app, APP);
  assert.equal(d.v, SCHEMA_VERSION);
  assert.equal(validate(d).pages[0].layers.length, 1);
});

test("validate lists every problem", () => {
  const d = newDiagram();
  d.pages[0].items = [
    { id: "a", kind: "shape", type: "rect", layer: "l1", x: 0, y: 0, w: 0, h: 10 },
    { id: "a", kind: "blob", layer: "nope" },
    { id: "c", kind: "connector", layer: "l1", route: "wiggly", from: { shape: "zz", point: "top" }, to: { shape: "a", point: "nowhere" } },
    { id: "g", kind: "group", layer: "l1", members: ["c"] },
  ];
  assert.throws(() => validate(d), (e) => {
    for (const bit of ["size must be positive", "duplicate id", "unknown kind", "unknown layer", "route must be", "unknown shape", "point nowhere", "two members", "not a shape or group"])
      assert.ok(e.message.includes(bit), bit);
    return true;
  });
});

test("a newer schema is refused, not misread", () => {
  assert.throws(() => migrate({ app: APP, v: SCHEMA_VERSION + 1 }), /newer WorkSuite Office/);
  assert.throws(() => migrate({ app: "worksuite.project", v: 1 }), /not a WorkSuite diagram/);
});

test("connect picks facing points, and glued ends follow their shapes", () => {
  const { m, form, c1 } = leaveFlow();
  const c = m.item(c1);
  assert.equal(c.from.point, "bottom");
  assert.equal(c.to.point, "top");
  const before = m.endpoints(c1);
  assert.deepEqual(before.to, { x: 380, y: 100 });
  m.move(form, 40, 10);
  assert.deepEqual(m.endpoints(c1).to, { x: 420, y: 110 });
  assert.deepEqual(m.endpoints(c1).from, before.from);
});

test("rotation turns connection points around the shape's centre", () => {
  const s = { x: 0, y: 0, w: 100, h: 50, rotate: 90 };
  assert.deepEqual(pointOn(s, 1, 0.5), { x: 50, y: 75 }); // the right side now faces down
});

test("removing a shape removes the connectors glued to it", () => {
  const { m, form } = leaveFlow();
  m.remove(form);
  assert.equal(m.page().items.filter((i) => i.kind === "connector").length, 0);
  assert.equal(m.page().items.length, 2);
});

test("groups move together, cannot nest into themselves, and dissolve when one member is left", () => {
  const { m, ask, form, ok } = leaveFlow();
  const g = m.group([ask, form]);
  m.move(g, 10, 0);
  assert.equal(m.item(ask).x, 310);
  assert.equal(m.item(form).x, 305);
  assert.throws(() => m.group([form, ok]), /two groups/);
  m.remove(ask);
  assert.throws(() => m.item(g), /no item/);
});

test("locked layers refuse edits; hidden layers are not hit", () => {
  const { m, ask } = leaveFlow();
  const notes = m.addLayer("Notes");
  const note = m.addShape({ layer: notes, x: 600, y: 20, w: 100, h: 40, text: "Policy" });
  m.setLayer(notes, { locked: true });
  assert.throws(() => m.move(note, 5, 5), /locked/);
  assert.equal(m.hitTest(650, 40), note);
  m.setLayer(notes, { visible: false });
  assert.equal(m.hitTest(650, 40), null);
  assert.equal(m.hitTest(380, 40), ask);
});

test("order: the front shape wins the hit test", () => {
  const m = new DiagramModel();
  const a = m.addShape({ x: 0, y: 0, w: 100, h: 100 });
  const b = m.addShape({ x: 50, y: 50, w: 100, h: 100 });
  assert.equal(m.hitTest(75, 75), b);
  m.toFront(a);
  assert.equal(m.hitTest(75, 75), a);
  m.toBack(a);
  assert.equal(m.hitTest(75, 75), b);
});

test("pages, undo and redo", () => {
  const { m } = leaveFlow();
  const p2 = m.addPage("Roles");
  m.addShape({ x: 10, y: 10 }, p2);
  assert.equal(m.doc.pages.length, 2);
  assert.ok(m.undo());
  assert.equal(m.page(p2).items.length, 0);
  assert.ok(m.redo());
  assert.equal(m.page(p2).items.length, 1);
  while (m.undo());
  assert.equal(m.page().items.length, 0);
});

test("a 300-shape diagram round-trips to the same bytes", () => {
  const m = new DiagramModel(newDiagram("Big"));
  let prev = null;
  for (let i = 0; i < 300; i++) {
    const s = m.addShape({ type: ["rect", "ellipse", "diamond", "terminator"][i % 4], x: (i % 20) * 140, y: Math.floor(i / 20) * 100, w: 110, h: 60, rotate: (i % 3) * 15, text: `Step ${i}` });
    if (prev) m.connect(prev, s, { route: ["straight", "elbow", "curved"][i % 3] });
    prev = s;
  }
  const text = serialize(m.doc);
  assert.equal(serialize(parse(text)), text);
  const reloaded = new DiagramModel(parse(text));
  const n = reloaded.addShape({});
  assert.equal(reloaded.page().items.filter((i) => i.id === n).length, 1);
});
