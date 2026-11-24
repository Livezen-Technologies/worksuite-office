import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { PRESETS, PAPERS, UNITS, toReal, fromReal, formatLength, ratioOf, scaleText, scaleError, tiles } from "../apps/diagram/core/scale.js";

const cm1m = { paper: 1, paperUnit: "cm", real: 1, realUnit: "m" };

test("drawing scale: page points to real lengths and back, as people read them", () => {
  assert.ok(Math.abs(toReal(UNITS.cm, cm1m) - 1) < 1e-9, "1 cm on the page is 1 m");
  assert.ok(Math.abs(fromReal(4.25, cm1m) - 4.25 * UNITS.cm) < 1e-9);
  assert.equal(formatLength(fromReal(4.25, cm1m), cm1m), "4.25 m");
  assert.equal(formatLength(UNITS.mm * 50, undefined), "50 mm", "no scale: millimetres on the page");
  const arch = PRESETS.find((p) => p.id === "1/4in").scale;
  assert.equal(formatLength(fromReal(12.5, arch), arch), "12 ft 6 in");
  assert.equal(formatLength(fromReal(11.99, arch), arch), "12 ft");
  assert.equal(ratioOf(cm1m), "1:100");
  assert.equal(ratioOf(arch), "1:48");
  assert.equal(ratioOf(PRESETS.find((p) => p.id === "1:20").scale), "1:20");
  assert.equal(scaleText(cm1m), "1 cm = 1 m (1:100)");
  assert.equal(scaleText(undefined), "No scale (1:1)");
  for (const p of PRESETS) assert.equal(scaleError(p.scale), "", p.id);
  assert.match(scaleError({ paper: 0, paperUnit: "cm", real: 1, realUnit: "m" }), /more than 0/);
  assert.match(scaleError({ paper: 1, paperUnit: "m", real: 1, realUnit: "m" }), /page unit/);
  assert.match(scaleError({ paper: 1, paperUnit: "cm", real: 1, realUnit: "parsec" }), /real unit/);
});

test("a page's scale is saved, undone and checked; a dimension line keeps its own colours", async () => {
  const m = new DiagramModel(newDiagram("Plan"));
  m.setLook({ scale: cm1m });
  assert.deepEqual(parse(serialize(m.doc)).pages[0].scale, cm1m);
  m.undo();
  assert.equal(m.page().scale, undefined);
  assert.throws(() => m.setLook({ scale: { paper: 1, paperUnit: "cm", real: -2, realUnit: "m" } }), /more than 0/);
  const { themeColors } = await import("../apps/diagram/core/theme.js");
  assert.equal(themeColors({ id: "ocean", variant: "bold" }, "dimension"), null);
  const { LIBRARIES, shapePath } = await import("../apps/diagram/editor/geometry.js");
  assert.ok(LIBRARIES.find((l) => l.id === "floor").shapes.some((s) => s.type === "dimension"));
  assert.match(shapePath("dimension", 200, 28), /^M0 22 H200/);
});

test("print tiling: a big page cut into sheets in reading order, the paper turned to need fewer", () => {
  const a4 = PAPERS.A4, margin = 28;
  const one = tiles(500, 700, { paper: a4, margin });
  assert.equal(one.length, 1, "fits one portrait sheet");
  assert.equal(one.landscape, false);
  const plan = tiles(2000, 1000, { paper: a4, margin });
  const tw = a4.h - 2 * margin, th = a4.w - 2 * margin; // landscape
  assert.equal(plan.landscape, true);
  assert.deepEqual([plan.cols, plan.rows], [Math.ceil(2000 / tw), Math.ceil(1000 / th)]);
  assert.equal(plan.length, plan.cols * plan.rows);
  assert.deepEqual(plan.slice(0, 2).map((t) => [t.row, t.col, t.x, t.y]), [[1, 1, 0, 0], [1, 2, tw, 0]]);
  const last = plan.at(-1);
  assert.ok(last.x + last.w >= 2000 && last.y + last.h >= 1000, "the sheets cover the page");
  const exact = tiles(a4.w - 2 * margin, a4.h - 2 * margin, { paper: a4, margin });
  assert.equal(exact.length, 1, "exactly one sheet's worth is one sheet");
});
