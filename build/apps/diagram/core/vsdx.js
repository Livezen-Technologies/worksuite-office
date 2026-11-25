/*
 * WorkSuite Diagram: open and save Visio drawings, .vsdx (#85, stage 3 of #71).
 * Pure ES module: XML through the Project XML reader, zips through common/zip.js.
 *
 * A .vsdx is an Open Packaging zip: visio/pages/pages.xml lists the pages, each visio/pages/pageN.xml holds its
 * shapes and the connections between them, and visio/masters/ holds the masters shapes inherit from.
 *
 * Reading: pages and their size; shapes with position, size, rotation, text, fill and line, and their outline
 * (the shape's own Geometry or its master's; MoveTo, LineTo, arcs, elliptical arcs, ellipses, splines and the
 * relative rows), stored as a "path" shape whose outline is kept in its own 0..1 box; 1-D shapes (connectors)
 * as connectors, glued to the shapes the drawing connects them to; groups' members as shapes. What a WorkSuite
 * diagram cannot hold yet (themes, layers' Visio properties, images, fields) is left out
 * and listed.
 *
 * Also opens macro drawings (.vsdm: the drawing, not its macros) and Visio templates (.vstx: a new drawing from it),
 * and writes a template (.vstx) as well as a drawing.
 *
 * Writing: one page per page, each shape with its outline as Geometry in relative units (so it resizes in
 * Visio), its text, fill and line; each connector as a 1-D shape along its route, glued with Connect elements; comments in visio/comments.xml.
 *
 * Units: Visio uses inches with y up from the bottom of the page; WorkSuite uses points with y down.
 */
import { toPropertySection, fromPropertyRows } from "./shapedata.js";
import { MAX_TEXT } from "./comments.js";
import { toHyperlinkSection, fromHyperlinkRows } from "./hyperlink.js";
import { parseXml } from "../../project/core/projectxml.js";
import { zip, unzipAsync } from "../../common/zip.js";
import { newDiagram, validate, connectionPoints, pointOn } from "./diagram.js";

const PT = 72; // points per inch
const NS = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const dec = new TextDecoder();
const local = (n) => n.replace(/^.*:/, "");
const kids = (el, name) => (el ? el.children.filter((c) => local(c.name) === name) : []);
const kid = (el, name) => kids(el, name)[0];
const r3 = (n) => Math.round(n * 1000) / 1000;

/* ---- reading helpers ---- */

/** The cells of a shape (or sheet) by name: { V, F } with V as a number when it is one. */
function cellsOf(sheet) {
  const out = {};
  for (const c of kids(sheet, "Cell")) out[c.attrs.N] = c.attrs.V;
  return out;
}
const num = (v, d = 0) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const color = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/** A Geometry section as SVG path commands in the shape's 0..1 box (y down), and whether it is filled. */
function geometryToPath(section, w, h) {
  if (!section) return null;
  const cells = cellsOf(section);
  if (num(cells.NoShow) === 1) return null;
  const rows = kids(section, "Row").sort((a, b) => num(a.attrs.IX) - num(b.attrs.IX));
  const P = (x, y) => [r3(w ? x / w : 0), r3(h ? 1 - y / h : 0)]; // inches in the box → 0..1, y down
  const R = (x, y) => [r3(x), r3(1 - y)]; // relative rows are fractions already, y up
  let d = "", cur = [0, 0], started = false;
  const move = (p) => { d += `M${p[0]} ${p[1]} `; cur = p; started = true; };
  const line = (p) => { if (!started) move(cur); d += `L${p[0]} ${p[1]} `; cur = p; };
  const sampled = (pts) => pts.forEach(line);
  for (const row of rows) {
    const c = cellsOf(row), t = row.attrs.T;
    if (num(c.Del) === 1) continue;
    const x = num(c.X), y = num(c.Y);
    if (t === "MoveTo") move(P(x, y));
    else if (t === "RelMoveTo") move(R(x, y));
    else if (t === "LineTo") line(P(x, y));
    else if (t === "RelLineTo") line(R(x, y));
    else if (t === "ArcTo") { // a bow of height A from the current point to (x, y)
      const end = P(x, y), a = num(c.A);
      const [x0, y0] = cur, mx = (x0 + end[0]) / 2, my = (y0 + end[1]) / 2, dx = end[0] - x0, dy = end[1] - y0, len = Math.hypot(dx, dy) || 1;
      const ctrl = [mx - (dy / len) * (-a / (h || 1)) * 2, my + (dx / len) * (-a / (h || 1)) * 2];
      const pts = [];
      for (let k = 1; k <= 8; k++) { const s = k / 8, u = 1 - s; pts.push([r3(u * u * x0 + 2 * u * s * ctrl[0] + s * s * end[0]), r3(u * u * y0 + 2 * u * s * ctrl[1] + s * s * end[1])]); }
      sampled(pts);
    } else if (t === "EllipticalArcTo" || t === "RelEllipticalArcTo") { // through the control point (A, B) to (x, y)
      const rel = t === "RelEllipticalArcTo";
      const end = rel ? R(x, y) : P(x, y), ctl = rel ? R(num(c.A), num(c.B)) : P(num(c.A), num(c.B));
      // a circle through three points (current, control, end), sampled; nearly straight arcs become a line
      const [ax, ay] = cur, [bx, by] = ctl, [ex, ey] = end;
      const D = 2 * (ax * (by - ey) + bx * (ey - ay) + ex * (ay - by));
      if (Math.abs(D) < 1e-9) { line(end); continue; }
      const ux = ((ax * ax + ay * ay) * (by - ey) + (bx * bx + by * by) * (ey - ay) + (ex * ex + ey * ey) * (ay - by)) / D;
      const uy = ((ax * ax + ay * ay) * (ex - bx) + (bx * bx + by * by) * (ax - ex) + (ex * ex + ey * ey) * (bx - ax)) / D;
      const ang = (px, py) => Math.atan2(py - uy, px - ux), rr = Math.hypot(ax - ux, ay - uy);
      let a0 = ang(ax, ay), a1 = ang(bx, by), a2 = ang(ex, ey);
      const norm = (v) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ccw = norm(a1 - a0) < norm(a2 - a0); // does the control point lie on the counter-clockwise way round?
      const sweep = ccw ? norm(a2 - a0) : -norm(a0 - a2);
      const pts = [];
      for (let k = 1; k <= 12; k++) { const a = a0 + (sweep * k) / 12; pts.push([r3(ux + rr * Math.cos(a)), r3(uy + rr * Math.sin(a))]); }
      sampled(pts);
    } else if (t === "Ellipse") { // centre (X, Y), a point on each axis (A, B) and (C, D)
      const cx = num(c.X), cy = num(c.Y), rx = Math.hypot(num(c.A) - cx, num(c.B) - cy), ry = Math.hypot(num(c.C) - cx, num(c.D) - cy);
      const pts = [];
      for (let k = 0; k <= 24; k++) { const a = (2 * Math.PI * k) / 24; pts.push(P(cx + rx * Math.cos(a), cy + ry * Math.sin(a))); }
      move(pts[0]); sampled(pts.slice(1)); d += "Z ";
    } else if (t === "SplineStart" || t === "SplineKnot" || t === "PolylineTo" || t === "NURBSTo" || t === "RelCubBezTo" || t === "RelQuadBezTo") {
      line(t.startsWith("Rel") ? R(x, y) : P(x, y)); // the end point: close enough for the outline, said in problems
    } else if (t === "InfiniteLine") continue;
  }
  if (!d) return null;
  const closed = Math.hypot(cur[0] - Number(d.match(/^M([\d.-]+)/)?.[1] ?? 0), cur[1] - Number(d.match(/^M[\d.-]+ ([\d.-]+)/)?.[1] ?? 0)) < 1e-3;
  return { d: d.trim() + (closed && !d.trim().endsWith("Z") ? " Z" : ""), filled: num(cells.NoFill) !== 1 };
}

/** A shape's text: the text nodes of <Text>, without its formatting marks. */
const textOf = (shape) => { const t = kid(shape, "Text"); return t ? (t.text + t.children.map((c) => c.text).join("")).replace(/\r\n?/g, "\n").trim() : null; };

/* ---- reading ---- */

/** A WorkSuite diagram from the bytes of a .vsdx: { doc, problems }. */
export async function fromVsdx(bytes) {
  const files = await unzipAsync(bytes);
  const xml = (path) => { const f = files[path]; return f ? parseXml(dec.decode(f)) : null; };
  const rels = (path) => {
    const at = path.lastIndexOf("/"), relPath = `${path.slice(0, at)}/_rels/${path.slice(at + 1)}.rels`, el = xml(relPath), out = {};
    for (const r of kids(el, "Relationship")) out[r.attrs.Id] = { target: new URL(r.attrs.Target, "http://x/" + path).pathname.slice(1), type: r.attrs.Type };
    return out;
  };
  const pagesEl = xml("visio/pages/pages.xml");
  const macros = Object.keys(files).some((f) => /vbaProject\.bin$/i.test(f)); // a .vsdm: the drawing opens, its macros do not
  if (!pagesEl) throw new Error(files["visio/document.xml"] ? "the drawing has no pages" : "not a Visio drawing (.vsdx)");
  const pagesRels = rels("visio/pages/pages.xml");
  const problems = new Set();
  const pendingLinks = []; // hyperlinks: resolved once every page is read, as they may go to a later page

  // masters: their top shapes by master ID (and sub-shapes by ID), for inheritance
  const masters = new Map();
  const mastersEl = xml("visio/masters/masters.xml");
  if (mastersEl) {
    const mrels = rels("visio/masters/masters.xml");
    for (const m of kids(mastersEl, "Master")) {
      const relId = kid(m, "Rel")?.attrs["r:id"];
      const content = relId && mrels[relId] ? xml(mrels[relId].target) : null;
      const shapes = kids(kid(content, "Shapes"), "Shape");
      const byId = new Map(shapes.map((s) => [s.attrs.ID, s]));
      masters.set(m.attrs.ID, { top: shapes[0], byId, name: m.attrs.NameU || m.attrs.Name || "" });
    }
  }

  const pageByVisioId = new Map();
  const doc = newDiagram("Visio drawing");
  doc.pages = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;

  for (const pageEl of kids(pagesEl, "Page")) {
    if (pageEl.attrs.Background === "1") { problems.add("background pages are left out"); continue; }
    const sheet = cellsOf(kid(pageEl, "PageSheet"));
    const pw = num(sheet.PageWidth, 11.69), ph = num(sheet.PageHeight, 8.27);
    const relId = kid(pageEl, "Rel")?.attrs["r:id"];
    const content = relId && pagesRels[relId] ? xml(pagesRels[relId].target) : null;
    const layer = id("l");
    const page = { id: id("p"), name: pageEl.attrs.NameU || pageEl.attrs.Name || `Page ${doc.pages.length + 1}`, width: r3(pw * PT), height: r3(ph * PT), layers: [{ id: layer, name: "Layer 1", visible: true, locked: false }], items: [] };
    const visioToShape = new Map(); // Visio sheet ID → our shape
    pageByVisioId.set(pageEl.attrs.ID, { page, visioToShape });
    const oneD = []; // connectors to place once every shape is known

    const walk = (shapes, offset) => {
      for (const s of shapes) {
        const master = s.attrs.Master ? masters.get(s.attrs.Master) : null;
        const ms = master ? (s.attrs.MasterShape ? master.byId.get(s.attrs.MasterShape) : master.top) : null;
        const c = { ...(ms ? cellsOf(ms) : {}), ...cellsOf(s) };
        const w = num(c.Width), h = num(c.Height);
        const isGroup = s.attrs.Type === "Group";
        const is1D = c.BeginX !== undefined && c.EndX !== undefined && (num(c.ObjType) === 2 || h === 0 || num(c.ObjType) === 0 && master && /connector/i.test(master.name));
        if (is1D) { oneD.push({ s, c, offset }); continue; }
        if (s.attrs.Type === "Foreign") problems.add("pictures are left out");
        const pinX = num(c.PinX) + offset.x, pinY = num(c.PinY) + offset.y;
        const left = pinX - num(c.LocPinX, w / 2), bottom = pinY - num(c.LocPinY, h / 2);
        if (isGroup) { // members are placed relative to the group's own box
          walk(kids(kid(s, "Shapes"), "Shape"), { x: left, y: bottom });
          problems.add("groups are opened up into their shapes");
          continue;
        }
        if (w <= 0 || h <= 0) continue;
        const geoms = (kids(s, "Section").some((x) => x.attrs.N === "Geometry") ? kids(s, "Section") : kids(ms, "Section")).filter((x) => x.attrs.N === "Geometry");
        const paths = geoms.map((g) => geometryToPath(g, w, h)).filter(Boolean);
        if (geoms.some((g) => kids(g, "Row").some((r) => ["SplineStart", "SplineKnot", "NURBSTo", "PolylineTo", "RelCubBezTo", "RelQuadBezTo"].includes(r.attrs.T)))) problems.add("curved outlines (splines, Béziers) are drawn as straight lines between their points");
        const text = textOf(s) ?? (ms ? textOf(ms) : null) ?? "";
        const shape = {
          id: id("s"), kind: "shape", type: paths.length ? "path" : "rect", layer,
          x: r3(left * PT), y: r3((ph - bottom - h) * PT), w: r3(w * PT), h: r3(h * PT),
          rotate: r3((-num(c.Angle) * 180) / Math.PI) + 0, text, style: {}, // + 0: no "-0"
        };
        if (paths.length) shape.path = paths.map((p) => p.d).join(" ");
        if (paths.length && !paths.some((p) => p.filled)) shape.style.fill = "none";
        const fill = color(c.FillForegnd), line = color(c.LineColor);
        if (fill && shape.style.fill !== "none" && num(c.FillPattern, 1) !== 0) shape.style.fill = fill;
        if (num(c.FillPattern, 1) === 0) shape.style.fill = "none";
        if (line) shape.style.line = line;
        if (c.LinePattern !== undefined && num(c.LinePattern) === 0) shape.style.line = "none";
        if (c.LineWeight !== undefined) shape.style.lineWidth = r3(num(c.LineWeight) * PT);
        if (c["Char.Size"] !== undefined) shape.style.fontSize = r3(num(c["Char.Size"]) * PT);
        // shape data: the shape's own Property rows over its master's
        const propRows = (sh) => kids(kids(sh, "Section").find((x) => x.attrs.N === "Property"), "Row").map((r) => ({ attrs: r.attrs, cells: cellsOf(r) }));
        const own = propRows(s), inherited = ms ? propRows(ms) : [];
        const rowsByName = new Map([...inherited, ...own].map((r) => [r.attrs.N, r]));
        const data = fromPropertyRows([...rowsByName.values()]);
        if (data.length) shape.data = data;
        const linkRows = kids(kids(s, "Section").find((x) => x.attrs.N === "Hyperlink"), "Row").map((r) => cellsOf(r));
        if (linkRows.length) pendingLinks.push({ shape, rows: linkRows });
        page.items.push(shape);
        visioToShape.set(s.attrs.ID, shape);
      }
    };
    walk(kids(kid(content, "Shapes"), "Shape"), { x: 0, y: 0 });

    // connectors: their glue from <Connects>, else free ends at their begin and end points
    const glue = new Map(); // connector ID → { begin: shapeId, end: shapeId }
    for (const cn of kids(kid(content, "Connects"), "Connect")) {
      const g = glue.get(cn.attrs.FromSheet) || {};
      if (/^Begin/.test(cn.attrs.FromCell || "")) g.begin = cn.attrs.ToSheet;
      if (/^End/.test(cn.attrs.FromCell || "")) g.end = cn.attrs.ToSheet;
      glue.set(cn.attrs.FromSheet, g);
    }
    for (const { s, c, offset } of oneD) {
      const at = (x, y) => ({ x: r3((num(x) + offset.x) * PT), y: r3((ph - num(y) - offset.y) * PT) });
      const b = at(c.BeginX, c.BeginY), e = at(c.EndX, c.EndY), g = glue.get(s.attrs.ID) || {};
      const end = (shapeVisioId, p) => {
        const target = visioToShape.get(shapeVisioId);
        if (!target) return { x: p.x, y: p.y };
        let best = null;
        for (const cp of connectionPoints(target)) { const q = pointOn(target, cp.fx, cp.fy), dist = Math.hypot(q.x - p.x, q.y - p.y); if (!best || dist < best.dist) best = { point: cp.name, dist }; }
        return { shape: target.id, point: best.point };
      };
      const rows = kids(kids(s, "Section").find((x) => x.attrs.N === "Geometry"), "Row").length;
      const conn = { id: id("c"), kind: "connector", layer, from: end(g.begin, b), to: end(g.end, e), route: rows > 2 ? "elbow" : "straight", text: textOf(s) || "", style: { arrowEnd: num(c.EndArrow) > 0 } };
      const line = color(c.LineColor);
      if (line) conn.style.line = line;
      if (num(c.BeginArrow) > 0) conn.style.arrowStart = true;
      if (c.LineWeight !== undefined) conn.style.lineWidth = r3(num(c.LineWeight) * PT);
      if (num(c.LinePattern, 1) > 1) conn.style.dash = true;
      page.items.push(conn);
    }
    doc.pages.push(page);
  }
  if (!doc.pages.length) throw new Error("the drawing has no foreground pages");
  // comments: visio/comments.xml, by page and shape; each a thread of its own (replies written by WorkSuite stay in its text)
  const commentsEl = xml("visio/comments.xml");
  if (commentsEl) {
    const authors = new Map(kids(kid(commentsEl, "AuthorList"), "AuthorEntry").map((a) => [a.attrs.ID, a.attrs.Name || a.attrs.Initials || "Visio"]));
    for (const ce of kids(kid(commentsEl, "CommentList"), "CommentEntry")) {
      const where = pageByVisioId.get(ce.attrs.PageID), text = (ce.text || "").trim();
      if (!where || !text) continue;
      const at = Number.isNaN(Date.parse(ce.attrs.Date)) ? new Date(0).toISOString() : new Date(ce.attrs.Date).toISOString();
      (where.page.comments ||= []).push({ id: id("m"), target: where.visioToShape.get(ce.attrs.ShapeID)?.id || null, author: String(authors.get(ce.attrs.AuthorID) || "Visio").trim() || "Visio", text: text.slice(0, MAX_TEXT), at, done: ce.attrs.Done === "1" || ce.attrs.Done === "true", replies: [] });
    }
  }
  for (const { shape, rows } of pendingLinks) { const link = fromHyperlinkRows(rows, doc.pages); if (link) shape.link = link; else problems.add("links to other files are left out"); }
  const name = (xml("docProps/core.xml") && kid(xml("docProps/core.xml"), "title")?.text) || "";
  if (name) doc.name = name;
  validate(doc);
  if (macros) problems.add("macros are left out (WorkSuite does not run them)");
  return { doc, problems: [...problems] };
}

/* ---- writing ---- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
// six decimals: inches to a millionth keep positions exact to well under a hundredth of a point
const r6 = (n) => Math.round(n * 1e6) / 1e6 + 0;
const cell = (n, v, u) => `<Cell N="${n}" V="${typeof v === "number" ? r6(v) : esc(v)}"${u ? ` U="${u}"` : ""}/>`;

/**
 * An SVG path (in a w×h box, y down: shapePath output or a stored 0..1 path scaled) as Visio Geometry sections in
 * relative units (fractions of the shape, y up). Curves and arcs are sampled into short lines.
 */
export function pathToGeometry(d, w, h) {
  const toks = d.match(/[MLHVQTCAZmlhvqtcaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let lastQ = null; // the last quadratic control point, for T (a smooth curve that mirrors it)
  const sections = [];
  let rows = [], cur = [0, 0], start = [0, 0], cmd = "", i = 0;
  const rel = ([x, y]) => [r3(w ? x / w : 0), r3(h ? 1 - y / h : 0)];
  const flush = (closed) => { if (rows.length > 1) sections.push({ rows, closed }); rows = []; };
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const C = cmd.toUpperCase();
    if (C !== "Q" && C !== "T") lastQ = null;
    if (C === "Z") { if (rows.length) rows.push({ t: "RelLineTo", p: rel(start) }); flush(true); cur = start; continue; }
    if (C === "M") { flush(false); cur = start = [n(), n()]; rows.push({ t: "RelMoveTo", p: rel(cur) }); cmd = "L"; continue; }
    if (C === "L") { cur = [n(), n()]; rows.push({ t: "RelLineTo", p: rel(cur) }); continue; }
    if (C === "H") { cur = [n(), cur[1]]; rows.push({ t: "RelLineTo", p: rel(cur) }); continue; }
    if (C === "V") { cur = [cur[0], n()]; rows.push({ t: "RelLineTo", p: rel(cur) }); continue; }
    if (C === "Q" || C === "T") {
      const c1 = C === "Q" ? [n(), n()] : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur.slice(), e = [n(), n()], s = cur;
      lastQ = c1;
      for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; rows.push({ t: "RelLineTo", p: rel([u * u * s[0] + 2 * u * t * c1[0] + t * t * e[0], u * u * s[1] + 2 * u * t * c1[1] + t * t * e[1]]) }); }
      cur = e; continue;
    }
    if (C === "C") {
      const c1 = [n(), n()], c2 = [n(), n()], e = [n(), n()], s = cur;
      for (let k = 1; k <= 10; k++) { const t = k / 10, u = 1 - t; rows.push({ t: "RelLineTo", p: rel([u ** 3 * s[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * e[0], u ** 3 * s[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * e[1]]) }); }
      cur = e; continue;
    }
    if (C === "A") { // endpoint arc → centre form (SVG spec F.6.5), sampled
      let rx = Math.abs(n()), ry = Math.abs(n()); const phi = (n() * Math.PI) / 180, large = n(), sweep = n(), e = [n(), n()], [x1, y1] = cur;
      const cp = Math.cos(phi), sp = Math.sin(phi), dx = (x1 - e[0]) / 2, dy = (y1 - e[1]) / 2;
      const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
      const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const sign = large === sweep ? -1 : 1;
      const co = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
      const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
      const cx = cp * cxp - sp * cyp + (x1 + e[0]) / 2, cy = sp * cxp + cp * cyp + (y1 + e[1]) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
      for (let k = 1; k <= 12; k++) { const t = t1 + (dt * k) / 12; rows.push({ t: "RelLineTo", p: rel([cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp]) }); }
      cur = e; continue;
    }
    i++; // anything else: skip a token rather than loop
  }
  flush(false);
  return sections;
}

/**
 * The bytes of a .vsdx for a WorkSuite diagram. outline(shape) gives a shape's SVG path in its w×h box;
 * routeOf(connector, page) gives a connector's route as page points [[x, y], …].
 */
export function toVsdx(doc, outline, routeOf, styleOf = (sh) => sh.style || {}, { template = false } = {}) {
  const authors = [], comments = [];
  const pages = doc.pages.map((page, pi) => {
    const ph = page.height / PT;
    const vid = new Map(); // our id → Visio sheet ID
    let next = 1;
    const shapes = [], connects = [];
    for (const it of page.items) if (it.kind === "shape") vid.set(it.id, next++);
    for (const it of page.items) {
      if (it.kind !== "shape") continue;
      const w = it.w / PT, h = it.h / PT, x = it.x / PT, top = it.y / PT;
      const geo = pathToGeometry(outline(it), it.w, it.h).map((sec, k) =>
        `<Section N="Geometry" IX="${k}">${cell("NoFill", sec.closed && it.style?.fill !== "none" ? 0 : 1)}${cell("NoLine", it.style?.line === "none" ? 1 : 0)}` +
        sec.rows.map((r, j) => `<Row T="${r.t}" IX="${j + 1}">${cell("X", r.p[0])}${cell("Y", r.p[1])}</Row>`).join("") + "</Section>").join("");
      const look = { ...styleOf(it), ...(it.style || {}) };
      const fill = look.fill && look.fill !== "none" ? look.fill : null;
      shapes.push(`<Shape ID="${vid.get(it.id)}" NameU="Shape.${vid.get(it.id)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
        cell("PinX", x + w / 2, "IN") + cell("PinY", ph - top - h / 2, "IN") + cell("Width", w, "IN") + cell("Height", h, "IN") +
        cell("LocPinX", w / 2, "IN") + cell("LocPinY", h / 2, "IN") + cell("Angle", (-(it.rotate || 0) * Math.PI) / 180, "RAD") +
        (fill ? cell("FillForegnd", fill) + cell("FillPattern", 1) : "") + (look.line === "none" ? cell("LinePattern", 0) : look.line ? cell("LineColor", look.line) : "") +
        (it.style?.lineWidth ? cell("LineWeight", it.style.lineWidth / PT, "PT") : "") +
        (it.style?.fontSize ? cell("Char.Size", it.style.fontSize / PT, "PT") : "") +
        geo + toPropertySection(it.data, cell) + toHyperlinkSection(it.link, doc.pages, cell) + (it.text ? `<Text>${esc(it.text)}</Text>` : "") + "</Shape>");
    }
    for (const it of page.items) {
      if (it.kind !== "connector") continue;
      const pts = routeOf(it, page).map(([px, py]) => [px / PT, ph - py / PT]);
      const [bx, by] = pts[0], [ex, ey] = pts[pts.length - 1];
      const len = Math.hypot(ex - bx, ey - by) || 0.01, ang = Math.atan2(ey - by, ex - bx), ca = Math.cos(-ang), sa = Math.sin(-ang);
      const localPts = pts.map(([px, py]) => [(px - bx) * ca - (py - by) * sa, (px - bx) * sa + (py - by) * ca]);
      const id = next++;
      shapes.push(`<Shape ID="${id}" NameU="Connector.${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
        cell("PinX", (bx + ex) / 2, "IN") + cell("PinY", (by + ey) / 2, "IN") + cell("Width", len, "IN") + cell("Height", 0, "IN") +
        cell("LocPinX", len / 2, "IN") + cell("LocPinY", 0, "IN") + cell("Angle", ang, "RAD") +
        cell("BeginX", bx, "IN") + cell("BeginY", by, "IN") + cell("EndX", ex, "IN") + cell("EndY", ey, "IN") + cell("ObjType", 2) +
        // labels stay level, as on the WorkSuite canvas: a text block of their own, centred on the line and turned
        // back by the line's angle (the line's own block is zero high, and turned it would leave the text no room)
        (it.text ? cell("TxtAngle", -ang, "RAD") + cell("TxtWidth", Math.max(1, it.text.length * 0.09), "IN") + cell("TxtHeight", 0.25, "IN") +
          cell("TxtPinX", len / 2, "IN") + cell("TxtPinY", 0, "IN") + cell("TxtLocPinX", Math.max(1, it.text.length * 0.09) / 2, "IN") + cell("TxtLocPinY", 0.125, "IN") : "") +
        (it.style?.arrowEnd !== false ? cell("EndArrow", 4) : "") + (it.style?.arrowStart ? cell("BeginArrow", 4) : "") +
        (it.style?.line ? cell("LineColor", it.style.line) : "") + (it.style?.lineWidth ? cell("LineWeight", it.style.lineWidth / PT, "PT") : "") + (it.style?.dash ? cell("LinePattern", 2) : "") +
        `<Section N="Geometry" IX="0">${cell("NoFill", 1)}` + localPts.map((p, j) => `<Row T="${j ? "LineTo" : "MoveTo"}" IX="${j + 1}">${cell("X", p[0], "IN")}${cell("Y", p[1], "IN")}</Row>`).join("") + "</Section>" +
        (it.text ? `<Text>${esc(it.text)}</Text>` : "") + "</Shape>");
      if (it.from.shape !== undefined && vid.has(it.from.shape)) connects.push(`<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${vid.get(it.from.shape)}" ToCell="PinX" ToPart="3"/>`);
      if (it.to.shape !== undefined && vid.has(it.to.shape)) connects.push(`<Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${vid.get(it.to.shape)}" ToCell="PinX" ToPart="3"/>`);
    }
    // comments (comments.js): Visio keeps one text per comment, so replies follow in it, one line each
    for (const c of page.comments || []) {
      if (!authors.includes(c.author)) authors.push(c.author);
      const text = [c.text, ...c.replies.map((r) => `— ${r.author}: ${r.text}`)].join("\n");
      const shapeAttr = c.target && vid.has(c.target) ? ` ShapeID="${vid.get(c.target)}"` : "";
      comments.push(`<CommentEntry AuthorID="${authors.indexOf(c.author)}" PageID="${pi}"${shapeAttr} Date="${esc(new Date(c.at).toISOString())}" Done="${c.done ? 1 : 0}" CommentID="${comments.length}">${esc(text)}</CommentEntry>`);
    }
    return {
      name: page.name, w: page.width / PT, h: ph,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${shapes.join("")}</Shapes>${connects.length ? `<Connects>${connects.join("")}</Connects>` : ""}</PageContents>`,
      file: `page${pi + 1}.xml`,
    };
  });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zip([
    { name: "[Content_Types].xml", data: head + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.${template ? "template" : "drawing"}.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>${pages.map((p) => `<Override PartName="/visio/pages/${p.file}" ContentType="application/vnd.ms-visio.page+xml"/>`).join("")}${comments.length ? '<Override PartName="/visio/comments.xml" ContentType="application/vnd.ms-visio.comments+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: head + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: head + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(doc.name)}</dc:title><dc:creator>WorkSuite Diagram</dc:creator></cp:coreProperties>` },
    { name: "visio/document.xml", data: head + `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"/><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style">${cell("LineWeight", 0.01041666666666667)}${cell("LineColor", "#000000")}${cell("LinePattern", 1)}${cell("FillForegnd", "#ffffff")}${cell("FillPattern", 1)}${cell("Char.Size", 0.1666666666666667)}${cell("Char.Color", "#000000")}</StyleSheet></StyleSheets></VisioDocument>` },
    { name: "visio/_rels/document.xml.rels", data: head + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>${comments.length ? '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/comments" Target="comments.xml"/>' : ""}</Relationships>` },
    ...(comments.length ? [{ name: "visio/comments.xml", data: head + `<Comments xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><ShowCommentTags>0</ShowCommentTags><AuthorList>${authors.map((a, i) => `<AuthorEntry ID="${i}" Name="${esc(a)}" Initials="${esc(a.split(/\s+/).map((w) => w[0]).join("").slice(0, 3))}" ResolutionID="${esc(a)}"/>`).join("")}</AuthorList><CommentList>${comments.join("")}</CommentList></Comments>` }] : []),
    { name: "visio/pages/pages.xml", data: head + `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">${pages.map((p, i) => `<Page ID="${i}" NameU="${esc(p.name)}" Name="${esc(p.name)}"><PageSheet>${cell("PageWidth", p.w, "IN")}${cell("PageHeight", p.h, "IN")}${cell("DrawingScale", 1, "IN")}${cell("PageScale", 1, "IN")}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`).join("")}</Pages>` },
    { name: "visio/pages/_rels/pages.xml.rels", data: head + `<Relationships xmlns="${NS_PKG}">${pages.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="${p.file}"/>`).join("")}</Relationships>` },
    ...pages.map((p) => ({ name: `visio/pages/${p.file}`, data: p.xml })),
  ]);
}
