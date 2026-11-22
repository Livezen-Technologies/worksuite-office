import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormula, evaluate, fieldsUsed, parseIndicators, indicatorFor } from "../apps/project/core/formula.js";
import { fieldValue, fieldIcon } from "../apps/project/core/fields.js";
import { newProject, ProjectModel } from "../apps/project/core/project.js";

const run = (src, vals = {}) => evaluate(parseFormula(src), (n) => { if (!(n in vals)) throw new Error(`there is no field called ${n}`); return vals[n]; }, "2026-02-10");

test("formulas: arithmetic, precedence, text, comparisons, logic and functions", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("(1 + 2) * 3"), 9);
  assert.equal(run("-[A] + 10", { A: 4 }), 6);
  assert.equal(run('[Name] & " (" & [N] & ")"', { Name: "Wiring", N: 2.5 }), "Wiring (2.5)");
  assert.equal(run("[A] >= 3 And Not [B]", { A: 3, B: false }), true);
  assert.equal(run('IIf([P] = 100, "Done", "Open")', { P: 40 }), "Open");
  assert.equal(run("Round([C] / 3, 2)", { C: 10 }), 3.33);
  assert.equal(run("Max(1, [A], 7)", { A: 9 }), 9);
  assert.equal(run('Days([S], "2026-02-20")', { S: "2026-02-10" }), 10);
  assert.equal(run("Days(Today(), [D])", { D: "2026-02-12" }), 2);
  assert.equal(run('[F] > "2026-03-01"', { F: "2026-03-04" }), true, "dates compare in date order");
  assert.equal(run('Left("Colombo", 3) & Upper("x")'), "ColX");
  assert.equal(run('"say ""hi"""'), 'say "hi"');
  assert.deepEqual([...fieldsUsed(parseFormula("[A] + IIf([B], [C], 1)"))], ["A", "B", "C"]);
});

test("formulas: errors are readable, and nothing runs as code", () => {
  assert.throws(() => parseFormula("1 +"), /ends too soon/);
  assert.throws(() => parseFormula("Foo(1)"), /Foo is not a function/);
  assert.throws(() => parseFormula("IIf(1, 2)"), /IIf takes 3 values/);
  assert.throws(() => parseFormula("[Cost"), /not closed/);
  assert.throws(() => parseFormula("alert(1); 2"), /alert is not a function|not understood/);
  assert.throws(() => run("1 / [Z]", { Z: 0 }), /division by zero/);
  assert.throws(() => run("[Nope]"), /no field called Nope/);
});

test("indicators: the first rule that holds gives the icon", () => {
  const r = parseIndicators("red if > 5; yellow if > 0; green");
  assert.deepEqual([indicatorFor(r, 9), indicatorFor(r, 2), indicatorFor(r, 0), indicatorFor(r, undefined)], ["red", "yellow", "green", null]);
  assert.equal(indicatorFor(parseIndicators('flag if = "Late"'), "Late"), "flag");
  assert.equal(indicatorFor(parseIndicators("check if = yes"), true), "check");
  assert.throws(() => parseIndicators("purple if > 1"), /not an icon/);
  assert.throws(() => parseIndicators("red when big"), /not a rule/);
});

test("formula fields: worked out from the task and other fields, typed by the field, not typed in", () => {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "Wiring", level: 0, start: "2026-02-02", duration: 4, progress: 50, deadline: "2026-02-04" });
  const t = m.tasks[0];
  const budget = m.addField("Budget", "number");
  m.setCustom(t.id, budget, 1000);
  const left = m.addField("Left", "number", { formula: "[Budget] * (100 - [% Complete]) / 100", indicators: "red if > 400; green" });
  const slip = m.addField("Slip", "number", { formula: "Days([Deadline], [Finish])" });
  const loop = m.addField("Loop", "number", { formula: "[Loop] + 1" });
  const env = { finish: () => "2026-02-05" };
  const f = (k) => m.doc.fields.find((x) => x.key === k);
  assert.deepEqual(fieldValue(m.doc, m.task(t.id), f(left), env), { value: 500 });
  assert.equal(fieldIcon(f(left), 500), "🔴");
  assert.deepEqual(fieldValue(m.doc, m.task(t.id), f(slip), env), { value: 1 });
  assert.match(fieldValue(m.doc, m.task(t.id), f(loop), env).error, /refers to itself/);
  assert.throws(() => m.setCustom(t.id, left, 3), /worked out by its formula/);
  assert.throws(() => m.addField("Bad", "number", { formula: "[Cost] +" }), /formula: the formula ends too soon/);
  m.updateField(left, { formula: "" });
  assert.equal(f(left).formula, undefined);
});

test("formula fields go through Project XML with their formula and worked-out values", async () => {
  const { toProjectXml, fromProjectXml } = await import("../apps/project/core/projectxml.js");
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "A", level: 0, start: "2026-02-02", duration: 4, progress: 25 });
  m.addField("Remaining", "number", { formula: "100 - [% Complete]" });
  const xml = toProjectXml(m.doc);
  assert.match(xml, /<Alias>Remaining<\/Alias><Formula>100 - \[% Complete\]<\/Formula>/);
  assert.match(xml, /<FieldID>188743767<\/FieldID><Value>75<\/Value>/);
  const { doc } = fromProjectXml(xml);
  assert.equal(doc.fields[0].formula, "100 - [% Complete]");
});

test("a formula with nothing to work from is blank, not 0", () => {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "A", level: 0, start: "2026-02-02", duration: 2, progress: 0 });
  const k = m.addField("Slip", "number", { formula: "Days([Deadline], [Finish])" });
  assert.deepEqual(fieldValue(m.doc, m.tasks[0], m.doc.fields.find((x) => x.key === k), { finish: () => "2026-02-03" }), { value: undefined });
});
