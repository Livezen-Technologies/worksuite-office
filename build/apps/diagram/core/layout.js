/*
 * WorkSuite Diagram: auto-layout of org charts and flowcharts (#87, roadmap stage 4). Pure ES module, no DOM.
 *
 * The graph is the page's shapes and the connectors glued between them. A forest (no shape with two parents)
 * is laid out as a tree: each parent centred over its children. Anything else is laid out in layers: each shape
 * one layer below its furthest predecessor, the shapes in a layer ordered to cross fewer lines (barycentre
 * sweeps), loops broken where they close; a loop's closing line, and a line that skips a layer, go round the side. Shapes without lines go in
 * the first layer. The result stays on the page, 20 points in from its edges; the page grows if it must.
 */

export const GAP = { along: 40, across: 60 }; // between shapes in a layer, and between layers
export const MARGIN = 20;
const ROUND_ROOM = 30; // extra room on the side lines go round

/**
 * New positions for the shapes: Map id → { x, y }, plus the connector ends to re-glue
 * ({ id, from, to } point names) so lines leave a shape on the side facing the next layer.
 * options: { direction: "down" | "right", ids (shapes to lay out; default all), origin { x, y } }
 */
export function autoLayout(page, options = {}) {
  const dir = options.direction === "right" ? "right" : "down";
  const want = options.ids ? new Set(options.ids) : null;
  const grouped = new Set(page.items.filter((i) => i.kind === "group").flatMap((g) => g.members));
  const shapes = page.items.filter((i) => i.kind === "shape" && (!want || want.has(i.id)) && !grouped.has(i.id));
  const ids = new Set(shapes.map((s) => s.id));
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const conns = page.items.filter((i) => i.kind === "connector" && ids.has(i.from.shape) && ids.has(i.to.shape) && i.from.shape !== i.to.shape);
  if (!shapes.length) return { positions: new Map(), connectors: [], page: null };

  // sizes along and across the flow: "down" stacks layers vertically
  const along = (s) => (dir === "down" ? s.w : s.h), across = (s) => (dir === "down" ? s.h : s.w);
  const out = new Map(), inn = new Map();
  for (const s of shapes) { out.set(s.id, []); inn.set(s.id, []); }
  const order = new Map(shapes.map((s, i) => [s.id, i])); // page order breaks ties, so the result is stable
  for (const c of conns) { out.get(c.from.shape).push(c.to.shape); inn.get(c.to.shape).push(c.from.shape); }

  // break loops: depth-first from the sources, dropping edges back to a shape on the current path
  const edges = [], state = new Map();
  const starts = [...shapes].sort((a, b) => inn.get(a.id).length - inn.get(b.id).length || order.get(a.id) - order.get(b.id));
  const visit = (n) => {
    state.set(n, 1);
    for (const m of out.get(n)) {
      if (state.get(m) === 1) continue; // closes a loop
      edges.push([n, m]);
      if (!state.has(m)) visit(m);
    }
    state.set(n, 2);
  };
  for (const s of starts) if (!state.has(s.id)) visit(s.id);
  const kids = new Map(shapes.map((s) => [s.id, []])), parents = new Map(shapes.map((s) => [s.id, []]));
  for (const [a, b] of edges) if (!kids.get(a).includes(b)) { kids.get(a).push(b); parents.get(b).push(a); }

  const origin = options.origin || { x: Math.min(...shapes.map((s) => s.x)), y: Math.min(...shapes.map((s) => s.y)) };
  const positions = new Map();
  const place = (id, a, c) => { // a: along the layer, c: across (layer offset)
    const s = byId.get(id);
    positions.set(id, dir === "down" ? { x: round(origin.x + a), y: round(origin.y + c) } : { x: round(origin.x + c), y: round(origin.y + a) });
    return s;
  };

  const roots = shapes.filter((s) => !parents.get(s.id).length).map((s) => s.id);
  const isForest = shapes.every((s) => parents.get(s.id).length <= 1);

  // depth of each shape: one below its furthest parent (longest path)
  const depth = new Map();
  const topo = [], indeg = new Map(shapes.map((s) => [s.id, parents.get(s.id).length]));
  const queue = roots.slice();
  while (queue.length) { const n = queue.shift(); topo.push(n); for (const m of kids.get(n)) { indeg.set(m, indeg.get(m) - 1); if (!indeg.get(m)) queue.push(m); } }
  for (const n of topo) depth.set(n, parents.get(n).reduce((d, p) => Math.max(d, depth.get(p) + 1), 0));
  const layers = [];
  for (const n of topo) (layers[depth.get(n)] ||= []).push(n);
  const layerSize = layers.map((l) => Math.max(...l.map((id) => across(byId.get(id)))));
  const layerAt = []; let acc = 0;
  for (const sz of layerSize) { layerAt.push(acc); acc += sz + GAP.across; }
  const at = (id) => layerAt[depth.get(id)] + (layerSize[depth.get(id)] - across(byId.get(id))) / 2;

  if (isForest) {
    // tidy tree: a subtree's width is the larger of its root and its children side by side
    const width = new Map();
    const measure = (id) => {
      const k = kids.get(id);
      const kw = k.reduce((sum, c) => sum + measure(c), 0) + Math.max(0, k.length - 1) * GAP.along;
      const w = Math.max(along(byId.get(id)), kw);
      width.set(id, w);
      return w;
    };
    const layout = (id, left) => {
      const w = width.get(id), k = kids.get(id);
      const kw = k.reduce((sum, c) => sum + width.get(c), 0) + Math.max(0, k.length - 1) * GAP.along;
      let x = left + (w - kw) / 2;
      for (const c of k) { layout(c, x); x += width.get(c) + GAP.along; }
      place(id, left + (w - along(byId.get(id))) / 2, at(id));
    };
    let left = 0;
    for (const r of roots) { measure(r); layout(r, left); left += width.get(r) + GAP.along; }
  } else {
    // layered: order each layer by the average position of its neighbours, sweeping down and up
    const pos = new Map();
    layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
    const sweep = (ls, nb) => {
      for (const l of ls) {
        const bc = new Map(l.map((id) => { const n = nb.get(id); return [id, n.length ? n.reduce((s, m) => s + pos.get(m), 0) / n.length : pos.get(id)]; }));
        l.sort((a, b) => bc.get(a) - bc.get(b) || order.get(a) - order.get(b));
        l.forEach((id, i) => pos.set(id, i));
      }
    };
    for (let k = 0; k < 4; k++) { sweep(layers.slice(1), parents); sweep(layers.slice(0, -1).reverse(), kids); }
    const widths = layers.map((l) => l.reduce((s, id) => s + along(byId.get(id)), 0) + (l.length - 1) * GAP.along);
    const widest = Math.max(...widths);
    layers.forEach((l, i) => {
      let a = (widest - widths[i]) / 2;
      for (const id of l) { place(id, a, at(id)); a += along(byId.get(id)) + GAP.along; }
    });
  }

  const [fromSide, toSide, aside] = dir === "down" ? ["bottom", "top", "left"] : ["right", "left", "top"];
  const connectors = conns.map((c) => {
    const span = depth.get(c.to.shape) - depth.get(c.from.shape);
    // a loop's closing line, a line within a layer, or one that skips a layer (it would cross the shapes between): round the side
    return span !== 1 ? { id: c.id, from: aside, to: aside, route: "elbow" } : { id: c.id, from: fromSide, to: toSide };
  });

  // keep it on the page: in from the edges, and the page grows when the layout is bigger than it
  const box = [...positions].map(([id, p]) => ({ ...p, w: byId.get(id).w, h: byId.get(id).h }));
  const minX = Math.min(...box.map((b) => b.x)), minY = Math.min(...box.map((b) => b.y));
  const w = Math.max(...box.map((b) => b.x + b.w)) - minX, h = Math.max(...box.map((b) => b.y + b.h)) - minY;
  // lines that go round the side need room there for the detour and its label
  const detour = connectors.some((c) => c.route) ? ROUND_ROOM : 0;
  const mx = MARGIN + (aside === "left" ? detour : 0), my = MARGIN + (aside === "top" ? detour : 0);
  const page2 = { width: Math.max(page.width, Math.ceil(w + mx + MARGIN)), height: Math.max(page.height, Math.ceil(h + my + MARGIN)) };
  const sx = clamp(minX, mx, page2.width - MARGIN - w) - minX, sy = clamp(minY, my, page2.height - MARGIN - h) - minY;
  for (const p of positions.values()) { p.x = round(p.x + sx); p.y = round(p.y + sy); }
  return { positions, connectors, page: page2 };
}
const round = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Applies a layout to a page in place (the editor calls it inside DiagramModel.edit, so it is one undo step). */
export function applyLayout(page, layout) {
  if (layout.page) { page.width = layout.page.width; page.height = layout.page.height; }
  for (const it of page.items) {
    if (it.kind === "shape" && layout.positions.has(it.id)) Object.assign(it, layout.positions.get(it.id));
    const c = it.kind === "connector" && layout.connectors.find((x) => x.id === it.id);
    if (c) { it.from = { ...it.from, point: c.from }; it.to = { ...it.to, point: c.to }; if (c.route) it.route = c.route; }
  }
}
