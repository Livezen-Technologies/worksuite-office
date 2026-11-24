import { test } from "node:test";
import assert from "node:assert/strict";
import { computeData, shapeText, withComputed, isFormula, formulaError } from "../apps/diagram/core/smart.js";
import { graphicFor } from "../apps/diagram/core/datagraphics.js";

const shape = (data, extra = {}) => ({ id: "s1", kind: "shape", type: "rect", x: 0, y: 0, w: 120, h: 60, text: "", data, ...extra });

test("formulas: read other data and the shape, chain, and report cycles and errors", () => {
  const s = shape([
    { label: "Qty", value: 4 }, { label: "Price", value: 2500 },
    { label: "Total", value: "=[Qty] * [Price]" }, { label: "With tax", value: "=[Total] * 1.18" },
    { label: "Status", value: '=IIf([Total] > 5000, "Approve", "OK")' },
    { label: "Loop A", value: "=[Loop B] + 1" }, { label: "Loop B", value: "=[Loop A] + 1" },
    { label: "Bad", value: "=[Qty] *" }, { label: "Missing", value: "=[Nope] + 1" },
  ]);
  const v = Object.fromEntries(computeData(s).map((d) => [d.label, d.value]));
  assert.equal(v.Total, 10000);
  assert.equal(v["With tax"], 11800, "a formula can use another formula's result");
  assert.equal(v.Status, "Approve");
  assert.equal(v["Loop A"], "#CYCLE");
  assert.match(v.Bad, /^#ERROR/);
  assert.match(v.Missing, /#ERROR no data called Nope/);
  assert.equal(v.Qty, 4, "plain values stay as they are");
  assert.ok(isFormula("=1") && !isFormula("1"));
  assert.equal(formulaError("=[Qty] * 2"), "");
  assert.notEqual(formulaError("=(("), "");
});

test("built-ins: Width and Height in real units under a drawing scale, Text and Page", () => {
  const s = shape([{ label: "Area", value: "=[Width] * [Height]" }, { label: "Where", value: '=[Page] & ": " & [Text]' }], { w: 720 / 25.4 * 4, h: 720 / 25.4 * 3, text: "Kitchen" });
  const page = { name: "Ground floor", scale: { paper: 1, paperUnit: "cm", real: 1, realUnit: "m" } };
  const v = Object.fromEntries(computeData(s, page).map((d) => [d.label, d.value]));
  assert.equal(v.Area, 12, "4 m × 3 m");
  assert.equal(v.Where, "Ground floor: Kitchen");
});

test("text fields show data, worked out; unknown fields stay; data graphics read formula results", () => {
  const s = shape([{ label: "Name", value: "Anura Perera" }, { label: "Role", value: "Director" }, { label: "Reports", value: 3 }, { label: "Load", value: '=IIf([Reports] > 2, "High", "Normal")' }], { text: "{Name}\n{Role} · {Load} · {Unknown}" });
  assert.equal(shapeText(s), "Anura Perera\nDirector · High · {Unknown}");
  assert.equal(shapeText(shape([], { text: "Plain" })), "Plain");
  const g = { field: "Load", rules: 'red if = "High"; green', fill: true };
  assert.equal(graphicFor(withComputed(s, {}), g).fill, graphicFor({ ...s, data: [{ label: "Load", value: "High" }] }, g).fill);
  assert.equal(withComputed(shape([{ label: "A", value: 1 }])).data[0].value, 1);
});
