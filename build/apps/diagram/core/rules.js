/*
 * WorkSuite Diagram: diagram validation with rules, for flowcharts and BPMN (roadmap stage 6). Pure ES module, no DOM.
 *
 * checkPage(page) finds the issues on a page: lines left loose, shapes with nothing connected, decisions that do not
 * branch, flows that stop short, a flowchart without a start or end, BPMN events used the wrong way round, and so on.
 * Which rules apply follows from the shapes: a page with BPMN events, tasks or gateways is checked as BPMN, any other
 * page with flowchart shapes as a flowchart. An issue can be ignored; the page remembers it in `ignore`.
 */

export const FLOW = new Set(["rect", "rounded", "diamond", "terminator", "data", "document", "database", "manual", "subprocess"]);
export const BPMN = new Set(["event", "endevent", "task", "gateway"]);
export const RULES = {
  loose: "A line has an end that is not glued to a shape",
  alone: "Nothing is connected to this shape",
  "no-start": "The flowchart has no Start / end shape",
  "decision-branches": "A decision needs two or more ways out",
  "decision-labels": "Label each way out of a decision (Yes, No, …)",
  "dead-end": "Nothing comes after this step",
  "no-text": "This step has no text",
  "bpmn-start": "The process has no start event",
  "bpmn-end": "The process has no end event",
  "start-in": "Nothing flows into a start event",
  "end-out": "Nothing flows out of an end event",
  "gateway-flow": "A gateway splits a flow or joins flows: it needs two ways in or two ways out",
  "task-flow": "A task needs a flow in and a flow out",
};
const named = (s) => (s.text || "").split("\n")[0].trim();

/** Which rules a page is checked with: "bpmn", "flowchart", or null when it has neither kind of shape. */
export function rulesetOf(page) {
  const types = page.items.filter((i) => i.kind === "shape").map((s) => s.type);
  if (types.some((t) => BPMN.has(t))) return "bpmn";
  if (types.some((t) => FLOW.has(t))) return "flowchart";
  return null;
}

/** The key that ignores one issue: its rule and the item it is about. */
export const issueKey = (issue) => `${issue.rule}:${issue.id || ""}`;

/**
 * The issues on a page: [{ rule, id (the shape or line, or null for the page), text }], ignored ones left out
 * unless { all: true }. Each issue's text names the shape when it has text.
 */
export function checkPage(page, { all = false } = {}) {
  const set = rulesetOf(page);
  if (!set) return [];
  const shapes = page.items.filter((i) => i.kind === "shape");
  const conns = page.items.filter((i) => i.kind === "connector");
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const ins = new Map(shapes.map((s) => [s.id, []])), outs = new Map(shapes.map((s) => [s.id, []]));
  for (const c of conns) {
    if (byId.has(c.from?.shape)) outs.get(c.from.shape).push(c);
    if (byId.has(c.to?.shape)) ins.get(c.to.shape).push(c);
  }
  const issues = [];
  const add = (rule, id = null) => {
    const s = id && byId.get(id);
    issues.push({ rule, id, text: RULES[rule] + (s && named(s) ? ` (${named(s)})` : "") });
  };
  for (const c of conns) if (!byId.has(c.from?.shape) || !byId.has(c.to?.shape)) add("loose", c.id);

  if (set === "flowchart") {
    const flow = shapes.filter((s) => FLOW.has(s.type));
    if (flow.length >= 2) {
      if (!flow.some((s) => s.type === "terminator")) add("no-start");
      for (const s of flow) {
        const i = ins.get(s.id).length, o = outs.get(s.id);
        if (!i && !o.length) { add("alone", s.id); continue; }
        if (s.type === "diamond") {
          if (o.length < 2) add("decision-branches", s.id);
          else if (o.some((c) => !(c.text || "").trim())) add("decision-labels", s.id);
        } else if (s.type !== "terminator" && i && !o.length && !["data", "document", "database"].includes(s.type)) add("dead-end", s.id);
      }
    }
    for (const s of flow) if (["rect", "rounded", "diamond", "subprocess"].includes(s.type) && !named(s)) add("no-text", s.id);
  } else {
    const bp = shapes.filter((s) => BPMN.has(s.type));
    if (!bp.some((s) => s.type === "event")) add("bpmn-start");
    if (!bp.some((s) => s.type === "endevent")) add("bpmn-end");
    for (const s of bp) {
      const i = ins.get(s.id).length, o = outs.get(s.id).length;
      if (s.type === "event" && i) add("start-in", s.id);
      if (s.type === "endevent" && o) add("end-out", s.id);
      if (s.type === "task" && (!i || !o)) add(!i && !o ? "alone" : "task-flow", s.id);
      if (s.type === "gateway") { if (!i && !o) add("alone", s.id); else if (i < 2 && o < 2) add("gateway-flow", s.id); }
      if (s.type === "task" && !named(s)) add("no-text", s.id);
    }
  }
  if (all) return issues;
  const ignored = new Set(page.ignore || []);
  return issues.filter((x) => !ignored.has(issueKey(x)));
}

/** Why a page's ignore list is wrong, or "". */
export const ignoreError = (ignore) => (ignore === undefined || (Array.isArray(ignore) && ignore.every((k) => typeof k === "string" && k.includes(":"))) ? "" : "ignore is a list of rule:item keys");
