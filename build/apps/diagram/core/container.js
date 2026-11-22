/*
 * WorkSuite Diagram: containers and callouts (roadmap stage 6). Pure ES module, no DOM.
 *
 * A container is a shape of type "container": a titled box drawn around other shapes. A shape belongs to the
 * container its centre is in (the innermost one when they nest), so moving a container takes its shapes along.
 * A callout is a shape of type "callout" with a `target` shape: a note with a leader line to the target, which follows
 * the target when either moves. If the target is removed, the callout stays as a plain note.
 */

export const CONTAINER_HEADER = 26;
export const CONTAINER_PAD = 20;
const inside = (s, box) => { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h; };

/** The box for a container around shapes: their bounding box, padded, with room for the title. */
export function containerAround(shapes, title = "Container") {
  if (!shapes.length) throw new Error("select the shapes to put in a container");
  const x0 = Math.min(...shapes.map((s) => s.x)), y0 = Math.min(...shapes.map((s) => s.y));
  const x1 = Math.max(...shapes.map((s) => s.x + s.w)), y1 = Math.max(...shapes.map((s) => s.y + s.h));
  return { type: "container", x: x0 - CONTAINER_PAD, y: y0 - CONTAINER_PAD - CONTAINER_HEADER, w: x1 - x0 + 2 * CONTAINER_PAD, h: y1 - y0 + 2 * CONTAINER_PAD + CONTAINER_HEADER, text: title };
}

/** The shapes in a container, with what is inside containers nested in it; lanes, the container itself and callouts' targets aside. */
export function containerMembers(items, box) {
  return items.filter((s) => s.kind === "shape" && s.id !== box.id && s.type !== "lane" && inside(s, box) && !(s.type === "container" && s.w >= box.w && s.h >= box.h));
}

/** The shapes that move with a shape: for a lane or a container, what is in it; and callouts whose target moves. */
export function carried(items, moving) {
  const out = new Map(moving.map((s) => [s.id, s]));
  for (const s of moving) if (s.type === "container" || s.type === "lane") for (const m of containerMembers(items, s)) out.set(m.id, m);
  return [...out.values()];
}

/** A callout next to a target shape, up and to the right of it. */
export function calloutFor(target, text = "Note") {
  return { type: "callout", x: target.x + target.w + 40, y: Math.max(0, target.y - 70), w: 140, h: 50, text, target: target.id };
}

/** The leader line of a callout: from the edge of the callout's box nearest the target to the target's nearest side. */
export function leader(callout, target) {
  const c = { x: callout.x + callout.w / 2, y: callout.y + callout.h / 2 }, t = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const edge = (box, toward) => {
    const dx = toward.x - (box.x + box.w / 2), dy = toward.y - (box.y + box.h / 2);
    if (!dx && !dy) return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const k = Math.min(Math.abs((box.w / 2) / (dx || 1e-9)), Math.abs((box.h / 2) / (dy || 1e-9)));
    return { x: box.x + box.w / 2 + dx * k, y: box.y + box.h / 2 + dy * k };
  };
  return [edge(callout, t), edge(target, c)];
}

/** A container's outline as a path: its box and the line under its title (for Visio export). */
export const containerPath = (c) => `M0 0 H${c.w} V${c.h} H0 Z M0 ${CONTAINER_HEADER} H${c.w}`;
