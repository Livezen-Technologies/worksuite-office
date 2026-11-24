import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { THEMES, VARIANTS, themeColors, themeConnector, borderParts, borderColor, contrast, mix, themeError, pageLookError, BORDER_TITLE_H } from "../apps/diagram/core/theme.js";

test("themes: every theme and variant colours shapes by kind, with text that reads (4.5:1) and outlines that show (3:1)", () => {
  for (const t of THEMES) for (const variant of VARIANTS) {
    const kinds = ["rect", "diamond", "terminator", "database"].map((type) => themeColors({ id: t.id, variant }, type));
    for (const c of kinds) {
      assert.ok(contrast(c.fill, c.text) >= 4.5, `${t.id} ${variant}: text ${c.text} on ${c.fill}`);
      assert.ok(contrast(c.line, "#ffffff") >= 3 || contrast(c.line, c.fill) >= 1.4, `${t.id} ${variant}: outline ${c.line}`);
    }
    assert.notEqual(kinds[0].line, kinds[1].line, `${t.id}: a decision is told apart from a process`);
  }
  const office = { id: "office", variant: "light" };
  assert.equal(themeColors(office, "rect").line, "#2563eb");
  assert.equal(themeColors({ id: "office", variant: "bold" }, "rect").text, "#ffffff");
  assert.equal(themeColors({ id: "office", variant: "outline" }, "rect").fill, "#ffffff");
  for (const own of ["lane", "container", "callout", "wall", "room"]) assert.equal(themeColors(office, own), null, `${own} keeps its own colours`);
  assert.equal(themeColors(undefined, "rect"), null);
  assert.equal(themeConnector(office), "#475569");
  assert.equal(themeConnector(undefined), null);
  assert.equal(mix("#000000", 0.5), "#808080");
  assert.equal(mix("#ffffff", -1), "#000000");
});

test("page look: set on one page or all, one undo step, saved and loaded, removed with null; bad values are refused", () => {
  const m = new DiagramModel(newDiagram("Look"));
  const p1 = m.page().id, p2 = m.addPage();
  m.setLook({ theme: { id: "forest", variant: "bold" } }, [p1, p2]);
  assert.deepEqual(m.doc.pages.map((p) => p.theme?.id), ["forest", "forest"]);
  m.setLook({ background: "#f0f9ff", border: { style: "frame", title: "Order process" } }, [p1]);
  const back = parse(serialize(m.doc));
  assert.equal(back.pages[0].background, "#f0f9ff");
  assert.deepEqual(back.pages[0].border, { style: "frame", title: "Order process" });
  assert.equal(back.pages[1].background, undefined);
  m.undo();
  assert.equal(m.doc.pages[0].border, undefined, "one undo step");
  m.setLook({ theme: null }, [p2]);
  assert.equal(m.doc.pages[1].theme, undefined);
  assert.equal(m.doc.pages[0].theme.variant, "bold", "the other page keeps its theme");

  assert.throws(() => m.setLook({ theme: { id: "neon", variant: "light" } }), /unknown theme neon/);
  assert.throws(() => m.setLook({ theme: { id: "ocean", variant: "loud" } }), /variant is one of light, bold, outline/);
  assert.throws(() => m.setLook({ background: "blue" }), /a background is a colour/);
  assert.throws(() => m.setLook({ border: { style: "wavy" } }), /a border is one of frame, band/);
  assert.throws(() => m.setLook({ border: { style: "band", color: "red" } }), /border's colour/);
  assert.throws(() => m.setLook({ theme: null }, ["nope"]), /no page nope/);
  assert.equal(themeError(undefined), ""); assert.equal(pageLookError({}), "");
});

test("borders: a frame with its title box in the corner, or a band across the top; the colour follows the theme", () => {
  const page = { width: 842, height: 595, border: { style: "frame", title: "Order process" } };
  const f = borderParts(page);
  assert.deepEqual(f.frame, { x: 12, y: 12, w: 818, h: 571 });
  assert.equal(f.titleBox.x + f.titleBox.w, 830, "title box in the bottom right corner of the frame");
  assert.equal(f.titleBox.y + f.titleBox.h, 583);
  assert.equal(f.title.text, "Order process");
  assert.equal(f.color, "#1e3a8a");
  const band = borderParts({ ...page, border: { style: "band", title: "Q3" }, theme: { id: "sunset", variant: "light" } });
  assert.deepEqual(band.band, { x: 0, y: 0, w: 842, h: BORDER_TITLE_H });
  assert.equal(band.color, "#c2410c", "the theme's first accent");
  assert.equal(borderColor({ border: { style: "band", color: "#000000" }, theme: { id: "ocean", variant: "light" } }), "#000000", "its own colour wins");
  assert.equal(borderParts({ ...page, border: { style: "frame" } }).titleBox, null, "no title, no box");
  assert.equal(borderParts({ width: 10, height: 10 }), null);
});
