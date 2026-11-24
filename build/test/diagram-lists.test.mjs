import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { CONTAINER_HEADER, CONTAINER_PAD } from "../apps/diagram/core/container.js";

test("lists keep their shapes in a column, in the order they stand, and fit round them", () => {
  const m = new DiagramModel(newDiagram("Steps"));
  const a = m.addShape({ type: "rect", x: 112, y: 300, w: 120, h: 40, text: "Third" });
  const b = m.addShape({ type: "rect", x: 95, y: 100, w: 150, h: 50, text: "First" });
  const c = m.addShape({ type: "rect", x: 130, y: 200, w: 100, h: 40, text: "Second" });
  const l = m.addList([a, b, c], "Steps");
  const S = (id) => m.item(id), L = S(l);
  assert.deepEqual([b, c, a].map((id) => S(id).y), [L.y + CONTAINER_HEADER + CONTAINER_PAD, L.y + CONTAINER_HEADER + CONTAINER_PAD + 60, L.y + CONTAINER_HEADER + CONTAINER_PAD + 110]);
  assert.ok([a, b, c].every((id) => S(id).x === L.x + CONTAINER_PAD), "lined up on the left");
  assert.equal(L.w, 160 + 2 * CONTAINER_PAD, "as wide as the widest, 160 at least");
  assert.equal(L.h, CONTAINER_HEADER + 2 * CONTAINER_PAD + 50 + 40 + 40 + 20);
  // drag "Third" above "First": it takes first place
  m.set(a, { y: L.y + CONTAINER_HEADER + 1 });
  assert.deepEqual([a, b, c].map((id) => S(id).y).sort((x, y) => x - y)[0], S(a).y);
  assert.ok(S(a).y < S(b).y && S(b).y < S(c).y);
  // drag "Second" out: the rest close up
  m.set(c, { x: 600, y: 600 });
  assert.equal(S(l).h, CONTAINER_HEADER + 2 * CONTAINER_PAD + 40 + 50 + 10);
  assert.equal(S(c).x, 600, "a shape outside the list is left alone");
  // a new shape dropped on it joins at its place
  const d = m.addShape({ type: "rect", x: S(l).x + 30, y: S(b).y + 30, w: 120, h: 40, text: "Late" });
  assert.ok(S(d).y > S(b).y && S(d).x === S(l).x + CONTAINER_PAD);
  assert.equal(parse(serialize(m.doc)).pages[0].items.find((i) => i.id === l).list.gap, 10);
  const empty = m.addList([], "Empty", { x: 500, y: 50 });
  assert.equal(S(empty).w, 160 + 2 * CONTAINER_PAD);
  assert.throws(() => m.set(a, { list: { gap: 1 } }), /a list is a container/);
});
