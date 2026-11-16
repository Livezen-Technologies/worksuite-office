/*
 * WorkSuite Project: the .wsproj document and its task model (#74, roadmap docs/project-diagram/roadmap.md).
 *
 * Pure ES module, no DOM: the editor (stage 2, #75) and the tests use it alike. It lives outside build/editors/,
 * which patch-pdf-convert.py copies over web-apps.
 *
 * The document (schema version 1), saved as canonical JSON inside the .wsproj zip:
 *   { app: "worksuite.project", v: 1, name, start, tasks: [Task], links: [Link], calendars: [], resources: [] }
 *   Task: { id, name, level (0 = top), start ("YYYY-MM-DD"), duration (days, 0 = milestone), progress (0-100),
 *           owner?, notes? }      tasks are in outline order; a task is a summary when the next task is deeper
 *   Link: { from, to, type: "FS" | "SS" | "FF" | "SF", lag (days) }
 * Stage 2 counts calendar days; working calendars and automatic scheduling come in stage 3 (#83).
 */

export const APP = "worksuite.project";
export const SCHEMA_VERSION = 1;
export const LINK_TYPES = ["FS", "SS", "FF", "SF"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

/* ---- dates (UTC calendar days) ---- */
export const toDay = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
/** a task's finish: the last day it runs (a milestone finishes the day it starts) */
/** With a working calendar (isWork(day) → bool) the duration counts working days, from the first working day. */
export function finishOf(t, isWork = null) {
  if (!isWork) return fromDay(toDay(t.start) + Math.max(0, t.duration - 1));
  let d = toDay(t.start), left = Math.max(0, t.duration - 1), guard = 0;
  while (!isWork(d)) { d++; if (++guard > 3660) throw new Error("the calendar has no working days"); }
  while (left > 0) { d++; if (isWork(d)) left--; if (++guard > 40000) throw new Error("the calendar has too few working days"); }
  return fromDay(d);
}

/* ---- the document ---- */
export function newProject(name = "Project", start = "2026-01-05") {
  return { app: APP, v: SCHEMA_VERSION, name, start, tasks: [], links: [], calendars: [], resources: [] };
}

/** Throws an Error listing every problem; returns the document when it is valid. */
export function validate(doc) {
  const errs = [];
  if (!doc || typeof doc !== "object") throw new Error("not a WorkSuite project");
  if (doc.app !== APP) errs.push("not a WorkSuite project");
  if (doc.v !== SCHEMA_VERSION) errs.push(`schema version ${doc.v} is not ${SCHEMA_VERSION}`);
  if (typeof doc.name !== "string") errs.push("name must be text");
  if (!DATE.test(doc.start || "")) errs.push("start must be a date");
  if (!Array.isArray(doc.tasks) || !Array.isArray(doc.links)) errs.push("tasks and links must be lists");
  const ids = new Set();
  (doc.tasks || []).forEach((t, i) => {
    const at = `task ${i + 1}`;
    if (typeof t.id !== "string" || !t.id) errs.push(`${at}: no id`);
    else if (ids.has(t.id)) errs.push(`${at}: duplicate id ${t.id}`);
    ids.add(t.id);
    if (typeof t.name !== "string") errs.push(`${at}: name must be text`);
    if (!Number.isInteger(t.level) || t.level < 0) errs.push(`${at}: bad level`);
    else if (t.level > (i === 0 ? 0 : doc.tasks[i - 1].level + 1)) errs.push(`${at}: level skips a step`);
    if (!DATE.test(t.start || "")) errs.push(`${at}: start must be a date`);
    if (!Number.isInteger(t.duration) || t.duration < 0) errs.push(`${at}: duration must be whole days`);
    if (!(t.progress >= 0 && t.progress <= 100)) errs.push(`${at}: progress must be 0-100`);
  });
  (doc.links || []).forEach((l, i) => {
    const at = `link ${i + 1}`;
    if (!ids.has(l.from) || !ids.has(l.to)) errs.push(`${at}: unknown task`);
    if (l.from === l.to) errs.push(`${at}: a task cannot depend on itself`);
    if (!LINK_TYPES.includes(l.type)) errs.push(`${at}: type must be one of ${LINK_TYPES.join(", ")}`);
    if (!Number.isInteger(l.lag)) errs.push(`${at}: lag must be whole days`);
  });
  if (!errs.length && hasCycle(doc.links)) errs.push("the links form a loop");
  if (errs.length) throw new Error(errs.join("; "));
  return doc;
}

/** Brings an older document up to SCHEMA_VERSION; refuses a newer one (made by a later WorkSuite). */
export function migrate(doc) {
  if (!doc || doc.app !== APP) throw new Error("not a WorkSuite project");
  if (doc.v > SCHEMA_VERSION) throw new Error(`made by a newer WorkSuite Office (schema ${doc.v}); update to open it`);
  // v1 is the first version: nothing to migrate yet
  return doc;
}

/* canonical JSON: keys sorted, so the same project always saves to the same bytes */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])]));
  return v;
}
export const serialize = (doc) => JSON.stringify(canon(validate(doc)), null, 1) + "\n";
export const parse = (text) => validate(migrate(JSON.parse(text)));

/* ---- links ---- */
export function hasCycle(links) {
  const next = new Map();
  for (const l of links) (next.get(l.from) || next.set(l.from, []).get(l.from)).push(l.to);
  const state = new Map(); // 1 visiting, 2 done
  const visit = (n) => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const m of next.get(n) || []) if (visit(m)) return true;
    state.set(n, 2);
    return false;
  };
  return [...next.keys()].some(visit);
}

/* ---- the model: edits with undo and redo ---- */
export class ProjectModel {
  constructor(doc = newProject()) {
    this.doc = validate(structuredClone(migrate(doc)));
    this.undoStack = [];
    this.redoStack = [];
    this.isWork = null; // a working calendar's isWork(day): durations then count working days (stage 3, schedule.js)
    this.seq = this.doc.tasks.reduce((m, t) => Math.max(m, Number(String(t.id).replace(/\D/g, "")) || 0), 0);
  }

  /* every edit goes through here: it applies fn to a copy, validates it, and keeps the old state for undo */
  edit(fn) {
    const before = structuredClone(this.doc);
    const draft = structuredClone(this.doc);
    fn(draft);
    validate(draft); // throws, leaving the model unchanged
    this.undoStack.push(before);
    this.redoStack = [];
    this.doc = draft;
    return this;
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.doc); this.doc = this.undoStack.pop(); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.doc); this.doc = this.redoStack.pop(); return true; }

  get tasks() { return this.doc.tasks; }
  indexOf(id) { const i = this.doc.tasks.findIndex((t) => t.id === id); if (i < 0) throw new Error("no task " + id); return i; }
  task(id) { return this.doc.tasks[this.indexOf(id)]; }
  isSummary(id) { const i = this.indexOf(id), t = this.doc.tasks; return i + 1 < t.length && t[i + 1].level > t[i].level; }
  /** the index just past a task's subtree */
  endOf(tasks, i) { let j = i + 1; while (j < tasks.length && tasks[j].level > tasks[i].level) j++; return j; }

  /** Adds a task after `afterId` (at the same level), or at the end; returns its id. */
  addTask(fields = {}, afterId = null) {
    const id = "t" + ++this.seq;
    this.edit((d) => {
      let at = d.tasks.length, level = 0;
      if (afterId) { const i = d.tasks.findIndex((t) => t.id === afterId); at = this.endOf(d.tasks, i); level = d.tasks[i].level; }
      d.tasks.splice(at, 0, { id, name: "New task", level, start: d.start, duration: 1, progress: 0, ...fields, ...(fields.level === undefined ? { level } : {}) });
    });
    return id;
  }
  addMilestone(fields = {}, afterId = null) { return this.addTask({ name: "Milestone", ...fields, duration: 0 }, afterId); }

  /** Removes a task with its subtasks and every link to them. */
  removeTask(id) {
    return this.edit((d) => {
      const i = d.tasks.findIndex((t) => t.id === id);
      const gone = new Set(d.tasks.splice(i, this.endOf(d.tasks, i) - i).map((t) => t.id));
      d.links = d.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
    });
  }

  set(id, fields) { return this.edit((d) => Object.assign(d.tasks.find((t) => t.id === id), fields)); }

  /** Indent: the task (and its subtasks) goes one level deeper, under the task above. */
  indent(id) {
    return this.edit((d) => {
      const i = d.tasks.findIndex((t) => t.id === id);
      if (i === 0 || d.tasks[i - 1].level < d.tasks[i].level) throw new Error("nothing above to indent under");
      for (let j = i, e = this.endOf(d.tasks, i); j < e; j++) d.tasks[j].level++;
    });
  }
  /** Outdent: the task (and its subtasks) comes up one level. */
  outdent(id) {
    return this.edit((d) => {
      const i = d.tasks.findIndex((t) => t.id === id);
      if (d.tasks[i].level === 0) throw new Error("already at the top level");
      for (let j = i, e = this.endOf(d.tasks, i); j < e; j++) d.tasks[j].level--;
    });
  }

  link(from, to, type = "FS", lag = 0) {
    return this.edit((d) => {
      if (d.links.some((l) => l.from === from && l.to === to)) throw new Error("already linked");
      d.links.push({ from, to, type, lag });
    });
  }
  unlink(from, to) { return this.edit((d) => { d.links = d.links.filter((l) => !(l.from === from && l.to === to)); }); }

  /** What the grid and chart show for a task: summaries roll up their subtasks' dates and progress. */
  view(id) {
    const tasks = this.doc.tasks, i = this.indexOf(id), t = tasks[i];
    const finish = finishOf(t, this.isWork);
    if (!this.isSummary(id)) return { ...t, finish, summary: false, milestone: t.duration === 0 };
    const kids = tasks.slice(i + 1, this.endOf(tasks, i)).filter((k, n, all) => !(n + 1 < all.length && all[n + 1].level > k.level));
    const s = Math.min(...kids.map((k) => toDay(k.start)));
    const f = Math.max(...kids.map((k) => toDay(finishOf(k, this.isWork))));
    const weight = kids.reduce((a, k) => a + Math.max(1, k.duration), 0);
    const progress = Math.round(kids.reduce((a, k) => a + k.progress * Math.max(1, k.duration), 0) / weight);
    let duration = f - s + 1;
    if (this.isWork) { duration = 0; for (let d = s; d <= f; d++) if (this.isWork(d)) duration++; }
    return { ...t, start: fromDay(s), finish: fromDay(f), duration, progress, summary: true, milestone: false };
  }
}
