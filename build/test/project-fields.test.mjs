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

test("material and cost resources: amounts in brackets, costs by type, no hours or workload, through Project XML", async () => {
  const { assignmentsOf, ownerText, overallocations } = await import("../apps/project/core/resources.js");
  const { costs, resourceSheet } = await import("../apps/project/core/costs.js");
  const { toProjectXml, fromProjectXml } = await import("../apps/project/core/projectxml.js");
  const t = { owner: "Ravi, Cement [20], Permit fee [15000]" };
  assert.deepEqual(assignmentsOf(t), [{ name: "Ravi", units: 1 }, { name: "Cement", units: 0, amount: 20 }, { name: "Permit fee", units: 0, amount: 15000 }]);
  assert.equal(ownerText(assignmentsOf(t)), t.owner);
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "Slab", level: 0, start: "2026-02-02", duration: 2, progress: 0, owner: "Ravi, Cement [20], Permit fee [15000]" });
  m.addTask({ name: "Walls", level: 0, start: "2026-02-02", duration: 2, progress: 0, owner: "Cement [10]" });
  m.setResource("Ravi", { rate: 100 }).setResource("Cement", { type: "material", unit: "bags", rate: 2500, costPerUse: 500 }).setResource("Permit fee", { type: "cost" });
  const id = m.tasks[0].id;
  assert.equal(m.task(id).work ?? 16, 16, "Ravi's hours only");
  assert.equal(costs(m.doc).byId.get(id), 16 * 100 + 20 * 2500 + 500 + 15000);
  const sheet = Object.fromEntries(resourceSheet(m.doc).map((r) => [r.name, [r.type, r.work, r.cost]]));
  assert.deepEqual(sheet, { Cement: ["material", 30, 76000], "Permit fee": ["cost", 0, 15000], Ravi: ["work", 16, 1600] });
  assert.deepEqual(overallocations(m.doc), [], "materials on two tasks at once are not over-allocated");
  m.set(id, { duration: 4 });
  assert.match(m.task(id).owner, /Cement \[20\]/, "a duration change keeps the amounts");
  const { doc, problems } = fromProjectXml(toProjectXml(m.doc));
  assert.deepEqual(problems, []);
  assert.equal(doc.tasks[0].owner, "Ravi, Cement [20], Permit fee [15000]");
  assert.deepEqual(doc.resources.find((r) => r.name === "Cement"), { name: "Cement", type: "material", unit: "bags", rate: 2500, costPerUse: 500 });
  assert.equal(doc.resources.find((r) => r.name === "Permit fee").type, "cost");
  assert.equal(costs(doc).total, costs(m.doc).total);
});

test("split tasks: pauses push the finish out, keep the duration, are not worked, and follow the scheduler", async () => {
  const { finishOf, segmentsOf, workDays, toDay } = await import("../apps/project/core/project.js");
  const { schedule, STANDARD } = await import("../apps/project/core/schedule.js");
  const { overallocations } = await import("../apps/project/core/resources.js");
  const isWork = STANDARD.isWork;
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.isWork = isWork;
  m.addTask({ name: "Paint", level: 0, start: "2026-02-02", duration: 4, progress: 0, owner: "Ravi" }); // Mon-Thu
  m.addTask({ name: "Other", level: 0, start: "2026-02-04", duration: 2, progress: 0, owner: "Ravi" }); // Wed-Thu
  const [a, b] = m.tasks.map((t) => t.id);
  assert.equal(overallocations(m.doc, isWork).length, 1);
  m.split(a, 2, 2); // Mon Tue | pause Wed Thu | Fri Mon
  const t = m.task(a);
  assert.equal(t.duration, 4);
  assert.equal(finishOf(t, isWork), "2026-02-09");
  assert.deepEqual(segmentsOf(t, isWork), [{ start: "2026-02-02", finish: "2026-02-03" }, { start: "2026-02-06", finish: "2026-02-09" }]);
  assert.equal(workDays(t, isWork).length, 4);
  assert.deepEqual(overallocations(m.doc, isWork), [], "Ravi does Other during the pause");
  m.link(a, b, "FS", 0);
  const s = schedule(m.doc, STANDARD);
  assert.equal(s.tasks[b].start, "2026-02-10", "the successor waits for the end of the last piece");
  assert.throws(() => m.split(a, 4, 1), /after 1 to 3 days/);
  m.set(a, { duration: 2 });
  assert.equal(m.task(a).splits, undefined, "a pause past the new duration is dropped");
  m.undo(); m.unsplit(a);
  assert.equal(finishOf(m.task(a), isWork), "2026-02-05");
  void toDay;
});

test("task calendars: every day and Mon-Sat tasks finish by their own days; the scheduler and successors follow", async () => {
  const { finishOf, workDays } = await import("../apps/project/core/project.js");
  const { schedule, STANDARD } = await import("../apps/project/core/schedule.js");
  const isWork = STANDARD.isWork;
  const cure = { start: "2026-02-05", duration: 4, calendar: "7d" }; // Thu Fri Sat Sun
  assert.equal(finishOf(cure, isWork), "2026-02-08");
  assert.equal(finishOf({ ...cure, calendar: "6d" }, isWork), "2026-02-09", "Thu Fri Sat Mon");
  assert.equal(finishOf({ ...cure, calendar: undefined }, isWork), "2026-02-10");
  assert.equal(workDays(cure, isWork).length, 4);
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.isWork = isWork;
  m.addTask({ name: "Pour", level: 0, start: "2026-02-02", duration: 4, progress: 0 }); // Mon-Thu
  m.addTask({ name: "Cure", level: 0, start: "2026-02-02", duration: 4, progress: 0 });
  m.addTask({ name: "Strip", level: 0, start: "2026-02-02", duration: 1, progress: 0 });
  const [a, b, c] = m.tasks.map((t) => t.id);
  m.link(a, b, "FS", 0).link(b, c, "FS", 0);
  m.edit((d) => { d.tasks[1].calendar = "7d"; });
  const s = schedule(m.doc, STANDARD);
  assert.deepEqual([s.tasks[b].start, s.tasks[b].finish], ["2026-02-06", "2026-02-09"], "Fri Sat Sun Mon");
  assert.equal(s.tasks[c].start, "2026-02-10");
  m.edit((d) => { d.tasks[1].start = "2026-02-06"; d.tasks[2].start = "2026-02-02"; });
  const s2 = schedule(m.doc, STANDARD);
  m.edit((d) => { d.tasks[1].start = "2026-02-05"; });
  assert.equal(schedule(m.doc, STANDARD).tasks[c].start, s2.tasks[c].start, "links decide, not the stored start");
  m.edit((d) => { d.tasks[2].duration = 0; d.tasks[1].duration = 2; }); // Cure Fri Sat → Strip (milestone) on Mon
  assert.equal(schedule(m.doc, STANDARD).tasks[c].start, "2026-02-09");
  assert.equal(schedule(m.doc, STANDARD).finish, "2026-02-09");
  assert.throws(() => m.edit((d) => { d.tasks[0].calendar = "24h"; }), /calendar must be one of/);
});

test("max units: a part-timer is over-allocated sooner, a crew of three later; levelling and Project XML follow", async () => {
  const { overallocations, weeklyLoad, maxUnitsOf } = await import("../apps/project/core/resources.js");
  const { toProjectXml, fromProjectXml } = await import("../apps/project/core/projectxml.js");
  const { usage } = await import("../apps/project/editor/views.js");
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  m.addTask({ name: "A", level: 0, start: "2026-02-02", duration: 2, progress: 0, owner: "Priya 75%, Crew 200%" });
  assert.equal(overallocations(m.doc).length, 1, "the crew at 200% is over one person");
  m.setResource("Crew", { maxUnits: 3 }).setResource("Priya", { maxUnits: 0.5 });
  assert.deepEqual(overallocations(m.doc).map((o) => [o.name, o.peak, o.max]), [["Priya", 0.75, 0.5]]);
  assert.equal(weeklyLoad(m.doc).find((r) => r.name === "Crew").max, 3);
  assert.deepEqual([...usage(m.doc, null, "resource").rows.find((r) => r.name === "Priya").over].length, 1);
  assert.equal(usage(m.doc, null, "resource").rows.find((r) => r.name === "Crew").over.size, 0);
  m.setResource("Priya", { maxUnits: 1 });
  assert.equal(maxUnitsOf(m.doc, "Priya"), 1);
  assert.equal(m.doc.resources.find((r) => r.name === "Priya"), undefined, "100% is the default: no row kept");
  const { doc } = fromProjectXml(toProjectXml(m.doc));
  assert.equal(maxUnitsOf(doc, "Crew"), 3);
  assert.throws(() => m.setResource("Crew", { maxUnits: -1 }), /max units must be more than 0/);
});
