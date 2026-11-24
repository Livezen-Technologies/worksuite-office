/*
 * WorkSuite Diagram: align, distribute, auto align and space, and re-layout of a page (roadmap stage 6).
 * Pure ES module, no DOM.
 *
 * Lanes, containers and callouts are structure, not flow: they are never aligned or laid out themselves. After shapes
 * move, containers are fitted round their shapes again and callouts keep their place beside their target. Re-layout
 * of a page with swimlanes keeps every shape in its lane: the flow runs along the lanes and only the position along
 * them comes from the layout.
 */

import { autoLayout, GAP } from "./layout.js";
import { laneOf, poolOf, LANE_HEADER } from "./swimlane.js";
import { containerMembers, CONTAINER_PAD, CONTAINER_HEADER } from "./container.js";

export const STRUCTURE = new Set(["lane", "container", "callout"]);
export const ALIGN = ["left", "center", "right", "top", "middle", "bottom"];
const flow = (s) => s.kind === "shape" && !STRUCTURE.has(s.type);
const round = (n) => Math.round(n * 100) / 100;
const centre = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

/**
 * Lines up shapes in place. Left, top: with the one furthest left or up; right, bottom: furthest right or down;
 * centre, middle: on the first shape's centre line (the first one selected).
 */
export function align(shapes, how) {
  if (!ALIGN.includes(how)) throw new Error(`unknown alignment "${how}"`);
  if (shapes.length < 2) throw new Error("Select 2 or more shapes");
  const first = shapes[0];
  const set = {
    left: (s, v) => (s.x = v), right: (s, v) => (s.x = v - s.w), center: (s, v) => (s.x = v - s.w / 2),
    top: (s, v) => (s.y = v), bottom: (s, v) => (s.y = v - s.h), middle: (s, v) => (s.y = v - s.h / 2),
  }[how];
  const v = {
    left: () => Math.min(...shapes.map((s) => s.x)), right: () => Math.max(...shapes.map((s) => s.x + s.w)),
    top: () => Math.min(...shapes.map((s) => s.y)), bottom: () => Math.max(...shapes.map((s) => s.y + s.h)),
    center: () => first.x + first.w / 2, middle: () => first.y + first.h / 2,
  }[how]();
  for (const s of shapes) { set(s, v); s.x = round(s.x); s.y = round(s.y); }
  return shapes;
}

/** Spreads shapes evenly between the outer two, across ("h") or down ("v"): equal gaps between them. */
export function distribute(shapes, axis = "h") {
  if (shapes.length < 3) throw new Error("Select 3 or more shapes");
  const [p, size] = axis === "v" ? ["y", "h"] : ["x", "w"];
  const ss = [...shapes].sort((a, b) => a[p] - b[p]);
  const total = ss.reduce((a, s) => a + s[size], 0), last = ss[ss.length - 1];
  const gap = (last[p] + last[size] - ss[0][p] - total) / (ss.length - 1);
  let at = ss[0][p];
  for (const s of ss) { s[p] = round(at); at += s[size] + gap; }
  return shapes;
}

/**
 * Auto align and space: straightens the lines between connected shapes and evens out the gaps along them.
 * Following the lines from where the flow starts, a shape that sits roughly in line with the shape before it (their
 * boxes overlap side on) is lined up with it, centre to centre, and moved to `gap` from it, taking the shapes after
 * it along. Diagonal lines, and lines between two lanes across them, are left as they are.
 * Returns Map id → { x, y } (and w, h for refitted containers) of what moved.
 */
export function autoAlignSpace(page, ids = null, { gap = GAP.along } = {}) {
  const want = ids ? new Set(ids) : null;
  const grouped = new Set(page.items.filter((i) => i.kind === "group").flatMap((g) => g.members));
  const shapes = page.items.filter((s) => flow(s) && (!want || want.has(s.id)) && !grouped.has(s.id));
  const pos = new Map(shapes.map((s) => [s.id, { x: s.x, y: s.y, w: s.w, h: s.h }]));
  const order = new Map(shapes.map((s, i) => [s.id, i]));
  const out = new Map(shapes.map((s) => [s.id, []])), incoming = new Map(shapes.map((s) => [s.id, 0]));
  for (const c of page.items) {
    if (c.kind !== "connector" || !pos.has(c.from?.shape) || !pos.has(c.to?.shape) || c.from.shape === c.to.shape) continue;
    out.get(c.from.shape).push(c.to.shape); incoming.set(c.to.shape, incoming.get(c.to.shape) + 1);
  }
  for (const k of out.values()) k.sort((a, b) => order.get(a) - order.get(b));

  // a spanning forest, breadth first from where the flow starts (top left first), then whatever a loop left out
  const parent = new Map(), visit = [], seen = new Set();
  const byPlace = (a, b) => (pos.get(a).x + pos.get(a).y) - (pos.get(b).x + pos.get(b).y) || order.get(a) - order.get(b);
  const starts = shapes.map((s) => s.id).sort((a, b) => (incoming.get(a) > 0) - (incoming.get(b) > 0) || byPlace(a, b));
  for (const s of starts) {
    if (seen.has(s)) continue;
    seen.add(s); const queue = [s];
    while (queue.length) {
      const n = queue.shift(); visit.push(n);
      for (const m of out.get(n)) if (!seen.has(m)) { seen.add(m); parent.set(m, n); queue.push(m); }
    }
  }
  const kids = new Map(shapes.map((s) => [s.id, []]));
  for (const [m, n] of parent) kids.get(n).push(m);
  const below = (id) => { const all = [id]; for (let i = 0; i < all.length; i++) all.push(...kids.get(all[i])); return all; };
  const lane = new Map(shapes.map((s) => [s.id, laneOf(page.items, s)?.id || null]));

  // which way a line runs: "h" when the two boxes overlap top to bottom, "v" when they overlap side to side
  const way = (a, b) => {
    const A = pos.get(a), B = pos.get(b), ca = centre(A), cb = centre(B);
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    if (Math.abs(dy) < (A.h + B.h) / 2 && Math.abs(dx) >= Math.abs(dy)) return "h";
    if (Math.abs(dx) < (A.w + B.w) / 2 && Math.abs(dy) > Math.abs(dx)) return "v";
    return null;
  };
  // with lanes, the axis across them: moving a shape that way would take it out of its lane
  const laneShape = page.items.find((l) => l.kind === "shape" && l.type === "lane" && [...lane.values()].includes(l.id));
  const acrossLanes = laneShape ? (laneShape.lane?.orientation === "v" ? "x" : "y") : null;
  for (const b of visit) {
    const a = parent.get(b), w = a && way(a, b);
    if (!w) continue;
    const A = pos.get(a), B = pos.get(b), sameLane = lane.get(a) === lane.get(b);
    const [line, step, size] = w === "h" ? ["y", "x", "w"] : ["x", "y", "h"];
    const half = line === "y" ? "h" : "w";
    // the shapes after b move with it, except across lanes, where each stays in its own
    const shift = (axis, d) => {
      for (const id of below(b)) if (axis !== acrossLanes || lane.get(id) === lane.get(b)) pos.get(id)[axis] = round(pos.get(id)[axis] + d);
    };
    if (line !== acrossLanes || sameLane) shift(line, A[line] + A[half] / 2 - B[half] / 2 - B[line]);
    if (step === acrossLanes && !sameLane) continue;
    shift(step, B[step] > A[step] ? A[step] + A[size] + gap - B[step] : A[step] - gap - B[size] - B[step]);
  }
  const moved = new Map();
  for (const s of shapes) { const p = pos.get(s.id); if (p.x !== s.x || p.y !== s.y) moved.set(s.id, { x: p.x, y: p.y }); }
  return carryAlong(page, moved);
}

/**
 * Re-layout of a page, or of the given shapes: the auto-layout of flow shapes, with lanes and containers kept.
 * When the shapes are in lanes, the flow runs along the lanes (left to right in horizontal lanes, top to bottom in
 * vertical ones) whatever the direction asked, each shape stays in its lane, shapes in the same lane and step share
 * it evenly, and the lanes grow to hold the flow. Returns a plan for applyLayout.
 */
export function relayout(page, direction = "down", ids = null) {
  const want = ids ? new Set(ids) : null;
  const plain = page.items.filter((s) => flow(s) && (!want || want.has(s.id))).map((s) => s.id);
  const inLane = new Map(), items = page.items;
  for (const id of plain) { const l = laneOf(items, items.find((i) => i.id === id)); if (l) inLane.set(id, l); }
  const laneDir = inLane.size ? ([...inLane.values()][0].lane?.orientation === "v" ? "v" : "h") : null;
  const dir = laneDir ? (laneDir === "h" ? "right" : "down") : direction;
  const lanes = [...new Map([...inLane.values()].map((l) => [l.id, l])).values()];
  const origin = laneDir === "h" ? { x: Math.min(...lanes.map((l) => l.x)) + LANE_HEADER + 20, y: 0 }
    : laneDir === "v" ? { x: 0, y: Math.min(...lanes.map((l) => l.y)) + LANE_HEADER + 20 } : undefined;
  const plan = autoLayout(page, { direction: dir, ids: plain, origin });
  if (!laneDir) { plan.positions = carryAlong(page, plan.positions); return plan; }

  // the across coordinate comes from the lane: shapes in the same lane and step share its width evenly
  const [along, across, size, aSize] = laneDir === "h" ? ["x", "y", "h", "w"] : ["y", "x", "w", "h"];
  const steps = new Map(); // lane id + step position → shape ids
  for (const [id, p] of plan.positions) {
    const l = inLane.get(id);
    if (!l) continue;
    const key = `${l.id}@${p[along]}`;
    steps.set(key, [...(steps.get(key) || []), id]);
  }
  for (const list of steps.values()) {
    const l = inLane.get(list[0]), start = l[across], room = l[size];
    list.sort((a, b) => items.find((i) => i.id === a)[across] - items.find((i) => i.id === b)[across]);
    list.forEach((id, i) => {
      const s = items.find((x) => x.id === id), slot = room / list.length;
      plan.positions.get(id)[across] = round(start + slot * i + (slot - s[size]) / 2);
    });
  }
  // the page keeps the lanes where they are: shift the flow back to start after the lane headers
  const placed = [...plan.positions].filter(([id]) => inLane.has(id));
  const first = Math.min(...placed.map(([, p]) => p[along]));
  const shift = origin[along] - first;
  for (const [, p] of plan.positions) p[along] = round(p[along] + shift);
  // lanes grow to hold the flow, the whole pool together
  const end = Math.max(...placed.map(([id, p]) => p[along] + items.find((i) => i.id === id)[aSize])) + 20;
  const grown = new Map();
  for (const l of lanes) for (const m of poolOf(items, l)) {
    const len = Math.max(m[aSize], round(end - m[along]));
    if (len !== m[aSize]) grown.set(m.id, { [aSize]: len });
  }
  for (const [id, g] of grown) plan.positions.set(id, { ...(plan.positions.get(id) || {}), ...g });
  if (plan.page) {
    const far = Math.max(...[...grown].map(([id, g]) => items.find((i) => i.id === id)[along] + g[aSize]), 0) + 20;
    if (laneDir === "h") plan.page.width = Math.max(plan.page.width, far); else plan.page.height = Math.max(plan.page.height, far);
  }
  plan.positions = carryAlong(page, plan.positions);
  return plan;
}

/**
 * After flow shapes move (Map id → { x, y }): callouts move with their target, and containers are fitted round
 * the shapes that were in them, the innermost first so an outer container takes the new size of one inside it.
 * Returns the positions with those added.
 */
export function carryAlong(page, positions) {
  const out = new Map(positions);
  const now = (s) => ({ ...s, ...(out.get(s.id) || {}) });
  for (const c of page.items.filter((s) => s.kind === "shape" && s.type === "callout" && s.target && out.has(s.target))) {
    if (out.has(c.id)) continue;
    const t = page.items.find((i) => i.id === c.target), p = out.get(c.target);
    if (!t || p.x === undefined) continue;
    out.set(c.id, { x: round(c.x + p.x - t.x), y: round(c.y + p.y - t.y) });
  }
  const boxes = page.items.filter((s) => s.kind === "shape" && s.type === "container")
    .map((c) => ({ c, members: containerMembers(page.items, c).filter((m) => m.type !== "callout") }))
    .filter((b) => b.members.some((m) => out.has(m.id) || m.type === "container"))
    .sort((a, b) => a.c.w * a.c.h - b.c.w * b.c.h);
  for (const { c, members } of boxes) {
    const ms = members.map(now);
    if (!members.some((m) => out.has(m.id))) continue;
    const x0 = Math.min(...ms.map((s) => s.x)), y0 = Math.min(...ms.map((s) => s.y));
    const x1 = Math.max(...ms.map((s) => s.x + s.w)), y1 = Math.max(...ms.map((s) => s.y + s.h));
    out.set(c.id, { x: round(x0 - CONTAINER_PAD), y: round(y0 - CONTAINER_PAD - CONTAINER_HEADER), w: round(x1 - x0 + 2 * CONTAINER_PAD), h: round(y1 - y0 + 2 * CONTAINER_PAD + CONTAINER_HEADER) });
  }
  return out;
}
