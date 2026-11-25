/*
 * WorkSuite Project: the .wsproj document and its task model (#74, roadmap docs/project-diagram/roadmap.md).
 *
 * Pure ES module, no DOM: the editor (stage 2, #75) and the tests use it alike. It lives outside build/editors/,
 * which patch-pdf-convert.py copies over web-apps.
 *
 * The document (schema version 1), saved as canonical JSON inside the .wsproj zip:
 *   { app: "worksuite.project", v: 1, name, start, tasks: [Task], links: [Link], calendars: [], resources: [], fields?: [{ key: "f1", name, type: text|number|date|flag }] }
 *   Task: { id, name, level (0 = top), start ("YYYY-MM-DD"), duration (days, 0 = milestone), progress (0-100),
 *           owner?, notes?, actualStart?, actualFinish?, deadline?, inactive?, type?, work?, effortDriven?, fixedCost?,
 *           priority? (0-1000, default 500), levelDelay? (working days added by resource levelling),
 *           custom? ({ fieldKey: value } for the document's custom fields),
 *           calendar? ("7d" every day, "6d" the project's days and Saturdays; default the project calendar),
 *           splits? ([{ after, days }]: pauses of `days` working days after `after` days of work),
 *           recurring? (on a summary: the pattern its occurrences were made from, recurring.js),
 *           subproject? ({ file, at }: on a summary, the plan file its tasks came from, refreshed from it and saved back to it) }
 *   resources: [{ name, rate (per hour), costPerUse }]   the Resource Sheet, by the names in Owner (costs.js)
 *         type: fixedUnits (default) | fixedWork | fixedDuration; work: person-hours; see tasktypes.js
 *         deadline: a date the task should finish by (it does not move the task; missing it is flagged);
 *         inactive: kept in the plan but not scheduled, rolled up, counted or linked (stage 5)   actual dates: when work really began and ended (#86)
 *   statusDate?: the date progress was last reported on (#86)      tasks are in outline order; a task is a summary when the next task is deeper
 *   budget?: the project's budget, an amount (stage 5)
 *   Link: { from, to, type: "FS" | "SS" | "FF" | "SF", lag (days) }
 * Stage 2 counts calendar days; working calendars and automatic scheduling come in stage 3 (#83).
 */

import { reportError } from "./reports.js";
import { recalc, TASK_TYPES, unitsOf, workOf } from "./tasktypes.js";
import { costs } from "./costs.js";
import { occurrences, patternError } from "./recurring.js";
import { fieldError, valueError, nextFieldKey } from "./fields.js";

export const APP = "worksuite.project";
export const SCHEMA_VERSION = 1;
export const LINK_TYPES = ["FS", "SS", "FF", "SF"];
/** Baselines kept per project (as many as professional planning tools keep). */
export const MAX_BASELINES = 11;
/** Interim plans kept per project: lighter snapshots of each task's start and finish (Interim 1 to 10). */
export const MAX_INTERIMS = 10;
/** A saved baseline or interim plan by name, or null. */
export const snapshotOf = (doc, name) => (doc.baselines || []).find((b) => b.name === name) || (doc.interims || []).find((b) => b.name === name) || null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

/* ---- dates (UTC calendar days) ---- */
export const toDay = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
/** a task's finish: the last day it runs (a milestone finishes the day it starts) */
/** With a working calendar (isWork(day) → bool) the duration counts working days, from the first working day. */
export function finishOf(t, isWork = null) {
  isWork = taskIsWork(t, isWork);
  const gaps = splitDays(t); // a split task's pauses lengthen its span, not its duration
  if (!isWork) return fromDay(toDay(t.start) + Math.max(0, t.duration - 1) + gaps);
  let d = toDay(t.start), left = Math.max(0, t.duration - 1) + gaps, guard = 0;
  while (!isWork(d)) { d++; if (++guard > 3660) throw new Error("the calendar has no working days"); }
  while (left > 0) { d++; if (isWork(d)) left--; if (++guard > 40000) throw new Error("the calendar has too few working days"); }
  return fromDay(d);
}

/* ---- task calendars (stage 5): a task can work other days than the project ---- */
/** The task calendars: every day (curing, a machine running round the clock), or the project's days plus Saturdays. */
export const TASK_CALENDARS = [
  { key: "7d", title: "Every day" },
  { key: "6d", title: "Mon–Sat" },
];
/** The working days a task counts: its own calendar's, else the project's (isWork; null is every day). */
export function taskIsWork(t, isWork = null) {
  if (t.calendar === "7d") return null;
  if (t.calendar === "6d") return isWork ? (d) => isWork(d) || new Date(d * 86400000).getUTCDay() === 6 : null;
  return isWork;
}

/* ---- split tasks (stage 5): work stops for a while and picks up again ---- */
/**
 * A task's pauses, valid ones only, in order: [{ after, days }], `after` working days of work then `days` working days
 * of pause. The duration counts the work; the pauses push the finish out.
 */
export function splitsOf(t) {
  if (!Array.isArray(t.splits) || !(t.duration > 1)) return [];
  return t.splits.filter((x) => Number.isInteger(x?.after) && Number.isInteger(x?.days) && x.after >= 1 && x.after < t.duration && x.days >= 1)
    .sort((a, b) => a.after - b.after).filter((x, i, a) => i === 0 || a[i - 1].after !== x.after);
}
/** The working days a split task is paused for, in all. */
export const splitDays = (t) => splitsOf(t).reduce((n, x) => n + x.days, 0);
/** What is wrong with a task's splits, or null. */
export function splitsError(t) {
  if (t.splits === undefined) return null;
  if (!Array.isArray(t.splits) || !t.splits.length) return "splits must be a list of pauses";
  if (!(t.duration > 1)) return "only a task of 2 days or more can be split";
  const seen = new Set();
  for (const x of t.splits) {
    if (!Number.isInteger(x?.after) || x.after < 1 || x.after >= t.duration) return `a split comes after 1 to ${t.duration - 1} days of work`;
    if (!Number.isInteger(x?.days) || x.days < 1) return "a split pauses for whole working days, 1 or more";
    if (seen.has(x.after)) return `two splits after day ${x.after}`;
    seen.add(x.after);
  }
  return null;
}
/** The days a task is worked (day numbers), its pauses and non-working days left out. */
export function workDays(t, isWork = null) {
  isWork = taskIsWork(t, isWork);
  const out = [], pauses = new Map(splitsOf(t).map((x) => [x.after, x.days]));
  let d = toDay(t.start), worked = 0, guard = 0;
  while (worked < Math.max(1, t.duration)) {
    if (!isWork || isWork(d)) {
      out.push(d); worked++;
      if (pauses.has(worked)) { let p = pauses.get(worked); while (p > 0) { d++; if (!isWork || isWork(d)) p--; if (++guard > 40000) break; } }
    }
    d++;
    if (++guard > 40000) throw new Error("the calendar has too few working days");
  }
  return t.duration === 0 ? out.slice(0, 1) : out;
}
/** A task's pieces of work: [{ start, finish }] (one piece unless it is split). */
export function segmentsOf(t, isWork = null) {
  const days = workDays(t, isWork), out = [], pauseAfter = new Set(splitsOf(t).map((x) => x.after));
  let from = days[0];
  days.forEach((d, i) => { if (pauseAfter.has(i + 1) || i === days.length - 1) { out.push({ start: fromDay(from), finish: fromDay(d) }); from = days[i + 1]; } });
  return out;
}

/* ---- WBS codes: 1, 1.1, 1.2, 2 … from the outline ---- */
export function wbsCodes(tasks) {
  const counts = [], out = new Map();
  for (const t of tasks) {
    counts.length = t.level + 1;
    counts[t.level] = (counts[t.level] || 0) + 1;
    out.set(t.id, counts.map((n) => n || 1).join("."));
  }
  return out;
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
  if (doc.fields !== undefined) {
    if (!Array.isArray(doc.fields)) errs.push("custom fields must be a list");
    else { const keys = new Set(); for (const f of doc.fields) { if (fieldError(f)) errs.push(fieldError(f)); else if (keys.has(f.key)) errs.push(`duplicate custom field ${f.key}`); keys.add(f?.key); } }
  }
  if (doc.reports !== undefined) {
    if (!Array.isArray(doc.reports)) errs.push("reports must be a list");
    else { const ids = new Set(); for (const r of doc.reports) { const e = reportError(r, doc.fields || []); if (e) errs.push(e); else if (ids.has(r.id)) errs.push(`duplicate report ${r.id}`); ids.add(r?.id); } }
  }
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
    for (const k of ["actualStart", "actualFinish", "deadline"]) if (t[k] !== undefined && !DATE.test(t[k])) errs.push(`${at}: ${k} must be a date`);
    if (t.inactive !== undefined && typeof t.inactive !== "boolean") errs.push(`${at}: inactive must be true or false`);
    if (t.effortDriven !== undefined && typeof t.effortDriven !== "boolean") errs.push(`${at}: effortDriven must be true or false`);
    if (t.type !== undefined && !TASK_TYPES.includes(t.type)) errs.push(`${at}: type must be one of ${TASK_TYPES.join(", ")}`);
    if (t.work !== undefined && !(Number.isFinite(t.work) && t.work >= 0)) errs.push(`${at}: work must be hours, 0 or more`);
    if (t.fixedCost !== undefined && !(Number.isFinite(t.fixedCost) && t.fixedCost >= 0)) errs.push(`${at}: fixed cost must be 0 or more`);
    if (t.priority !== undefined && !(Number.isInteger(t.priority) && t.priority >= 0 && t.priority <= 1000)) errs.push(`${at}: priority must be a whole number from 0 to 1000`);
    if (t.levelDelay !== undefined && !(Number.isInteger(t.levelDelay) && t.levelDelay >= 0)) errs.push(`${at}: levelling delay must be whole working days`);
    if (t.recurring !== undefined && patternError(t.recurring)) errs.push(`${at}: ${patternError(t.recurring)}`);
    if (t.subproject !== undefined && !(t.subproject && typeof t.subproject.file === "string" && t.subproject.file.trim() && t.subproject.file.length <= 255 && /^\d{4}-\d{2}-\d{2}$/.test(t.subproject.at))) errs.push(`${at}: a subproject names its file and the day it was read`);
    if (t.actualStart && t.actualFinish && t.actualFinish < t.actualStart) errs.push(`${at}: actual finish is before actual start`);
    if (splitsError(t)) errs.push(`${at}: ${splitsError(t)}`);
    if (t.fixedCostAccrual !== undefined && !["start", "prorated", "end"].includes(t.fixedCostAccrual)) errs.push(`${at}: fixed cost accrual must be start, prorated or end`);
    if (t.calendar !== undefined && !TASK_CALENDARS.some((c) => c.key === t.calendar)) errs.push(`${at}: calendar must be one of ${TASK_CALENDARS.map((c) => c.key).join(", ")}`);
    if (t.custom !== undefined) {
      if (!t.custom || typeof t.custom !== "object") errs.push(`${at}: custom values must be a set of fields`);
      else for (const [k, v] of Object.entries(t.custom)) {
        const f = (doc.fields || []).find((x) => x.key === k);
        if (!f) errs.push(`${at}: no custom field ${k}`);
        else if (valueError(f.type, v)) errs.push(`${at}: ${f.name} ${valueError(f.type, v)}`);
      }
    }
  });
  (doc.links || []).forEach((l, i) => {
    const at = `link ${i + 1}`;
    if (!ids.has(l.from) || !ids.has(l.to)) errs.push(`${at}: unknown task`);
    if (l.from === l.to) errs.push(`${at}: a task cannot depend on itself`);
    if (!LINK_TYPES.includes(l.type)) errs.push(`${at}: type must be one of ${LINK_TYPES.join(", ")}`);
    if (!Number.isInteger(l.lag)) errs.push(`${at}: lag must be whole days`);
  });
  if (doc.statusDate !== undefined && !DATE.test(doc.statusDate)) errs.push("status date must be a date");
  if (doc.budget !== undefined && !(Number.isFinite(doc.budget) && doc.budget > 0)) errs.push("the budget must be an amount more than 0");
  if (doc.resources !== undefined) {
    if (!Array.isArray(doc.resources)) errs.push("resources must be a list");
    else {
      const names = new Set();
      doc.resources.forEach((r, i) => {
        if (typeof r?.name !== "string" || !r.name.trim()) errs.push(`resource ${i + 1}: no name`);
        else if (names.has(r.name)) errs.push(`resource ${i + 1}: ${r.name} is listed twice`);
        names.add(r?.name);
        for (const k of ["rate", "costPerUse"]) if (r?.[k] !== undefined && !(Number.isFinite(r[k]) && r[k] >= 0)) errs.push(`resource ${i + 1}: ${k} must be 0 or more`);
        if (r?.maxUnits !== undefined && !(Number.isFinite(r.maxUnits) && r.maxUnits > 0 && r.maxUnits <= 100)) errs.push(`resource ${i + 1}: max units must be more than 0 (1 is one person full time)`);
        if (r?.accrue !== undefined && !["start", "prorated", "end"].includes(r.accrue)) errs.push(`resource ${i + 1}: accrue must be start, prorated or end`);
        if (r?.type !== undefined && !["work", "material", "cost"].includes(r.type)) errs.push(`resource ${i + 1}: type must be work, material or cost`);
        if (r?.unit !== undefined && typeof r.unit !== "string") errs.push(`resource ${i + 1}: unit must be text`);
      });
    }
  }
  if (doc.interims !== undefined) {
    if (!Array.isArray(doc.interims) || doc.interims.length > MAX_INTERIMS) errs.push(`interim plans must be a list of at most ${MAX_INTERIMS}`);
    else doc.interims.forEach((b, i) => {
      const at = `interim plan ${i + 1}`;
      if (typeof b.name !== "string" || !b.name) errs.push(`${at}: no name`);
      else if ((doc.baselines || []).some((x) => x.name === b.name)) errs.push(`${at}: ${b.name} is also a baseline's name`);
      if (!DATE.test(b.saved || "")) errs.push(`${at}: saved must be a date`);
      if (!b.tasks || typeof b.tasks !== "object") { errs.push(`${at}: no tasks`); return; }
      for (const [id, v] of Object.entries(b.tasks)) if (!DATE.test(v.start || "") || !DATE.test(v.finish || "")) errs.push(`${at}: task ${id} is incomplete`);
    });
  }
  if (doc.baselines !== undefined) {
    if (!Array.isArray(doc.baselines) || doc.baselines.length > MAX_BASELINES) errs.push(`baselines must be a list of at most ${MAX_BASELINES}`);
    else doc.baselines.forEach((b, i) => {
      const at = `baseline ${i + 1}`;
      if (typeof b.name !== "string" || !b.name) errs.push(`${at}: no name`);
      if (!DATE.test(b.saved || "")) errs.push(`${at}: saved must be a date`);
      if (!b.tasks || typeof b.tasks !== "object") { errs.push(`${at}: no tasks`); return; }
      for (const [id, v] of Object.entries(b.tasks)) {
        if (!DATE.test(v.start || "") || !DATE.test(v.finish || "") || !Number.isInteger(v.duration)) errs.push(`${at}: task ${id} is incomplete`);
        if (v.cost !== undefined && !(Number.isFinite(v.cost) && v.cost >= 0)) errs.push(`${at}: task ${id} has a bad cost`);
      }
    });
  }
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
  /**
   * Inserts another project (a document) as a summary task at the end, named after it, with its tasks one level under
   * it, its links, and the Resource Sheet rows and custom fields this project does not have yet (fields are matched by
   * name; a field of the same name but another type is added as a new field). Its baselines, interim plans, budget and
   * status date stay behind. Returns the summary's id; one undo step.
   */
  insertProject(other, name = other.name || "Inserted project", { file = null, at = new Date().toISOString().slice(0, 10) } = {}) {
    validate(other);
    const sum = "t" + ++this.seq;
    const ids = new Map(other.tasks.map((t) => [t.id, "t" + ++this.seq]));
    this.edit((d) => {
      // custom fields: reuse ours by name and type, add the rest under new keys
      const keyOf = new Map();
      for (const f of other.fields || []) {
        const mine = (d.fields || []).find((x) => x.name.toLowerCase() === f.name.toLowerCase() && x.type === f.type);
        if (mine) { keyOf.set(f.key, mine.key); continue; }
        d.fields = d.fields || [];
        const key = nextFieldKey(d.fields);
        let label = f.name;
        for (let n = 2; d.fields.some((x) => x.name.toLowerCase() === label.toLowerCase()); n++) label = `${f.name} (${n})`;
        d.fields.push({ ...f, key, name: label });
        keyOf.set(f.key, key);
      }
      const start = other.tasks.length ? other.tasks.reduce((m, t) => (t.start < m ? t.start : m), other.tasks[0].start) : other.start;
      d.tasks.push({ id: sum, name: String(name).trim() || "Inserted project", level: 0, start, duration: 1, progress: 0, ...(file ? { subproject: { file: String(file).slice(0, 255), at } } : {}) });
      for (const t of other.tasks) {
        const copy = { ...structuredClone(t), id: ids.get(t.id), level: t.level + 1 };
        if (copy.custom) copy.custom = Object.fromEntries(Object.entries(copy.custom).filter(([k]) => keyOf.has(k)).map(([k, v]) => [keyOf.get(k), v]));
        d.tasks.push(copy);
      }
      for (const l of other.links) d.links.push({ ...l, from: ids.get(l.from), to: ids.get(l.to) });
      for (const r of other.resources || []) {
        d.resources = d.resources || [];
        if (!d.resources.some((x) => x.name === r.name)) d.resources.push({ ...r });
      }
    });
    return sum;
  }
  /* ---- linked subprojects: an inserted plan that remembers its file ---- */
  /**
   * Replaces a subproject's tasks with the plan as it is in its file now: the summary keeps its name, place and
   * links; its old tasks, and links to them, go; the plan's tasks and links come in under it. One undo step.
   */
  refreshSubproject(id, other, at = new Date().toISOString().slice(0, 10)) {
    validate(other);
    if (!this.task(id).subproject) throw new Error("That task is not a linked subproject");
    const ids = new Map(other.tasks.map((t) => [t.id, "t" + ++this.seq]));
    return this.edit((d) => {
      const i = d.tasks.findIndex((t) => t.id === id), end = this.endOf(d.tasks, i), base = d.tasks[i].level;
      const gone = new Set(d.tasks.slice(i + 1, end).map((t) => t.id));
      const fresh = other.tasks.map((t) => ({ ...structuredClone(t), id: ids.get(t.id), level: base + 1 + t.level }));
      fresh.forEach((t) => delete t.custom); // fields are matched when a plan is first inserted, not on refresh
      d.tasks.splice(i + 1, end - i - 1, ...fresh);
      d.links = d.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)).concat(other.links.map((l) => ({ ...l, from: ids.get(l.from), to: ids.get(l.to) })));
      d.tasks[i].subproject = { ...d.tasks[i].subproject, at };
      for (const r of other.resources || []) {
        d.resources = d.resources || [];
        if (!d.resources.some((x) => x.name === r.name)) d.resources.push({ ...r });
      }
    });
  }
  /** A subproject's tasks as a plan of their own, to save back to its file: a project document. */
  subprojectDoc(id) {
    const i = this.indexOf(id), sum = this.doc.tasks[i];
    const tasks = this.doc.tasks.slice(i + 1, this.endOf(this.doc.tasks, i)).map((t) => ({ ...structuredClone(t), level: t.level - sum.level - 1 }));
    const ids = new Set(tasks.map((t) => t.id));
    const names = new Set(tasks.flatMap((t) => (t.owner || "").split(",").map((x) => x.replace(/\[.*\]|\d+(\.\d+)?\s*%/g, "").trim())));
    tasks.forEach((t) => delete t.custom);
    const start = tasks.length ? tasks.reduce((m, t) => (t.start < m ? t.start : m), tasks[0].start) : sum.start;
    return validate({ app: APP, v: SCHEMA_VERSION, name: sum.name, start, tasks, links: this.doc.links.filter((l) => ids.has(l.from) && ids.has(l.to)).map((l) => ({ ...l })), calendars: [], resources: (this.doc.resources || []).filter((r) => names.has(r.name)).map((r) => ({ ...r })) });
  }
  /** Keeps a subproject's tasks but forgets its file (a plain inserted plan from now on). */
  unlinkSubproject(id) { return this.edit((d) => { const t = d.tasks.find((x) => x.id === id); if (t) delete t.subproject; }); }

  /**
   * A recurring task: a summary named `name`, keeping `pattern`, with one subtask per occurrence from `start`
   * (recurring.js). `fields` go on every occurrence (duration, owner…). Returns the summary's id; one undo step.
   */
  addRecurring(name, start, pattern, fields = {}, afterId = null) {
    const dates = occurrences(start, pattern, this.isWork);
    if (!dates.length) throw new Error("That pattern has no dates");
    const id = "t" + ++this.seq;
    const kids = dates.map(() => "t" + ++this.seq);
    this.edit((d) => {
      let at = d.tasks.length, level = 0;
      if (afterId) { const i = d.tasks.findIndex((t) => t.id === afterId); at = this.endOf(d.tasks, i); level = d.tasks[i].level; }
      const rows = [{ id, name, level, start: dates[0], duration: 1, progress: 0, recurring: { ...pattern } },
        ...dates.map((date, n) => ({ id: kids[n], name: `${name} ${n + 1}`, level: level + 1, start: date, duration: 1, progress: 0, ...fields }))];
      d.tasks.splice(at, 0, ...rows);
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

  set(id, fields) {
    return this.edit((d) => {
      const target = d.tasks.find((x) => x.id === id);
      const before = { ...target };
      const t = Object.assign(target, fields);
      // duration, work and people stay in balance by the task's type (tasktypes.js)
      const changed = "work" in fields ? "work" : "duration" in fields ? "duration" : "owner" in fields ? "units" : null;
      if (changed) recalc(before, t, changed);
      if (t.work === undefined) delete t.work;
      // a shorter duration drops the pauses that no longer fall inside the work
      if (t.splits !== undefined) { const ok = splitsOf(t); if (ok.length) t.splits = ok; else delete t.splits; }
      // progress keeps the actual dates (#86): work began on the planned start, and 100% ends it on the planned finish
      if (fields.progress !== undefined && !("actualStart" in fields) && !("actualFinish" in fields)) {
        if (t.progress > 0 && !t.actualStart) t.actualStart = t.start;
        if (t.progress === 0) { delete t.actualStart; delete t.actualFinish; }
        if (t.progress === 100) t.actualFinish = t.actualFinish || finishOf(t, this.isWork);
        else delete t.actualFinish;
      }
    });
  }
  /** Sets a Resource Sheet row (type work/material/cost, unit, rate, cost per use), creating it; empty values clear them. */
  setResource(name, fields) {
    return this.edit((d) => {
      d.resources = d.resources || [];
      let r = d.resources.find((x) => x.name === name);
      if (!r) { r = { name }; d.resources.push(r); }
      for (const k of ["rate", "costPerUse"]) if (k in fields) { if (fields[k] === null || fields[k] === undefined || fields[k] === "") delete r[k]; else r[k] = Number(fields[k]); }
      if ("accrue" in fields) { if (!fields.accrue || fields.accrue === "prorated") delete r.accrue; else r.accrue = fields.accrue; }
      if ("maxUnits" in fields) { const v = fields.maxUnits; if (v === null || v === undefined || v === "" || Number(v) === 1) delete r.maxUnits; else r.maxUnits = Number(v); }
      if ("type" in fields) { if (!fields.type || fields.type === "work") delete r.type; else r.type = fields.type; }
      if ("unit" in fields) { if (!String(fields.unit ?? "").trim()) delete r.unit; else r.unit = String(fields.unit).trim(); }
      if (r.type !== "material") delete r.unit;
      if (r.type) delete r.maxUnits; // materials and cost resources have no time to give
      d.resources = d.resources.filter((x) => x.rate || x.costPerUse || x.type || x.maxUnits !== undefined || x.accrue);
    });
  }
  /** Splits a task: work pauses for `days` working days after `after` days of work (a pause there already is replaced). */
  split(id, after, days) {
    return this.edit((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      t.splits = [...(t.splits || []).filter((x) => x.after !== after), { after, days }].sort((a, b) => a.after - b.after);
    });
  }
  /** Joins a split task's pieces back together. */
  unsplit(id) { return this.edit((d) => { const t = d.tasks.find((x) => x.id === id); if (t) delete t.splits; }); }
  /** Adds a custom field (a column) of a type; returns its key. */
  /** Saves a custom report layout (reports.js): a new one, or the one with the same id. One undo step. */
  saveReport(r) {
    this.edit((d) => {
      const list = (d.reports ||= []), clean = { id: r.id, name: String(r.name || "").trim(), columns: [...r.columns], filter: r.filter || "all", group: r.group || "none", sort: r.sort || null };
      const at = list.findIndex((x) => x.id === r.id);
      if (at >= 0) list[at] = clean; else list.push(clean);
    });
  }
  removeReport(id) {
    this.edit((d) => { d.reports = (d.reports || []).filter((r) => r.id !== id); if (!d.reports.length) delete d.reports; });
  }
  addField(name, type, extra = {}) {
    let key;
    this.edit((d) => {
      d.fields = d.fields || []; key = nextFieldKey(d.fields);
      const f = { key, name: String(name).trim(), type };
      if (extra.formula && String(extra.formula).trim()) f.formula = String(extra.formula).trim();
      if (extra.indicators && String(extra.indicators).trim()) f.indicators = String(extra.indicators).trim();
      d.fields.push(f);
    });
    return key;
  }
  /** Changes a custom field's name, formula or indicators (empty text removes a formula or indicators). */
  updateField(key, props) {
    return this.edit((d) => {
      const f = (d.fields || []).find((x) => x.key === key);
      if (!f) return;
      if (props.name !== undefined) f.name = String(props.name).trim();
      for (const k of ["formula", "indicators"]) if (props[k] !== undefined) { const v = String(props[k] ?? "").trim(); if (v) f[k] = v; else delete f[k]; }
      // a field worked out by a formula keeps no typed values
      if (f.formula) for (const t of d.tasks) if (t.custom && f.key in t.custom) { delete t.custom[f.key]; if (!Object.keys(t.custom).length) delete t.custom; }
    });
  }
  /** Renames a custom field. */
  renameField(key, name) { return this.edit((d) => { const f = (d.fields || []).find((x) => x.key === key); if (f) f.name = String(name).trim(); }); }
  /** Removes a custom field and its values. */
  removeField(key) {
    return this.edit((d) => {
      d.fields = (d.fields || []).filter((f) => f.key !== key);
      if (!d.fields.length) delete d.fields;
      for (const t of d.tasks) if (t.custom) { delete t.custom[key]; if (!Object.keys(t.custom).length) delete t.custom; }
    });
  }
  /** A task's value for a custom field; undefined clears it. */
  setCustom(id, key, value) {
    const f = (this.doc.fields || []).find((x) => x.key === key);
    if (f?.formula) throw new Error(`${f.name} is worked out by its formula`);
    return this.edit((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      t.custom = { ...(t.custom || {}) };
      if (value === undefined) delete t.custom[key]; else t.custom[key] = value;
      if (!Object.keys(t.custom).length) delete t.custom;
    });
  }
  /** The status date progress is measured against; null clears it. */
  /** The project's budget (an amount), or null to clear it. */
  setBudget(amount) { return this.edit((d) => { if (amount === null || amount === undefined || amount === "" || !(Number(amount) > 0)) delete d.budget; else d.budget = Math.round(Number(amount) * 100) / 100; }); }
  setStatusDate(iso) { return this.edit((d) => { if (iso) d.statusDate = iso; else delete d.statusDate; }); }

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

  /**
   * Saves the plan as it stands as a baseline (#83): every task's start, finish and duration, to compare actual
   * against plan later. Up to MAX_BASELINES; a name already used is replaced. `saved` is the day it was saved.
   */
  saveBaseline(name = "Baseline", saved = new Date().toISOString().slice(0, 10)) {
    return this.edit((d) => {
      const tasks = {};
      const cost = costs(d).byId; // the planned cost goes into the baseline too: earned value measures against it
      for (const t of d.tasks) {
        const v = this.viewIn(d, t.id);
        tasks[t.id] = { start: v.start, finish: v.finish, duration: v.duration, cost: cost.get(t.id) || 0 };
        if (!this.isSummary(t.id) && t.duration > 0 && unitsOf(t) > 0) tasks[t.id].work = workOf(t);
      }
      const list = (d.baselines || []).filter((b) => b.name !== name);
      if (list.length >= MAX_BASELINES) throw new Error(`a project keeps at most ${MAX_BASELINES} baselines; clear one first`);
      d.baselines = [...list, { name, saved, tasks }];
    });
  }
  clearBaseline(name) { return this.edit((d) => { d.baselines = (d.baselines || []).filter((b) => b.name !== name); if (!d.baselines.length) delete d.baselines; }); }
  baseline(name) { return snapshotOf(this.doc, name); }
  /** Saves an interim plan: each task's start and finish as they are now (no durations, work or costs). */
  saveInterim(name = "Interim 1", saved = new Date().toISOString().slice(0, 10)) {
    return this.edit((d) => {
      const tasks = {};
      for (const t of d.tasks) { const v = this.viewIn(d, t.id); tasks[t.id] = { start: v.start, finish: v.finish }; }
      const list = (d.interims || []).filter((b) => b.name !== name);
      if (list.length >= MAX_INTERIMS) throw new Error(`a project keeps at most ${MAX_INTERIMS} interim plans; clear one first`);
      d.interims = [...list, { name, saved, tasks }];
    });
  }
  clearInterim(name) { return this.edit((d) => { d.interims = (d.interims || []).filter((b) => b.name !== name); if (!d.interims.length) delete d.interims; }); }

  /**
   * Plan against actual for a task: the baseline's dates and the slip in days (positive: later than planned).
   * With a working calendar the slip counts working days. Null when the task was added after the baseline.
   */
  variance(id, name) {
    const b = this.baseline(name), base = b && b.tasks[id];
    if (!base) return null;
    const v = this.view(id);
    const slip = (a, c) => {
      if (!this.isWork) return toDay(c) - toDay(a);
      const [lo, hi, sign] = toDay(a) <= toDay(c) ? [toDay(a), toDay(c), 1] : [toDay(c), toDay(a), -1];
      let n = 0;
      for (let d = lo + 1; d <= hi; d++) if (this.isWork(d)) n++;
      return sign * n;
    };
    return { start: base.start, finish: base.finish, duration: base.duration, startSlip: slip(base.start, v.start), finishSlip: slip(base.finish, v.finish) };
  }

  /** view() on another copy of the document (for saving a baseline inside an edit) */
  viewIn(doc, id) { const keep = this.doc; this.doc = doc; try { return this.view(id); } finally { this.doc = keep; } }

  /** What the grid and chart show for a task: summaries roll up their subtasks' dates and progress. */
  view(id) {
    const tasks = this.doc.tasks, i = this.indexOf(id), t = tasks[i];
    const finish = finishOf(t, this.isWork);
    if (!this.isSummary(id)) return { ...t, finish, summary: false, milestone: t.duration === 0 };
    const leaves = tasks.slice(i + 1, this.endOf(tasks, i)).filter((k, n, all) => !(n + 1 < all.length && all[n + 1].level > k.level));
    const active = leaves.filter((k) => !k.inactive);
    const kids = active.length ? active : leaves; // a summary of only inactive tasks still shows where they were
    const s = Math.min(...kids.map((k) => toDay(k.start)));
    const f = Math.max(...kids.map((k) => toDay(finishOf(k, this.isWork))));
    const weight = kids.reduce((a, k) => a + Math.max(1, k.duration), 0);
    const progress = Math.round(kids.reduce((a, k) => a + k.progress * Math.max(1, k.duration), 0) / weight);
    let duration = f - s + 1;
    if (this.isWork) { duration = 0; for (let d = s; d <= f; d++) if (this.isWork(d)) duration++; }
    return { ...t, start: fromDay(s), finish: fromDay(f), duration, progress, summary: true, milestone: false };
  }
}
