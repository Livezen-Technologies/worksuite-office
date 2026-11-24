/*
 * WorkSuite Diagram: the .wsdiagram document and its shape model (#78, roadmap docs/project-diagram/roadmap.md).
 *
 * Pure ES module, no DOM: the editor (stage 2, #79) and the tests use it alike. It lives outside build/editors/,
 * which patch-pdf-convert.py copies over web-apps.
 *
 * The document (schema version 1), saved as canonical JSON inside the .wsdiagram zip:
 *   { app: "worksuite.diagram", v: 1, name, pages: [Page] }
 *   Page:      { id, name, width, height, layers: [Layer], items: [Shape | Connector | Group], graphics? }   (items: back to front;
 *              link?: { source, key, at } (the table last linked, linkdata.js);
 *              graphics: data graphics, datagraphics.js; jumps: false to draw crossing connectors without hops)
 *   Layer:     { id, name, visible, locked }
 *   Shape:     { id, kind: "shape", type ("rect", "ellipse", "diamond", "terminator", …), layer, x, y, w, h,
 *                rotate (degrees), text, style: { fill, line, lineWidth, fontSize, … } }
 *                data?: [{ label, value }] (shape data: text, numbers, yes/no; shapedata.js)
 *                target?: a shape id (a callout's shape; container.js)
 *                link?: { page } | { url } (a hyperlink to a page of the diagram or an address; hyperlink.js)
 *   Connector: { id, kind: "connector", layer, from: End, to: End, route: "straight" | "elbow" | "curved",
 *                text, style: { line, lineWidth, arrowEnd, arrowStart } }
 *     End:     { shape, point } glued to one of the shape's connection points, or { x, y } free
 *   Group:     { id, kind: "group", layer, members: [shape or group ids] }
 * Coordinates are in points on the page; x, y are the shape's top-left before rotation.
 */

import { makeLanes, nextLane } from "./swimlane.js";
import { dataError } from "./shapedata.js";
import { graphicsError } from "./datagraphics.js";
import { matchRows, mergeRow } from "./linkdata.js";
import { linkError } from "./hyperlink.js";
import { containerAround, calloutFor } from "./container.js";
import { themeError, pageLookError } from "./theme.js";
import { ignoreError, issueKey } from "./rules.js";

export const APP = "worksuite.diagram";
export const SCHEMA_VERSION = 1;
export const ROUTES = ["straight", "elbow", "curved"];
const KINDS = ["shape", "connector", "group"];

/* ---- connection points: where connectors glue, as fractions of the shape's box ---- */
const SIDES = [["top", 0.5, 0], ["right", 1, 0.5], ["bottom", 0.5, 1], ["left", 0, 0.5]];
export const connectionPoints = (shape) => {
  const pts = SIDES.map(([name, fx, fy]) => ({ name, fx, fy }));
  if (shape.type === "rect" || shape.type === "terminator") pts.push({ name: "center", fx: 0.5, fy: 0.5 });
  return pts;
};

/** A point on a shape's box (fractions fx, fy), on the page, with the shape's rotation applied. */
export function pointOn(shape, fx, fy) {
  const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
  const dx = shape.x + fx * shape.w - cx, dy = shape.y + fy * shape.h - cy;
  const a = ((shape.rotate || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const r = (n) => Math.round(n * 1000) / 1000;
  return { x: r(cx + dx * cos - dy * sin), y: r(cy + dx * sin + dy * cos) };
}

/* ---- the document ---- */
export function newDiagram(name = "Diagram") {
  return {
    app: APP, v: SCHEMA_VERSION, name,
    pages: [{ id: "p1", name: "Page 1", width: 842, height: 595, layers: [{ id: "l1", name: "Layer 1", visible: true, locked: false }], items: [] }],
  };
}

/** Throws an Error listing every problem; returns the document when it is valid. */
export function validate(doc) {
  const errs = [];
  if (!doc || typeof doc !== "object") throw new Error("not a WorkSuite diagram");
  if (doc.app !== APP) errs.push("not a WorkSuite diagram");
  if (doc.v !== SCHEMA_VERSION) errs.push(`schema version ${doc.v} is not ${SCHEMA_VERSION}`);
  if (!Array.isArray(doc.pages) || !doc.pages.length) errs.push("a diagram needs at least one page");
  const ids = new Set();
  const seen = (id, at) => { if (typeof id !== "string" || !id) errs.push(`${at}: no id`); else if (ids.has(id)) errs.push(`${at}: duplicate id ${id}`); ids.add(id); };
  for (const [pi, page] of (doc.pages || []).entries()) {
    const at = `page ${pi + 1}`;
    seen(page.id, at);
    if (!(page.width > 0 && page.height > 0)) errs.push(`${at}: bad size`);
    if (graphicsError(page.graphics)) errs.push(`${at}: ${graphicsError(page.graphics)}`);
    if (themeError(page.theme)) errs.push(`${at}: ${themeError(page.theme)}`);
    if (pageLookError(page)) errs.push(`${at}: ${pageLookError(page)}`);
    if (ignoreError(page.ignore)) errs.push(`${at}: ${ignoreError(page.ignore)}`);
    if (page.link !== undefined && !(page.link && typeof page.link.key === "string" && page.link.key)) errs.push(`${at}: a data link needs its key column`);
    if (page.jumps !== undefined && page.jumps !== false) errs.push(`${at}: jumps is false or left out`);
    if (!Array.isArray(page.layers) || !page.layers.length) { errs.push(`${at}: needs a layer`); continue; }
    const layers = new Set(page.layers.map((l) => (seen(l.id, `${at} layer`), l.id)));
    const shapes = new Map(), items = new Map();
    for (const it of page.items || []) {
      const w = `${at} item ${it.id}`;
      seen(it.id, w);
      items.set(it.id, it);
      if (!KINDS.includes(it.kind)) errs.push(`${w}: unknown kind`);
      if (!layers.has(it.layer)) errs.push(`${w}: unknown layer`);
      if (it.kind === "shape") {
        shapes.set(it.id, it);
        if (typeof it.type !== "string" || !it.type) errs.push(`${w}: no type`);
        for (const k of ["x", "y", "w", "h"]) if (!Number.isFinite(it[k])) errs.push(`${w}: ${k} must be a number`);
        if (!(it.w > 0 && it.h > 0)) errs.push(`${w}: size must be positive`);
        if (dataError(it.data)) errs.push(`${w}: ${dataError(it.data)}`);
        if (it.target !== undefined && (typeof it.target !== "string" || it.target === it.id)) errs.push(`${w}: a callout's target must be another shape`);
        if (linkError(it.link, (doc.pages || []).map((pg) => pg.id))) errs.push(`${w}: ${linkError(it.link, (doc.pages || []).map((pg) => pg.id))}`);
      }
    }
    for (const it of page.items || []) {
      if (it.target !== undefined && it.kind === "shape" && !shapes.has(it.target)) errs.push(`${at} item ${it.id}: its callout target is not on the page`);
      const w = `${at} item ${it.id}`;
      if (it.kind === "connector") {
        if (!ROUTES.includes(it.route)) errs.push(`${w}: route must be one of ${ROUTES.join(", ")}`);
        for (const end of ["from", "to"]) {
          const e = it[end];
          if (!e) { errs.push(`${w}: no ${end} end`); continue; }
          if (e.shape !== undefined) {
            const s = shapes.get(e.shape);
            if (!s) errs.push(`${w}: ${end} is glued to an unknown shape`);
            else if (!connectionPoints(s).some((p) => p.name === e.point)) errs.push(`${w}: ${end} point ${e.point} is not on ${s.id}`);
          } else if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) errs.push(`${w}: ${end} needs a shape or a position`);
        }
      }
      if (it.kind === "group") {
        if (!Array.isArray(it.members) || it.members.length < 2) errs.push(`${w}: a group needs two members`);
        for (const m of it.members || []) {
          const t = items.get(m);
          if (!t || (t.kind !== "shape" && t.kind !== "group")) errs.push(`${w}: member ${m} is not a shape or group`);
        }
      }
    }
    // a shape or group belongs to at most one group, and groups do not contain themselves
    const owner = new Map();
    for (const it of page.items || []) if (it.kind === "group") for (const m of it.members || []) {
      if (owner.has(m)) errs.push(`${at}: ${m} is in two groups`);
      owner.set(m, it.id);
    }
    for (const start of owner.keys()) {
      let cur = start, hops = 0;
      while (owner.has(cur) && hops++ <= owner.size) cur = owner.get(cur);
      if (hops > owner.size) { errs.push(`${at}: groups contain each other`); break; }
    }
  }
  if (errs.length) throw new Error(errs.join("; "));
  return doc;
}

export function migrate(doc) {
  if (!doc || doc.app !== APP) throw new Error("not a WorkSuite diagram");
  if (doc.v > SCHEMA_VERSION) throw new Error(`made by a newer WorkSuite Office (schema ${doc.v}); update to open it`);
  // 10.1.89 to 10.1.91 gave titled containers the type the cloud library's small Container shape had: a small,
  // empty "container" is that cloud shape, now "appcontainer"
  for (const page of doc.pages || []) for (const it of page.items || []) {
    if (it.kind !== "shape" || it.type !== "container" || it.w > 100 || it.h > 100) continue;
    const holds = (page.items || []).some((o) => o !== it && o.kind === "shape" && o.x + o.w / 2 > it.x && o.x + o.w / 2 < it.x + it.w && o.y + o.h / 2 > it.y && o.y + o.h / 2 < it.y + it.h);
    if (!holds) it.type = "appcontainer";
  }
  return doc; // v1 is the first version
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])]));
  return v;
}
export const serialize = (doc) => JSON.stringify(canon(validate(doc)), null, 1) + "\n";
export const parse = (text) => validate(migrate(JSON.parse(text)));

/* ---- the model: edits with undo and redo ---- */
export class DiagramModel {
  constructor(doc = newDiagram()) {
    this.doc = validate(structuredClone(migrate(doc)));
    this.undoStack = [];
    this.redoStack = [];
    const nums = this.doc.pages.flatMap((p) => [p.id, ...p.layers.map((l) => l.id), ...p.items.map((i) => i.id)]).map((id) => Number(String(id).replace(/\D/g, "")) || 0);
    this.seq = Math.max(0, ...nums);
  }
  id(prefix) { return prefix + ++this.seq; }

  edit(fn) {
    const before = structuredClone(this.doc);
    const draft = structuredClone(this.doc);
    const out = fn(draft);
    validate(draft);
    this.undoStack.push(before);
    this.redoStack = [];
    this.doc = draft;
    return out;
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.doc); this.doc = this.undoStack.pop(); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.doc); this.doc = this.redoStack.pop(); return true; }

  page(pageId = this.doc.pages[0].id) { const p = this.doc.pages.find((x) => x.id === pageId); if (!p) throw new Error("no page " + pageId); return p; }
  item(id, pageId) { const it = this.page(pageId).items.find((i) => i.id === id); if (!it) throw new Error("no item " + id); return it; }
  layerOf(d, page, layerId) { return d.pages.find((p) => p.id === page).layers.find((l) => l.id === layerId); }
  assertEditable(d, pageId, layerId) { if (this.layerOf(d, pageId, layerId).locked) throw new Error("the layer is locked"); }

  /* pages and layers */
  addPage(name) { const id = this.id("p"), lid = this.id("l"); this.edit((d) => { d.pages.push({ id, name: name || `Page ${d.pages.length + 1}`, width: 842, height: 595, layers: [{ id: lid, name: "Layer 1", visible: true, locked: false }], items: [] }); }); return id; }
  removePage(pageId) { this.edit((d) => { d.pages = d.pages.filter((p) => p.id !== pageId); for (const p of d.pages) for (const it of p.items) if (it.link?.page === pageId) delete it.link; }); }
  addLayer(name, pageId = this.page().id) { const id = this.id("l"); this.edit((d) => { d.pages.find((p) => p.id === pageId).layers.push({ id, name, visible: true, locked: false }); }); return id; }
  setLayer(layerId, fields, pageId = this.page().id) { this.edit((d) => Object.assign(this.layerOf(d, pageId, layerId), fields)); }

  /* shapes */
  addShape(fields, pageId = this.page().id) {
    const id = this.id("s");
    this.edit((d) => {
      const page = d.pages.find((p) => p.id === pageId);
      const shape = { id, kind: "shape", type: "rect", layer: page.layers[0].id, x: 0, y: 0, w: 120, h: 60, rotate: 0, text: "", style: {}, ...fields };
      this.assertEditable(d, pageId, shape.layer);
      page.items.push(shape);
    });
    return id;
  }
  /**
   * Links a table to the page's shapes (linkdata.js): matching rows' columns become their shape data; with `addMissing`,
   * rows with no shape become new shapes in a grid below the drawing. The page remembers { source, key }. One undo
   * step. Returns { updated, added, unmatched }.
   */
  linkData(rows, key, { source = "", addMissing = false, at = new Date().toISOString().slice(0, 10) } = {}, pageId = this.page().id) {
    const page = this.page(pageId), { header, keyIndex, matches, unmatched } = matchRows(page.items, rows, key);
    const newIds = addMissing ? unmatched.map(() => this.id("s")) : [];
    this.edit((d) => {
      const p = d.pages.find((x) => x.id === pageId);
      for (const { id, row } of matches) { const s = p.items.find((i) => i.id === id); this.assertEditable(d, pageId, s.layer); s.data = mergeRow(s.data, header, row); }
      if (newIds.length) {
        const bottom = Math.max(40, ...p.items.filter((i) => i.kind === "shape").map((i) => i.y + i.h));
        const per = Math.max(1, Math.floor((p.width - 40) / 160));
        unmatched.forEach((row, n) => p.items.push({ id: newIds[n], kind: "shape", type: "rect", layer: p.layers[0].id, x: 40 + (n % per) * 160, y: bottom + 30 + Math.floor(n / per) * 80, w: 140, h: 60, rotate: 0, text: row[keyIndex], style: {}, data: mergeRow([], header, row) }));
        p.height = Math.max(p.height, bottom + 30 + Math.ceil(unmatched.length / per) * 80 + 20);
      }
      p.link = { source: String(source), key: header[keyIndex], at };
    });
    return { updated: matches.length, added: newIds.length, unmatched: addMissing ? 0 : unmatched.length };
  }
  /** Puts a container around shapes, behind the first of them; returns its id. */
  addContainer(ids, title = "Container", pageId = this.page().id) {
    const page = this.page(pageId), shapes = ids.flatMap((id) => this.shapesIn(page, id));
    const f = containerAround(shapes, title), id = this.id("s");
    this.edit((d) => {
      const p = d.pages.find((x) => x.id === pageId), at = Math.min(...shapes.map((s) => p.items.findIndex((i) => i.id === s.id)));
      p.items.splice(Math.max(0, at), 0, { id, kind: "shape", layer: shapes[0].layer, rotate: 0, style: {}, ...f });
    });
    return id;
  }
  /** Adds a callout on a shape; returns its id. */
  addCallout(targetId, text = "Note", pageId = this.page().id) {
    const t = this.page(pageId).items.find((i) => i.id === targetId);
    if (!t || t.kind !== "shape") throw new Error("select a shape to add a callout to");
    return this.addShape({ ...calloutFor(t, text), layer: t.layer }, pageId);
  }
  /** Sets a shape's hyperlink ({ page } or { url }); undefined removes it. */
  setLink(id, link, pageId = this.page().id) {
    this.edit((d) => {
      const it = d.pages.find((p) => p.id === pageId).items.find((i) => i.id === id);
      if (!it || it.kind !== "shape") throw new Error("a link goes on a shape");
      this.assertEditable(d, pageId, it.layer);
      if (link) it.link = link; else delete it.link;
    });
  }
  /** Sets a page's data graphics (datagraphics.js); null removes them. */
  setGraphics(graphics, pageId = this.page().id) {
    this.edit((d) => { const p = d.pages.find((x) => x.id === pageId); if (graphics) p.graphics = graphics; else delete p.graphics; });
  }
  /**
   * Sets how pages look (theme.js): { theme, background, border }, each null to remove it and left out to keep it.
   * pageIds: the pages to change (default the current one). One undo step.
   */
  setLook(look, pageIds = [this.page().id]) {
    this.edit((d) => {
      for (const id of pageIds) {
        const p = d.pages.find((x) => x.id === id);
        if (!p) throw new Error(`no page ${id}`);
        for (const k of ["theme", "background", "border"]) {
          if (!(k in look)) continue;
          if (look[k] === null || look[k] === "") delete p[k]; else p[k] = structuredClone(look[k]);
        }
      }
    });
  }
  /** Ignores a validation issue (rules.js) on its page, or brings it back (ignore false); one undo step. */
  ignoreIssue(issue, ignore = true, pageId = this.page().id) {
    this.edit((d) => {
      const p = d.pages.find((x) => x.id === pageId), key = issueKey(issue);
      const list = (p.ignore || []).filter((k) => k !== key);
      if (ignore) list.push(key);
      if (list.length) p.ignore = list; else delete p.ignore;
    });
  }
  /** Sets a shape's data (shapedata.js); an empty list removes it. */
  setData(id, data, pageId = this.page().id) {
    this.edit((d) => {
      const it = d.pages.find((p) => p.id === pageId).items.find((i) => i.id === id);
      if (!it || it.kind !== "shape") throw new Error("shape data goes on a shape");
      this.assertEditable(d, pageId, it.layer);
      if (data && data.length) it.data = data.map((x) => ({ label: String(x.label).trim(), value: x.value })); else delete it.data;
    });
  }
  /** Adds swimlanes (swimlane.js makeLanes) behind everything on the page; returns their ids. One undo step. */
  addLanes(names, opts = {}, pageId = this.page().id) {
    const fields = makeLanes(names, opts), ids = fields.map(() => this.id("s"));
    this.edit((d) => {
      const page = d.pages.find((p) => p.id === pageId);
      this.assertEditable(d, pageId, page.layers[0].id);
      page.items.unshift(...fields.map((f, i) => ({ id: ids[i], kind: "shape", layer: page.layers[0].id, rotate: 0, style: {}, ...f })));
    });
    return ids;
  }
  /** Adds a lane at the end of the pool a lane is in; returns its id. */
  addLane(laneId, name = "Lane", pageId = this.page().id) {
    const page = this.page(pageId), lane = page.items.find((i) => i.id === laneId);
    if (!lane || lane.type !== "lane") throw new Error("select a lane to add one after it");
    const id = this.id("s"), f = nextLane(page.items, lane, name);
    this.edit((d) => {
      const p = d.pages.find((x) => x.id === pageId), at = p.items.findIndex((i) => i.id === laneId);
      p.items.splice(at + 1, 0, { id, kind: "shape", layer: lane.layer, rotate: 0, style: { ...(lane.style || {}) }, ...f });
    });
    return id;
  }
  /** Moves or resizes a shape (or every shape in a group); glued connectors follow by themselves. */
  move(id, dx, dy, pageId = this.page().id) {
    this.edit((d) => {
      const page = d.pages.find((p) => p.id === pageId);
      for (const s of this.shapesIn(page, id)) { this.assertEditable(d, pageId, s.layer); s.x += dx; s.y += dy; }
    });
  }
  resize(id, w, h, pageId = this.page().id) { this.set(id, { w, h }, pageId); }
  set(id, fields, pageId = this.page().id) {
    this.edit((d) => {
      const it = d.pages.find((p) => p.id === pageId).items.find((i) => i.id === id);
      this.assertEditable(d, pageId, it.layer);
      Object.assign(it, fields);
    });
  }
  /** Removes items; connectors glued to a removed shape are removed with it, and groups left with one member dissolve. */
  remove(ids, pageId = this.page().id) {
    const gone = new Set([].concat(ids));
    this.edit((d) => {
      const page = d.pages.find((p) => p.id === pageId);
      for (const id of gone) for (const s of this.shapesIn(page, id)) gone.add(s.id);
      page.items = page.items.filter((i) => !gone.has(i.id) && !(i.kind === "connector" && (gone.has(i.from.shape) || gone.has(i.to.shape))));
      for (const g of page.items.filter((i) => i.kind === "group")) g.members = g.members.filter((m) => !gone.has(m));
      for (const c of page.items) if (c.target && gone.has(c.target)) delete c.target; // a callout whose shape goes stays as a note
      page.items = page.items.filter((i) => i.kind !== "group" || i.members.length >= 2);
    });
  }

  /* connectors */
  connect(from, to, fields = {}, pageId = this.page().id) {
    const id = this.id("c");
    this.edit((d) => {
      const page = d.pages.find((p) => p.id === pageId);
      const end = (e) => (typeof e === "string" ? { shape: e, point: this.nearestPoints(page, e, e === from ? to : from) } : e);
      const c = { id, kind: "connector", layer: page.layers[0].id, from: end(from), to: end(to), route: "elbow", text: "", style: { arrowEnd: true }, ...fields };
      this.assertEditable(d, pageId, c.layer);
      page.items.push(c);
    });
    return id;
  }
  /** The connection point of `shapeId` that faces `otherId` best (shortest distance between points). */
  nearestPoints(page, shapeId, otherId) {
    const a = page.items.find((i) => i.id === shapeId);
    const b = typeof otherId === "string" ? page.items.find((i) => i.id === otherId) : null;
    const target = b ? pointOn(b, 0.5, 0.5) : otherId;
    let best = null;
    for (const p of connectionPoints(a).filter((q) => q.name !== "center")) {
      const at = pointOn(a, p.fx, p.fy), dist = Math.hypot(at.x - target.x, at.y - target.y);
      if (!best || dist < best.dist) best = { name: p.name, dist };
    }
    return best.name;
  }
  /** Where a connector's ends are on the page right now (glued ends follow their shapes). */
  endpoints(connectorId, pageId = this.page().id) {
    const page = this.page(pageId), c = this.item(connectorId, pageId);
    const at = (e) => {
      if (e.shape === undefined) return { x: e.x, y: e.y };
      const s = page.items.find((i) => i.id === e.shape), p = connectionPoints(s).find((q) => q.name === e.point);
      return pointOn(s, p.fx, p.fy);
    };
    return { from: at(c.from), to: at(c.to) };
  }

  /* groups and order */
  group(ids, pageId = this.page().id) {
    const id = this.id("g");
    this.edit((d) => { const page = d.pages.find((p) => p.id === pageId); page.items.push({ id, kind: "group", layer: page.items.find((i) => i.id === ids[0]).layer, members: [...ids] }); });
    return id;
  }
  ungroup(groupId, pageId = this.page().id) { this.edit((d) => { const page = d.pages.find((p) => p.id === pageId); page.items = page.items.filter((i) => i.id !== groupId); }); }
  /** Every shape a shape or group stands for. */
  shapesIn(page, id) {
    const it = page.items.find((i) => i.id === id);
    if (!it) return [];
    if (it.kind === "shape") return [it];
    if (it.kind === "group") return it.members.flatMap((m) => this.shapesIn(page, m));
    return [];
  }
  toFront(id, pageId = this.page().id) { this.edit((d) => { const p = d.pages.find((x) => x.id === pageId), i = p.items.findIndex((x) => x.id === id); p.items.push(...p.items.splice(i, 1)); }); }
  toBack(id, pageId = this.page().id) { this.edit((d) => { const p = d.pages.find((x) => x.id === pageId), i = p.items.findIndex((x) => x.id === id); p.items.unshift(...p.items.splice(i, 1)); }); }

  /** The topmost visible shape at a page point (rotation respected), or null. */
  hitTest(x, y, pageId = this.page().id) {
    const page = this.page(pageId), visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
    for (let i = page.items.length - 1; i >= 0; i--) {
      const s = page.items[i];
      if (s.kind !== "shape" || !visible.has(s.layer)) continue;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = (-(s.rotate || 0) * Math.PI) / 180;
      const lx = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), ly = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
      if (lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h) return s.id;
    }
    return null;
  }
}
