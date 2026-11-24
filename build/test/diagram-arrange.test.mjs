import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram } from "../apps/diagram/core/diagram.js";
import { applyLayout, GAP } from "../apps/diagram/core/layout.js";
import { align, distribute, autoAlignSpace, relayout, carryAlong } from "../apps/diagram/core/arrange.js";
import { laneOf, LANE_HEADER } from "../apps/diagram/core/swimlane.js";
import { CONTAINER_PAD, CONTAINER_HEADER } from "../apps/diagram/core/container.js";

const box = (x, y, w = 100, h = 50) => ({ x, y, w, h });

test("align: every side and centre line; distribute: even gaps across and down", () => {
  const ss = () => [box(100, 100), box(160, 220, 60, 30), box(40, 300, 140, 80)];
  assert.deepEqual(align(ss(), "left").map((s) => s.x), [40, 40, 40]);
  assert.deepEqual(align(ss(), "right").map((s) => s.x + s.w), [220, 220, 220]);
  assert.deepEqual(align(ss(), "center").map((s) => s.x + s.w / 2), [150, 150, 150], "on the first shape's centre");
  assert.deepEqual(align(ss(), "top").map((s) => s.y), [100, 100, 100]);
  assert.deepEqual(align(ss(), "bottom").map((s) => s.y + s.h), [380, 380, 380]);
  assert.deepEqual(align(ss(), "middle").map((s) => s.y + s.h / 2), [125, 125, 125]);
  assert.throws(() => align([box(0, 0)], "left"), /2 or more/);
  assert.throws(() => align(ss(), "diagonal"), /unknown alignment/);

  const v = distribute([box(0, 0, 50, 20), box(0, 300, 50, 40), box(0, 50, 50, 10)], "v");
  const sorted = [...v].sort((a, b) => a.y - b.y);
  assert.equal(sorted[1].y - (sorted[0].y + sorted[0].h), sorted[2].y - (sorted[1].y + sorted[1].h), "equal gaps down");
  assert.deepEqual([sorted[0].y, sorted[2].y], [0, 300], "the outer two stay");
  const h = distribute([box(0, 0), box(500, 0), box(130, 0)], "h").sort((a, b) => a.x - b.x);
  assert.equal(h[1].x - 100, 500 - (h[1].x + 100));
  assert.throws(() => distribute([box(0, 0), box(1, 1)]), /3 or more/);
});

test("auto align and space: a wobbly flow comes out straight with even gaps; a diagonal line is left alone", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const a = m.addShape({ type: "rect", x: 40, y: 100, w: 100, h: 50, text: "Start" });
  const b = m.addShape({ type: "rect", x: 190, y: 115, w: 100, h: 50, text: "Check" }); // a little low, close
  const c = m.addShape({ type: "rect", x: 400, y: 92, w: 120, h: 60, text: "Approve" }); // far, a little high
  const d = m.addShape({ type: "rect", x: 405, y: 260, w: 100, h: 50, text: "Pay" }); // below c, a little off
  const far = m.addShape({ type: "rect", x: 700, y: 500, w: 100, h: 50, text: "Archive" }); // diagonal from d
  m.connect(a, b); m.connect(b, c);
  m.connect(c, d); m.connect(d, far);
  const plan = autoAlignSpace(m.page());
  m.edit((doc) => applyLayout(doc.pages[0], { positions: plan, connectors: [], page: null }));
  const S = (id) => m.item(id), mid = (s) => s.y + s.h / 2, cx = (s) => s.x + s.w / 2;
  assert.ok(!plan.has(a), "the start stays");
  assert.equal(mid(S(b)), mid(S(a))); assert.equal(mid(S(c)), mid(S(a)), "one straight row");
  assert.equal(S(b).x - (S(a).x + S(a).w), GAP.along); assert.equal(S(c).x - (S(b).x + S(b).w), GAP.along, "even gaps");
  assert.equal(cx(S(d)), cx(S(c)), "lined up under Approve");
  assert.equal(S(d).y - (S(c).y + S(c).h), GAP.along);
  assert.equal(S(far).x, 700 + (S(d).x - 405), "a diagonal line is not straightened: Archive just moves with Pay");
  assert.equal(S(far).y, 500 + (S(d).y - 260));
  // a chosen gap, and only the selected shapes
  const only = autoAlignSpace(m.page(), [a, b], { gap: 80 });
  assert.deepEqual([...only.keys()], [b]);
  assert.equal(only.get(b).x, S(a).x + S(a).w + 80);
});

test("auto align and space: shapes stay in their lanes; callouts and containers follow", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const [l1, l2] = m.addLanes(["Sales", "Finance"], { x: 20, y: 20, length: 900, size: 120 });
  const a = m.addShape({ type: "rect", x: 80, y: 50, w: 100, h: 50, text: "Order" });
  const b = m.addShape({ type: "rect", x: 300, y: 160, w: 100, h: 50, text: "Invoice" }); // in Finance, overlaps Order side on? no: diagonal
  const c = m.addShape({ type: "rect", x: 100, y: 155, w: 100, h: 50, text: "Credit check" }); // under Order, other lane
  m.connect(a, c); m.connect(c, b);
  const note = m.addCallout(b, "Due in 30 days");
  const plan = autoAlignSpace(m.page());
  m.edit((doc) => applyLayout(doc.pages[0], { positions: plan, connectors: [], page: null }));
  assert.equal(laneOf(m.page().items, m.item(a)).id, l1);
  assert.equal(laneOf(m.page().items, m.item(c)).id, l2, "lined up under Order but not pulled across into Sales");
  assert.equal(m.item(c).x + 50, m.item(a).x + 50, "lined up along the lanes is fine");
  assert.equal(m.item(c).y, 155, "no spacing across lanes");
  assert.equal(m.item(b).y, m.item(c).y, "Invoice in line with Credit check in Finance");
  assert.equal(m.item(b).x, m.item(c).x + 100 + GAP.along);
  assert.equal(m.item(note).x - m.item(b).x, 300 + 100 + 40 - 300, "the callout kept its place beside Invoice");

  const k = new DiagramModel(newDiagram("Box"));
  const p = k.addShape({ type: "rect", x: 100, y: 100, w: 100, h: 50 }), q = k.addShape({ type: "rect", x: 300, y: 110, w: 100, h: 50 });
  k.connect(p, q);
  const ct = k.addContainer([p, q], "Team");
  const moved = autoAlignSpace(k.page());
  assert.equal(moved.get(q).x, 240);
  const fit = moved.get(ct);
  assert.deepEqual([fit.x, fit.w], [100 - CONTAINER_PAD, 240 + 2 * CONTAINER_PAD], "the container fits its shapes again");
  assert.equal(fit.h, 50 + 2 * CONTAINER_PAD + CONTAINER_HEADER);
});

test("re-layout: lanes and containers are not laid out as shapes; a swimlane flow runs along its lanes and stays in them", () => {
  const m = new DiagramModel(newDiagram("Swim"));
  const [sales, fin] = m.addLanes(["Sales", "Finance"], { x: 20, y: 20, length: 400, size: 120 });
  const ids = [
    m.addShape({ type: "rect", x: 300, y: 40, w: 100, h: 50, text: "Order" }),
    m.addShape({ type: "rect", x: 60, y: 170, w: 100, h: 50, text: "Credit" }),
    m.addShape({ type: "rect", x: 200, y: 30, w: 100, h: 40, text: "Confirm" }),
    m.addShape({ type: "rect", x: 250, y: 160, w: 100, h: 50, text: "Invoice" }),
    m.addShape({ type: "rect", x: 100, y: 160, w: 100, h: 50, text: "Pay" }),
  ];
  const [order, credit, confirm, invoice, pay] = ids;
  m.connect(order, credit); m.connect(credit, confirm);
  m.connect(credit, invoice); m.connect(invoice, pay);
  const lanesBefore = new Map(ids.map((id) => [id, laneOf(m.page().items, m.item(id)).id]));
  const plan = relayout(m.page(), "down");
  assert.ok(!plan.positions.has(sales) || plan.positions.get(sales).x === undefined, "a lane is never moved, only made longer");
  m.edit((doc) => applyLayout(doc.pages[0], plan));
  const S = (id) => m.item(id);
  for (const id of ids) assert.equal(laneOf(m.page().items, S(id)).id, lanesBefore.get(id), `${S(id).text} stays in its lane`);
  assert.ok(S(order).x >= 20 + LANE_HEADER, "after the lane headers");
  assert.ok(S(order).x < S(credit).x && S(credit).x < S(confirm).x && S(credit).x < S(invoice).x && S(invoice).x < S(pay).x, "left to right along the lanes");
  assert.equal(S(confirm).x, S(invoice).x, "the same step");
  assert.equal(S(order).y + S(order).h / 2, 20 + 60, "alone in its lane and step: in the middle of the lane");
  const end = Math.max(...ids.map((id) => S(id).x + S(id).w));
  assert.ok(S(sales).w >= end - 20 && S(fin).w === S(sales).w, "the pool grew to hold the flow, both lanes together");
  assert.ok(m.page().width >= S(sales).x + S(sales).w, "and the page with it");
});

test("re-layout: containers are fitted round their shapes after the layout; a page without lanes lays out as asked", () => {
  const m = new DiagramModel(newDiagram("Org"));
  const boss = m.addShape({ type: "rect", x: 400, y: 400, w: 100, h: 50, text: "Boss" });
  const x = m.addShape({ type: "rect", x: 100, y: 100, w: 100, h: 50, text: "X" });
  const y = m.addShape({ type: "rect", x: 250, y: 100, w: 100, h: 50, text: "Y" });
  m.connect(boss, x); m.connect(boss, y);
  const team = m.addContainer([x, y], "Team");
  const plan = relayout(m.page(), "down");
  assert.ok(!plan.positions.has(team) || plan.positions.get(team).w, "the container is refitted, not laid out");
  m.edit((doc) => applyLayout(doc.pages[0], plan));
  const S = (id) => m.item(id);
  assert.ok(S(boss).y + S(boss).h < S(x).y, "top to bottom");
  assert.equal(S(x).y, S(y).y);
  assert.deepEqual([S(team).x, S(team).y], [Math.min(S(x).x, S(y).x) - CONTAINER_PAD, S(x).y - CONTAINER_PAD - CONTAINER_HEADER]);
  assert.equal(S(team).x + S(team).w, Math.max(S(x).x, S(y).x) + 100 + CONTAINER_PAD);
  // nothing moved: nothing to carry
  assert.equal(carryAlong(m.page(), new Map()).size, 0);
});
