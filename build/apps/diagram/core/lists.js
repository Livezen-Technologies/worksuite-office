/*
 * WorkSuite Diagram: lists (roadmap stage 6). Pure ES module, no DOM.
 *
 * A list is a container ({ type: "container", list: { gap } }) that keeps its shapes in a column: in the order they
 * stand, one under another, lined up on the left, the list as wide as its widest shape and as tall as all of them.
 * Drop a shape on a list and it takes its place; drag it out and the rest close up. arrangeLists runs after every edit,
 * so a list is always tidy; it changes nothing when the list already is.
 */

import { containerMembers, CONTAINER_HEADER, CONTAINER_PAD } from "./container.js";

export const LIST_GAP = 10;
const r2 = (n) => Math.round(n * 100) / 100;

/** Arranges every list on a page, in place. Nested containers in a list move as one with what is inside them. */
export function arrangeLists(page) {
  for (const list of page.items.filter((i) => i.kind === "shape" && i.type === "container" && i.list)) {
    const all = containerMembers(page.items, list);
    // only the list's own shapes: not those inside a container that is itself in the list
    const inner = new Set(all.filter((m) => m.type === "container").flatMap((c) => containerMembers(page.items, c).map((x) => x.id)));
    const own = all.filter((m) => !inner.has(m.id) && m.type !== "callout").sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
    const gap = list.list.gap ?? LIST_GAP;
    let y = list.y + CONTAINER_HEADER + CONTAINER_PAD;
    const x = list.x + CONTAINER_PAD;
    for (const s of own) {
      const dx = r2(x - s.x), dy = r2(y - s.y);
      if (dx || dy) {
        const carry = s.type === "container" ? containerMembers(page.items, s) : [];
        for (const m of [s, ...carry]) { m.x = r2(m.x + dx); m.y = r2(m.y + dy); }
      }
      y += s.h + gap;
    }
    const w = r2(Math.max(160, ...own.map((s) => s.w)) + 2 * CONTAINER_PAD);
    const h = r2(Math.max(own.length ? y - gap - list.y + CONTAINER_PAD : CONTAINER_HEADER + 60, CONTAINER_HEADER + 40));
    if (list.w !== w) list.w = w;
    if (list.h !== h) list.h = h;
  }
  return page;
}
