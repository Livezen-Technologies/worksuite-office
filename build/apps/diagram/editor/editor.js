/*
 * WorkSuite Diagram editor (#79 canvas, #80 connectors, #81 shape libraries), on the Diagram model (core/diagram.js).
 *
 * Shapes come from the libraries (click to add, or drag onto the page). Pointer tool: click or drag a box to
 * select (Shift adds), drag to move with grid snapping and smart guides, corner handles resize, double-click
 * edits text. Connector tool: drag from one shape to another; the connector glues to the facing points and
 * follows the shapes. Keys: Delete, Ctrl+Z / Ctrl+Y, Ctrl+D duplicate, Ctrl+G / Ctrl+Shift+G group and ungroup,
 * arrows nudge (Shift: a grid step), F2 or Enter edits text, Esc goes back to the pointer.
 *
 * The page stands alone until the native shell hosts it (#72); window.WorkSuiteDiagram lets the shell load a
 * file, read it back and switch read-only mode (free viewing, #73).
 */
import { autoLayout, applyLayout } from "../core/layout.js";
import { parseTable, readTable, addTable } from "../core/fromtable.js";
import { askText } from "../../common/dialog.js";
import { DiagramModel, newDiagram, parse, serialize, connectionPoints, pointOn, APP } from "../core/diagram.js";
import { checkEdit, reasonText, openUpgrade } from "../../common/licence.js";
import { packDocument, unpackDocument } from "../../common/zip.js";
import { fromVsdx, toVsdx } from "../core/vsdx.js";
import { shapePath, LIBRARIES, OPEN_LIBRARIES, libraryShape, snap, alignGuides, route, midpoint, resizeBox } from "./geometry.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const GRID = 10;
const FILLS = { room: "#fafaf9", wall: "#52525b", door: "#ffffff", window: "#e0f2fe", stairs: "#f5f5f4", table: "#fef3c7", desk: "#fef3c7", sofa: "#e7e5e4", class: "#fffbeb", actor: "#ffffff", usecase: "#ecfccb", component: "#e0e7ff", note: "#fef9c3", package: "#f5f5f4", event: "#dcfce7", endevent: "#fee2e2", task: "#dbeafe", gateway: "#fef3c7", pool: "#ffffff", vm: "#e0f2fe", container: "#dbeafe", function: "#ffedd5", queue: "#f3e8ff", loadbalancer: "#dcfce7", bucket: "#fee2e2", rect: "#dbeafe", rounded: "#dbeafe", diamond: "#fef3c7", terminator: "#e0f2fe", data: "#ede9fe", document: "#f5f5f4", database: "#dcfce7", manual: "#ffedd5", subprocess: "#dbeafe", ellipse: "#fce7f3", triangle: "#fef9c3", hexagon: "#e0e7ff", person: "#e2e8f0", server: "#e2e8f0", cloud: "#f1f5f9" };
const LINES = { room: "#57534e", wall: "#27272a", door: "#57534e", window: "#0284c7", stairs: "#78716c", table: "#a16207", desk: "#a16207", sofa: "#78716c", class: "#b45309", actor: "#334155", usecase: "#4d7c0f", component: "#4f46e5", note: "#a16207", package: "#57534e", event: "#16a34a", endevent: "#dc2626", task: "#2563eb", gateway: "#d97706", pool: "#475569", vm: "#0284c7", container: "#2563eb", function: "#ea580c", queue: "#9333ea", loadbalancer: "#16a34a", bucket: "#dc2626", diamond: "#d97706", terminator: "#0284c7", data: "#7c3aed", database: "#16a34a", manual: "#ea580c", ellipse: "#db2777", triangle: "#ca8a04", hexagon: "#4f46e5", person: "#475569", server: "#475569", cloud: "#64748b", document: "#78716c" };

const state = {
  model: new DiagramModel(newDiagram("Untitled diagram")),
  pageId: "p1",
  libOpen: new Set(OPEN_LIBRARIES), // shape libraries open in the panel
  sel: [],
  tool: "select",
  zoom: 1,
  grid: true,
  readOnly: false,
  message: "",
  fileName: "Untitled diagram.wsdiagram",
  drag: null,
  guides: [],
};

const page = () => state.model.page(state.pageId);
const items = () => page().items;
const shapes = () => items().filter((i) => i.kind === "shape");
const byId = (id) => items().find((i) => i.id === id);
const ownerOf = (id) => items().find((i) => i.kind === "group" && i.members.includes(id));
const topOf = (id) => { let cur = id, o; while ((o = ownerOf(cur))) cur = o.id; return cur; };
const layerOf = (it) => page().layers.find((l) => l.id === it.layer);
const isVisible = (it) => layerOf(it)?.visible !== false;
const selShapes = () => state.sel.flatMap((id) => state.model.shapesIn(page(), id));

function run(fn) {
  if (state.readOnly) return;
  try { fn(); state.message = ""; } catch (e) { state.message = e.message; }
  render();
}

/* ---- commands ---- */
const commands = {
  new: () => { state.model = new DiagramModel(newDiagram("Untitled diagram")); state.pageId = state.model.doc.pages[0].id; state.sel = []; state.fileName = "Untitled diagram.wsdiagram"; render(); },
  open: () => $("wd-file").click(),
  fromTable: () => fromTable(),
  save: () => { download(state.fileName, packDocument(APP, serialize(state.model.doc)), "application/zip"); state.saved = state.model.undoStack.length; render(); },
  exportPng: () => exportPng(),
  exportVsdx: () => run(() => {
    const routeOf = (c, pg) => {
      const e = state.model.endpoints(c.id, pg.id);
      return route(c.route, e.from, e.to, sideOf(c.from), sideOf(c.to));
    };
    // the colours each shape is drawn with: its own, else its type's default, as on the canvas
    const styleOf = (sh) => ({ fill: FILLS[sh.type] || "#dbeafe", line: LINES[sh.type] || "#2563eb" });
    download(state.fileName.replace(/\.wsdiagram$/, "") + ".vsdx", toVsdx(state.model.doc, (sh) => shapePath(sh.type, sh.w, sh.h, sh.path), routeOf, styleOf), "application/vnd.ms-visio.drawing");
  }),
  print: () => window.print(),
  exportSvg: () => download(state.fileName.replace(/\.wsdiagram$/, "") + ` - ${page().name}.svg`, pageSvg(false), "image/svg+xml"),
  remove: () => run(() => { if (state.sel.length) state.model.remove(state.sel, state.pageId); state.sel = []; }),
  duplicate: () => run(() => {
    const out = [];
    for (const s of selShapes()) { const { id: _old, ...copy } = structuredClone(s); out.push(state.model.addShape({ ...copy, x: s.x + 20, y: s.y + 20 }, state.pageId)); }
    state.sel = out;
  }),
  undo: () => run(() => state.model.undo()),
  redo: () => run(() => state.model.redo()),
  group: () => run(() => { if (state.sel.length < 2) throw new Error("Select two or more shapes to group"); state.sel = [state.model.group(state.sel, state.pageId)]; }),
  ungroup: () => run(() => { const g = state.sel.map(byId).filter((i) => i?.kind === "group"); g.forEach((x) => state.model.ungroup(x.id, state.pageId)); state.sel = g.flatMap((x) => x.members); }),
  front: () => run(() => state.sel.forEach((id) => state.model.toFront(id, state.pageId))),
  back: () => run(() => [...state.sel].reverse().forEach((id) => state.model.toBack(id, state.pageId))),
  alignLeft: () => arrange((ss) => { const x = Math.min(...ss.map((s) => s.x)); ss.forEach((s) => (s.x = x)); }),
  alignCenter: () => arrange((ss) => { const c = ss[0].x + ss[0].w / 2; ss.forEach((s) => (s.x = c - s.w / 2)); }),
  alignTop: () => arrange((ss) => { const y = Math.min(...ss.map((s) => s.y)); ss.forEach((s) => (s.y = y)); }),
  distributeH: () => arrange((ss) => {
    ss.sort((a, b) => a.x - b.x);
    const total = ss.reduce((a, s) => a + s.w, 0), span = ss[ss.length - 1].x + ss[ss.length - 1].w - ss[0].x, gap = (span - total) / (ss.length - 1);
    let x = ss[0].x;
    for (const s of ss) { s.x = x; x += s.w + gap; }
  }, 3),
  layoutDown: () => layout("down"),
  layoutRight: () => layout("right"),
  zoomIn: () => { state.zoom = Math.min(4, state.zoom * 1.25); render(); },
  zoomOut: () => { state.zoom = Math.max(0.25, state.zoom / 1.25); render(); },
  zoomFit: () => { const c = $("wd-canvas"); state.zoom = Math.max(0.25, Math.min(4, (c.clientWidth - 56) / page().width, (c.clientHeight - 56) / page().height)); render(); },
};
/** A diagram from a pasted table (#88), on a page of its own: one undo step. */
async function fromTable() {
  if (state.readOnly) return;
  const got = await askText({
    title: "Diagram from a table",
    hint: "Paste rows from a spreadsheet, or type them with commas.\nOrg chart: Name, Role, Reports to.   Flowchart: From, To, Label.",
    placeholder: "Name\tRole\tReports to\nAnura\tDirector\t\nBimali\tFinance\tAnura",
    sample: TABLE_SAMPLE, ok: "Create diagram",
  });
  if (!got) return;
  run(() => {
    const table = readTable(parseTable(got.text));
    const m = state.model, pageId = m.id("p"), layerId = m.id("l");
    m.edit((d) => { // the page and its diagram: one step
      const page = { id: pageId, name: table.kind === "org" ? "Org chart" : "Flowchart", width: 842, height: 595, layers: [{ id: layerId, name: "Layer 1", visible: true, locked: false }], items: [] };
      d.pages.push(page);
      addTable(page, table, (p) => m.id(p));
    });
    state.pageId = pageId; state.sel = [];
  });
}
const TABLE_SAMPLE = `Name	Role	Reports to
Anura Perera	Managing Director	
Bimali Silva	Finance	Anura Perera
Chaminda Fernando	Operations	Anura Perera
Dilini Jayasuriya	Sales	Anura Perera
Eranga Wickrama	Accounts	Bimali Silva
Fathima Rizvi	Logistics	Chaminda Fernando
Gayan Bandara	Warehouse	Chaminda Fernando`;

/** Auto-layout (#87): the selected shapes, or the whole page when fewer than two are selected; one undo step. */
function layout(direction) {
  run(() => {
    const picked = selShapes().map((s) => s.id);
    const ids = picked.length >= 2 ? picked : null;
    const plan = autoLayout(page(), { direction, ids });
    if (plan.positions.size < 2) throw new Error("Nothing to lay out: add two or more shapes");
    state.model.edit((d) => applyLayout(d.pages.find((p) => p.id === state.pageId), plan));
  });
}
/** Moves several shapes in one undo step. */
function arrange(fn, min = 2) {
  run(() => {
    const ids = selShapes().map((s) => s.id);
    if (ids.length < min) throw new Error(`Select ${min} or more shapes`);
    state.model.edit((d) => fn(d.pages.find((p) => p.id === state.pageId).items.filter((i) => ids.includes(i.id))));
  });
}
/** The page as a PNG at twice its size (sharp on high-density screens and in print). */
function exportPng() {
  const p = page(), scale = 2;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = p.width * scale; c.height = p.height * scale;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    c.toBlob((blob) => blob.arrayBuffer().then((buf) => download(state.fileName.replace(/\.wsdiagram$/, "") + ` - ${p.name}.png`, new Uint8Array(buf), "image/png")), "image/png");
  };
  img.onerror = () => { state.message = "The page could not be drawn as a picture"; render(); };
  img.src = URL.createObjectURL(new Blob([pageSvg(false)], { type: "image/svg+xml" }));
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- drawing ---- */
function sideOf(end) { return end.shape !== undefined ? end.point : "center"; }
function connectorPoints(c) {
  const ends = state.model.endpoints(c.id, state.pageId);
  return route(c.route, ends.from, ends.to, sideOf(c.from), sideOf(c.to));
}
function textLines(text, x, cx, cy, size = 13) {
  const lines = String(text || "").split("\n");
  const top = cy - ((lines.length - 1) * size * 1.25) / 2 + size * 0.35;
  return lines.map((l, i) => `<tspan x="${cx}" y="${top + i * size * 1.25}">${esc(l)}</tspan>`).join("");
}
function shapeSvg(s) {
  const fill = s.style?.fill || FILLS[s.type] || "#dbeafe", line = s.style?.line || LINES[s.type] || "#2563eb";
  const lw = s.style?.lineWidth ?? 1.5;
  const tf = `translate(${s.x} ${s.y})${s.rotate ? ` rotate(${s.rotate} ${s.w / 2} ${s.h / 2})` : ""}`;
  return `<g data-id="${s.id}" transform="${tf}"><path class="shape-body" d="${shapePath(s.type, s.w, s.h, s.path)}" fill="${fill}" stroke="${line}" stroke-width="${lw}"/>` +
    `<text class="shape-text" text-anchor="middle" style="font-size:${s.style?.fontSize || 13}px">${textLines(s.text, 0, s.w / 2, s.h / 2, s.style?.fontSize || 13)}</text></g>`;
}
function connectorSvg(c, interactive) {
  const pts = connectorPoints(c), selected = interactive && state.sel.includes(c.id);
  const d = c.route === "curved" ? `M${pts[0]} C${pts[1]} ${pts[2]} ${pts[3]}` : `M${pts.map((p) => p.join(" ")).join(" L")}`;
  const ms = c.style?.arrowEnd !== false ? ` marker-end="url(#wd-arrow)"` : "";
  const mid = midpoint(c.route === "curved" ? [pts[0], pts[3]] : pts);
  return `<path class="conn${selected ? " is-sel" : ""}" d="${d}"${ms}/>` + (interactive ? `<path class="conn-hit" data-id="${c.id}" d="${d}"/>` : "") +
    (c.text ? `<text class="conn-text" x="${mid[0]}" y="${mid[1] - 4}" text-anchor="middle">${esc(c.text)}</text>` : "");
}
function pageSvg(interactive) {
  const p = page(), z = interactive ? state.zoom : 1;
  let out = `<svg xmlns="${NS}" class="page" width="${p.width * z}" height="${p.height * z}" viewBox="0 0 ${p.width} ${p.height}" font-family="Inter, system-ui, sans-serif">`;
  out += `<defs><marker id="wd-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path class="arrow-head" d="M0,0 L9,4.5 L0,9z" fill="#475569"/></marker>` +
    `<pattern id="wd-dots" width="${GRID * 2}" height="${GRID * 2}" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--dot)"/></pattern></defs>`;
  if (interactive) out += `<rect class="bg" x="0" y="0" width="${p.width}" height="${p.height}" fill="${state.grid ? "url(#wd-dots)" : "transparent"}"/>`;
  else out += `<style>.shape-body{stroke-width:1.5}.shape-text{font-size:13px;fill:#1f2937}.conn{fill:none;stroke:#475569;stroke-width:1.5}.conn-text{font-size:12px;fill:#475569;paint-order:stroke;stroke:#fff;stroke-width:4px}.arrow-head{fill:#475569}</style><rect x="0" y="0" width="${p.width}" height="${p.height}" fill="#fff"/>`; // an exported file has no stylesheet
  for (const it of p.items) {
    if (!isVisible(it)) continue;
    if (it.kind === "shape") out += shapeSvg(it);
    else if (it.kind === "connector") out += connectorSvg(it, interactive);
  }
  if (interactive) out += overlaySvg();
  return out + "</svg>";
}
function bbox(ss) {
  const x = Math.min(...ss.map((s) => s.x)), y = Math.min(...ss.map((s) => s.y));
  return { x, y, w: Math.max(...ss.map((s) => s.x + s.w)) - x, h: Math.max(...ss.map((s) => s.y + s.h)) - y };
}
function overlaySvg() {
  let out = "";
  const ss = selShapes();
  if (ss.length) {
    const b = bbox(ss);
    out += `<rect class="sel-box" x="${b.x - 4}" y="${b.y - 4}" width="${b.w + 8}" height="${b.h + 8}"/>`;
    if (ss.length === 1 && state.sel[0] === ss[0].id && !state.readOnly) {
      for (const [hn, hx, hy] of [["nw", b.x, b.y], ["ne", b.x + b.w, b.y], ["sw", b.x, b.y + b.h], ["se", b.x + b.w, b.y + b.h]])
        out += `<rect class="handle ${hn}" data-handle="${hn}" x="${hx - 5}" y="${hy - 5}" width="10" height="10"/>`;
    }
  }
  if (state.tool === "connect" && state.hover) {
    const s = byId(state.hover);
    if (s?.kind === "shape") for (const p of connectionPoints(s)) { const at = pointOn(s, p.fx, p.fy); out += `<circle class="cpoint" cx="${at.x}" cy="${at.y}" r="4"/>`; }
  }
  for (const g of state.guides) out += g.axis === "x" ? `<line class="guide" x1="${g.at}" x2="${g.at}" y1="0" y2="${page().height}"/>` : `<line class="guide" y1="${g.at}" y2="${g.at}" x1="0" x2="${page().width}"/>`;
  if (state.drag?.marquee) { const m = state.drag.marquee; out += `<rect class="marquee" x="${Math.min(m.x0, m.x1)}" y="${Math.min(m.y0, m.y1)}" width="${Math.abs(m.x1 - m.x0)}" height="${Math.abs(m.y1 - m.y0)}"/>`; }
  if (state.drag?.link) { const l = state.drag.link; out += `<line class="ghost" x1="${l.x0}" y1="${l.y0}" x2="${l.x1}" y2="${l.y1}"/>`; }
  return out;
}

/* ---- panels ---- */
function renderLib() {
  let html = "";
  for (const lib of LIBRARIES) {
    html += `<details data-lib-open="${lib.id}" ${state.libOpen.has(lib.id) ? "open" : ""}><summary>${lib.name}</summary><div class="wd-shapes">`;
    for (const s of lib.shapes) html += `<button type="button" draggable="true" data-shape="${s.type}" data-lib="${lib.id}" title="${s.name}" ${state.readOnly ? "disabled" : ""}><svg viewBox="-2 -2 34 28"><path d="${shapePath(s.type, 30, 24 * Math.min(1, Math.max(0.35, s.h / s.w * 1.25)))}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
    html += "</div></details>";
  }
  $("wd-lib").innerHTML = html;
  $("wd-lib").querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => { if (d.open) state.libOpen.add(d.dataset.libOpen); else state.libOpen.delete(d.dataset.libOpen); }));
}
function renderProps() {
  const ss = selShapes(), conns = state.sel.map(byId).filter((i) => i?.kind === "connector");
  let html = "";
  if (ss.length === 1 && state.sel.length === 1) {
    const s = ss[0];
    html += `<h4>Shape</h4><label>Text<textarea data-prop="text" rows="2">${esc(s.text)}</textarea></label>
      <div class="two"><label>Fill<input type="color" data-prop="fill" value="${s.style?.fill || FILLS[s.type] || "#dbeafe"}"></label><label>Line<input type="color" data-prop="line" value="${s.style?.line || LINES[s.type] || "#2563eb"}"></label></div>
      <div class="two"><label>Width<input type="number" data-prop="w" value="${Math.round(s.w)}" min="10"></label><label>Height<input type="number" data-prop="h" value="${Math.round(s.h)}" min="10"></label></div>
      <div class="two"><label>Rotate<input type="number" data-prop="rotate" value="${s.rotate || 0}" step="15"></label><label>Text size<input type="number" data-prop="fontSize" value="${s.style?.fontSize || 13}" min="6" max="72"></label></div>`;
  } else if (conns.length === 1 && state.sel.length === 1) {
    const c = conns[0];
    html += `<h4>Connector</h4><label>Text<input data-prop="ctext" value="${esc(c.text)}"></label>
      <label>Style<select data-prop="route">${["elbow", "straight", "curved"].map((r) => `<option ${r === c.route ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <label><span><input type="checkbox" data-prop="arrowEnd" ${c.style?.arrowEnd !== false ? "checked" : ""}> Arrow at the end</span></label>`;
  } else if (state.sel.length > 1) html += `<h4>Selection</h4><p class="hint">${ss.length} shapes selected. Use Arrange to align, distribute or group them.</p>`;
  else html += `<h4>Page</h4><label>Name<input data-prop="pname" value="${esc(page().name)}"></label><div class="two"><label>Width<input type="number" data-prop="pw" value="${page().width}"></label><label>Height<input type="number" data-prop="ph" value="${page().height}"></label></div>`;
  html += `<h4>Layers</h4>`;
  for (const l of [...page().layers].reverse()) html += `<div class="wd-layer"><button data-layer-vis="${l.id}" title="Show or hide">${l.visible ? "👁" : "◌"}</button><span class="name">${esc(l.name)}</span><button data-layer-lock="${l.id}" title="Lock or unlock">${l.locked ? "🔒" : "🔓"}</button></div>`;
  html += `<div><button data-cmd-local="addLayer" ${state.readOnly ? "disabled" : ""}>+ Layer</button></div>`;
  $("wd-props").innerHTML = html;
  $("wd-props").querySelectorAll("input, textarea, select").forEach((el) => (el.disabled = state.readOnly));
}
function renderPages() {
  $("wd-pages").innerHTML = state.model.doc.pages.map((p) => `<button data-page="${p.id}" class="${p.id === state.pageId ? "is-on" : ""}">${esc(p.name)}</button>`).join("") + (state.readOnly ? "" : `<button data-page-add>+</button>`);
}

let rendering = false;
function render() {
  if (rendering) return;
  rendering = true;
  try {
    if (!state.model.doc.pages.some((p) => p.id === state.pageId)) state.pageId = state.model.doc.pages[0].id;
    state.sel = state.sel.filter((id) => byId(id));
    $("wd-canvas").innerHTML = pageSvg(true);
    renderLib();
    renderProps();
    renderPages();
    $("wd-title").textContent = state.fileName.replace(/\.wsdiagram$/, "") + (state.model.undoStack.length !== (state.saved || 0) ? " •" : ""); // • unsaved changes
    $("wd-mode").hidden = !state.readOnly;
  $("wd-mode-text").textContent = reasonText(state.licence || "no_license");
  $("wd-upgrade").hidden = state.licence === "unavailable" || state.licence === "unknown";
  $("wd-retry").hidden = !$("wd-upgrade").hidden;
    document.querySelectorAll("[data-edit]").forEach((b) => (b.disabled = state.readOnly));
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === state.tool));
    $("wd-zoomlabel").textContent = Math.round(state.zoom * 100) + "%";
    const n = shapes().length, c = items().filter((i) => i.kind === "connector").length;
    $("wd-status").innerHTML = `<span>${page().name} · page ${state.model.doc.pages.findIndex((p) => p.id === state.pageId) + 1} of ${state.model.doc.pages.length}</span><span>${n} shape${n === 1 ? "" : "s"} · ${c} connector${c === 1 ? "" : "s"}</span>${state.sel.length ? `<span>${state.sel.length} selected</span>` : ""}${state.message ? `<span class="err" role="alert">${esc(state.message)}</span>` : ""}`;
  } finally { rendering = false; }
}

/* ---- adding shapes ---- */
function addFromLibrary(type, at) {
  const def = libraryShape(type);
  run(() => {
    const p = page();
    const x = at ? at.x - def.w / 2 : p.width / 2 - def.w / 2 + (shapes().length % 5) * 20;
    const y = at ? at.y - def.h / 2 : p.height / 2 - def.h / 2 + (shapes().length % 5) * 20;
    const visibleLayer = [...p.layers].reverse().find((l) => l.visible && !l.locked) || p.layers[0];
    state.sel = [state.model.addShape({ type, w: def.w, h: def.h, text: def.text, layer: visibleLayer.id, x: state.grid ? snap(x, GRID) : x, y: state.grid ? snap(y, GRID) : y }, state.pageId)];
    state.tool = "select";
  });
}

/* ---- pointer on the page ---- */
function toPage(e) {
  const svg = $("wd-canvas").querySelector("svg.page");
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
// a double-click edits a shape's text. Each press redraws the page and captures the pointer, so the browser
// sends neither "dblclick" nor a second "click": two presses within 400 ms at the same spot count as one.
let lastPress = null;
$("wd-canvas").addEventListener("pointerdown", (e) => {
  if (!e.target.closest("svg.page") || e.button !== 0) return;
  $("wd-canvas").focus();
  const at = toPage(e);
  const now = e.timeStamp, again = lastPress && now - lastPress.t < 400 && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = again ? null : { t: now, x: e.clientX, y: e.clientY };
  if (again && state.tool === "select" && !state.readOnly) {
    const hit = state.model.hitTest(at.x, at.y, state.pageId);
    // preventDefault: the press would otherwise focus the canvas after we focus the text box, closing it at once
    if (hit) { e.preventDefault(); state.drag = null; editText(hit); return; }
  }
  const handle = e.target.closest("[data-handle]");
  const connHit = e.target.closest(".conn-hit");
  const hit = state.model.hitTest(at.x, at.y, state.pageId);
  if (state.tool === "connect" && !state.readOnly) {
    if (hit) state.drag = { link: { from: hit, x0: at.x, y0: at.y, x1: at.x, y1: at.y } };
  } else if (handle && !state.readOnly) {
    const s = selShapes()[0];
    state.drag = { resize: handle.dataset.handle, id: s.id, box: { x: s.x, y: s.y, w: s.w, h: s.h }, x0: at.x, y0: at.y };
  } else if (connHit) {
    state.sel = e.shiftKey ? [...state.sel, connHit.dataset.id] : [connHit.dataset.id];
  } else if (hit) {
    const id = topOf(hit);
    if (e.shiftKey) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
    else if (!state.sel.includes(id)) state.sel = [id];
    const moving = selShapes();
    if (!state.readOnly && moving.length) state.drag = { move: true, x0: at.x, y0: at.y, start: moving.map((s) => ({ id: s.id, x: s.x, y: s.y })), box: bbox(moving) };
  } else {
    if (!e.shiftKey) state.sel = [];
    state.drag = { marquee: { x0: at.x, y0: at.y, x1: at.x, y1: at.y } };
  }
  $("wd-canvas").setPointerCapture(e.pointerId); // the canvas stays put while the page inside it redraws
  render();
});
$("wd-canvas").addEventListener("pointermove", (e) => {
  if (!$("wd-canvas").querySelector("svg.page")) return;
  const at = toPage(e), d = state.drag;
  if (!d) {
    if (state.tool === "connect") { const h = state.model.hitTest(at.x, at.y, state.pageId); if (h !== state.hover) { state.hover = h; render(); } }
    return;
  }
  if (d.move) {
    let dx = at.x - d.x0, dy = at.y - d.y0;
    const ids = new Set(d.start.map((s) => s.id));
    let box = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
    if (state.grid) { box.x = snap(box.x, GRID); box.y = snap(box.y, GRID); }
    const g = alignGuides(box, shapes().filter((s) => !ids.has(s.id) && isVisible(s)));
    state.guides = g.guides;
    dx = g.x - d.box.x; dy = g.y - d.box.y;
    d.dx = dx; d.dy = dy;
    for (const s of d.start) Object.assign(byId(s.id), { x: s.x + dx, y: s.y + dy }); // a live preview; the edit happens on release
  } else if (d.resize) {
    const b = resizeBox(d.box, d.resize, at.x - d.x0, at.y - d.y0);
    d.next = state.grid ? { x: snap(b.x, GRID), y: snap(b.y, GRID), w: Math.max(10, snap(b.w, GRID)), h: Math.max(10, snap(b.h, GRID)) } : b;
    Object.assign(byId(d.id), d.next);
  } else if (d.marquee) { d.marquee.x1 = at.x; d.marquee.y1 = at.y; }
  else if (d.link) { d.link.x1 = at.x; d.link.y1 = at.y; state.hover = state.model.hitTest(at.x, at.y, state.pageId); }
  render();
});
$("wd-canvas").addEventListener("pointerup", (e) => {
  const d = state.drag;
  state.drag = null;
  state.guides = [];
  if (!d) return;
  if (d.move) {
    for (const s of d.start) Object.assign(byId(s.id), { x: s.x, y: s.y });
    if (d.dx || d.dy) run(() => state.model.edit((doc) => { for (const s of d.start) { const it = doc.pages.find((p) => p.id === state.pageId).items.find((i) => i.id === s.id); if (layerOf(it).locked) throw new Error("the layer is locked"); it.x = s.x + d.dx; it.y = s.y + d.dy; } }));
    else render();
  } else if (d.resize) {
    Object.assign(byId(d.id), d.box);
    if (d.next) run(() => state.model.set(d.id, d.next, state.pageId)); else render();
  } else if (d.marquee) {
    const m = d.marquee, x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    if (x1 - x0 > 3 || y1 - y0 > 3) {
      const inside = shapes().filter((s) => isVisible(s) && s.x >= x0 && s.y >= y0 && s.x + s.w <= x1 && s.y + s.h <= y1).map((s) => topOf(s.id));
      state.sel = [...new Set([...(e.shiftKey ? state.sel : []), ...inside])];
    }
    render();
  } else if (d.link) {
    const to = state.model.hitTest(toPage(e).x, toPage(e).y, state.pageId);
    if (to && to !== d.link.from) run(() => { state.sel = [state.model.connect(d.link.from, to, { route: $("wd-route").value }, state.pageId)]; });
    else render();
  }
});
function editText(id) {
  const s = byId(id);
  if (!s || s.kind !== "shape") return;
  const svg = $("wd-canvas").querySelector("svg.page"), r = svg.getBoundingClientRect(), c = $("wd-canvas").getBoundingClientRect(), z = state.zoom;
  const ta = document.createElement("textarea");
  ta.className = "wd-text";
  ta.value = s.text || "";
  Object.assign(ta.style, { left: `${r.left - c.left + $("wd-canvas").scrollLeft + s.x * z}px`, top: `${r.top - c.top + $("wd-canvas").scrollTop + s.y * z}px`, width: `${s.w * z}px`, height: `${s.h * z}px` });
  $("wd-canvas").appendChild(ta);
  ta.focus();
  ta.select();
  setTimeout(() => { if (ta.isConnected && document.activeElement !== ta) { ta.focus(); ta.select(); } }, 0);
  let done = false;
  const finish = (keep) => { if (done) return; done = true; const v = ta.value; ta.remove(); if (keep && v !== (s.text || "")) run(() => state.model.set(id, { text: v }, state.pageId)); else render(); $("wd-canvas").focus(); };
  ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); finish(true); } else if (ev.key === "Escape") finish(false); ev.stopPropagation(); });
  const opened = performance.now();
  ta.addEventListener("blur", () => { if (performance.now() - opened < 150) { setTimeout(() => ta.isConnected && ta.focus(), 0); return; } finish(true); });
}

/* ---- keyboard ---- */
$("wd-canvas").addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? commands.redo() : commands.undo(); }
  else if (mod && k === "y") { e.preventDefault(); commands.redo(); }
  else if (mod && k === "d") { e.preventDefault(); commands.duplicate(); }
  else if (mod && k === "g") { e.preventDefault(); e.shiftKey ? commands.ungroup() : commands.group(); }
  else if (mod && k === "a") { e.preventDefault(); state.sel = [...new Set(items().filter((i) => i.kind !== "group" && isVisible(i)).map((i) => (i.kind === "shape" ? topOf(i.id) : i.id)))]; render(); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commands.remove(); }
  else if (e.key === "Escape") { state.tool = "select"; state.sel = []; render(); }
  else if ((e.key === "F2" || e.key === "Enter") && selShapes().length === 1) { e.preventDefault(); editText(selShapes()[0].id); }
  else if (e.key.startsWith("Arrow") && state.sel.length) {
    e.preventDefault();
    const step = e.shiftKey ? GRID : 1, dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0, dy = { ArrowUp: -step, ArrowDown: step }[e.key] || 0;
    const ids = selShapes().map((s) => s.id);
    run(() => state.model.edit((doc) => doc.pages.find((p) => p.id === state.pageId).items.filter((i) => ids.includes(i.id)).forEach((i) => { i.x += dx; i.y += dy; })));
  }
});

/* ---- panels' events ---- */
document.querySelectorAll(".wd-tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
function showTab(name) {
  document.querySelectorAll(".wd-tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
  document.querySelectorAll(".wd-group").forEach((g) => g.classList.toggle("is-on", g.dataset.tab === name));
}
$("wd-ribbon").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.cmd) commands[b.dataset.cmd]();
  if (b.dataset.tool) { state.tool = b.dataset.tool; render(); }
});
$("wd-grid").addEventListener("change", (e) => { state.grid = e.target.checked; render(); });
$("wd-upgrade").addEventListener("click", () => (window.WorkSuiteDiagram.onUpgrade || openUpgrade)());
$("wd-retry").addEventListener("click", () => applyLicence());
/** Free viewing, Pro editing (#73): asks the local service at startup and on Try again. */
async function applyLicence() {
  const r = await checkEdit("diagram.edit");
  state.licence = r.reason;
  window.WorkSuiteDiagram.setReadOnly(!r.edit);
}
$("wd-lib").addEventListener("click", (e) => { const b = e.target.closest("[data-shape]"); if (b && !b.disabled) addFromLibrary(b.dataset.shape); });
$("wd-lib").addEventListener("dragstart", (e) => { const b = e.target.closest("[data-shape]"); if (b) e.dataTransfer.setData("text/x-worksuite-shape", b.dataset.shape); });
$("wd-canvas").addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-worksuite-shape")) e.preventDefault(); });
$("wd-canvas").addEventListener("drop", (e) => { const t = e.dataTransfer.getData("text/x-worksuite-shape"); if (t) { e.preventDefault(); addFromLibrary(t, toPage(e)); } });
$("wd-pages").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.page) { state.pageId = b.dataset.page; state.sel = []; render(); }
  else if (b.hasAttribute("data-page-add")) run(() => { state.pageId = state.model.addPage(); state.sel = []; });
});
$("wd-props").addEventListener("change", (e) => {
  const el = e.target, prop = el.dataset.prop;
  if (!prop) return;
  const id = state.sel[0], it = id && byId(id);
  run(() => {
    if (prop === "text") state.model.set(id, { text: el.value }, state.pageId);
    else if (prop === "fill" || prop === "line" || prop === "fontSize") state.model.set(id, { style: { ...it.style, [prop]: prop === "fontSize" ? Number(el.value) : el.value } }, state.pageId);
    else if (prop === "w" || prop === "h" || prop === "rotate") state.model.set(id, { [prop]: Number(el.value) }, state.pageId);
    else if (prop === "ctext") state.model.set(id, { text: el.value }, state.pageId);
    else if (prop === "route") state.model.set(id, { route: el.value }, state.pageId);
    else if (prop === "arrowEnd") state.model.set(id, { style: { ...it.style, arrowEnd: el.checked } }, state.pageId);
    else if (prop === "pname" || prop === "pw" || prop === "ph") state.model.edit((d) => { const p = d.pages.find((x) => x.id === state.pageId); if (prop === "pname") p.name = el.value || p.name; else p[prop === "pw" ? "width" : "height"] = Math.max(100, Number(el.value)); });
  });
});
$("wd-props").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.layerVis) { const l = page().layers.find((x) => x.id === b.dataset.layerVis); run(() => state.model.setLayer(l.id, { visible: !l.visible }, state.pageId)); }
  else if (b.dataset.layerLock) { const l = page().layers.find((x) => x.id === b.dataset.layerLock); run(() => state.model.setLayer(l.id, { locked: !l.locked }, state.pageId)); }
  else if (b.dataset.cmdLocal === "addLayer") run(() => state.model.addLayer(`Layer ${page().layers.length + 1}`, state.pageId));
});
$("wd-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.vsdx$/i.test(f.name)) await openVsdx(bytes, f.name);
    else load(bytes, f.name);
  } catch (err) { state.message = "Could not open " + f.name + ": " + err.message; render(); }
  e.target.value = "";
});

/** Opens a Visio drawing (#85) as a new WorkSuite diagram, listing what could not come across. */
async function openVsdx(bytes, name) {
  const { doc, problems } = await fromVsdx(bytes);
  state.model = new DiagramModel(doc);
  state.pageId = state.model.doc.pages[0].id;
  state.fileName = name.replace(/\.vsdx$/i, "") + ".wsdiagram";
  state.saved = -1; // not saved as .wsdiagram yet
  state.sel = [];
  state.message = problems.length ? `Opened ${name}: ${problems.join("; ")}` : "";
  render();
}

/** Opens a diagram: the bytes of a .wsdiagram file (or its JSON text). */
function load(input, name = "Diagram.wsdiagram") {
  state.model = new DiagramModel(parse(typeof input === "string" ? input : unpackDocument(input, APP)));
  state.saved = 0;
  state.pageId = state.model.doc.pages[0].id;
  state.fileName = name;
  state.sel = [];
  render();
}

/* the shell's handle (#72): load a file, read it back, free viewing without Pro (#73) */
window.WorkSuiteDiagram = {
  load,
  openVsdx,
  text: () => serialize(state.model.doc),
  bytes: () => packDocument(APP, serialize(state.model.doc)),
  svg: () => pageSvg(false),
  /** The current page cropped to its drawing plus `margin` points: { svg, width, height } (for a picture in a document). */
  svgFit(margin = 16) {
    const p = page(), boxes = [];
    for (const it of p.items) {
      if (!isVisible(it)) continue;
      if (it.kind === "shape") boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h });
      else if (it.kind === "connector") { const pts = connectorPoints(it); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }); }
    }
    const b = boxes.length ? bbox(boxes) : { x: 0, y: 0, w: p.width, h: p.height };
    const x = Math.max(0, b.x - margin), y = Math.max(0, b.y - margin), w = Math.min(p.width - x, b.w + 2 * margin), h = Math.min(p.height - y, b.h + 2 * margin);
    const svg = pageSvg(false).replace(/^<svg([^>]*) width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg$1 width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`);
    return { svg, width: w, height: h };
  },
  setReadOnly(on) { state.readOnly = !!on; state.tool = "select"; render(); },
  onUpgrade: null,
};

// a sample to try the editor: ?sample
if (new URLSearchParams(location.search).has("sample")) {
  const m = new DiagramModel(newDiagram("Leave approval"));
  const add = (type, x, y, text, w, h) => { const d = libraryShape(type); return m.addShape({ type, x, y, w: w || d.w, h: h || d.h, text }); };
  const a = add("terminator", 350, 30, "Employee requests leave", 170);
  const b = add("rect", 345, 120, "Fill in leave form", 180);
  const c = add("diamond", 345, 220, "Manager approves?", 180, 100);
  const no = add("rect", 600, 240, "Ask for changes", 170);
  const hr = add("rect", 345, 370, "HR records leave", 180);
  const cal = add("database", 380, 460, "Calendar", 110, 70);
  const pol = add("document", 90, 360, "Leave policy", 150, 70);
  m.connect(a, b); m.connect(b, c);
  m.connect(c, no, { text: "No" });
  m.connect(no, b, { route: "elbow" });
  m.connect(c, hr, { text: "Yes" });
  m.connect(hr, cal);
  m.connect(pol, hr, { route: "straight", style: { arrowEnd: false } });
  m.addPage("Roles");
  state.model = new DiagramModel(m.doc);
  state.fileName = "Leave approval.wsdiagram";
  state.sel = [c];
}
const embedded = new URLSearchParams(location.search).has("embedded"); // inside the WorkSuite Diagram plugin (#85)
if (embedded) document.documentElement.classList.add("is-embedded");
if (new URLSearchParams(location.search).has("readonly")) state.readOnly = true;
else if (!embedded) applyLicence(); // embedded: the plugin checks the licence and calls setReadOnly
showTab("home");
render();
