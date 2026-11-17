// Drafting without a model (#88): a diagram from a pasted table, a plan from a pasted outline.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTable, readTable, addTable } from "../apps/diagram/core/fromtable.js";
import { DiagramModel } from "../apps/diagram/core/diagram.js";
import { parseLine, outlineToDoc } from "../apps/project/core/outline.js";
import { ProjectModel } from "../apps/project/core/project.js";
import { applySchedule, STANDARD } from "../apps/project/core/schedule.js";

test("tables: tabs, commas, quotes", () => {
  assert.deepEqual(parseTable("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTable('Name,Reports to\n"Silva, A.",CEO\r\n'), [["Name", "Reports to"], ["Silva, A.", "CEO"]]);
});

test("an org chart from Name, Role, Reports to", () => {
  const t = readTable(parseTable("Name\tRole\tReports to\nAnura\tCEO\t\nBimali\tCFO\tAnura\nChaminda\tCTO\tAnura\nDilan\tDeveloper\tChaminda"));
  assert.equal(t.kind, "org");
  assert.equal(t.nodes.length, 4);
  assert.equal(t.nodes[0].text, "Anura\nCEO");
  assert.deepEqual(t.edges.map((e) => [e.from, e.to]), [["anura", "bimali"], ["anura", "chaminda"], ["chaminda", "dilan"]]);
  const m = new DiagramModel();
  const r = m.edit((d) => addTable(d.pages[0], t, (p) => m.id(p)));
  assert.deepEqual(r, { shapes: 4, connectors: 3, kind: "org" });
  const shapes = m.page().items.filter((i) => i.kind === "shape");
  const top = shapes.find((s) => s.text.startsWith("Anura")), dev = shapes.find((s) => s.text.startsWith("Dilan"));
  assert.ok(dev.y > top.y); // laid out top to bottom
  assert.equal(m.undoStack.length, 1);
});

test("a flowchart from From, To, Label: decisions and start/end shapes", () => {
  const t = readTable(parseTable("From,To,Label\nOrder in,In stock?,\nIn stock?,Ship,Yes\nIn stock?,Back-order,No\nBack-order,Ship,\nShip,Done,"));
  assert.equal(t.kind, "flow");
  const type = (k) => t.nodes.find((n) => n.key === k).type;
  assert.equal(type("order in"), "terminator");
  assert.equal(type("in stock?"), "diamond");
  assert.equal(type("ship"), "rect");
  assert.equal(type("done"), "terminator");
  assert.equal(t.edges.find((e) => e.to === "ship").text, "Yes");
});

test("without a header: an empty last cell means an org chart", () => {
  assert.equal(readTable(parseTable("Anura,\nBimali,Anura")).kind, "org");
  assert.equal(readTable(parseTable("A,B\nB,C")).kind, "flow");
  assert.throws(() => readTable(parseTable("just one column")), /two columns/);
});

test("outline lines: indent, numbering, durations, milestones, people", () => {
  assert.deepEqual(parseLine("    Choose site 4d @Nimal"), { depth: 4, name: "Choose site", duration: 4, milestone: false, owner: "Nimal" });
  assert.deepEqual(parseLine("- Sign lease 2 weeks @Ayesha @Ravi 50%"), { depth: 0, name: "Sign lease", duration: 10, milestone: false, owner: "Ayesha, Ravi 50%" });
  assert.deepEqual(parseLine("1.2 Lease signed milestone"), { depth: 4, name: "Lease signed", duration: 0, milestone: true, owner: "" });
  assert.equal(parseLine("Plan for 2026").name, "Plan for 2026"); // a year is not a duration
});

test("an outline becomes a linked, scheduled plan", () => {
  const doc = outlineToDoc(`Planning
  Choose site 4d @Nimal
  Sign lease 3d @Ayesha
  Lease signed milestone
Fit-out
  Network 6d
  Furniture 8d`, { name: "Office move", start: "2026-02-02" });
  assert.deepEqual(doc.tasks.map((t) => [t.name, t.level, t.duration]), [["Planning", 0, 1], ["Choose site", 1, 4], ["Sign lease", 1, 3], ["Lease signed", 1, 0], ["Fit-out", 0, 1], ["Network", 1, 6], ["Furniture", 1, 8]]);
  const name = (id) => doc.tasks.find((t) => t.id === id).name;
  assert.deepEqual(doc.links.map((l) => `${name(l.from)}>${name(l.to)}`).sort(), ["Choose site>Sign lease", "Sign lease>Lease signed", "Lease signed>Network", "Network>Furniture"].sort());
  const m = new ProjectModel(doc);
  m.isWork = STANDARD.isWork;
  const r = applySchedule(m, STANDARD);
  assert.equal(m.view("t7").finish, r.finish);
  assert.equal(m.task("t6").start, "2026-02-11"); // after 4 + 3 working days from Mon 2 Feb; the milestone takes none
  assert.throws(() => outlineToDoc("   \n"), /one task per line/);
});
