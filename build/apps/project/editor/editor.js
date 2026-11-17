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
import { ProjectModel, newProject, parse, serialize, finishOf, APP } from "../core/project.js";
import { fromProjectXml, toProjectXml, isMpp, MPP_HELP } from "../core/projectxml.js";
import { schedule, applySchedule, criticalPath, STANDARD, SRI_LANKA } from "../core/schedule.js";
import { overallocations, weeklyLoad } from "../core/resources.js";
import { behindSchedule } from "../core/progress.js";
import { outlineToDoc } from "../core/outline.js";
import { askText } from "../../common/dialog.js";
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
  { key: "name", label: "Task name", w: 210, edit: true },
  { key: "duration", label: "Duration", w: 72, edit: true },
  { key: "start", label: "Start", w: 104, edit: true },
  { key: "finish", label: "Finish", w: 104 },
  { key: "progress", label: "% done", w: 60, edit: true },
  { key: "owner", label: "Owner", w: 90, edit: true },
];

const calendar = () => (state.cal === "lk" ? SRI_LANKA : STANDARD);
const state = {
  cal: "standard",
  showBaseline: false,
  showCritical: false,
  workload: false, // the workload view in place of the Gantt chart (#86)
  note: "",
  model: new ProjectModel(newProject("Untitled project", mondayOf(new Date()))),
  behind: [], // tasks behind at the status date: [{ id, name, expected, progress, behind, late }]
  over: [], // over-allocations: [{ name, from, to, days, tasks }]
  sel: [], // selected task ids, in the order they were picked
  collapsed: new Set(),
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
  aiPlan: () => aiPlan(),
  save: () => { download(state.fileName, packDocument(APP, serialize(state.model.doc)), "application/zip"); state.saved = state.model.undoStack.length; render(); },
  exportCsv: () => download(state.fileName.replace(/\.wsproj$/, "") + ".csv", toCsv(), "text/csv"),
  exportXml: () => download(state.fileName.replace(/\.wsproj$/, "") + ".xml", toProjectXml(state.model.doc, calendar().isWork), "application/xml"),
  exportXlsx: () => download(state.fileName.replace(/\.wsproj$/, "") + ".xlsx", xlsx(tableRows(), state.model.doc.name), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  print: () => { fitForPrint(); window.print(); },
  addTask: () => run(() => { const id = state.model.addTask({ start: startForNew() }, first() || null); state.sel = [id]; startEdit(id, "name"); }),
  addMilestone: () => run(() => { const id = state.model.addMilestone({ start: startForNew() }, first() || null); state.sel = [id]; }),
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
  today: () => { const sc = timescale(visibleRows(state.model, state.collapsed), state.zoom, state.model.doc.start); $("wp-chart").scrollLeft = Math.max(0, sc.x(new Date().toISOString().slice(0, 10)) - 120); },
};

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
  const rows = [["ID", "Level", "Task name", "Duration (days)", "Start", "Finish", "% done", "Owner", "Predecessors"]];
  state.model.tasks.forEach((t, i) => {
    const v = state.model.view(t.id);
    const preds = state.model.doc.links.filter((l) => l.to === t.id).map((l) => `${state.model.indexOf(l.from) + 1}${l.type}${l.lag ? (l.lag > 0 ? "+" : "") + l.lag + "d" : ""}`).join(";");
    rows.push([i + 1, t.level, "  ".repeat(t.level) + t.name, v.duration, v.start, v.finish, v.progress, t.owner || "", preds]);
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
  let html = `<table class="wp-table"><colgroup>${COLS.map((c) => `<col style="width:${c.w}px">`).join("")}</colgroup><tr>${COLS.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  for (const r of rows) {
    const n = t.indexOf(r.id) + 1;
    const cells = COLS.map((c) => {
      if (state.editing && state.editing.id === r.id && state.editing.key === c.key) {
        const value = c.key === "duration" ? `${r.duration}d` : c.key === "progress" ? r.progress : (r[c.key] ?? "");
        return `<td class="${c.key}"><input data-edit-input value="${esc(value)}" ${c.key === "start" ? 'type="date"' : ""}></td>`;
      }
      if (c.key === "n") return `<td class="n">${n}</td>`;
      if (c.key === "name") {
        const tw = r.summary ? `<span class="tw" data-toggle="${r.id}">${state.collapsed.has(r.id) ? "▸" : "▾"}</span>` : `<span class="tw"></span>`;
        return `<td class="name" style="padding-inline-start:${8 + r.level * 16}px">${tw}${esc(r.name)}</td>`;
      }
      if (c.key === "duration") return `<td>${r.milestone ? "0 d" : `${r.duration} d`}</td>`;
      if (c.key === "start" || c.key === "finish") return `<td>${fmt(r[c.key])}</td>`;
      if (c.key === "progress") return `<td>${r.progress}%</td>`;
      return `<td>${esc(r[c.key])}</td>`;
    }).join("");
    html += `<tr data-id="${r.id}" class="${selSet.has(r.id) ? "is-sel" : ""} ${r.summary ? "is-summary" : ""}">${cells}</tr>`;
  }
  $("wp-grid").innerHTML = html + "</table>";
  const input = $("wp-grid").querySelector("[data-edit-input]");
  if (input) { input.focus(); input.select?.(); }
}

function startEdit(id, key) {
  if (state.readOnly) return;
  const col = COLS.find((c) => c.key === key);
  if (!col || !col.edit) return;
  if (state.model.isSummary(id) && (key === "duration" || key === "start" || key === "progress")) { state.message = "A summary's dates and progress come from its subtasks"; render(); return; }
  state.editing = { id, key };
  render();
}
function commitEdit(value) {
  const { id, key } = state.editing;
  state.editing = null;
  const fields = {};
  if (key === "name") fields.name = value.trim() || "Task";
  else if (key === "owner") fields.owner = value.trim() || undefined;
  else if (key === "start") { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { state.message = "Start must be a date"; render(); return; } fields.start = value; }
  else if (key === "duration") { const d = parseDuration(value); if (d === null) { state.message = "Duration is whole days, like 5 or 2w"; render(); return; } fields.duration = d; }
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
  for (const l of state.model.doc.links) {
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
      const crit = critical.has(b.id) ? " is-crit" : "";
      const late = behind.get(b.id);
      if (late) svg += `<rect class="wp-behind" x="${b.x - 4}" y="${b.y + 4}" width="${b.w + 8}" height="22" rx="6"><title>${late.late ? "Late" : "Behind"}: ${late.progress}% done, ${late.expected}% expected by the status date</title></rect>`;
      if (over.has(b.id)) svg += `<rect class="wp-over" x="${b.x - 2}" y="${b.y + 6}" width="${b.w + 4}" height="18" rx="5"><title>Someone on this task has another task at the same time</title></rect>`;
      svg += `<rect class="wp-bar${crit}" x="${b.x}" y="${b.y + 8}" width="${b.w}" height="14" rx="4"/>`;
      if (b.progress) svg += `<rect class="wp-bar-done${crit}" x="${b.x}" y="${b.y + 8}" width="${(b.w * b.progress) / 100}" height="14" rx="4"/>`;
      if (r.owner) svg += `<text class="wp-label" x="${b.x + b.w + 6}" y="${b.y + 19}">${esc(r.owner)}</text>`;
      svg += `<rect class="wp-hit" data-drag="move" data-id="${b.id}" x="${b.x}" y="${b.y + 4}" width="${Math.max(0, b.w - 6)}" height="22"/><rect class="wp-grip" data-drag="size" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + 4}" width="10" height="22"/>`;
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
function render() {
  // redrawing removes a focused edit box, whose blur would save and redraw again mid-render
  if (rendering) return;
  rendering = true;
  try { draw(); } finally { rendering = false; }
}
function draw() {
  state.model.isWork = calendar().isWork; // the grid, the chart and the scheduler count the same working days
  const rows = visibleRows(state.model, state.collapsed);
  renderGrid(rows);
  try { state.over = overallocations(state.model.doc, calendar().isWork); } catch { state.over = []; }
  try { state.behind = behindSchedule(state.model.doc, state.model.doc.statusDate, calendar().isWork); } catch { state.behind = []; }
  $("wp-status-date").value = state.model.doc.statusDate || "";
  if (state.workload) renderWorkload(); else renderChart(rows);
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
  $("wp-status").innerHTML = `<span>${state.model.tasks.length} task${state.model.tasks.length === 1 ? "" : "s"}</span>${finish ? `<span>Finish: ${fmt(finish)}</span>` : ""}<span>${state.model.doc.links.length} link${state.model.doc.links.length === 1 ? "" : "s"}</span>${behindText()}${overText()}${state.message ? `<span class="err" role="alert">${esc(state.message)}</span>` : state.note ? `<span>${esc(state.note)}</span>` : slipText()}`;
}

/* ---- events ---- */
document.querySelectorAll(".wp-tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
function showTab(name) {
  document.querySelectorAll(".wp-tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
  document.querySelectorAll(".wp-group").forEach((g) => g.classList.toggle("is-on", g.dataset.tab === name));
}
$("wp-ribbon").addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b && !b.disabled) commands[b.dataset.cmd](); });
$("wp-zoom").addEventListener("change", (e) => { state.zoom = e.target.value; render(); });
$("wp-cal").addEventListener("change", (e) => { state.cal = e.target.value; render(); });
$("wp-critical").addEventListener("change", (e) => { state.showCritical = e.target.checked; render(); });
$("wp-status-date").addEventListener("change", (e) => run(() => state.model.setStatusDate(e.target.value || null)));
$("wp-workload").addEventListener("change", (e) => { state.workload = e.target.checked; render(); });
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
  const tr = e.target.closest("tr[data-id]");
  if (!tr || e.target.closest("input")) return;
  const id = tr.dataset.id;
  // a double-click edits the cell: the first click redraws the table, so the browser may never send "dblclick";
  // the second click itself says it is the second (detail 2) and lands on the redrawn cell
  if (e.detail === 2 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const td = e.target.closest("td");
    if (td) { state.sel = [id]; startEdit(id, COLS[td.cellIndex].key); }
    return;
  }
  if (e.ctrlKey || e.metaKey) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
  else if (e.shiftKey && state.sel.length) {
    const rows = visibleRows(state.model, state.collapsed).map((r) => r.id), a = rows.indexOf(state.sel[0]), b = rows.indexOf(id);
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
    const rows = visibleRows(state.model, state.collapsed).map((r) => r.id);
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
    renderChart(visibleRows(state.model, state.collapsed));
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
  if (svg) svg.setAttribute("height", String(visibleRows(state.model, state.collapsed).length * ROW_H + 8));
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
  const insp = m.addTask({ name: "Inspection", start: "2026-02-27", duration: 4, owner: "Nimal" }, sec);
  const mv = m.addTask({ name: "Move", start: "2026-03-05", duration: 7 }, fit);
  const pack = m.addTask({ name: "Pack and label", level: 1, start: "2026-03-05", duration: 3, owner: "Team" }, mv);
  const day = m.addTask({ name: "Moving day", start: "2026-03-10", duration: 2, owner: "Movers" }, pack);
  const it = m.addTask({ name: "IT check and go-live", start: "2026-03-12", duration: 2, owner: "Ravi" }, day);
  const open = m.addMilestone({ name: "Open for business", start: "2026-03-13" }, it);
  [[site, lease], [lease, signed], [net, sec], [sec, insp], [insp, pack], [pack, day], [day, it], [it, open]].forEach(([a, b]) => m.link(a, b));
  m.setStatusDate("2026-02-18");
  state.model = new ProjectModel(m.doc);
  state.fileName = "Office move.wsproj";
}
if (new URLSearchParams(location.search).has("readonly")) state.readOnly = true;
else applyLicence();
showTab("task");
render();
