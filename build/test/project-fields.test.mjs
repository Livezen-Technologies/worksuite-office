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
