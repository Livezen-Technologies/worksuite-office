import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { checkPage, rulesetOf, issueKey, RULES } from "../apps/diagram/core/rules.js";

const rules = (page) => checkPage(page).map((x) => x.rule).sort();

test("flowchart rules: a sound flowchart passes; loose lines, lone shapes, decisions and dead ends are found", () => {
  const m = new DiagramModel(newDiagram("Refunds"));
  const start = m.addShape({ type: "terminator", x: 20, y: 100, w: 100, h: 50, text: "Start" });
  const check = m.addShape({ type: "rect", x: 160, y: 100, w: 100, h: 50, text: "Check order" });
  const big = m.addShape({ type: "diamond", x: 300, y: 90, w: 120, h: 70, text: "Over 10,000?" });
  const pay = m.addShape({ type: "rect", x: 460, y: 100, w: 100, h: 50, text: "Pay" });
  const ask = m.addShape({ type: "rect", x: 300, y: 220, w: 120, h: 50, text: "Ask manager" });
  const end = m.addShape({ type: "terminator", x: 600, y: 100, w: 100, h: 50, text: "End" });
  m.connect(start, check); m.connect(check, big);
  m.connect(big, pay, { text: "No" }); m.connect(big, ask, { text: "Yes" });
  m.connect(ask, pay); m.connect(pay, end);
  assert.equal(rulesetOf(m.page()), "flowchart");
  assert.deepEqual(checkPage(m.page()), [], "no issues");

  m.set(m.page().items.find((i) => i.kind === "connector" && i.text === "Yes").id, { text: "" });
  assert.deepEqual(rules(m.page()), ["decision-labels"]);
  const lone = m.addShape({ type: "rect", x: 20, y: 400, w: 100, h: 50, text: "Archive" });
  const stuck = m.addShape({ type: "rect", x: 460, y: 300, w: 100, h: 50, text: "" });
  m.connect(ask, stuck);
  const loose = m.connect(pay, { x: 700, y: 300 });
  const found = checkPage(m.page());
  assert.deepEqual(found.map((x) => x.rule).sort(), ["alone", "dead-end", "decision-labels", "loose", "no-text"]);
  assert.equal(found.find((x) => x.rule === "alone").id, lone);
  assert.equal(found.find((x) => x.rule === "alone").text, `${RULES.alone} (Archive)`, "names the shape");
  assert.equal(found.find((x) => x.rule === "loose").id, loose);
  assert.equal(found.find((x) => x.rule === "dead-end").id, stuck);

  const one = new DiagramModel(newDiagram("Short"));
  const a = one.addShape({ type: "rect", x: 0, y: 0, w: 100, h: 50, text: "A" }), d = one.addShape({ type: "diamond", x: 200, y: 0, w: 100, h: 60, text: "OK?" });
  one.connect(a, d);
  assert.deepEqual(rules(one.page()), ["decision-branches", "no-start"]);
  assert.equal(rulesetOf(new DiagramModel(newDiagram("Empty")).page()), null);
  assert.deepEqual(checkPage(new DiagramModel(newDiagram("Empty")).page()), []);
});

test("BPMN rules: start and end events, events the wrong way round, tasks and gateways without flows", () => {
  const m = new DiagramModel(newDiagram("Process"));
  const s = m.addShape({ type: "event", x: 20, y: 100, w: 40, h: 40, text: "" });
  const t = m.addShape({ type: "task", x: 100, y: 85, w: 140, h: 70, text: "Review claim" });
  const g = m.addShape({ type: "gateway", x: 280, y: 92, w: 56, h: 56, text: "" });
  const ok = m.addShape({ type: "task", x: 380, y: 30, w: 140, h: 70, text: "Approve" });
  const no = m.addShape({ type: "task", x: 380, y: 160, w: 140, h: 70, text: "Reject" });
  const e = m.addShape({ type: "endevent", x: 580, y: 100, w: 40, h: 40, text: "" });
  m.connect(s, t); m.connect(t, g); m.connect(g, ok); m.connect(g, no); m.connect(ok, e); m.connect(no, e);
  assert.equal(rulesetOf(m.page()), "bpmn");
  assert.deepEqual(checkPage(m.page()), []);
  m.connect(e, s);
  assert.deepEqual(rules(m.page()), ["end-out", "start-in"]);

  const b = new DiagramModel(newDiagram("Broken"));
  const t1 = b.addShape({ type: "task", x: 0, y: 0, w: 140, h: 70, text: "" });
  const g1 = b.addShape({ type: "gateway", x: 200, y: 0, w: 56, h: 56, text: "" });
  b.addShape({ type: "task", x: 0, y: 200, w: 140, h: 70, text: "Lost" });
  b.connect(t1, g1);
  assert.deepEqual(rules(b.page()), ["alone", "bpmn-end", "bpmn-start", "gateway-flow", "no-text", "task-flow"]);
});

test("ignoring an issue: remembered on the page, one undo step, saved; it can be brought back", () => {
  const m = new DiagramModel(newDiagram("Flow"));
  m.addShape({ type: "terminator", x: 0, y: 0, w: 100, h: 50, text: "Start" });
  const lone = m.addShape({ type: "rect", x: 200, y: 0, w: 100, h: 50, text: "Note to self" });
  const issues = checkPage(m.page());
  const mine = issues.find((x) => x.id === lone);
  m.ignoreIssue(mine);
  assert.deepEqual(m.page().ignore, [issueKey(mine)]);
  assert.ok(!checkPage(m.page()).some((x) => x.id === lone));
  assert.ok(checkPage(m.page(), { all: true }).some((x) => x.id === lone), "still found when all are asked for");
  assert.deepEqual(parse(serialize(m.doc)).pages[0].ignore, [`alone:${lone}`]);
  m.undo();
  assert.equal(m.page().ignore, undefined, "one undo step");
  m.ignoreIssue(mine); m.ignoreIssue(mine, false);
  assert.equal(m.page().ignore, undefined, "brought back");
  const doc = JSON.parse(serialize(m.doc)); doc.pages[0].ignore = "everything";
  assert.throws(() => parse(JSON.stringify(doc)), /ignore is a list/);
});
