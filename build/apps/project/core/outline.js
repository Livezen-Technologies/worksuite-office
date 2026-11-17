/*
 * WorkSuite Project: a plan from an outline (#88, roadmap stage 4). Pure ES module, no DOM.
 *
 * Paste or type one task per line; indent (spaces, tabs, "-", "*" or "1.2" numbering) to put tasks under a
 * summary. At the end of a line, optionally: a duration ("5d", "2w", "3 days"; "milestone" or "0d" for a
 * milestone) and people ("@Nimal", "@Priya 50%"). Tasks under the same summary follow one another (finish to
 * start) unless linkInOrder is false; then the plan is scheduled on the working calendar.
 */
import { newProject, validate } from "./project.js";

const DUR = /\s+(\d+)\s*(d|day|days|w|wk|wks|week|weeks)\s*$/i;
const MILESTONE = /\s+(milestone|0\s*d|0\s*days?)\s*$/i;
const PEOPLE = /\s+@([^@]+?)\s*$/;

/** One line: { depth (raw indent), name, duration | null, milestone, owner }. */
export function parseLine(line) {
  const indent = /^[\t ]*/.exec(line)[0].replace(/\t/g, "    ").length;
  let s = line.trim().replace(/^([-*•]|\d+(\.\d+)*[.)]?)\s+/, (m, _a, _b) => m);
  const numbered = /^(\d+(?:\.\d+)*)[.)]?\s+/.exec(s);
  const depth = numbered ? (numbered[1].split(".").length - 1) * 4 : indent;
  s = s.replace(/^([-*•]|\d+(\.\d+)*[.)]?)\s+/, "");
  const owners = [];
  for (let m; (m = PEOPLE.exec(s)); ) { owners.unshift(m[1].trim()); s = s.slice(0, m.index); }
  let duration = null, milestone = false;
  const ms = MILESTONE.exec(s), d = DUR.exec(s);
  if (ms) { milestone = true; duration = 0; s = s.slice(0, ms.index); }
  else if (d) { duration = Number(d[1]) * (d[2].toLowerCase().startsWith("w") ? 5 : 1); s = s.slice(0, d.index); } // a week is 5 working days
  return { depth, name: s.trim(), duration, milestone, owner: owners.join(", ") };
}

/** A WorkSuite Project document from outline text; throws with the reason when there are no tasks. */
export function outlineToDoc(text, { name = "New plan", start = "2026-01-05", linkInOrder = true } = {}) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).map(parseLine).filter((l) => l.name);
  if (!lines.length) throw new Error("Type one task per line; indent a line to put it under the one above");
  if (lines.length > 2000) throw new Error("The outline has more than 2000 lines");
  const doc = newProject(name, start);
  const stack = []; // raw indents of the open levels
  lines.forEach((l, i) => {
    while (stack.length && l.depth <= stack[stack.length - 1]) stack.pop();
    const level = Math.min(stack.length, i === 0 ? 0 : doc.tasks[i - 1].level + 1);
    stack.length = level;
    stack.push(l.depth);
    const t = { id: "t" + (i + 1), name: l.name, level, start, duration: l.duration ?? 1, progress: 0 };
    if (l.owner) t.owner = l.owner;
    doc.tasks.push(t);
  });
  // tasks with no duration of their own that turn out to be summaries keep 1: the schedule rolls them up
  if (linkInOrder) {
    const isSummary = (i) => i + 1 < doc.tasks.length && doc.tasks[i + 1].level > doc.tasks[i].level;
    // under each parent, link each child to the next child's first task (summaries link through their last leaf)
    const lastLeaf = (i) => { let j = i; while (j + 1 < doc.tasks.length && doc.tasks[j + 1].level > doc.tasks[i].level) j++; return j; };
    const firstLeaf = (i) => { let j = i; while (isSummary(j)) j++; return j; };
    for (let i = 0; i < doc.tasks.length; i++) {
      const lvl = doc.tasks[i].level;
      const after = lastLeaf(i);
      const next = after + 1 < doc.tasks.length && doc.tasks[after + 1].level === lvl ? after + 1 : -1;
      if (next < 0) continue;
      const a = doc.tasks[isSummary(i) ? after : i], b = doc.tasks[firstLeaf(next)];
      if (!doc.links.some((x) => x.from === a.id && x.to === b.id)) doc.links.push({ from: a.id, to: b.id, type: "FS", lag: 0 });
    }
  }
  return validate(doc);
}
