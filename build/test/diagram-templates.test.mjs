import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { TEMPLATES, templatePage } from "../apps/diagram/core/templates.js";
import { checkPage } from "../apps/diagram/core/rules.js";

test("every template makes a valid page with fresh ids, and the flowchart and BPMN ones pass Check Diagram", () => {
  const m = new DiagramModel(newDiagram("All"));
  for (const t of TEMPLATES) {
    m.edit((d) => { const p = templatePage(t.id, (x) => m.id(x)); d.pages.push({ id: m.id("p"), ...p }); });
    const page = m.doc.pages.at(-1);
    assert.equal(page.name, t.name);
    assert.ok(page.items.filter((i) => i.kind === "shape").length >= 3, `${t.id} has shapes`);
  }
  const back = parse(serialize(m.doc));
  assert.equal(back.pages.length, TEMPLATES.length + 1, "saves and loads: ids are unique across pages");
  for (const id of ["flowchart", "swimlane", "bpmn"]) {
    const page = back.pages.find((p) => p.name === TEMPLATES.find((t) => t.id === id).name);
    assert.deepEqual(checkPage(page).map((x) => x.rule), [], `${id} follows its rules`);
  }
  assert.throws(() => templatePage("nope", (x) => x), /no template/);
});
