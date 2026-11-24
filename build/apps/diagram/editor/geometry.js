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
    /* floor plan (#87) */
    case "room": return box(w, h);
    case "wall": return box(w, h);
    case "dimension": { const y = h - 6, t = Math.min(6, w / 4); return `M0 ${r(y)} H${r(w)} M0 ${r(y - 6)} V${r(h)} M${r(w)} ${r(y - 6)} V${r(h)} M${r(t)} ${r(y - 3)} L0 ${r(y)} L${r(t)} ${r(y + 3)} M${r(w - t)} ${r(y - 3)} L${r(w)} ${r(y)} L${r(w - t)} ${r(y + 3)}`; } // a measured line: its length is its label
    case "door": return `M0 ${r(h)} V0 A${r(w)} ${r(h)} 0 0 1 ${r(w)} ${r(h)} Z`; // the leaf, hinged bottom left, and its swing
    case "window": return `${box(w, h)} M0 ${r(h / 2)} H${r(w)}`;
    case "stairs": { let d = box(w, h); for (let i = 1; i < 6; i++) d += ` M${r((w * i) / 6)} 0 V${r(h)}`; return d; }
    case "table": return oval(w / 2, h / 2, w / 2, h / 2);
    case "desk": return `${box(w, h * 0.7)} M${r(w * 0.35)} ${r(h * 0.78)} H${r(w * 0.65)} V${r(h)} H${r(w * 0.35)} Z`;
    case "sofa": return `M0 0 H${r(w)} V${r(h)} H0 Z M${r(w * 0.12)} ${r(h * 0.3)} H${r(w * 0.88)} V${r(h)} M${r(w * 0.12)} ${r(h * 0.3)} V${r(h)}`;
    /* UML */
    // P&ID (ISA 5.1 style): vessel, pump, valves, instrument bubble, heat exchanger
    case "vessel": { const k = Math.min(h * 0.15, w / 2); return `M0 ${r(k)} A${r(w / 2)} ${r(k)} 0 0 1 ${r(w)} ${r(k)} V${r(h - k)} A${r(w / 2)} ${r(k)} 0 0 1 0 ${r(h - k)} Z`; }
    case "pump": return `${oval(w / 2, h / 2, w / 2, h / 2)} M${r(w / 2)} 0 H${r(w)} M${r(w * 0.15)} ${r(h)} L${r(w * 0.3)} ${r(h * 0.82)} M${r(w * 0.85)} ${r(h)} L${r(w * 0.7)} ${r(h * 0.82)}`;
    case "valve": return `M0 0 L${r(w)} ${r(h)} V0 L0 ${r(h)} Z`;
    case "controlvalve": return `M0 ${r(h * 0.45)} L${r(w)} ${r(h)} V${r(h * 0.45)} L0 ${r(h)} Z M${r(w / 2)} ${r(h * 0.72)} V${r(h * 0.25)} M${r(w * 0.2)} ${r(h * 0.25)} A${r(w * 0.3)} ${r(h * 0.25)} 0 0 1 ${r(w * 0.8)} ${r(h * 0.25)} Z`;
    case "instrument": return `${oval(w / 2, h / 2, w / 2, h / 2)} M0 ${r(h / 2)} H${r(w)}`;
    case "heatexchanger": return `${oval(w / 2, h / 2, w / 2, h / 2)} M${r(w * 0.1)} ${r(h / 2)} L${r(w * 0.3)} ${r(h * 0.25)} L${r(w * 0.5)} ${r(h * 0.75)} L${r(w * 0.7)} ${r(h * 0.25)} L${r(w * 0.9)} ${r(h / 2)}`;
    // site plan: building footprint, tree, parking bays, road
    case "building": return `${box(w, h)} M0 0 L${r(w)} ${r(h)} M${r(w)} 0 L0 ${r(h)}`;
    case "tree": return `${oval(w / 2, h / 2, w / 2, h / 2)} ${oval(w / 2, h / 2, w * 0.08, h * 0.08)}`;
    case "parking": { let d = box(w, h); const n = Math.max(1, Math.round(w / 30)); for (let i = 1; i < n; i++) d += ` M${r((w * i) / n)} 0 V${r(h * 0.8)}`; return d; }
    case "road": return `${box(w, h)} M0 ${r(h / 2)} H${r(w)}`;
    case "class": return `${box(w, h)} M0 ${r(h * 0.28)} H${r(w)} M0 ${r(h * 0.64)} H${r(w)}`;
    case "actor": { const hr = Math.min(w, h) * 0.14; return `${oval(w / 2, hr, hr, hr)} M${r(w / 2)} ${r(2 * hr)} V${r(h * 0.62)} M${r(w * 0.15)} ${r(h * 0.36)} H${r(w * 0.85)} M${r(w * 0.15)} ${r(h)} L${r(w / 2)} ${r(h * 0.62)} L${r(w * 0.85)} ${r(h)}`; }
    case "usecase": return oval(w / 2, h / 2, w / 2, h / 2);
    case "component": { const t = Math.min(h * 0.16, 10); return `M${r(t)} 0 H${r(w)} V${r(h)} H${r(t)} Z M0 ${r(h * 0.22)} H${r(2 * t)} V${r(h * 0.22 + t)} H0 Z M0 ${r(h * 0.56)} H${r(2 * t)} V${r(h * 0.56 + t)} H0 Z`; }
    case "note": { const k = Math.min(w, h) * 0.2; return `M0 0 H${r(w - k)} L${r(w)} ${r(k)} V${r(h)} H0 Z M${r(w - k)} 0 V${r(k)} H${r(w)}`; }
    case "package": { const th = Math.min(h * 0.2, 14); return `M0 0 H${r(w * 0.4)} V${r(th)} H${r(w)} V${r(h)} H0 Z M0 ${r(th)} H${r(w * 0.4)}`; }
    /* BPMN */
    case "event": return oval(w / 2, h / 2, w / 2, h / 2);
    case "endevent": return `${oval(w / 2, h / 2, w / 2, h / 2)} ${oval(w / 2, h / 2, w * 0.4, h * 0.4)}`;
    case "task": { const k = Math.min(12, w / 4, h / 4); return `M${r(k)} 0 H${r(w - k)} Q${r(w)} 0 ${r(w)} ${r(k)} V${r(h - k)} Q${r(w)} ${r(h)} ${r(w - k)} ${r(h)} H${r(k)} Q0 ${r(h)} 0 ${r(h - k)} V${r(k)} Q0 0 ${r(k)} 0 Z`; }
    case "gateway": return `M${r(w / 2)} 0 L${r(w)} ${r(h / 2)} L${r(w / 2)} ${r(h)} L0 ${r(h / 2)} Z M${r(w * 0.35)} ${r(h * 0.35)} L${r(w * 0.65)} ${r(h * 0.65)} M${r(w * 0.65)} ${r(h * 0.35)} L${r(w * 0.35)} ${r(h * 0.65)}`;
    case "pool": return `${box(w, h)} M${r(Math.min(30, w * 0.1))} 0 V${r(h)}`;
    /* cloud architecture: our own simple icons */
    case "vm": return `M0 0 H${r(w)} V${r(h * 0.72)} H0 Z M${r(w * 0.4)} ${r(h * 0.72)} V${r(h * 0.88)} M${r(w * 0.6)} ${r(h * 0.72)} V${r(h * 0.88)} M${r(w * 0.25)} ${r(h)} H${r(w * 0.75)} V${r(h * 0.88)} H${r(w * 0.25)} Z`;
    case "appcontainer": { const k = h * 0.25; return `M${r(w / 2)} 0 L${r(w)} ${r(k)} V${r(h - k)} L${r(w / 2)} ${r(h)} L0 ${r(h - k)} V${r(k)} Z M0 ${r(k)} L${r(w / 2)} ${r(2 * k)} L${r(w)} ${r(k)} M${r(w / 2)} ${r(2 * k)} V${r(h)}`; }
    case "queue": { let d = box(w, h); for (let i = 1; i < 4; i++) d += ` M${r((w * i) / 4)} 0 V${r(h)}`; return d; }
    case "loadbalancer": return `${oval(w / 2, h / 2, w / 2, h / 2)} M${r(w * 0.2)} ${r(h / 2)} H${r(w * 0.8)} M${r(w * 0.5)} ${r(h / 2)} L${r(w * 0.78)} ${r(h * 0.28)} M${r(w * 0.5)} ${r(h / 2)} L${r(w * 0.78)} ${r(h * 0.72)}`;
    case "function": return `${box(w, h)} M${r(w * 0.3)} ${r(h * 0.22)} H${r(w * 0.42)} L${r(w * 0.7)} ${r(h * 0.8)} M${r(w * 0.52)} ${r(h * 0.45)} L${r(w * 0.3)} ${r(h * 0.8)}`;
    case "bucket": { const e = Math.min(h * 0.14, 10); return `M0 ${r(e)} L${r(w * 0.12)} ${r(h)} H${r(w * 0.88)} L${r(w)} ${r(e)} ${oval(w / 2, e, w / 2, e)}`; }
    default: return `M0 0 H${r(w)} V${r(h)} H0 Z`;
  }
  function box(bw, bh) { return `M0 0 H${r(bw)} V${r(bh)} H0 Z`; }
  function oval(cx, cy, rx, ry) { return `M${r(cx)} ${r(cy - ry)} A${r(rx)} ${r(ry)} 0 1 1 ${r(cx)} ${r(cy + ry)} A${r(rx)} ${r(ry)} 0 1 1 ${r(cx)} ${r(cy - ry)} Z`; }
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
  { id: "floor", name: "Floor plan", shapes: [
    { type: "room", name: "Room", w: 200, h: 150, text: "Room" },
    { type: "wall", name: "Wall", w: 200, h: 8, text: "" },
    { type: "door", name: "Door", w: 40, h: 40, text: "" },
    { type: "window", name: "Window", w: 60, h: 8, text: "" },
    { type: "stairs", name: "Stairs", w: 90, h: 40, text: "" },
    { type: "table", name: "Round table", w: 60, h: 60, text: "" },
    { type: "desk", name: "Desk and chair", w: 70, h: 50, text: "" },
    { type: "sofa", name: "Sofa", w: 90, h: 40, text: "" },
    { type: "dimension", name: "Dimension line", w: 200, h: 28, text: "" },
  ] },
  { id: "uml", name: "UML", shapes: [
    { type: "class", name: "Class", w: 160, h: 110, text: "ClassName" },
    { type: "actor", name: "Actor", w: 50, h: 80, text: "" },
    { type: "usecase", name: "Use case", w: 150, h: 60, text: "Use case" },
    { type: "component", name: "Component", w: 150, h: 70, text: "Component" },
    { type: "note", name: "Note", w: 130, h: 70, text: "Note" },
    { type: "package", name: "Package", w: 160, h: 100, text: "Package" },
  ] },
  { id: "bpmn", name: "BPMN", shapes: [
    { type: "event", name: "Start event", w: 40, h: 40, text: "" },
    { type: "endevent", name: "End event", w: 40, h: 40, text: "" },
    { type: "task", name: "Task", w: 140, h: 70, text: "Task" },
    { type: "gateway", name: "Gateway", w: 56, h: 56, text: "" },
    { type: "pool", name: "Pool / lane", w: 500, h: 140, text: "" },
  ] },
  { id: "pid", name: "Process (P&ID)", shapes: [
    { type: "vessel", name: "Tank / vessel", w: 70, h: 130, text: "" },
    { type: "pump", name: "Pump", w: 50, h: 50, text: "" },
    { type: "valve", name: "Valve", w: 36, h: 20, text: "" },
    { type: "controlvalve", name: "Control valve", w: 36, h: 44, text: "" },
    { type: "instrument", name: "Instrument", w: 44, h: 44, text: "FT\n101" },
    { type: "heatexchanger", name: "Heat exchanger", w: 60, h: 60, text: "" },
  ] },
  { id: "site", name: "Site plan", shapes: [
    { type: "building", name: "Building", w: 200, h: 120, text: "" },
    { type: "tree", name: "Tree", w: 40, h: 40, text: "" },
    { type: "parking", name: "Parking bays", w: 180, h: 60, text: "" },
    { type: "road", name: "Road", w: 300, h: 40, text: "" },
  ] },
  { id: "cloud", name: "Cloud architecture", shapes: [
    { type: "vm", name: "Virtual machine", w: 70, h: 70, text: "VM" },
    { type: "appcontainer", name: "Container", w: 64, h: 70, text: "" },
    { type: "function", name: "Function", w: 60, h: 60, text: "" },
    { type: "queue", name: "Queue", w: 100, h: 40, text: "" },
    { type: "loadbalancer", name: "Load balancer", w: 60, h: 60, text: "" },
    { type: "bucket", name: "Object storage", w: 64, h: 64, text: "" },
  ] },
];
/** The libraries open in the panel at first; the rest open with a click. */
export const OPEN_LIBRARIES = ["flowchart", "basic", "org", "network"];
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
    // both ends on the same side: go round, out past the further of the two
    const mx = by !== 0 ? p2[0] : ax === bx ? (ax < 0 ? Math.min(p1[0], p2[0]) : Math.max(p1[0], p2[0])) : (p1[0] + p2[0]) / 2;
    pts.push([mx, p1[1]], [mx, p2[1]]);
  } else {
    const my = bx !== 0 ? p2[1] : ay === by && ay !== 0 ? (ay < 0 ? Math.min(p1[1], p2[1]) : Math.max(p1[1], p2[1])) : (p1[1] + p2[1]) / 2;
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

/* ---- line jumps: where two connectors cross, the later one hops over the earlier ---- */
const segX = (p, q, r, s) => {
  // the crossing point of segments pq and rs, strictly inside both (not at their ends), or null
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  const e = 1e-6;
  return t > e && t < 1 - e && u > e && u < 1 - e ? { t, u, at: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] } : null;
};

/**
 * Jumps for a list of polylines (connectors' points, in drawing order): for each, per segment, the distances along the
 * segment where it crosses an earlier polyline (a crossing is drawn once, as a hop on the later line). Curved
 * connectors pass null and are neither hopped nor hopped over.
 */
export function lineJumps(lines, radius = 5) {
  return lines.map((pts, i) => {
    if (!pts) return null;
    return pts.slice(1).map((q, k) => {
      const p = pts[k], len = Math.hypot(q[0] - p[0], q[1] - p[1]), out = [];
      for (let j = 0; j < i; j++) {
        const other = lines[j];
        if (!other) continue;
        for (let m = 1; m < other.length; m++) {
          const r = other[m - 1], s2 = other[m], len2 = Math.hypot(s2[0] - r[0], s2[1] - r[1]);
          const x = segX(p, q, r, s2);
          // room for the hop on both lines: not at a bend or an end of either
          if (x && x.t * len > radius && (1 - x.t) * len > radius && x.u * len2 > radius && (1 - x.u) * len2 > radius) out.push(x.t * len);
        }
      }
      return out.sort((a, b) => a - b).filter((v, n, a) => n === 0 || v - a[n - 1] > 2 * radius);
    });
  });
}

/** An SVG path for a polyline with hops (semicircles of `radius`) at its jumps. */
export function jumpPath(pts, jumps, radius = 5) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  pts.slice(1).forEach((q, k) => {
    const p = pts[k], len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    for (const at of jumps?.[k] || []) {
      const a = [p[0] + ux * (at - radius), p[1] + uy * (at - radius)], b = [p[0] + ux * (at + radius), p[1] + uy * (at + radius)];
      const r3 = (n) => Math.round(n * 100) / 100;
      // the hop bulges up on horizontal lines and to the left on vertical ones, like Visio's
      const sweep = Math.abs(ux) >= Math.abs(uy) ? (ux > 0 ? 1 : 0) : (uy > 0 ? 1 : 0);
      d += ` L${r3(a[0])} ${r3(a[1])} A${radius} ${radius} 0 0 ${sweep} ${r3(b[0])} ${r3(b[1])}`;
    }
    d += ` L${q[0]} ${q[1]}`;
  });
  return d;
}
