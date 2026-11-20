/*
 * WorkSuite Project editor (#75 task grid, #76 Gantt chart), on the Project model (core/project.js).
 *
 * Grid: select (click, Ctrl/Shift+click, arrows), edit a cell (double-click, F2 or typing; Enter keeps,
 * Esc cancels), Insert adds a task, Delete removes, Tab / Shift+Tab indent and outdent, Ctrl+Z / Ctrl+Y undo
 * and redo; the triangle collapses a summary. Chart: drag a bar to move it, its right end to change its
 * duration; Link joins the selected tasks in order (finish to start).
 *
 * The page stands alone until the native shell hosts it (#72): it saves and opens through the browser, and
 * window.WorkSuiteProject lets the shell load a file, read it back and switch read-only mode (free viewing, #73).
 */
import { ProjectModel, newProject, parse, serialize, finishOf, wbsCodes, APP } from "../core/project.js";
import { fromProjectXml, toProjectXml, isMpp, MPP_HELP } from "../core/projectxml.js";
import { schedule, applySchedule, applyLevelling, clearLevelling, criticalPath, STANDARD, SRI_LANKA } from "../core/schedule.js";
import { level, unlevelledStart } from "../core/levelling.js";
import { overallocations, weeklyLoad } from "../core/resources.js";
import { behindSchedule, pastDeadline } from "../core/progress.js";
import { assignmentsOf } from "../core/resources.js";
import { outlineToDoc } from "../core/outline.js";
import { workOf, unitsOf, TASK_TYPES } from "../core/tasktypes.js";
import { costs, resourceSheet, formatMoney } from "../core/costs.js";
import { earnedValue } from "../core/earnedvalue.js";
import { BOARD_COLUMNS, board, progressFor, month, network, NODE, usage, FILTERS, filterTasks, timeline, GROUPS, groupRows, overview } from "./views.js";
import { askText, askForm } from "../../common/dialog.js";
import { FIELD_TYPES, parseValue, formatValue } from "../core/fields.js";
import { describe as describeRecurring, patternError } from "../core/recurring.js";
import { decorateRibbon, ribbonStyles } from "../../common/ribbon.js";
import { aiDraft } from "../../common/aidraft.js";
import { checkEdit, reasonText, openUpgrade } from "../../common/licence.js";
import { packDocument, unpackDocument, xlsx } from "../../common/zip.js";
import { ROW_H, visibleRows, timescale, headers, bars, linkPath, dragStart, dragDuration, parseDuration } from "./gantt.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const COLS = [
  { key: "n", label: "", w: 36 },
  { key: "wbs", label: "WBS", w: 48 },
  { key: "name", label: "Task name", w: 210, edit: true },
  { key: "duration", label: "Duration", w: 72, edit: true },
  { key: "work", label: "Work", w: 64, edit: true },
  { key: "cost", label: "Cost", w: 104 },
  { key: "fixedCost", label: "Fixed cost", w: 96, edit: true },
  { key: "start", label: "Start", w: 104, edit: true },
  { key: "finish", label: "Finish", w: 104 },
  { key: "deadline", label: "Deadline", w: 96, edit: true },
  { key: "progress", label: "% done", w: 60, edit: true },
  { key: "owner", label: "Owner", w: 90, edit: true },
  { key: "priority", label: "Priority", w: 64, edit: true },
];

/** The grid's columns: the fixed ones, then one per custom field (key "c:<field key>"). */
const cols = () => [...COLS, ...(state.model.doc.fields || []).map((f) => ({ key: "c:" + f.key, label: f.name, w: f.type === "flag" ? 56 : f.type === "text" ? 120 : 96, edit: true, field: f }))];

const calendar = () => (state.cal === "lk" ? SRI_LANKA : STANDARD);
const state = {
  cal: "standard",
  showBaseline: false,
  showCritical: false,
  board: false, // the Task Board (stage 5)
  net: false, // the Network Diagram (stage 5)
  tuse: false, // Task Usage (stage 5)
  ruse: false, // Resource Usage (stage 5)
  tl: false, // the Timeline (stage 5)
  report: false, // the Project Overview report (stage 5)
  cal: false, // the Calendar view, and the month it shows
  calMonth: null, // [year, month index]
  ev: false, // the earned value table in place of the Gantt chart (stage 5)
  sheet: false, // the Resource Sheet in place of the Gantt chart (stage 5)
  workload: false, // the workload view in place of the Gantt chart (#86)
  note: "",
  model: new ProjectModel(newProject("Untitled project", mondayOf(new Date()))),
  behind: [], // tasks behind at the status date: [{ id, name, expected, progress, behind, late }]
  over: [], // over-allocations: [{ name, from, to, days, tasks }]
  sel: [], // selected task ids, in the order they were picked
  collapsed: new Set(),
  group: "none", // Group by (stage 5): a GROUPS key
  filter: "all", // the task filter (stage 5): a FILTERS key or "person:<name>"
  zoom: "week",
  readOnly: false,
  editing: null, // { id, key }
  message: "",
  fileName: "Untitled project.wsproj",
};

function mondayOf(d) {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  const dow = (new Date(day * 86400000).getUTCDay() + 6) % 7;
  return new Date((day - dow) * 86400000).toISOString().slice(0, 10);
}

/* ---- commands ---- */
function run(fn) {
  if (state.readOnly) return;
  state.note = "";
  try { state.message = ""; fn(); } catch (e) { state.message = e.message; }
  render();
}
const selected = () => state.sel.filter((id) => state.model.tasks.some((t) => t.id === id));
const first = () => selected()[0];

const commands = {
  new: () => { if (confirmDiscard()) { state.model = new ProjectModel(newProject("Untitled project", mondayOf(new Date()))); state.sel = []; state.fileName = "Untitled project.wsproj"; render(); } },
  open: () => $("wp-file").click(),
  fromOutline: () => fromOutline(),
  viewGantt: () => showView(null),
  viewWorkload: () => showView("workload"),
  viewSheet: () => showView("sheet"),
  viewEv: () => showView("ev"),
  viewBoard: () => showView("board"),
  viewCal: () => showView("cal"),
  viewNet: () => showView("net"),
  addField: async () => {
    if (state.readOnly) return;
    const v = await askForm({
      title: "New custom field", hint: "A column of your own for every task, such as Supplier, Budget code, Approved or Delivery date.", ok: "Add column",
      fields: [{ key: "name", label: "Name", value: "" }, { key: "type", label: "Type", type: "select", options: FIELD_TYPES.map((t) => [t.key, t.title]), value: "text" }],
      check: (x) => (!x.name.trim() ? "Give the field a name" : (state.model.doc.fields || []).some((f) => f.name.toLowerCase() === x.name.trim().toLowerCase()) ? "There is already a field with that name" : null),
    });
    if (v) run(() => state.model.addField(v.name, v.type));
  },
  removeField: async () => {
    if (state.readOnly) return;
    const fs = state.model.doc.fields || [];
    if (!fs.length) { state.message = "There are no custom fields yet"; render(); return; }
    const v = await askForm({
      title: "Remove a custom field", hint: "The column and its values on every task are removed. Undo brings them back.", ok: "Remove",
      fields: [{ key: "key", label: "Field", type: "select", options: fs.map((f) => [f.key, f.name]), value: fs[0].key }],
    });
    if (v) run(() => state.model.removeField(v.key));
  },
  clearFilter: () => { state.filter = "all"; render(); },
  viewTaskUsage: () => showView("tuse"),
  viewResUsage: () => showView("ruse"),
  viewTimeline: () => showView("tl"),
  viewReport: () => showView("report"),
  aiPlan: () => aiPlan(),
  save: () => { download(state.fileName, packDocument(APP, serialize(state.model.doc)), "application/zip"); state.saved = state.model.undoStack.length; render(); },
  exportCsv: () => download(state.fileName.replace(/\.wsproj$/, "") + ".csv", toCsv(), "text/csv"),
  exportXml: () => download(state.fileName.replace(/\.wsproj$/, "") + ".xml", toProjectXml(state.model.doc, calendar().isWork), "application/xml"),
  exportXlsx: () => download(state.fileName.replace(/\.wsproj$/, "") + ".xlsx", xlsx(tableRows(), state.model.doc.name), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  print: () => { fitForPrint(); window.print(); },
  addTask: () => run(() => { const id = state.model.addTask({ start: startForNew() }, first() || null); state.sel = [id]; startEdit(id, "name"); }),
  addRecurring: () => addRecurring(),
  addMilestone: () => run(() => { const id = state.model.addMilestone({ start: startForNew() }, first() || null); state.sel = [id]; }),
  levelAll: () => run(() => {
    const before = overallocations(state.model.doc, calendar().isWork).length;
    if (!before) { state.note = "Nobody is over-allocated: nothing to level"; return; }
    const finish = () => state.model.tasks.reduce((f, t) => { const v = state.model.view(t.id); return v.finish > f ? v.finish : f; }, "");
    const was = finish();
    const plan = applyLevelling(state.model, calendar(), level);
    state.note = plan.moved.length
      ? `Levelled: ${plan.moved.length} task${plan.moved.length === 1 ? "" : "s"} delayed; finish ${fmt(was)} → ${fmt(finish())}` + (plan.unresolved.length ? ` (${plan.unresolved.length} clash${plan.unresolved.length === 1 ? "" : "es"} could not be moved)` : "")
      : "No task could be delayed to remove the over-allocation";
  }),
  clearLevel: () => run(() => {
    if (!state.model.tasks.some((t) => t.levelDelay)) { state.note = "Nothing has been levelled"; return; }
    clearLevelling(state.model, calendar(), unlevelledStart);
    state.note = "Levelling cleared: tasks back where their links put them";
  }),
  inactive: () => run(() => {
    const ids = selected().filter((id) => !state.model.isSummary(id));
    if (!ids.length) throw new Error("Select tasks to make inactive or active again (not summaries)");
    const on = !ids.every((id) => state.model.task(id).inactive); // mixed or all active: inactivate all; all inactive: back on
    state.model.edit((d) => { for (const t of d.tasks) if (ids.includes(t.id)) t.inactive = on || undefined; });
    state.note = on ? `${ids.length} task${ids.length === 1 ? "" : "s"} inactive: kept in the plan, left out of the schedule` : "Active again";
  }),
  remove: () => run(() => { for (const id of selected()) if (state.model.tasks.some((t) => t.id === id)) state.model.removeTask(id); state.sel = []; }),
  indent: () => run(() => selected().forEach((id) => state.model.indent(id))),
  outdent: () => run(() => selected().forEach((id) => state.model.outdent(id))),
  link: () => run(() => { const s = selected(); if (s.length < 2) throw new Error("Select two or more tasks to link, in order"); for (let i = 1; i < s.length; i++) state.model.link(s[i - 1], s[i]); }),
  unlink: () => run(() => { const s = new Set(selected()); for (const l of [...state.model.doc.links]) if (s.has(l.from) && s.has(l.to)) state.model.unlink(l.from, l.to); }),
  p0: () => run(() => selected().forEach((id) => state.model.set(id, { progress: 0 }))),
  p50: () => run(() => selected().forEach((id) => state.model.set(id, { progress: 50 }))),
  p100: () => run(() => selected().forEach((id) => state.model.set(id, { progress: 100 }))),
  undo: () => run(() => state.model.undo()),
  redo: () => run(() => state.model.redo()),
  autoSchedule: () => run(() => {
    const r = applySchedule(state.model, calendar());
    state.message = r.problems.join("; ");
    if (!state.message) state.note = `Scheduled on the ${state.cal === "lk" ? "Sri Lanka" : "standard"} calendar: finishes ${fmt(r.finish)}`;
  }),
  saveBaseline: () => run(() => {
    state.model.saveBaseline("Baseline");
    state.showBaseline = true;
    $("wp-baseline").checked = true;
    state.note = "Baseline saved: the grey bars show the plan as it is now";
  }),
  today: () => { const sc = timescale(shownRows(), state.zoom, state.model.doc.start); $("wp-chart").scrollLeft = Math.max(0, sc.x(new Date().toISOString().slice(0, 10)) - 120); },
};

/** A recurring task (stage 5): a summary with one subtask per occurrence. */
async function addRecurring() {
  if (state.readOnly) return;
  const dow = (new Date(startForNew() + "T00:00:00Z").getUTCDay() + 6) % 7 + 1;
  const pattern = (v) => ({ every: v.every, interval: v.interval, ...(v.every === "week" ? { weekdays: v.weekdays } : {}), ...(v.ends === "count" ? { count: v.count } : { until: v.until }) });
  const v = await askForm({
    title: "Recurring task",
    hint: "A summary with one task for each time. Times on a holiday or weekend move to the next working day.",
    ok: "Add",
    fields: [
      { key: "name", label: "Name", value: "Status meeting" },
      { key: "duration", label: "Each takes", type: "number", value: 1, min: 1, hint: "working days" },
      { key: "owner", label: "Owner", value: "", hint: "names, as in the Owner column" },
      { key: "every", label: "Repeats", type: "select", value: "week", options: [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] },
      { key: "interval", label: "Every", type: "number", value: 1, min: 1, max: 99, hint: "days, weeks or months" },
      { key: "weekdays", label: "On", type: "days", value: [dow > 5 ? 1 : dow], showIf: (x) => x.every === "week" },
      { key: "start", label: "From", type: "date", value: startForNew() },
      { key: "ends", label: "Ends", type: "radio", value: "count", options: [["count", "After a number of times"], ["until", "On a date"]] },
      { key: "count", label: "Times", type: "number", value: 6, min: 1, showIf: (x) => x.ends === "count" },
      { key: "until", label: "Until", type: "date", value: "", showIf: (x) => x.ends === "until" },
    ],
    check: (x) => !x.name.trim() ? "Give it a name" : !(x.duration >= 1) ? "Each time takes at least a day" : !/^\d{4}-\d{2}-\d{2}$/.test(x.start) ? "Choose a start date" : patternError(pattern(x)),
  });
  if (!v) return;
  run(() => {
    const id = state.model.addRecurring(v.name.trim(), v.start, pattern(v), { duration: Math.round(v.duration), ...(v.owner.trim() ? { owner: v.owner.trim() } : {}) }, first() || null);
    state.sel = [id];
    state.note = `${describeRecurring(state.model.task(id).recurring)}: ${state.model.tasks.filter((t, i, all) => i > state.model.indexOf(id) && t.level > state.model.task(id).level).length} tasks added`;
  });
}

/** A new plan from an outline (#88): one task per line, indented under its summary. */
async function fromOutline(value = "") {
  if (state.readOnly || !confirmDiscard()) return;
  const got = await askText({
    value,
    title: "New plan from an outline",
    hint: "One task per line. Indent a line to put it under the one above.\nAt the end of a line: a duration (5d, 2w), \"milestone\", and people (@Nimal, @Priya 50%).",
    placeholder: "Planning\n  Choose site 4d @Nimal\n  Sign lease 3d\n  Lease signed milestone",
    sample: OUTLINE_SAMPLE, checkbox: "Each task follows the one before it", ok: "Create plan",
  });
  if (!got) return;
  run(() => {
    const doc = outlineToDoc(got.text, { name: "New plan", start: mondayOf(new Date()), linkInOrder: got.checked });
    state.model = new ProjectModel(doc);
    state.model.isWork = calendar().isWork;
    if (doc.links.length) applySchedule(state.model, calendar());
    state.model.undoStack = []; state.model.redoStack = [];
    state.sel = []; state.saved = -1; state.fileName = "New plan.wsproj";
    state.note = `Created ${doc.tasks.length} tasks from the outline`;
  });
}
/** A plan drafted by the local AI from a description (#88), shown as an outline to check before it is made. */
async function aiPlan() {
  if (state.readOnly) return;
  const ask = await askText({ title: "Draft a plan with AI", hint: "Describe the project: what it is, how long it may take, and who is involved. The draft opens as an outline you can change before the plan is made.", placeholder: "Plan a 3-month office move for 40 people. Nimal handles the site, Ayesha the furniture, Ravi the network.", ok: "Draft", rows: 5 });
  if (!ask) return;
  state.note = "Drafting the plan with the local AI…"; state.message = ""; render();
  try {
    const text = await aiDraft("plan", ask.text);
    state.note = ""; render();
    await fromOutline(text);
  } catch (e) { state.note = ""; state.message = e.message; render(); }
}
const OUTLINE_SAMPLE = `Planning
  Choose new site 4d @Nimal
  Sign lease 3d @Ayesha
  Lease signed milestone
Fit-out
  Network and power 6d @Ravi
  Furniture 8d @Ayesha
  Inspection 2d @Nimal
Move
  Pack and label 3d @Team
  Moving day 2d @Movers
  Open for business milestone`;

function startForNew() {
  const t = first() && state.model.task(first());
  return t ? finishOf(t, calendar().isWork) : state.model.doc.start;
}
function confirmDiscard() { return state.model.undoStack.length === 0 || window.confirm("Discard the changes to this project?"); }

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** The task list as rows, for CSV and XLSX: a header, then one row per task with its predecessors. */
function tableRows() {
  const rows = [["ID", "WBS", "Level", "Task name", "Duration (days)", "Start", "Finish", "Deadline", "% done", "Owner", "Predecessors", "Active", ...(state.model.doc.fields || []).map((f) => f.name)]];
  const fs = state.model.doc.fields || [];
  const wbs = wbsCodes(state.model.tasks);
  state.model.tasks.forEach((t, i) => {
    const v = state.model.view(t.id);
    const preds = state.model.doc.links.filter((l) => l.to === t.id).map((l) => `${state.model.indexOf(l.from) + 1}${l.type}${l.lag ? (l.lag > 0 ? "+" : "") + l.lag + "d" : ""}`).join(";");
    rows.push([i + 1, wbs.get(t.id), t.level, "  ".repeat(t.level) + t.name, v.duration, v.start, v.finish, t.deadline || "", v.progress, t.owner || "", preds, t.inactive ? "No" : "Yes", ...fs.map((f) => (f.type === "flag" ? (t.custom?.[f.key] ? "Yes" : "No") : t.custom?.[f.key] ?? ""))]);
  });
  return rows;
}
function toCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return tableRows().map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

/* ---- grid ---- */
function renderGrid(rows) {
  const t = state.model;
  const selSet = new Set(state.sel);
  const wbs = wbsCodes(t.tasks);
  const cost = costs(t.doc).byId;
  const C = cols();
  let html = `<table class="wp-table"><colgroup>${C.map((c) => `<col style="width:${c.w}px">`).join("")}</colgroup><tr>${C.map((c) => `<th${c.field ? ` class="custom" title="${esc(c.field.name)} (${c.field.type})"` : ""}>${esc(c.label)}</th>`).join("")}</tr>`;
  for (const r of rows) {
    if (r.group) {
      html += `<tr class="is-summary is-group" data-group="${esc(r.id)}"><td class="n"></td><td colspan="${C.length - 1}" class="name"><span class="tw" data-toggle="${esc(r.id)}">${state.collapsed.has(r.id) ? "▸" : "▾"}</span>${esc(r.name)} <span class="wp-group-n">${r.count} task${r.count === 1 ? "" : "s"} · ${fmt(r.start)} – ${fmt(r.finish)} · ${r.progress}%</span></td></tr>`;
      continue;
    }
    const n = t.indexOf(r.id) + 1;
    const cells = C.map((c) => {
      if (c.field && state.editing && state.editing.id === r.id && state.editing.key === c.key) {
        const v = r.custom?.[c.field.key];
        return `<td class="custom"><input data-edit-input value="${esc(c.field.type === "flag" ? (v ? "yes" : "") : v ?? "")}" ${c.field.type === "date" ? 'type="date"' : ""} placeholder="${c.field.type === "flag" ? "yes / no" : ""}"></td>`;
      }
      if (c.field) return `<td class="custom ${c.field.type}">${esc(formatValue(c.field.type, r.custom?.[c.field.key], fmt))}</td>`;
      if (state.editing && state.editing.id === r.id && state.editing.key === c.key) {
        const value = c.key === "duration" ? `${r.duration}d` : c.key === "progress" ? r.progress : c.key === "work" ? `${workOf(r)}h` : (r[c.key] ?? "");
        return `<td class="${c.key}"><input data-edit-input value="${esc(value)}" ${c.key === "start" || c.key === "deadline" ? 'type="date"' : ""}></td>`;
      }
      if (c.key === "n") return `<td class="n">${n}</td>`;
      if (c.key === "wbs") return `<td class="wbs">${wbs.get(r.id)}</td>`;
      if (c.key === "deadline") return `<td class="${r.deadline && !r.inactive && r.finish > r.deadline ? "is-late" : ""}">${r.deadline ? fmt(r.deadline) : ""}</td>`;
      if (c.key === "name") {
        const tw = r.summary ? `<span class="tw" data-toggle="${r.id}">${state.collapsed.has(r.id) ? "▸" : "▾"}</span>` : `<span class="tw"></span>`;
        const rec = r.recurring ? ` <span class="rec" title="${esc(describeRecurring(r.recurring))}">↻</span>` : "";
        return `<td class="name" style="padding-inline-start:${8 + r.level * 16}px">${tw}${esc(r.name)}${rec}</td>`;
      }
      if (c.key === "duration") return `<td>${r.milestone ? "0 d" : `${r.duration} d`}</td>`;
      if (c.key === "priority") return `<td class="${r.levelDelay ? "is-levelled" : ""}" title="${r.levelDelay ? `Delayed ${r.levelDelay} working day${r.levelDelay === 1 ? "" : "s"} by levelling` : ""}">${r.summary ? "" : r.priority ?? 500}</td>`;
      if (c.key === "cost") return `<td class="money">${cost.get(r.id) ? formatMoney(cost.get(r.id)) : ""}</td>`;
      if (c.key === "fixedCost") return `<td class="money">${r.fixedCost ? formatMoney(r.fixedCost) : ""}</td>`;
      if (c.key === "work") return `<td class="work">${!r.summary && !r.milestone && unitsOf(r) > 0 ? `${workOf(r)} h` : ""}</td>`;
      if (c.key === "start" || c.key === "finish") return `<td>${fmt(r[c.key])}</td>`;
      if (c.key === "progress") return `<td>${r.progress}%</td>`;
      return `<td>${esc(r[c.key])}</td>`;
    }).join("");
    html += `<tr data-id="${r.id}" class="${selSet.has(r.id) ? "is-sel" : ""} ${r.summary ? "is-summary" : ""} ${r.inactive ? "is-inactive" : ""}">${cells}</tr>`;
  }
  $("wp-grid").innerHTML = html + "</table>";
  const input = $("wp-grid").querySelector("[data-edit-input]");
  if (input) { input.focus(); input.select?.(); }
}

function startEdit(id, key) {
  if (state.readOnly) return;
  const col = cols().find((c) => c.key === key);
  if (!col || !col.edit) return;
  if (state.model.isSummary(id) && (key === "duration" || key === "start" || key === "progress" || key === "deadline" || key === "work" || key === "priority")) { state.message = "A summary's dates and progress come from its subtasks"; render(); return; }
  state.editing = { id, key };
  render();
}
function commitEdit(value) {
  const { id, key } = state.editing;
  state.editing = null;
  if (key.startsWith("c:")) {
    const f = (state.model.doc.fields || []).find((x) => "c:" + x.key === key);
    if (!f) return render();
    const p = parseValue(f.type, value);
    if (p.error) { state.message = `${f.name}: ${p.error}`; render(); return; }
    run(() => state.model.setCustom(id, f.key, p.value));
    return;
  }
  const fields = {};
  if (key === "name") fields.name = value.trim() || "Task";
  else if (key === "owner") fields.owner = value.trim() || undefined;
  else if (key === "start") { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { state.message = "Start must be a date"; render(); return; } fields.start = value; }
  else if (key === "duration") { const d = parseDuration(value); if (d === null) { state.message = "Duration is whole days, like 5 or 2w"; render(); return; } fields.duration = d; }
  else if (key === "priority") {
    const p = Number(String(value).trim());
    if (!(Number.isInteger(p) && p >= 0 && p <= 1000)) { state.message = "Priority is a whole number from 0 to 1000 (500 is normal)"; render(); return; }
    fields.priority = p === 500 ? undefined : p;
  }
  else if (key === "fixedCost") {
    const n = Number(String(value).replace(/,/g, "").trim() || 0);
    if (!(n >= 0)) { state.message = "A fixed cost is an amount, 0 or more"; render(); return; }
    fields.fixedCost = n ? Math.round(n * 100) / 100 : undefined;
  }
  else if (key === "work") {
    const h = Number(String(value).trim().replace(/\s*(h|hrs?|hours?)$/i, ""));
    if (!(h >= 0) || !String(value).trim()) { state.message = "Work is hours, like 40 or 40h"; render(); return; }
    if (!(unitsOf(state.model.task(id)) > 0)) { state.message = "Assign someone in the Owner column first: work is their hours"; render(); return; }
    fields.work = Math.round(h * 100) / 100;
  }
  else if (key === "deadline") { if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { state.message = "A deadline is a date"; render(); return; } fields.deadline = value || undefined; }
  else if (key === "progress") { const p = Number(String(value).replace("%", "")); if (!(p >= 0 && p <= 100)) { state.message = "Progress is 0 to 100"; render(); return; } fields.progress = Math.round(p); }
  run(() => state.model.set(id, fields));
}

/* ---- chart ---- */
function renderChart(rows) {
  const sc = timescale(rows, state.zoom, state.model.doc.start);
  const hd = headers(sc, state.zoom);
  const bs = bars(rows, sc);
  const byId = new Map(bs.map((b) => [b.id, b]));
  const over = new Set(state.over.flatMap((o) => o.tasks));
  const behind = new Map(state.behind.map((x) => [x.id, x]));
  const h = Math.max(rows.length * ROW_H + ROW_H * 3, $("wp-chart").clientHeight - 46);
  const selSet = new Set(state.sel);
  let critical = new Set();
  if (state.showCritical && state.model.tasks.length) {
    try { critical = new Set(criticalPath(schedule(state.model.doc, calendar()))); } catch (e) { state.message = e.message; }
  }
  let svg = `<div class="wp-scale" style="width:${sc.width}px">${hd.top.map((c) => `<div style="left:${c.x}px">${c.label}</div>`).join("")}${hd.bottom.map((c) => `<div class="b" style="left:${c.x}px;width:${c.w}px">${c.label}</div>`).join("")}</div>`;
  svg += `<svg width="${sc.width}" height="${h}" xmlns="${NS}"><defs><marker id="wp-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6z" fill="currentColor" class="wp-arrow"/></marker></defs>`;
  for (const w of hd.weekends) svg += `<rect class="wp-weekend" x="${w.x}" y="0" width="${w.w}" height="${h}"/>`;
  for (let i = 1; i <= rows.length; i++) svg += `<line class="wp-rowline" x1="0" x2="${sc.width}" y1="${i * ROW_H - 0.5}" y2="${i * ROW_H - 0.5}"/>`;
  for (const l of state.group === "none" ? state.model.doc.links : []) { // grouped, rows are out of link order
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) continue;
    svg += `<polyline class="wp-link" style="color:var(--ink3)" marker-end="url(#wp-arrow)" points="${linkPath(a, b, l.type).map((p) => p.join(",")).join(" ")}"/>`;
  }
  for (const b of bs) {
    const r = rows[b.row];
    if (b.kind === "milestone") {
      svg += `<rect class="wp-ms" x="${b.x - 6}" y="${b.y + 9}" width="12" height="12" transform="rotate(45 ${b.x} ${b.y + 15})"/><text class="wp-label" x="${b.x + 12}" y="${b.y + 19}">${esc(r.name)}</text>`;
    } else if (b.kind === "summary") {
      svg += `<path class="wp-sum" d="M${b.x} ${b.y + 10} h${b.w} v8 l-5 5 l-5 -5 H${b.x + 10} l-5 5 l-5 -5 Z"/>`;
    } else {
      const base = state.showBaseline && state.model.baseline("Baseline")?.tasks[b.id];
      if (base) svg += `<rect class="wp-base" x="${sc.x(base.start)}" y="${b.y + 23}" width="${Math.max(2, sc.x(base.finish) - sc.x(base.start) + sc.dayW)}" height="4" rx="2"/>`;
      const crit = (critical.has(b.id) ? " is-crit" : "") + (r.inactive ? " is-inactive" : "");
      const late = behind.get(b.id);
      if (late) svg += `<rect class="wp-behind" x="${b.x - 4}" y="${b.y + 4}" width="${b.w + 8}" height="22" rx="6"><title>${late.late ? "Late" : "Behind"}: ${late.progress}% done, ${late.expected}% expected by the status date</title></rect>`;
      if (over.has(b.id)) svg += `<rect class="wp-over" x="${b.x - 2}" y="${b.y + 6}" width="${b.w + 4}" height="18" rx="5"><title>Someone on this task has another task at the same time</title></rect>`;
      svg += `<rect class="wp-bar${crit}" x="${b.x}" y="${b.y + 8}" width="${b.w}" height="14" rx="4"/>`;
      if (b.progress) svg += `<rect class="wp-bar-done${crit}" x="${b.x}" y="${b.y + 8}" width="${(b.w * b.progress) / 100}" height="14" rx="4"/>`;
      if (r.owner) svg += `<text class="wp-label" x="${b.x + b.w + 6}" y="${b.y + 19}">${esc(r.owner)}</text>`;
      svg += `<rect class="wp-hit" data-drag="move" data-id="${b.id}" x="${b.x}" y="${b.y + 4}" width="${Math.max(0, b.w - 6)}" height="22"/><rect class="wp-grip" data-drag="size" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + 4}" width="10" height="22"/>`;
    }
    if (r.deadline && !r.summary) {
      const dx = sc.x(r.deadline) + sc.dayW, late = !r.inactive && r.finish > r.deadline;
      svg += `<path class="wp-deadline${late ? " is-late" : ""}" d="M${dx - 5} ${b.y + 2} h10 l-5 7 z"><title>Deadline ${fmt(r.deadline)}${late ? " (missed)" : ""}</title></path>`;
    }
    if (selSet.has(b.id)) svg += `<rect class="wp-sel-bar" x="${b.x - 3}" y="${b.y + 4}" width="${b.w + 6}" height="22" rx="5"/>`;
  }
  if (state.model.doc.statusDate) {
    const sx = sc.x(state.model.doc.statusDate) + sc.dayW; // the end of the status date
    if (sx >= 0 && sx <= sc.width) svg += `<line class="wp-statusline" x1="${sx}" x2="${sx}" y1="0" y2="${h}"><title>Status date</title></line>`;
  }
  const today = new Date().toISOString().slice(0, 10), tx = sc.x(today) + sc.dayW / 2;
  if (tx >= 0 && tx <= sc.width) svg += `<line class="wp-today" x1="${tx}" x2="${tx}" y1="0" y2="${h}"/>`;
  $("wp-chart").innerHTML = svg + "</svg>";
  state.scale = sc;
}

/** One view at a time in the right-hand pane (null: the Gantt chart). */
function showView(name) {
  for (const k of ["workload", "sheet", "ev", "board", "cal", "net", "tuse", "ruse", "tl", "report"]) state[k] = k === name;
  if (name === "cal" && !state.calMonth) {
    const d = new Date((first() ? state.model.task(first()).start : state.model.doc.start) + "T00:00:00Z");
    state.calMonth = [d.getUTCFullYear(), d.getUTCMonth()];
  }
  render();
}

/** The Task Board: cards in Not started, In progress and Done; dragging a card to a column sets its progress. */
function renderBoard() {
  const b = board(state.model.doc, calendar().isWork, state.model.doc.statusDate || null);
  const sel = new Set(state.sel), drag = state.readOnly ? "" : 'draggable="true"';
  $("wp-chart").innerHTML = `<div class="wp-board">${BOARD_COLUMNS.map((c) => `<section class="wp-col" data-col="${c.key}"><h3>${c.title} <span>${b[c.key].length}</span></h3>${
    b[c.key].map((k) => `<article class="wp-card ${sel.has(k.id) ? "is-sel" : ""} ${k.late ? "is-late" : ""}" data-card="${k.id}" ${drag}>${k.phase ? `<small>${esc(k.phase)}</small>` : ""}<b>${k.milestone ? "◆ " : ""}${esc(k.name)}</b>` +
      `<span class="meta">${fmt(k.start)}${k.milestone ? "" : ` – ${fmt(k.finish)}`}${k.late ? " · late" : ""}</span>${k.owner ? `<span class="who">${esc(k.owner)}</span>` : ""}` +
      (c.key === "doing" ? `<span class="bar"><i style="width:${k.progress}%"></i></span>` : "") + `</article>`).join("")}</section>`).join("")}</div>`;
}
$("wp-chart").addEventListener("dragstart", (e) => { const c = e.target.closest("[data-card]"); if (c) e.dataTransfer.setData("text/x-ws-task", c.dataset.card); });
$("wp-chart").addEventListener("dragover", (e) => { const col = e.target.closest("[data-col]"); if (col && state.board) { e.preventDefault(); col.classList.add("is-over"); } });
$("wp-chart").addEventListener("dragleave", (e) => { const col = e.target.closest("[data-col]"); if (col) col.classList.remove("is-over"); });
$("wp-chart").addEventListener("drop", (e) => {
  const col = e.target.closest("[data-col]"), id = e.dataTransfer.getData("text/x-ws-task");
  if (!col || !id || !state.board) return;
  e.preventDefault();
  const t = state.model.task(id);
  run(() => { state.model.set(id, { progress: progressFor(col.dataset.col, t) }); state.sel = [id]; });
});

/** The Network Diagram: a box per task, in columns by its links; critical tasks outlined in red. */
function renderNet() {
  const n = network(state.model.doc, calendar().isWork);
  if (!n.nodes.length) { $("wp-chart").innerHTML = `<p class="wp-empty">Add tasks to see how they depend on each other.</p>`; return; }
  let crit = new Set();
  try { crit = new Set(criticalPath(schedule(state.model.doc, calendar()))); } catch { /* a plan that cannot be scheduled still draws */ }
  const sel = new Set(state.sel);
  let svg = `<svg class="wp-net" width="${n.width}" height="${n.height}" xmlns="${NS}"><defs><marker id="wp-net-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7z" class="wp-net-head"/></marker></defs>`;
  for (const e of n.edges) svg += `<polyline class="wp-net-link ${crit.has(e.from) && crit.has(e.to) ? "is-crit" : ""}" marker-end="url(#wp-net-arrow)" points="${e.points.map((p) => p.join(",")).join(" ")}"><title>${e.type}</title></polyline>`;
  for (const b of n.nodes) {
    const cls = `wp-node ${crit.has(b.id) ? "is-crit" : ""} ${sel.has(b.id) ? "is-sel" : ""} ${b.milestone ? "is-ms" : ""}`;
    const clip = (s, k) => (s.length > k ? s.slice(0, k - 1) + "…" : s);
    svg += `<g class="${cls}" data-card="${b.id}" transform="translate(${b.x},${b.y})"><rect width="${NODE.w}" height="${NODE.h}" rx="6"/>` +
      `<text x="10" y="18" class="t">${b.milestone ? "◆ " : ""}${esc(clip(b.name, 26))}</text>` +
      `<text x="10" y="37" class="s">Start ${fmt(b.start)}</text><text x="${NODE.w - 10}" y="37" class="s" text-anchor="end">ID ${b.n}</text>` +
      `<text x="10" y="53" class="s">Finish ${fmt(b.finish)}</text><text x="${NODE.w - 10}" y="53" class="s" text-anchor="end">${b.milestone ? "0 d" : b.duration + " d"}</text>` +
      `<text x="10" y="69" class="s">${esc(clip(b.owner, 30))}</text><title>${esc(b.name)}</title></g>`;
  }
  $("wp-chart").innerHTML = svg + "</svg>";
}

/** The Project Overview report: headline figures, milestones ahead, tasks running late and work by person. */
function renderReport() {
  const doc = state.model.doc, isWork = calendar().isWork;
  const o = overview(doc, { isWork, from: doc.statusDate || null });
  const late = [...state.behind.map((x) => ({ id: x.id, name: x.name, why: `${x.progress}% done, ${x.expected}% expected` })),
    ...pastDeadline(doc, isWork).filter((x) => !state.behind.some((b) => b.id === x.id)).map((x) => ({ id: x.id, name: x.name, why: `finishes ${fmt(x.finish)}, deadline ${fmt(x.deadline)}` }))];
  const tile = (label, value, sub = "", cls = "") => `<section class="wp-tile ${cls}"><span class="l">${label}</span><b>${value}</b><span class="s">${sub}</span></section>`;
  const slip = o.slipDays === null ? "No baseline set" : o.slipDays > 0 ? `${o.slipDays} day${o.slipDays === 1 ? "" : "s"} later than the baseline` : o.slipDays < 0 ? `${-o.slipDays} day${o.slipDays === -1 ? "" : "s"} earlier than the baseline` : "On the baseline";
  const over = o.baselineCost !== null && o.cost > o.baselineCost;
  const pct = (n) => (o.tasks ? (n / o.tasks) * 100 : 0);
  let h = `<div class="wp-report"><h2>${esc(doc.name)} <span>Project Overview${doc.statusDate ? ` · status ${fmt(doc.statusDate)}` : ""}</span></h2><div class="wp-tiles">` +
    tile("Complete", `${o.percent}%`, `<span class="wp-meter"><i style="width:${o.percent}%"></i></span>`) +
    tile("Finish", fmt(o.finish), slip, o.slipDays > 0 ? "is-bad" : "") +
    tile("Cost", formatMoney(o.cost), o.baselineCost === null ? "No baseline cost" : `${over ? "Over" : "Within"} the baseline of ${formatMoney(o.baselineCost)}`, over ? "is-bad" : "") +
    tile("Tasks", String(o.tasks), `<span class="wp-stack"><i class="todo" style="width:${pct(o.todo)}%"></i><i class="doing" style="width:${pct(o.doing)}%"></i><i class="done" style="width:${pct(o.done)}%"></i></span><span class="wp-key"><i class="todo"></i>${o.todo} not started <i class="doing"></i>${o.doing} in progress <i class="done"></i>${o.done} done</span>`) +
    `</div><div class="wp-panels">`;
  h += `<section class="wp-panel"><h3>Milestones ahead</h3>${o.milestones.length ? `<ul>${o.milestones.map((m) => `<li data-card="${m.id}"><span>◆ ${esc(m.name)}</span><span class="${m.deadline && m.date > m.deadline ? "is-late" : ""}">${fmt(m.date)}</span></li>`).join("")}</ul>` : `<p class="wp-empty">No milestones ahead.</p>`}</section>`;
  h += `<section class="wp-panel"><h3>Running late</h3>${late.length ? `<ul>${late.map((x) => `<li data-card="${x.id}"><span>${esc(x.name)}</span><span class="is-late">${x.why}</span></li>`).join("")}</ul>` : `<p class="wp-empty">${doc.statusDate ? "Nothing is behind." : "Set a status date (Project tab) to see what is behind."}</p>`}</section>`;
  const max = Math.max(1, ...o.people.map((p) => p.work));
  h += `<section class="wp-panel wide"><h3>Work by person</h3>${o.people.length ? `<table class="wp-bars">${o.people.map((p) => `<tr><th>${esc(p.name)}</th><td><span class="bar" style="width:${(p.work / max) * 100}%"></span><span class="v">${p.work} h${p.cost ? " · " + formatMoney(p.cost) : ""}</span></td></tr>`).join("")}</table>` : `<p class="wp-empty">No one is assigned yet.</p>`}</section>`;
  $("wp-chart").innerHTML = h + `</div></div>`;
}

/** The Timeline: the plan at a glance; phases as bars, milestones as diamonds, the status date as a line. */
function renderTimeline() {
  const w = Math.max(360, $("wp-chart").clientWidth - 24);
  const t = timeline(state.model.doc, calendar().isWork, w, state.model.doc.statusDate || null), sel = new Set(state.sel);
  if (!t.height) { $("wp-chart").innerHTML = `<p class="wp-empty">Add tasks to see the timeline.</p>`; return; }
  let svg = `<svg class="wp-tl" width="${w}" height="${t.height}" xmlns="${NS}"><rect class="wp-tl-bg" x="0" y="0" width="${w}" height="${t.height}" rx="8"/>`;
  for (const k of t.ticks) svg += `<line class="wp-tl-tick" x1="${k.x}" x2="${k.x}" y1="8" y2="${t.height - 8}"/><text class="wp-tl-month" x="${k.x + 4}" y="20">${k.label}</text>`;
  for (const b of t.bars) {
    const y = t.laneTop + b.lane * (t.barH + 6), clip = Math.max(0, Math.floor((b.w - 12) / 7));
    svg += `<g class="wp-tl-bar ${sel.has(b.id) ? "is-sel" : ""}" data-card="${b.id}"><rect x="${b.x}" y="${y}" width="${b.w}" height="${t.barH}" rx="5"/>` +
      `<rect class="done" x="${b.x}" y="${y + t.barH - 4}" width="${(b.w * b.progress) / 100}" height="4" rx="2"/>` +
      `<text x="${b.x + 6}" y="${y + 13}">${esc(b.name.length > clip ? b.name.slice(0, Math.max(0, clip - 1)) + (clip > 1 ? "…" : "") : b.name)}</text>` +
      `<text class="d" x="${b.x + 6}" y="${y + 25}">${b.w > 140 ? fmt(b.start) + " – " + fmt(b.finish) : ""}</text><title>${esc(b.name)}: ${fmt(b.start)} – ${fmt(b.finish)}</title></g>`;
  }
  for (const m of t.milestones) svg += `<g class="wp-tl-ms ${sel.has(m.id) ? "is-sel" : ""}" data-card="${m.id}"><line x1="${m.x}" x2="${m.x}" y1="${m.y}" y2="${m.labelY - 10}"/><path d="M${m.x},${m.y - 7} l7,7 l-7,7 l-7,-7z"/><text x="${m.anchor === "end" ? m.x - 4 : m.x + 4}" y="${m.labelY}" text-anchor="${m.anchor}">${esc(m.name)} · ${fmt(m.date)}</text><title>${esc(m.name)}</title></g>`;
  if (t.statusX !== null) svg += `<line class="wp-tl-status" x1="${t.statusX}" x2="${t.statusX}" y1="8" y2="${t.height - 8}"><title>Status date</title></line>`;
  $("wp-chart").innerHTML = svg + "</svg>";
}

/** The Calendar: a month of working days with the tasks that run on each. */
function renderCal() {
  const [y, mo] = state.calMonth;
  const m = month(state.model.doc, y, mo, calendar().isWork), sel = new Set(state.sel);
  let h = `<div class="wp-cal"><header><button type="button" data-cal="-1" title="Previous month">‹</button><b>${m.title}</b><button type="button" data-cal="1" title="Next month">›</button><button type="button" data-cal="0">Today</button></header>`;
  h += `<div class="grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("")}`;
  for (const w of m.weeks) w.forEach((d, wd) => {
    h += `<div class="day ${d.inMonth ? "" : "out"} ${d.working ? "" : "off"}"><span class="n">${Number(d.date.slice(8))}</span>` +
      d.tasks.slice(0, 4).map((t) => `<span class="chip ${t.milestone ? "ms" : ""} ${sel.has(t.id) ? "is-sel" : ""}" data-card="${t.id}" title="${esc(t.name)}">${t.first || t.milestone || wd === 0 ? esc(t.name) : "&nbsp;"}</span>`).join("") +
      (d.tasks.length > 4 ? `<span class="more">+${d.tasks.length - 4} more</span>` : "") + `</div>`;
  });
  $("wp-chart").innerHTML = h + "</div></div>";
}
$("wp-chart").addEventListener("click", (e) => {
  const nav = e.target.closest("[data-cal]");
  if (nav && state.cal) {
    const step = Number(nav.dataset.cal);
    if (step === 0) { const t = new Date(); state.calMonth = [t.getUTCFullYear(), t.getUTCMonth()]; }
    else { const d = new Date(Date.UTC(state.calMonth[0], state.calMonth[1] + step, 1)); state.calMonth = [d.getUTCFullYear(), d.getUTCMonth()]; }
    render(); return;
  }
  const card = e.target.closest("[data-card]");
  if (card && (state.board || state.cal || state.net || state.tuse || state.ruse || state.tl || state.report)) { state.sel = [card.dataset.card]; render(); }
});

/** Earned value at the status date: planned, earned and actual value per task, the indexes, and totals. */
function renderEv() {
  const r = earnedValue(state.model.doc, { isWork: calendar().isWork });
  if (r.error) { $("wp-chart").innerHTML = `<p class="wp-empty">${esc(r.error)}</p>`; return; }
  const m = (n) => formatMoney(n), idx = (x) => (x === null ? "–" : x.toFixed(2)), cls = (x) => (x !== null && x < 1 ? "is-over" : "");
  const neg = (n) => (n < 0 ? "is-over" : "");
  const line = (name, f, tag = "td") => `<tr><th>${name}</th><${tag} class="money">${m(f.bac)}</${tag}><${tag} class="money">${m(f.pv)}</${tag}><${tag} class="money">${m(f.ev)}</${tag}><${tag} class="money">${m(f.ac)}</${tag}>` +
    `<${tag} class="money ${neg(f.sv)}">${m(f.sv)}</${tag}><${tag} class="money ${neg(f.cv)}">${m(f.cv)}</${tag}><${tag} class="${cls(f.spi)}">${idx(f.spi)}</${tag}><${tag} class="${cls(f.cpi)}">${idx(f.cpi)}</${tag}><${tag} class="money">${m(f.eac)}</${tag}></tr>`;
  let h = `<p class="wp-evnote">At the status date, ${fmt(r.statusDate)}, against “${esc(r.baseline)}”. Actual cost is the current cost of the work done.</p>`;
  h += `<table class="wp-load wp-ev"><thead><tr><th>Task</th><th title="Budget at completion: the baselined cost">BAC</th><th title="Planned value: the budget of the work planned by the status date">PV</th><th title="Earned value: the budget of the work done">EV</th><th title="Actual cost of the work done">AC</th><th title="Schedule variance: EV − PV">SV</th><th title="Cost variance: EV − AC">CV</th><th title="Schedule performance: EV ÷ PV; under 1 is behind">SPI</th><th title="Cost performance: EV ÷ AC; under 1 is over budget">CPI</th><th title="Estimate at completion: BAC ÷ CPI">EAC</th></tr></thead><tbody>`;
  for (const row of r.rows) h += line(esc(row.name), row);
  $("wp-chart").innerHTML = h + `</tbody><tfoot>${line("Project", r.total)}</tfoot></table>`;
}

/** The Resource Sheet: everyone on the plan, with a rate per hour and a cost per use to type in. */
/** Task Usage and Resource Usage: hours per week, a row per task (or person) with its people (or tasks) beneath. */
function renderUsage(by) {
  const u = usage(state.model.doc, calendar().isWork, by);
  if (!u.rows.length) { $("wp-chart").innerHTML = `<p class="wp-empty">No work is assigned yet. Type names in the Owner column to see hours per week here.</p>`; return; }
  const fmt = (d) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  const cells = (r, over) => u.weeks.map((w) => `<td class="${over && over.has(w) ? "is-over" : ""}">${r.weeks.get(w) ? r.weeks.get(w) + " h" : ""}</td>`).join("");
  let h = `<table class="wp-load wp-usage"><thead><tr><th>${by === "task" ? "Task" : "Person"}</th><th>Work</th>${u.weeks.map((w) => `<th>${fmt(w)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of u.rows) {
    h += `<tr class="wp-usage-top"${r.id ? ` data-card="${esc(r.id)}"` : ""}><th>${esc(r.name)}${r.over && r.over.size ? ' <span class="wp-over" title="Over-allocated">!</span>' : ""}</th><td>${r.total} h</td>${cells(r, r.over)}</tr>`;
    for (const c of r.children) h += `<tr class="wp-usage-sub"${c.id ? ` data-card="${esc(c.id)}"` : ""}><th>${esc(c.name)}</th><td>${c.total} h</td>${cells(c)}</tr>`;
  }
  $("wp-chart").innerHTML = h + `</tbody></table>`;
}

function renderSheet() {
  const rows = resourceSheet(state.model.doc);
  if (!rows.length) { $("wp-chart").innerHTML = `<p class="wp-empty">No one is assigned yet. Type names in the Owner column; each person then gets a row here for their rate.</p>`; return; }
  const ro = state.readOnly ? "disabled" : "";
  let h = `<table class="wp-load wp-sheet"><thead><tr><th>Person</th><th>Rate per hour</th><th>Cost per use</th><th>Tasks</th><th>Work</th><th>Cost</th></tr></thead><tbody>`;
  for (const r of rows) {
    h += `<tr><th>${esc(r.name)}</th><td><input data-rate="${esc(r.name)}" data-field="rate" type="number" min="0" step="0.01" value="${r.rate || ""}" placeholder="0.00" ${ro}></td>` +
      `<td><input data-rate="${esc(r.name)}" data-field="costPerUse" type="number" min="0" step="0.01" value="${r.costPerUse || ""}" placeholder="0.00" ${ro}></td>` +
      `<td>${r.tasks}</td><td>${r.work} h</td><td class="money">${formatMoney(r.cost)}</td></tr>`;
  }
  $("wp-chart").innerHTML = h + `</tbody><tfoot><tr><th>Total</th><td></td><td></td><td></td><td>${Math.round(rows.reduce((s, r) => s + r.work, 0) * 100) / 100} h</td><td class="money">${formatMoney(rows.reduce((s, r) => s + r.cost, 0))}</td></tr></tfoot></table>`;
}
$("wp-chart").addEventListener("change", (e) => {
  const input = e.target.closest("[data-rate]");
  if (!input) return;
  const v = input.value.trim();
  run(() => {
    if (v !== "" && !(Number(v) >= 0)) throw new Error("A rate is an amount, 0 or more");
    state.model.setResource(input.dataset.rate, { [input.dataset.field]: v === "" ? null : Math.round(Number(v) * 100) / 100 });
  });
});

/** The workload view: each person's task-days per week; a red cell has a day with two tasks or more. */
function renderWorkload() {
  const rows = weeklyLoad(state.model.doc, calendar().isWork);
  if (!rows.length) { $("wp-chart").innerHTML = `<p class="wp-empty">No one is assigned yet. Type names in the Owner column, separated by commas; add a percentage for part time, like “Priya 50%”.</p>`; return; }
  const weeks = [...new Set(rows.flatMap((r) => r.weeks.map((w) => w.start)))].sort();
  const short = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  let h = `<table class="wp-load"><thead><tr><th>Person</th>${weeks.map((w) => `<th>${short(w)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of rows) {
    const by = new Map(r.weeks.map((w) => [w.start, w]));
    const hasOver = r.weeks.some((w) => w.peak > 1);
    h += `<tr><th>${esc(r.name)}${hasOver ? ' <span class="wp-warn" title="Over-allocated">!</span>' : ""}</th>${weeks.map((w) => {
      const c = by.get(w);
      return c ? `<td class="${c.peak > 1 ? "is-over" : ""}" title="${c.days} person-day${c.days === 1 ? "" : "s"}${c.peak > 1 ? `, up to ${Math.round(c.peak * 100)}% on one day` : ""}">${c.days}d</td>` : "<td></td>";
    }).join("")}</tr>`;
  }
  $("wp-chart").innerHTML = h + "</tbody></table>";
}

function costText() {
  const total = costs(state.model.doc).total;
  const ev = state.model.doc.statusDate ? earnedValue(state.model.doc, { isWork: calendar().isWork }) : { error: true };
  const idx = !ev.error && ev.total.spi !== null ? ` · SPI ${ev.total.spi.toFixed(2)}${ev.total.cpi !== null ? ` · CPI ${ev.total.cpi.toFixed(2)}` : ""}` : "";
  return total ? `<span title="SPI under 1: behind schedule. CPI under 1: over budget.">Cost: ${formatMoney(total)}${idx}</span>` : "";
}

function deadlineText() {
  const late = pastDeadline(state.model.doc, calendar().isWork);
  return late.length ? `<span class="err" title="${esc(late.map((x) => `${x.name}: finishes ${fmt(x.finish)}, deadline ${fmt(x.deadline)}`).join("\n"))}">${late.length} past deadline</span>` : "";
}

function behindText() {
  const sd = state.model.doc.statusDate;
  if (!sd) return "";
  if (!state.behind.length) return `<span>Status ${fmt(sd)}: on track</span>`;
  const late = state.behind.filter((x) => x.late).length;
  return `<span class="warn" title="${esc(state.behind.map((x) => `${x.name}: ${x.progress}% of ${x.expected}%`).join("\n"))}">Status ${fmt(sd)}: ${state.behind.length} behind${late ? `, ${late} late` : ""}</span>`;
}

function overText() {
  if (!state.over.length) return "";
  const names = [...new Set(state.over.map((o) => o.name))];
  return `<span class="err" title="${esc(state.over.map((o) => `${o.name}: ${fmt(o.from)}${o.to !== o.from ? " – " + fmt(o.to) : ""}`).join("\n"))}">Over-allocated: ${esc(names.join(", "))}</span>`;
}

/** The selected task's slip against the baseline, for the status bar. */
function slipText() {
  if (!state.showBaseline || !first() || !state.model.baseline("Baseline")) return "";
  const v = state.model.variance(first(), "Baseline");
  if (!v) return `<span>${esc(state.model.task(first()).name)}: not in the baseline</span>`;
  const days = Math.abs(v.finishSlip), unit = state.model.isWork ? "working day" : "day";
  const when = v.finishSlip === 0 ? "on plan" : `${days} ${unit}${days === 1 ? "" : "s"} ${v.finishSlip > 0 ? "late" : "early"}`;
  return `<span>${esc(state.model.task(first()).name)}: ${when} against the baseline</span>`;
}

/* ---- render ---- */
let rendering = false;
/** The rows on screen: the outline (less collapsed summaries), through the task filter. */
function shownRows() {
  const rows = visibleRows(state.model, state.collapsed);
  let keep = null;
  try {
    let critical = new Set();
    if (state.filter === "critical") critical = new Set(criticalPath(schedule(state.model.doc, calendar())));
    keep = filterTasks(state.model.doc, state.filter, { critical, behind: new Set(state.behind.map((x) => x.id)), deadline: new Set(pastDeadline(state.model.doc, calendar().isWork).map((x) => x.id)) });
  } catch { keep = null; }
  const shown = keep ? rows.filter((r) => keep.has(r.id)) : rows;
  if (state.group === "none") return shown;
  let critical = new Set();
  if (state.group === "critical") try { critical = new Set(criticalPath(schedule(state.model.doc, calendar()))); } catch { /* none */ }
  // grouped, every task shows: collapsing applies to the headings instead
  const all = keep ? state.model.tasks.map((t) => state.model.view(t.id)).filter((r) => keep.has(r.id)) : state.model.tasks.map((t) => state.model.view(t.id));
  const grouped = groupRows(all, state.model.doc, state.group, { critical });
  let hide = false;
  return grouped.filter((r) => (r.group ? ((hide = state.collapsed.has(r.id)), true) : !hide));
}
/** The tasks' ids among the rows (group headings left out). */
const taskIds = (rows) => rows.filter((r) => !r.group).map((r) => r.id);
/** The Filter box: the fixed filters, then one per person. */
function fillFilter() {
  const sel = $("wp-filter"), people = [...new Set(state.model.doc.tasks.flatMap((t) => assignmentsOf(t).map((a) => a.name)))].sort();
  if (state.filter.startsWith("person:") && !people.includes(state.filter.slice(7))) state.filter = "all";
  const html = FILTERS.map((f) => `<option value="${f.key}">${f.title}</option>`).join("") + (people.length ? `<optgroup label="Assigned to">${people.map((p) => `<option value="person:${esc(p)}">${esc(p)}</option>`).join("")}</optgroup>` : "");
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
  sel.value = state.filter;
  const g = $("wp-group");
  if (!g.options.length) g.innerHTML = GROUPS.map((x) => `<option value="${x.key}">${x.title}</option>`).join("");
  g.value = state.group;
  $("wp-filter-on").hidden = state.filter === "all";
}

function render() {
  // redrawing removes a focused edit box, whose blur would save and redraw again mid-render
  if (rendering) return;
  rendering = true;
  try { draw(); } finally { rendering = false; }
}
function draw() {
  state.model.isWork = calendar().isWork; // the grid, the chart and the scheduler count the same working days
  try { state.over = overallocations(state.model.doc, calendar().isWork); } catch { state.over = []; }
  try { state.behind = behindSchedule(state.model.doc, state.model.doc.statusDate, calendar().isWork); } catch { state.behind = []; }
  const rows = shownRows();
  fillFilter();
  renderGrid(rows);
  $("wp-status-date").value = state.model.doc.statusDate || "";
  const firstTyped = typedTargets()[0] ? state.model.task(typedTargets()[0]) : null;
  $("wp-type").value = firstTyped?.type || "fixedUnits";
  $("wp-effort").checked = !!firstTyped?.effortDriven;
  $("wp-type").disabled = $("wp-effort").disabled = state.readOnly || !firstTyped;
  const view = state.report ? "viewReport" : state.tl ? "viewTimeline" : state.tuse ? "viewTaskUsage" : state.ruse ? "viewResUsage" : state.net ? "viewNet" : state.board ? "viewBoard" : state.cal ? "viewCal" : state.ev ? "viewEv" : state.sheet ? "viewSheet" : state.workload ? "viewWorkload" : "viewGantt";
  for (const b of document.querySelectorAll('[data-cmd^="view"]')) b.setAttribute("aria-pressed", String(b.dataset.cmd === view));
  if (state.report) renderReport(); else if (state.tl) renderTimeline(); else if (state.tuse) renderUsage("task"); else if (state.ruse) renderUsage("resource"); else if (state.net) renderNet(); else if (state.board) renderBoard(); else if (state.cal) renderCal(); else if (state.ev) renderEv(); else if (state.sheet) renderSheet(); else if (state.workload) renderWorkload(); else renderChart(rows);
  $("wp-title").textContent = state.fileName.replace(/\.wsproj$/, "") + (state.model.undoStack.length !== (state.saved || 0) ? " •" : ""); // • unsaved changes
  $("wp-mode").hidden = !state.readOnly;
  $("wp-mode-text").textContent = reasonText(state.licence || "no_license");
  $("wp-upgrade").hidden = state.licence === "unavailable" || state.licence === "unknown";
  $("wp-retry").hidden = !$("wp-upgrade").hidden;
  for (const b of document.querySelectorAll("[data-edit]")) b.disabled = state.readOnly;
  $("wp-ribbon").querySelector('[data-cmd="undo"]').disabled ||= !state.model.undoStack.length;
  $("wp-ribbon").querySelector('[data-cmd="redo"]').disabled ||= !state.model.redoStack.length;
  const all = state.model.tasks.map((t) => state.model.view(t.id));
  const finish = all.length ? all.reduce((m, v) => (v.finish > m ? v.finish : m), all[0].finish) : null;
  $("wp-status").innerHTML = `<span>${state.model.tasks.length} task${state.model.tasks.length === 1 ? "" : "s"}</span>${finish ? `<span>Finish: ${fmt(finish)}</span>` : ""}<span>${state.model.doc.links.length} link${state.model.doc.links.length === 1 ? "" : "s"}</span>${costText()}${deadlineText()}${behindText()}${overText()}${state.message ? `<span class="err" role="alert">${esc(state.message)}</span>` : state.note ? `<span>${esc(state.note)}</span>` : slipText()}`;
}

/* ---- events ---- */
document.querySelectorAll(".wp-tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
function showTab(name) {
  document.querySelectorAll(".wp-tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
  document.querySelectorAll(".wp-group").forEach((g) => g.classList.toggle("is-on", g.dataset.tab === name));
}
$("wp-ribbon").addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b && !b.disabled) commands[b.dataset.cmd](); });
$("wp-zoom").addEventListener("change", (e) => { state.zoom = e.target.value; render(); });
$("wp-group").addEventListener("change", (e) => { state.group = e.target.value; render(); });
$("wp-filter").addEventListener("change", (e) => { state.filter = e.target.value; render(); });
$("wp-cal").addEventListener("change", (e) => { state.cal = e.target.value; render(); });
$("wp-critical").addEventListener("change", (e) => { state.showCritical = e.target.checked; render(); });
/* task type and effort driven: for the selected tasks (not summaries or milestones) */
function typedTargets() { return selected().filter((id) => !state.model.isSummary(id) && state.model.task(id).duration > 0); }
$("wp-type").addEventListener("change", (e) => run(() => {
  const ids = typedTargets();
  if (!ids.length) throw new Error("Select tasks to set their type");
  state.model.edit((d) => { for (const t of d.tasks) if (ids.includes(t.id)) t.type = e.target.value === "fixedUnits" ? undefined : e.target.value; });
}));
$("wp-effort").addEventListener("change", (e) => run(() => {
  const ids = typedTargets();
  if (!ids.length) throw new Error("Select tasks to make effort driven");
  state.model.edit((d) => { for (const t of d.tasks) if (ids.includes(t.id)) t.effortDriven = e.target.checked || undefined; });
}));
$("wp-status-date").addEventListener("change", (e) => run(() => state.model.setStatusDate(e.target.value || null)));
$("wp-baseline").addEventListener("change", (e) => { state.showBaseline = e.target.checked; render(); });
$("wp-upgrade").addEventListener("click", () => (window.WorkSuiteProject.onUpgrade || openUpgrade)());
$("wp-retry").addEventListener("click", () => applyLicence());
/** Free viewing, Pro editing (#73): asks the local service at startup and on Try again. */
async function applyLicence() {
  const r = await checkEdit("project.edit");
  state.licence = r.reason;
  window.WorkSuiteProject.setReadOnly(!r.edit);
}

$("wp-grid").addEventListener("click", (e) => {
  const tog = e.target.closest("[data-toggle]");
  if (tog) { const id = tog.dataset.toggle; state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); render(); return; }
  if (e.target.closest("tr[data-group]")) return;
  const tr = e.target.closest("tr[data-id]");
  if (!tr || e.target.closest("input")) return;
  const id = tr.dataset.id;
  // a double-click edits the cell: the first click redraws the table, so the browser may never send "dblclick";
  // the second click itself says it is the second (detail 2) and lands on the redrawn cell
  if (e.detail === 2 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const td = e.target.closest("td");
    if (td) { state.sel = [id]; startEdit(id, cols()[td.cellIndex].key); }
    return;
  }
  if (e.ctrlKey || e.metaKey) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
  else if (e.shiftKey && state.sel.length) {
    const rows = taskIds(shownRows()), a = rows.indexOf(state.sel[0]), b = rows.indexOf(id);
    state.sel = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else state.sel = [id];
  state.note = ""; // a new selection: the status bar shows its baseline slip, not the last command's note
  render();
  $("wp-grid").focus();
});
$("wp-grid").addEventListener("keydown", (e) => {
  const input = e.target.closest("[data-edit-input]");
  if (input) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(input.value); $("wp-grid").focus(); }
    else if (e.key === "Escape") { state.editing = null; render(); $("wp-grid").focus(); }
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); commands.undo(); }
  else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); commands.redo(); }
  else if (e.key === "Insert" || (mod && e.key === "Enter")) { e.preventDefault(); commands.addTask(); }
  else if (e.key === "Delete") { e.preventDefault(); commands.remove(); }
  else if (e.key === "Tab") { e.preventDefault(); e.shiftKey ? commands.outdent() : commands.indent(); }
  else if (e.key === "F2" && first()) { e.preventDefault(); startEdit(first(), "name"); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const rows = taskIds(shownRows());
    const i = Math.max(0, rows.indexOf(first())), j = Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    if (rows.length) { state.sel = [rows[j]]; render(); }
  } else if (e.key.length === 1 && !mod && first()) { startEdit(first(), "name"); const inp = $("wp-grid").querySelector("[data-edit-input]"); if (inp) inp.value = e.key; e.preventDefault(); }
});
$("wp-grid").addEventListener("focusout", (e) => {
  const input = e.target.closest?.("[data-edit-input]");
  if (input && state.editing && !rendering) commitEdit(input.value);
});

// dragging bars in the chart: move, or change the duration from the right end
$("wp-chart").addEventListener("pointerdown", (e) => {
  const hit = e.target.closest("[data-drag]");
  if (!hit || state.readOnly) return;
  const id = hit.dataset.id, mode = hit.dataset.drag, x0 = e.clientX, task = { ...state.model.task(id) };
  state.sel = [id];
  hit.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = ev.clientX - x0;
    const preview = mode === "move" ? { start: dragStart(task, dx, state.scale.dayW) } : { duration: dragDuration(task, dx, state.scale.dayW) };
    Object.assign(state.model.task(id), preview); // a live preview; the real edit happens on release
    renderChart(shownRows());
  };
  const up = (ev) => {
    hit.removeEventListener("pointermove", move);
    Object.assign(state.model.task(id), { start: task.start, duration: task.duration });
    const dx = ev.clientX - x0;
    if (Math.abs(dx) >= state.scale.dayW / 2) run(() => state.model.set(id, mode === "move" ? { start: dragStart(task, dx, state.scale.dayW) } : { duration: dragDuration(task, dx, state.scale.dayW) }));
    else render();
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerup", up, { once: true });
});
// keep the grid and chart rows together when either scrolls
$("wp-chart").addEventListener("scroll", () => { $("wp-grid").scrollTop = $("wp-chart").scrollTop; });
$("wp-grid").addEventListener("scroll", () => { $("wp-chart").scrollTop = $("wp-grid").scrollTop; });

$("wp-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { load(new Uint8Array(await f.arrayBuffer()), f.name); } catch (err) { state.message = "Could not open " + f.name + ": " + err.message; render(); }
  e.target.value = "";
});

/** Opens a project: the bytes of a .wsproj file (or its JSON text). */
function load(input, name = "Project.wsproj") {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (isMpp(bytes, name)) throw new Error(MPP_HELP); // closed format: how to save it as Project XML instead
  let i = 0;
  while (i < bytes.length && (bytes[i] <= 0x20 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++; // spaces, a BOM
  if (bytes[i] === 0x3c) { // "<": Project XML (#84), opened as a new WorkSuite project
    const { doc, problems } = fromProjectXml(new TextDecoder().decode(bytes));
    state.model = new ProjectModel(doc);
    state.saved = -1; // not saved as .wsproj yet
    state.fileName = name.replace(/\.xml$/i, "") + ".wsproj";
    state.sel = [];
    state.collapsed.clear();
    state.note = problems.length ? "" : `Opened ${name} (Project XML)`;
    state.message = problems.join("; ");
    render();
    return;
  }
  state.model = new ProjectModel(parse(typeof input === "string" ? input : unpackDocument(input, APP)));
  state.saved = 0;
  state.fileName = name;
  state.sel = [];
  state.collapsed.clear();
  render();
}

/* printing: the chart is scaled so the whole timeline fits the page width (A4 landscape less margins) */
function fitForPrint() {
  const svg = $("wp-chart").querySelector("svg");
  const width = svg ? Number(svg.getAttribute("width")) : 0;
  $("wp-chart").style.setProperty("--print-zoom", width ? String(Math.min(1, 1046 / width)) : "1");
  // on paper the chart is as tall as its tasks, not the window; the next redraw restores the screen size
  if (svg) svg.setAttribute("height", String(shownRows().length * ROW_H + 8));
}
window.addEventListener("beforeprint", fitForPrint);
window.addEventListener("afterprint", () => render());
matchMedia("print").addEventListener?.("change", (e) => e.matches && fitForPrint());

/* the shell's handle (#72): load a file, read it back, free viewing without Pro (#73) */
window.WorkSuiteProject = {
  load,
  text: () => serialize(state.model.doc),
  bytes: () => packDocument(APP, serialize(state.model.doc)),
  setReadOnly(on) { state.readOnly = !!on; state.editing = null; render(); },
  onUpgrade: null,
};

// a sample plan to try the editor: ?sample
if (new URLSearchParams(location.search).has("sample")) {
  const m = new ProjectModel(newProject("Office move", "2026-02-02"));
  const plan = m.addTask({ name: "Planning", start: "2026-02-02", duration: 8 });
  const site = m.addTask({ name: "Choose new site", level: 1, start: "2026-02-02", duration: 4, progress: 100, owner: "Nimal" }, plan);
  const lease = m.addTask({ name: "Sign lease", start: "2026-02-06", duration: 3, progress: 60, owner: "Ayesha" }, site);
  const signed = m.addMilestone({ name: "Lease signed", start: "2026-02-11" }, lease);
  const fit = m.addTask({ name: "Fit-out", start: "2026-02-12", duration: 15 }, plan);
  const net = m.addTask({ name: "Network and power", level: 1, start: "2026-02-12", duration: 6, progress: 30, owner: "Ravi" }, fit);
  const furn = m.addTask({ name: "Furniture", start: "2026-02-12", duration: 8, progress: 10, owner: "Ayesha, Ravi 50%" }, net);
  const sec = m.addTask({ name: "Security and access", start: "2026-02-20", duration: 5, owner: "Ravi" }, furn);
  const insp = m.addTask({ name: "Inspection", start: "2026-02-27", duration: 4, owner: "Nimal", deadline: "2026-03-03" }, sec);
  m.addTask({ name: "Art for the walls (if budget allows)", start: "2026-03-02", duration: 3, owner: "Ayesha", inactive: true }, insp);
  const mv = m.addTask({ name: "Move", start: "2026-03-05", duration: 7 }, fit);
  const pack = m.addTask({ name: "Pack and label", level: 1, start: "2026-03-05", duration: 3, owner: "Team" }, mv);
  const day = m.addTask({ name: "Moving day", start: "2026-03-10", duration: 2, owner: "Movers" }, pack);
  const it = m.addTask({ name: "IT check and go-live", start: "2026-03-12", duration: 2, owner: "Ravi" }, day);
  const open = m.addMilestone({ name: "Open for business", start: "2026-03-13" }, it);
  [[site, lease], [lease, signed], [net, sec], [sec, insp], [insp, pack], [pack, day], [day, it], [it, open]].forEach(([a, b]) => m.link(a, b));
  m.setStatusDate("2026-02-18");
  m.setResource("Nimal", { rate: 2500 }); m.setResource("Ayesha", { rate: 2200 }); m.setResource("Ravi", { rate: 2800 }); m.setResource("Movers", { costPerUse: 45000 });
  m.set(m.tasks.find((t) => t.name === "Furniture").id, { fixedCost: 380000 });
  m.isWork = STANDARD.isWork; m.saveBaseline("Baseline", "2026-01-30");
  m.setResource("Ravi", { rate: 3000 }); // dearer than planned: the cost index shows it
  state.model = new ProjectModel(m.doc);
  state.fileName = "Office move.wsproj";
}
if (new URLSearchParams(location.search).has("readonly")) state.readOnly = true;
else applyLicence();
ribbonStyles();
decorateRibbon($("wp-ribbon"));
showTab("task");
render();
