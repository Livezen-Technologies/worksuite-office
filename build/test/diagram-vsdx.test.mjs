// build/apps/diagram/core/vsdx.js: Visio drawings (#85). A deflated .vsdx shaped like Visio's (a master the shapes
// inherit from, a rotated ellipse, text with formatting marks, a connector glued with <Connects>, a group, a
// picture) is read; WorkSuite diagrams round-trip; and LibreOffice, an independent Visio reader, opens what we
// write and finds its text (when LibreOffice is installed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagramModel, newDiagram } from "../apps/diagram/core/diagram.js";
import { fromVsdx, toVsdx, pathToGeometry } from "../apps/diagram/core/vsdx.js";
import { shapePath, route } from "../apps/diagram/editor/geometry.js";

const NS = 'xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PK = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const C = (n, v) => `<Cell N="${n}" V="${v}"/>`;
const PARTS = {
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  "_rels/.rels": `<Relationships ${PK}><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`,
  "visio/document.xml": `<VisioDocument ${NS}/>`,
  "visio/masters/masters.xml": `<Masters ${NS}><Master ID="2" NameU="Process"><Rel r:id="rId1"/></Master><Master ID="5" NameU="Dynamic connector"><Rel r:id="rId2"/></Master></Masters>`,
  "visio/masters/_rels/masters.xml.rels": `<Relationships ${PK}><Relationship Id="rId1" Target="master1.xml" Type="m"/><Relationship Id="rId2" Target="master2.xml" Type="m"/></Relationships>`,
  "visio/masters/master1.xml": `<MasterContents ${NS}><Shapes><Shape ID="5" Type="Shape">${C("Width", 1.5)}${C("Height", 0.75)}${C("LocPinX", 0.75)}${C("LocPinY", 0.375)}${C("FillForegnd", "#dbeafe")}
    <Section N="Geometry" IX="0"><Row T="RelMoveTo" IX="1">${C("X", 0)}${C("Y", 0)}</Row><Row T="RelLineTo" IX="2">${C("X", 1)}${C("Y", 0)}</Row><Row T="RelLineTo" IX="3">${C("X", 1)}${C("Y", 1)}</Row><Row T="RelLineTo" IX="4">${C("X", 0)}${C("Y", 1)}</Row><Row T="RelLineTo" IX="5">${C("X", 0)}${C("Y", 0)}</Row></Section></Shape></Shapes></MasterContents>`,
  "visio/masters/master2.xml": `<MasterContents ${NS}><Shapes><Shape ID="5" Type="Shape">${C("ObjType", 2)}</Shape></Shapes></MasterContents>`,
  "visio/pages/pages.xml": `<Pages ${NS}><Page ID="0" NameU="Flow"><PageSheet>${C("PageWidth", 8.5)}${C("PageHeight", 11)}</PageSheet><Rel r:id="rId1"/></Page><Page ID="4" NameU="VBackground" Background="1"><Rel r:id="rId2"/></Page></Pages>`,
  "visio/pages/_rels/pages.xml.rels": `<Relationships ${PK}><Relationship Id="rId1" Target="page1.xml" Type="p"/><Relationship Id="rId2" Target="page2.xml" Type="p"/></Relationships>`,
  "visio/pages/page1.xml": `<PageContents ${NS}><Shapes>
    <Shape ID="1" Master="2" Type="Shape">${C("PinX", 2)}${C("PinY", 10)}<Text><cp IX="0"/>Start here</Text></Shape>
    <Shape ID="2" Master="2" Type="Shape">${C("PinX", 2)}${C("PinY", 8)}${C("FillForegnd", "#fef3c7")}${C("LineColor", "#d97706")}${C("LineWeight", 0.0208333)}<Text>Review</Text></Shape>
    <Shape ID="3" Type="Shape">${C("PinX", 5)}${C("PinY", 8)}${C("Width", 1)}${C("Height", 0.5)}${C("Angle", -1.5707963)}
      <Section N="Geometry" IX="0"><Row T="Ellipse" IX="1">${C("X", 0.5)}${C("Y", 0.25)}${C("A", 1)}${C("B", 0.25)}${C("C", 0.5)}${C("D", 0.5)}</Row></Section><Text>Ellipse</Text></Shape>
    <Shape ID="4" Master="5" Type="Shape">${C("BeginX", 2)}${C("BeginY", 9.625)}${C("EndX", 2)}${C("EndY", 8.375)}${C("EndArrow", 13)}
      <Section N="Geometry" IX="0"><Row T="MoveTo" IX="1">${C("X", 0)}${C("Y", 0)}</Row><Row T="LineTo" IX="2">${C("X", 1.25)}${C("Y", 0)}</Row></Section><Text>next</Text></Shape>
    <Shape ID="6" Type="Group">${C("PinX", 6)}${C("PinY", 3)}${C("Width", 2)}${C("Height", 1)}${C("LocPinX", 1)}${C("LocPinY", 0.5)}<Shapes>
      <Shape ID="7" Master="2" Type="Shape">${C("PinX", 0.75)}${C("PinY", 0.5)}<Text>In a group</Text></Shape></Shapes></Shape>
    <Shape ID="8" Type="Foreign">${C("PinX", 1)}${C("PinY", 1)}${C("Width", 1)}${C("Height", 1)}</Shape>
  </Shapes><Connects><Connect FromSheet="4" FromCell="BeginX" ToSheet="1" ToCell="PinX"/><Connect FromSheet="4" FromCell="EndX" ToSheet="2" ToCell="PinX"/></Connects></PageContents>`,
  "visio/pages/page2.xml": `<PageContents ${NS}><Shapes/></PageContents>`,
};

function visioLike() { // a deflated zip, as Visio writes
  const dir = mkdtempSync(join(tmpdir(), "vsdx-"));
  try {
    writeFileSync(join(dir, "parts.json"), JSON.stringify(PARTS));
    execFileSync(process.platform === "win32" ? "python" : "python3", ["-I", "-c",
      "import sys,json,zipfile;p=json.load(open(sys.argv[1],encoding='utf-8'));z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED);[z.writestr(k,v) for k,v in p.items()];z.close()",
      join(dir, "parts.json"), join(dir, "d.vsdx")]);
    return readFileSync(join(dir, "d.vsdx"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a deflated drawing shaped like Visio's", async () => {
  const { doc, problems } = await fromVsdx(visioLike());
  assert.equal(doc.pages.length, 1); // the background page is left out
  const p = doc.pages[0];
  assert.equal(p.name, "Flow");
  assert.deepEqual([p.width, p.height], [612, 792]);
  const shapes = p.items.filter((i) => i.kind === "shape"), byText = (t) => shapes.find((s) => s.text === t);
  const start = byText("Start here");
  assert.deepEqual([start.x, start.y, start.w, start.h], [90, 45, 108, 54]); // master size, PinX/Y in inches, y flipped
  assert.equal(start.type, "path");
  assert.equal(start.style.fill, "#dbeafe"); // from the master
  assert.match(start.path, /^M0 1 L1 1 L1 0 L0 0/); // the master's outline, in the 0..1 box, y down
  const review = byText("Review");
  assert.deepEqual([review.style.fill, review.style.line, review.style.lineWidth], ["#fef3c7", "#d97706", 1.5]);
  assert.equal(byText("Ellipse").rotate, 90);
  assert.ok(byText("In a group")); // groups opened up into their shapes
  assert.deepEqual([byText("In a group").x, byText("In a group").y], [360, 549]); // bottom 2.5 + 0.5 − 0.375 in, so top 11 − 2.625 − 0.75 = 7.625 in
  const conn = p.items.find((i) => i.kind === "connector");
  assert.deepEqual([conn.from.shape, conn.from.point, conn.to.shape, conn.to.point], [start.id, "bottom", review.id, "top"]);
  assert.equal(conn.text, "next");
  assert.equal(conn.style.arrowEnd, true);
  assert.ok(problems.some((x) => /pictures/.test(x)));
  assert.ok(problems.some((x) => /background pages/.test(x)));
});

test("geometry: every outline becomes relative Visio rows, closed outlines closed", () => {
  const secs = pathToGeometry(shapePath("diamond", 100, 60), 100, 60);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].closed, true);
  assert.deepEqual(secs[0].rows[0], { t: "RelMoveTo", p: [0.5, 1] });
  assert.ok(secs[0].rows.every((r) => r.p.every((v) => v >= -0.001 && v <= 1.001)));
  assert.equal(pathToGeometry(shapePath("database", 100, 80), 100, 80).length, 2); // the body and its open top line
  assert.ok(pathToGeometry(shapePath("ellipse", 100, 80), 100, 80)[0].rows.length > 20); // arcs sampled
  // the document shape's wavy edge uses T (a smooth quadratic): it stays inside the box, no stray line
  const doc = pathToGeometry(shapePath("document", 150, 70), 150, 70);
  assert.equal(doc.length, 1);
  assert.ok(doc[0].rows.every((r) => r.p.every((v) => v >= -0.001 && v <= 1.001)), "inside the box");
  assert.ok(doc[0].rows.length > 12, "both curves sampled");
});

function sampleDiagram() {
  const m = new DiagramModel(newDiagram("Leave approval"));
  const a = m.addShape({ type: "terminator", x: 300, y: 20, w: 160, h: 40, text: "ඉල්ලීම & request" });
  const b = m.addShape({ type: "diamond", x: 295, y: 120, w: 170, h: 90, text: "Approve?", style: { fill: "#fef3c7", line: "#d97706" } });
  const c = m.addShape({ type: "rect", x: 560, y: 140, w: 160, h: 50, text: "Ask again", rotate: 15 });
  m.connect(a, b, { text: "send" });
  m.connect(b, c, { route: "elbow", text: "No" });
  m.addPage("Roles");
  return m;
}
const routeOf = (m) => (c, page) => { const e = m.endpoints(c.id, page.id); const side = (x) => (x.shape !== undefined ? x.point : "center"); return route(c.route, e.from, e.to, side(c.from), side(c.to)); };

test("WorkSuite diagrams round-trip through .vsdx", async () => {
  const m = sampleDiagram();
  const bytes = toVsdx(m.doc, (s) => shapePath(s.type, s.w, s.h, s.path), routeOf(m));
  const { doc } = await fromVsdx(bytes);
  assert.equal(doc.name, "Leave approval");
  assert.deepEqual(doc.pages.map((p) => p.name), ["Page 1", "Roles"]);
  const before = m.doc.pages[0].items.filter((i) => i.kind === "shape"), after = doc.pages[0].items.filter((i) => i.kind === "shape");
  assert.deepEqual(after.map((s) => s.text), before.map((s) => s.text));
  for (let k = 0; k < before.length; k++) {
    for (const f of ["x", "y", "w", "h", "rotate"]) assert.ok(Math.abs(after[k][f] - (before[k][f] || 0)) < 0.01, `${before[k].text} ${f}`);
  }
  assert.equal(after[1].style.fill, "#fef3c7");
  const conns = doc.pages[0].items.filter((i) => i.kind === "connector");
  assert.deepEqual(conns.map((c) => [c.text, c.from.shape === after[0].id || c.from.shape === after[1].id]), [["send", true], ["No", true]]);
  assert.equal(conns[1].route, "elbow");
});

test("LibreOffice opens the .vsdx we write and finds its text", { skip: !existsSync("/usr/bin/soffice") && "LibreOffice is not installed" }, () => {
  const m = sampleDiagram();
  const dir = mkdtempSync(join(tmpdir(), "vsdx-lo-"));
  try {
    writeFileSync(join(dir, "leave.vsdx"), toVsdx(m.doc, (s) => shapePath(s.type, s.w, s.h, s.path), routeOf(m)));
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "svg", "--outdir", dir, join(dir, "leave.vsdx")], { stdio: "pipe", timeout: 120000 });
    const svg = readFileSync(join(dir, "leave.svg"), "utf8");
    for (const t of ["Approve?", "Ask again", "send"]) assert.ok(svg.includes(t), t);
    assert.ok((svg.match(/<path/g) || []).length >= 5, "the shapes and connectors are drawn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("not a Visio drawing", async () => {
  const { zip } = await import("../apps/common/zip.js");
  await assert.rejects(fromVsdx(zip([{ name: "a.txt", data: "x" }])), /not a Visio drawing/);
});

test("comments travel through .vsdx: on shapes and the page, replies in the text, resolved kept", async () => {
  const m = new DiagramModel(newDiagram("Reviewed"));
  const a = m.addShape({ type: "rect", x: 40, y: 40, w: 120, h: 60, text: "Step" });
  const c1 = m.addComment(a, "Is this the <right> step?", "Asha Perera", "2026-11-20T09:00:00.000Z");
  m.replyComment(c1, "Yes & it stays", "Ravi", "2026-11-20T10:00:00.000Z");
  const c2 = m.addComment(null, "Page note", "Ravi", "2026-11-21T08:00:00.000Z");
  m.resolveComment(c2);
  const bytes = toVsdx(m.doc, (s) => shapePath(s.type, s.w, s.h, s.path), routeOf(m));
  const { doc } = await fromVsdx(bytes);
  const page = doc.pages[0], shape = page.items.find((i) => i.kind === "shape");
  assert.equal(page.comments.length, 2);
  const [x, y] = page.comments;
  assert.equal(x.target, shape.id);
  assert.equal(x.author, "Asha Perera");
  assert.equal(x.text, "Is this the <right> step?\n— Ravi: Yes & it stays");
  assert.equal(x.at, "2026-11-20T09:00:00.000Z");
  assert.equal(x.done, false);
  assert.equal(y.target, null);
  assert.equal(y.done, true);
  const plain = await fromVsdx(toVsdx(new DiagramModel(newDiagram("None")).doc, (s) => shapePath(s.type, s.w, s.h, s.path), routeOf(m)));
  assert.equal(plain.doc.pages[0].comments, undefined);
});

test("data graphic icons and bars go to .vsdx as shapes; borderless shapes stay borderless", async () => {
  const { graphicFor, graphicShapes } = await import("../apps/diagram/core/datagraphics.js");
  const shape = { id: "s1", kind: "shape", type: "rect", layer: "l1", x: 100, y: 50, w: 112, h: 60, data: [{ label: "Status", value: "Late" }, { label: "Done", value: 25 }] };
  const gfx = graphicFor(shape, { field: "Status", rules: 'red if = "Late"; green', icon: true, bar: { field: "Done", max: 100 } });
  const extra = graphicShapes(shape, gfx);
  assert.deepEqual(extra.map((s) => s.id), ["s1-icon", "s1-bar-bg", "s1-bar"]);
  assert.equal(extra[0].text, "🔴");
  assert.deepEqual([extra[0].x, extra[0].y], [192, 52]);
  assert.deepEqual([extra[1].x, extra[1].y, extra[1].w], [106, 101, 100]);
  assert.equal(extra[2].w, 25);
  assert.deepEqual(graphicShapes(shape, {}), []);
  assert.equal(graphicShapes(shape, { bar: 0 }).length, 1); // an empty bar: the track alone

  const m = new DiagramModel(newDiagram("Bars"));
  m.addShape({ type: "rect", x: 10, y: 10, w: 40, h: 20, text: "x", style: { fill: "#e5e7eb", line: "none" } });
  const { doc } = await fromVsdx(toVsdx(m.doc, (s) => shapePath(s.type, s.w, s.h, s.path), routeOf(m)));
  assert.equal(doc.pages[0].items[0].style.line, "none");
});
