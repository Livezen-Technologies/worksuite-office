import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { carried, leader, containerMembers, CONTAINER_HEADER, CONTAINER_PAD } from "../apps/diagram/core/container.js";

test("containers: around the selected shapes and behind them; their shapes (and nested containers' shapes) move with them", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const a = m.addShape({ type: "rect", x: 100, y: 100, w: 100, h: 50, text: "A" });
  const b = m.addShape({ type: "rect", x: 260, y: 140, w: 100, h: 50, text: "B" });
  const out = m.addShape({ type: "rect", x: 600, y: 100, w: 100, h: 50, text: "Out" });
  const c = m.addContainer([a, b], "Team A");
  const box = m.item(c);
  assert.deepEqual([box.x, box.y, box.w, box.h], [100 - CONTAINER_PAD, 100 - CONTAINER_PAD - CONTAINER_HEADER, 260 + 2 * CONTAINER_PAD, 90 + 2 * CONTAINER_PAD + CONTAINER_HEADER]);
  assert.equal(m.page().items[0].id, c, "behind its shapes");
  const outer = m.addContainer([c], "Department");
  assert.deepEqual(containerMembers(m.page().items, m.item(outer)).map((s) => s.text).sort(), ["A", "B", "Team A"]);
  assert.deepEqual(carried(m.page().items, [m.item(c)]).map((s) => s.text).sort(), ["A", "B", "Team A"]);
  assert.ok(!carried(m.page().items, [m.item(outer)]).some((s) => s.id === out));
  assert.equal(parse(serialize(m.doc)).pages[0].items.filter((i) => i.type === "container").length, 2);
  assert.throws(() => m.addContainer([]), /select the shapes/);
});

test("callouts: next to their shape with a leader line; a removed target leaves a plain note", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  const a = m.addShape({ type: "rect", x: 100, y: 200, w: 100, h: 50, text: "A" });
  const n = m.addCallout(a, "Check this");
  const note = m.item(n);
  assert.equal(note.target, a);
  const [from, to] = leader(note, m.item(a));
  assert.ok(from.x <= note.x + 0.001 || from.y >= note.y + note.h - 0.001, "the line leaves the note's edge facing the shape");
  assert.ok(to.x >= 200 - 0.001 || to.y <= 200 + 0.001, "and reaches the shape's edge");
  m.remove([a]);
  assert.equal(m.item(n).target, undefined);
  assert.throws(() => m.edit((d) => { d.pages[0].items[0].target = "zz"; }), /callout target is not on the page/);
});

test("the cloud library's Container shape is its own type, and files from 10.1.89 to 10.1.91 are put right on opening", async () => {
  const { LIBRARIES, shapePath } = await import("../apps/diagram/editor/geometry.js");
  const cloud = LIBRARIES.find((l) => l.id === "cloud").shapes.find((s) => s.name === "Container");
  assert.equal(cloud.type, "appcontainer");
  assert.match(shapePath("appcontainer", 64, 70), /^M32 0/);
  const m = new DiagramModel(newDiagram("Cloud"));
  const a = m.addShape({ type: "rect", x: 100, y: 100, w: 100, h: 50 });
  const titled = m.addContainer([a], "Team");
  m.addShape({ type: "rect", x: 400, y: 100, w: 64, h: 70, text: "" });
  const doc = JSON.parse(serialize(m.doc));
  doc.pages[0].items.at(-1).type = "container"; // as 10.1.89 to 10.1.91 saved a cloud container
  const back = parse(JSON.stringify(doc));
  assert.equal(back.pages[0].items.at(-1).type, "appcontainer");
  assert.equal(back.pages[0].items.find((i) => i.id === titled).type, "container", "a titled container round shapes stays one");
});
