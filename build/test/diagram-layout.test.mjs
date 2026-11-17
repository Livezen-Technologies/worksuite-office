import test from "node:test";
import assert from "node:assert/strict";
import { DiagramModel } from "../apps/diagram/core/diagram.js";
import { autoLayout, applyLayout, GAP } from "../apps/diagram/core/layout.js";

function chart(edges, n) {
  const m = new DiagramModel();
  const ids = Array.from({ length: n }, (_, i) => m.addShape({ x: 500 - i * 37, y: 300 + (i % 3) * 50, w: 100, h: 50, text: "S" + i }));
  for (const [a, b] of edges) m.connect({ shape: ids[a], point: "right" }, { shape: ids[b], point: "left" });
  return { m, ids, page: () => m.page() };
}

test("an org chart: each parent centred over its children, a layer per level", () => {
  const { m, ids, page } = chart([[0, 1], [0, 2], [0, 3], [2, 4], [2, 5]], 6);
  const { positions: p, connectors } = autoLayout(page(), { origin: { x: 20, y: 20 } });
  const cx = (i) => p.get(ids[i]).x + 50;
  assert.equal(p.get(ids[0]).y, 20);
  for (const i of [1, 2, 3]) assert.equal(p.get(ids[i]).y, 20 + 50 + GAP.across);
  for (const i of [4, 5]) assert.equal(p.get(ids[i]).y, 20 + 2 * (50 + GAP.across));
  assert.equal(cx(2), (cx(4) + cx(5)) / 2); // parent over its children
  assert.equal(cx(0), (cx(1) + cx(3)) / 2);
  assert.ok(p.get(ids[4]).x + 100 + GAP.along <= p.get(ids[5]).x); // no overlap
  assert.deepEqual(new Set(connectors.map((c) => c.from + ">" + c.to)), new Set(["bottom>top"]));
  m.edit((d) => applyLayout(d.pages[0], autoLayout(d.pages[0])));
  assert.equal(m.undoStack.length, 6 + 5 + 1); // one undo step
});

test("a flowchart with a merge and a loop is layered, without overlaps", () => {
  // 0 → 1, 0 → 2, 1 → 3, 2 → 3, 3 → 1 (loop back)
  const { ids, page } = chart([[0, 1], [0, 2], [1, 3], [2, 3], [3, 1]], 4);
  const { positions: p, connectors } = autoLayout(page(), { direction: "right", origin: { x: 20, y: 20 } });
  assert.equal(p.get(ids[0]).x, 20);
  assert.equal(p.get(ids[1]).x, p.get(ids[2]).x); // same layer
  assert.ok(p.get(ids[3]).x > p.get(ids[1]).x);
  const ys = [p.get(ids[1]).y, p.get(ids[2]).y].sort((a, b) => a - b);
  assert.ok(ys[1] - ys[0] >= 50 + GAP.along);
  assert.equal(connectors.filter((c) => c.from === "right" && c.to === "left").length, 4);
  assert.deepEqual(connectors.find((c) => c.from === "top"), { id: connectors.find((c) => c.from === "top").id, from: "top", to: "top", route: "elbow" }); // the loop goes round
});

test("only the chosen shapes move; grouped shapes stay put", () => {
  const { m, ids, page } = chart([[0, 1], [1, 2]], 4);
  const g = m.group([ids[2], ids[3]]);
  const { positions } = autoLayout(page(), { ids: [ids[0], ids[1], ids[2]] });
  assert.deepEqual([...positions.keys()].sort(), [ids[0], ids[1]].sort());
  assert.ok(g);
});

test("the layout stays on the page, and the page grows when it must", () => {
  const { ids, page } = chart(Array.from({ length: 11 }, (_, i) => [i, i + 1]), 12); // a chain of 12, 1320 points tall
  const L = autoLayout(page(), { direction: "down" });
  const ys = [...L.positions.values()].map((q) => q.y);
  assert.equal(Math.min(...ys), 20);
  assert.equal(L.page.height, 12 * 50 + 11 * 60 + 40);
  assert.equal(L.page.width, page().width);
  assert.ok(ids.length);
});

test("a line that skips a layer goes round the side instead of through the shapes between", () => {
  const { ids, page } = chart([[0, 1], [1, 2], [0, 2]], 3); // 0 → 1 → 2, and 0 → 2 directly
  const { connectors } = autoLayout(page(), { direction: "right" });
  const skip = connectors.find((c) => c.from === "top");
  assert.ok(skip, "the long line is re-glued to the top");
  assert.equal(connectors.filter((c) => c.from === "right").length, 2);
  assert.ok(ids.length === 3);
});
