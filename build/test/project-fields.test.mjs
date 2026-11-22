import { test } from "node:test";
import assert from "node:assert/strict";
import { newProject, ProjectModel, validate } from "../apps/project/core/project.js";
import { parseValue, formatValue, nextFieldKey } from "../apps/project/core/fields.js";

test("custom fields: add, set typed values, remove with their values; undo brings them back", () => {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "A", level: 0, start: "2026-02-02", duration: 2, progress: 0 });
  const id = m.tasks[0].id;
  const sup = m.addField("Supplier", "text"), ok = m.addField("Approved", "flag");
  assert.deepEqual([sup, ok], ["f1", "f2"]);
  m.setCustom(id, sup, "Abans").setCustom(id, ok, true);
  assert.deepEqual(m.task(id).custom, { f1: "Abans", f2: true });
  m.setCustom(id, ok, undefined);
  assert.deepEqual(m.task(id).custom, { f1: "Abans" });
  m.removeField(sup);
  assert.equal(m.task(id).custom, undefined);
  assert.equal(m.doc.fields.length, 1);
  m.undo();
  assert.equal(m.task(id).custom.f1, "Abans");
  assert.throws(() => m.setCustom(id, ok, "yes"), /Approved must be yes or no/);
  assert.throws(() => m.setCustom(id, "f9", 1), /no custom field f9/);
});

test("validate: custom field definitions", () => {
  const d = newProject("P", "2026-02-02");
  d.fields = [{ key: "f1", name: "Budget", type: "money" }];
  assert.throws(() => validate(d), /type is one of/);
  d.fields = [{ key: "f1", name: "A", type: "text" }, { key: "f1", name: "B", type: "text" }];
  assert.throws(() => validate(d), /duplicate custom field f1/);
});

test("parseValue and formatValue by type", () => {
  assert.deepEqual(parseValue("number", "1,250.5"), { value: 1250.5 });
  assert.ok(parseValue("number", "lots").error);
  assert.deepEqual(parseValue("flag", "Yes"), { value: true });
  assert.deepEqual(parseValue("flag", "no"), { value: undefined });
  assert.deepEqual(parseValue("date", "2026-03-01"), { value: "2026-03-01" });
  assert.ok(parseValue("date", "March").error);
  assert.deepEqual(parseValue("text", "  "), { value: undefined });
  assert.equal(formatValue("flag", true), "✓");
  assert.equal(formatValue("date", "2026-03-01", (d) => "D" + d), "D2026-03-01");
  assert.equal(nextFieldKey([{ key: "f1" }, { key: "f4" }]), "f5");
});

test("Project XML: custom fields go out as Text/Number/Date/Flag extended attributes and come back", async () => {
  const { toProjectXml, fromProjectXml } = await import("../apps/project/core/projectxml.js");
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "A", level: 0, start: "2026-02-02", duration: 2, progress: 0 });
  m.addTask({ name: "B", level: 0, start: "2026-02-04", duration: 1, progress: 0 });
  const [a, b] = m.tasks.map((t) => t.id);
  const s = m.addField("Supplier", "text"), n = m.addField("Budget", "number"), d = m.addField("Delivery", "date"), f = m.addField("Approved", "flag"), s2 = m.addField("Code", "text");
  m.setCustom(a, s, "Abans & Co").setCustom(a, n, 1500.5).setCustom(a, d, "2026-02-20").setCustom(a, f, true).setCustom(b, s2, "X-1");
  const xml = toProjectXml(m.doc);
  assert.match(xml, /<FieldID>188743731<\/FieldID><FieldName>Text1<\/FieldName><Alias>Supplier<\/Alias>/);
  assert.match(xml, /<FieldID>188743734<\/FieldID><FieldName>Text2<\/FieldName><Alias>Code<\/Alias>/);
  assert.match(xml, /<FieldID>188743767<\/FieldID><FieldName>Number1/);
  assert.match(xml, /<FieldID>188743945<\/FieldID><FieldName>Date1/);
  assert.match(xml, /<FieldID>188743752<\/FieldID><FieldName>Flag1/);
  assert.match(xml, /<ExtendedAttribute><FieldID>188743731<\/FieldID><Value>Abans &amp; Co<\/Value><\/ExtendedAttribute>/);
  const { doc, problems } = fromProjectXml(xml);
  assert.deepEqual(problems, []);
  assert.deepEqual(doc.fields.map((x) => [x.name, x.type]), [["Supplier", "text"], ["Budget", "number"], ["Delivery", "date"], ["Approved", "flag"], ["Code", "text"]], "in the plan's order");
  const byName = (t) => Object.fromEntries(Object.entries(t.custom || {}).map(([k, v]) => [doc.fields.find((x) => x.key === k).name, v]));
  assert.deepEqual(byName(doc.tasks[0]), { Supplier: "Abans & Co", Budget: 1500.5, Delivery: "2026-02-20", Approved: true });
  assert.deepEqual(byName(doc.tasks[1]), { Code: "X-1" });
});

test("Project XML from Microsoft Project: a field without an alias keeps its own name; unknown fields are skipped", async () => {
  const { fromProjectXml } = await import("../apps/project/core/projectxml.js");
  const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>P</Name><StartDate>2026-02-02T08:00:00</StartDate>
    <ExtendedAttributes><ExtendedAttribute><FieldID>188743769</FieldID><FieldName>Number3</FieldName></ExtendedAttribute><ExtendedAttribute><FieldID>188744529</FieldID><FieldName>Enterprise</FieldName></ExtendedAttribute></ExtendedAttributes>
    <Tasks><Task><UID>1</UID><ID>1</ID><Name>A</Name><OutlineLevel>1</OutlineLevel><Start>2026-02-02T08:00:00</Start><Duration>PT8H0M0S</Duration>
    <ExtendedAttribute><FieldID>188743769</FieldID><Value>42</Value></ExtendedAttribute><ExtendedAttribute><FieldID>188744529</FieldID><Value>9</Value></ExtendedAttribute></Task></Tasks></Project>`;
  const { doc } = fromProjectXml(xml);
  assert.deepEqual(doc.fields, [{ key: "f1", name: "Number3", type: "number" }]);
  assert.deepEqual(doc.tasks[0].custom, { f1: 42 });
});
