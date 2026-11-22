/*
 * WorkSuite Diagram: swimlanes for cross-functional flowcharts (roadmap stage 6). Pure ES module, no DOM.
 *
 * A lane is a shape of type "lane": a band with a header holding its title, { lane: { orientation: "h" | "v" } }.
 * Horizontal lanes stack top to bottom with the header on the left; vertical lanes stand side by side with the header
 * on top. A shape belongs to the lane its centre is in, so moving a lane takes its shapes with it.
 */

export const LANE_HEADER = 32;

/** Shapes for a set of lanes: horizontal ones stacked down from (x, y), vertical ones side by side. */
export function makeLanes(names, { orientation = "h", x = 40, y = 40, length = 760, size = 130 } = {}) {
  return names.map((name, i) => (orientation === "v"
    ? { type: "lane", x: x + i * size, y, w: size, h: length, text: name, lane: { orientation: "v" } }
    : { type: "lane", x, y: y + i * size, w: length, h: size, text: name, lane: { orientation: "h" } }));
}

const inside = (s, box) => { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h; };

/** The shapes in a lane (centre inside it), lanes left out. */
export function laneMembers(items, lane) {
  return items.filter((s) => s.kind === "shape" && s.type !== "lane" && s.id !== lane.id && inside(s, lane));
}

/** The lane a shape is in, or null. */
export function laneOf(items, shape) {
  return items.find((l) => l.kind === "shape" && l.type === "lane" && l.id !== shape.id && inside(shape, l)) || null;
}

/** The lanes stacked with this one (same orientation, lined up and touching in a row), in order. */
export function poolOf(items, lane) {
  const v = lane.lane?.orientation === "v";
  const lanes = items.filter((l) => l.kind === "shape" && l.type === "lane" && (l.lane?.orientation === "v") === v && (v ? l.y === lane.y && l.h === lane.h : l.x === lane.x && l.w === lane.w));
  lanes.sort((a, b) => (v ? a.x - b.x : a.y - b.y));
  // only the run of lanes touching this one
  const at = lanes.findIndex((l) => l.id === lane.id);
  if (at < 0) return [lane];
  const out = [lanes[at]];
  for (let i = at + 1; i < lanes.length && Math.abs((v ? lanes[i].x : lanes[i].y) - (v ? lanes[i - 1].x + lanes[i - 1].w : lanes[i - 1].y + lanes[i - 1].h)) < 1; i++) out.push(lanes[i]);
  for (let i = at - 1; i >= 0 && Math.abs((v ? lanes[i + 1].x : lanes[i + 1].y) - (v ? lanes[i].x + lanes[i].w : lanes[i].y + lanes[i].h)) < 1; i--) out.unshift(lanes[i]);
  return out;
}

/** Where a new lane goes at the end of a pool: the shape fields for it. */
export function nextLane(items, lane, name = "Lane") {
  const pool = poolOf(items, lane), last = pool[pool.length - 1], v = lane.lane?.orientation === "v";
  return v ? { type: "lane", x: last.x + last.w, y: last.y, w: last.w, h: last.h, text: name, lane: { orientation: "v" } }
    : { type: "lane", x: last.x, y: last.y + last.h, w: last.w, h: last.h, text: name, lane: { orientation: "h" } };
}

/** A lane's outline as a path: its box and the line that closes off its header (for Visio export). */
export function lanePath(lane) {
  const { w, h } = lane, H = LANE_HEADER;
  return lane.lane?.orientation === "v" ? `M0 0 H${w} V${h} H0 Z M0 ${H} H${w}` : `M0 0 H${w} V${h} H0 Z M${H} 0 V${h}`;
}
