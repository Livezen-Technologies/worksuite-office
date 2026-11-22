import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { makeLanes, laneMembers, laneOf, poolOf, nextLane } from "../apps/diagram/core/swimlane.js";

test("swimlanes: stacked lanes behind the shapes, members by centre, a pool, a lane added at its end", () => {
  const m = new DiagramModel(newDiagram("Refund"));
  const a = m.addShape({ type: "rect", x: 100, y: 60, w: 120, h: 50, text: "Ask" });
  const ids = m.addLanes(["Customer", "Support", "Finance"], { x: 40, y: 40, length: 700, size: 100 });
  const b = m.addShape({ type: "rect", x: 300, y: 170, w: 120, h: 50, text: "Check" });
  const page = m.page();
  assert.deepEqual(page.items.slice(0, 3).map((i) => i.text), ["Customer", "Support", "Finance"], "lanes go behind");
  assert.deepEqual(page.items.slice(0, 3).map((i) => [i.y, i.h]), [[40, 100], [140, 100], [240, 100]]);
  const [cust, supp] = ids.map((id) => m.item(id));
  assert.deepEqual(laneMembers(page.items, cust).map((s) => s.id), [a]);
  assert.equal(laneOf(page.items, m.item(b)).text, "Support");
  assert.deepEqual(poolOf(page.items, supp).map((l) => l.text), ["Customer", "Support", "Finance"]);
  const d = m.addLane(ids[2], "Bank");
  assert.deepEqual([m.item(d).y, m.item(d).h, m.item(d).lane.orientation], [340, 100, "h"]);
  assert.equal(parse(serialize(m.doc)).pages[0].items.filter((i) => i.type === "lane").length, 4, "saved and read back");
  assert.throws(() => m.addLane(a), /select a lane/);
  const v = makeLanes(["A", "B"], { orientation: "v", x: 0, y: 0, length: 500, size: 200 });
  assert.deepEqual(v.map((l) => [l.x, l.w, l.h]), [[0, 200, 500], [200, 200, 500]]);
  assert.deepEqual(nextLane(v.map((l, i) => ({ ...l, id: "v" + i, kind: "shape" })), { ...v[0], id: "v0", kind: "shape" }, "C").x, 400);
});

test("swimlanes export to Visio with their header line and come back as shapes with their titles", async () => {
  const { toVsdx, fromVsdx } = await import("../apps/diagram/core/vsdx.js");
  const { lanePath } = await import("../apps/diagram/core/swimlane.js");
  const { shapePath } = await import("../apps/diagram/editor/geometry.js");
  const m = new DiagramModel(newDiagram("Refund"));
  m.addLanes(["Customer", "Finance"], { x: 40, y: 40, length: 600, size: 120 });
  m.addShape({ type: "rect", x: 200, y: 70, w: 120, h: 50, text: "Ask" });
  assert.match(lanePath(m.page().items[0]), /M32 0 V120/);
  const bytes = toVsdx(m.doc, (s) => (s.type === "lane" ? lanePath(s) : shapePath(s.type, s.w, s.h, s.path)), () => []);
  const back = await fromVsdx(bytes);
  const texts = (back.doc || back).pages[0].items.filter((i) => i.kind === "shape").map((i) => i.text);
  assert.deepEqual(texts.sort(), ["Ask", "Customer", "Finance"]);
});
