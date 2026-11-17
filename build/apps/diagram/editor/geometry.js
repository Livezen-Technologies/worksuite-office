/*
 * WorkSuite Diagram: the canvas geometry (#79, #80, #81). Pure functions, no DOM, so the tests cover them:
 * shape outlines, the shape libraries, grid snapping, alignment guides, connector routes and resizing.
 */

/** A stored outline (M, L, Z in the shape's 0..1 box, from a Visio drawing) scaled to w×h. */
export function scalePath(d, w, h) {
  const r = (n) => Math.round(n * 100) / 100;
  return String(d).replace(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g, (_, c, x, y) => `${c}${r(Number(x) * w)} ${r(Number(y) * h)}`);
}

/**
 * An SVG path for a shape type in its own box (0,0)-(w,h). Unknown types draw as a rectangle; "path" shapes
 * (outlines read from Visio) draw their own outline, `path`, scaled to the box.
 */
export function shapePath(type, w, h, path = null) {
  const r = (n) => Math.round(n * 100) / 100;
  if (type === "path" && path) return scalePath(path, w, h);
  switch (type) {
    case "ellipse": return `M${r(w / 2)} 0 A${r(w / 2)} ${r(h / 2)} 0 1 1 ${r(w / 2)} ${r(h)} A${r(w / 2)} ${r(h / 2)} 0 1 1 ${r(w / 2)} 0 Z`;
    case "diamond": return `M${r(w / 2)} 0 L${r(w)} ${r(h / 2)} L${r(w / 2)} ${r(h)} L0 ${r(h / 2)} Z`;
    case "terminator": { const k = Math.min(h / 2, w / 2); return `M${r(k)} 0 H${r(w - k)} A${r(k)} ${r(k)} 0 0 1 ${r(w - k)} ${r(h)} H${r(k)} A${r(k)} ${r(k)} 0 0 1 ${r(k)} 0 Z`; }
    case "data": { const k = Math.min(w * 0.2, h * 0.5); return `M${r(k)} 0 H${r(w)} L${r(w - k)} ${r(h)} H0 Z`; }
    case "document": return `M0 0 H${r(w)} V${r(h * 0.82)} Q${r(w * 0.75)} ${r(h * 0.62)} ${r(w / 2)} ${r(h * 0.82)} T0 ${r(h * 0.82)} Z`;
    case "database": { const e = Math.min(h * 0.18, 14); return `M0 ${r(e)} A${r(w / 2)} ${r(e)} 0 0 1 ${r(w)} ${r(e)} V${r(h - e)} A${r(w / 2)} ${r(e)} 0 0 1 0 ${r(h - e)} Z M0 ${r(e)} A${r(w / 2)} ${r(e)} 0 0 0 ${r(w)} ${r(e)}`; }
    case "manual": { const k = Math.min(w * 0.12, h * 0.5); return `M0 0 H${r(w)} L${r(w - k)} ${r(h)} H${r(k)} Z`; }
    case "subprocess": { const k = Math.min(w * 0.1, 14); return `M0 0 H${r(w)} V${r(h)} H0 Z M${r(k)} 0 V${r(h)} M${r(w - k)} 0 V${r(h)}`; }
    case "rounded": { const k = Math.min(10, w / 4, h / 4); return `M${r(k)} 0 H${r(w - k)} Q${r(w)} 0 ${r(w)} ${r(k)} V${r(h - k)} Q${r(w)} ${r(h)} ${r(w - k)} ${r(h)} H${r(k)} Q0 ${r(h)} 0 ${r(h - k)} V${r(k)} Q0 0 ${r(k)} 0 Z`; }
    case "triangle": return `M${r(w / 2)} 0 L${r(w)} ${r(h)} H0 Z`;
    case "hexagon": { const k = Math.min(w * 0.25, h * 0.5); return `M${r(k)} 0 H${r(w - k)} L${r(w)} ${r(h / 2)} L${r(w - k)} ${r(h)} H${r(k)} L0 ${r(h / 2)} Z`; }
    case "person": return `M${r(w / 2)} 0 A${r(w * 0.2)} ${r(h * 0.2)} 0 1 1 ${r(w / 2 - 0.01)} 0 Z M0 ${r(h)} Q0 ${r(h * 0.45)} ${r(w / 2)} ${r(h * 0.45)} Q${r(w)} ${r(h * 0.45)} ${r(w)} ${r(h)} Z`;
    case "server": return `M0 0 H${r(w)} V${r(h)} H0 Z M0 ${r(h / 3)} H${r(w)} M0 ${r((2 * h) / 3)} H${r(w)}`;
    case "cloud": return `M${r(w * 0.25)} ${r(h)} A${r(w * 0.25)} ${r(h * 0.3)} 0 0 1 ${r(w * 0.2)} ${r(h * 0.42)} A${r(w * 0.28)} ${r(h * 0.32)} 0 0 1 ${r(w * 0.72)} ${r(h * 0.3)} A${r(w * 0.22)} ${r(h * 0.35)} 0 0 1 ${r(w * 0.78)} ${r(h)} Z`;
    default: return `M0 0 H${r(w)} V${r(h)} H0 Z`;
  }
}

/** The shape libraries (#81): every shape WorkSuite's own, with a default size and text. */
export const LIBRARIES = [
  { id: "flowchart", name: "Flowchart", shapes: [
    { type: "rect", name: "Process", w: 140, h: 60, text: "Process" },
    { type: "diamond", name: "Decision", w: 140, h: 90, text: "Decision?" },
    { type: "terminator", name: "Start / end", w: 140, h: 50, text: "Start" },
    { type: "data", name: "Data", w: 140, h: 60, text: "Data" },
    { type: "document", name: "Document", w: 140, h: 70, text: "Document" },
    { type: "database", name: "Database", w: 110, h: 80, text: "Database" },
    { type: "manual", name: "Manual step", w: 140, h: 60, text: "Manual step" },
    { type: "subprocess", name: "Subprocess", w: 140, h: 60, text: "Subprocess" },
  ] },
  { id: "basic", name: "Basic", shapes: [
    { type: "rect", name: "Rectangle", w: 120, h: 80, text: "" },
    { type: "rounded", name: "Rounded rectangle", w: 120, h: 80, text: "" },
    { type: "ellipse", name: "Ellipse", w: 110, h: 80, text: "" },
    { type: "triangle", name: "Triangle", w: 100, h: 90, text: "" },
    { type: "hexagon", name: "Hexagon", w: 120, h: 80, text: "" },
  ] },
  { id: "org", name: "Org chart", shapes: [
    { type: "rounded", name: "Position", w: 160, h: 60, text: "Name\nRole" },
    { type: "person", name: "Person", w: 60, h: 70, text: "" },
  ] },
  { id: "network", name: "Network", shapes: [
    { type: "server", name: "Server", w: 70, h: 90, text: "Server" },
    { type: "cloud", name: "Cloud", w: 140, h: 90, text: "Internet" },
    { type: "database", name: "Storage", w: 90, h: 80, text: "Storage" },
  ] },
];
export const libraryShape = (type) => LIBRARIES.flatMap((l) => l.shapes).find((s) => s.type === type);

/** Snaps a value to the grid (no grid: unchanged). */
export const snap = (v, grid) => (grid ? Math.round(v / grid) * grid : v);

/**
 * Smart guides: when a moving box's left/centre/right (or top/middle/bottom) comes within `tol` of another
 * shape's, the box snaps to it and a guide line shows where. Returns the snapped position and the guides.
 */
export function alignGuides(box, others, tol = 5) {
  const xs = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = (b) => [b.y, b.y + b.h / 2, b.y + b.h];
  let best = { dx: null, dy: null, gx: null, gy: null };
  for (const o of others) {
    xs(box).forEach((v, i) => xs(o).forEach((t) => { const d = t - v; if (Math.abs(d) <= tol && (best.dx === null || Math.abs(d) < Math.abs(best.dx))) best = { ...best, dx: d, gx: t, ix: i }; }));
    ys(box).forEach((v, i) => ys(o).forEach((t) => { const d = t - v; if (Math.abs(d) <= tol && (best.dy === null || Math.abs(d) < Math.abs(best.dy))) best = { ...best, dy: d, gy: t, iy: i }; }));
  }
  const guides = [];
  if (best.gx !== null) guides.push({ axis: "x", at: best.gx });
  if (best.gy !== null) guides.push({ axis: "y", at: best.gy });
  return { x: box.x + (best.dx || 0), y: box.y + (best.dy || 0), guides };
}

const SIDE_DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], center: [0, 0] };

/**
 * A connector's route as points. Straight: the two ends. Elbow: leaves each end straight out of its side, then
 * turns at right angles. Curved: the ends plus two control points (a cubic Bézier).
 */
export function route(kind, a, b, sideA = "right", sideB = "left", gap = 16) {
  if (kind === "straight") return [[a.x, a.y], [b.x, b.y]];
  const [ax, ay] = SIDE_DIR[sideA] || [0, 0], [bx, by] = SIDE_DIR[sideB] || [0, 0];
  if (kind === "curved") {
    const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    return [[a.x, a.y], [a.x + ax * k, a.y + ay * k], [b.x + bx * k, b.y + by * k], [b.x, b.y]];
  }
  const p1 = [a.x + ax * gap, a.y + ay * gap], p2 = [b.x + bx * gap, b.y + by * gap];
  const pts = [[a.x, a.y], p1];
  const horizontalA = ax !== 0;
  if (horizontalA) {
    const mx = by !== 0 ? p2[0] : (p1[0] + p2[0]) / 2;
    pts.push([mx, p1[1]], [mx, p2[1]]);
  } else {
    const my = bx !== 0 ? p2[1] : (p1[1] + p2[1]) / 2;
    pts.push([p1[0], my], [p2[0], my]);
  }
  pts.push(p2, [b.x, b.y]);
  // drop points that repeat or sit on a straight line between their neighbours
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1], o = out[out.length - 2];
    if (q && q[0] === p[0] && q[1] === p[1]) continue;
    if (o && ((o[0] === q[0] && q[0] === p[0]) || (o[1] === q[1] && q[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/** The point halfway along a route, for the connector's text. */
export function midpoint(points) {
  let total = 0;
  const segs = points.slice(1).map((p, i) => { const l = Math.hypot(p[0] - points[i][0], p[1] - points[i][1]); total += l; return l; });
  let left = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i]) { const t = segs[i] ? left / segs[i] : 0; return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t]; }
    left -= segs[i];
  }
  return points[points.length - 1];
}

/** Resizing from a corner handle ("nw", "ne", "sw", "se"), keeping the opposite corner put; minimum 10×10. */
export function resizeBox(box, handle, dx, dy, min = 10) {
  let { x, y, w, h } = box;
  if (handle.includes("e")) w = Math.max(min, w + dx);
  if (handle.includes("s")) h = Math.max(min, h + dy);
  if (handle.includes("w")) { const nw = Math.max(min, w - dx); x += w - nw; w = nw; }
  if (handle.includes("n")) { const nh = Math.max(min, h - dy); y += h - nh; h = nh; }
  return { x, y, w, h };
}
