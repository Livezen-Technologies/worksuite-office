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

const state = {
  model: new ProjectModel(newProject("Untitled project", mondayOf(new Date()))),
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
  try { fn(); state.message = ""; } catch (e) { state.message = e.message; }
  render();
}
const selected = () => state.sel.filter((id) => state.model.tasks.some((t) => t.id === id));
const first = () => selected()[0];

const commands = {
  new: () => { if (confirmDiscard()) { state.model = new ProjectModel(newProject("Untitled project", mondayOf(new Date()))); state.sel = []; state.fileName = "Untitled project.wsproj"; render(); } },
  open: () => $("wp-file").click(),
  save: () => { download(state.fileName, packDocument(APP, serialize(state.model.doc)), "application/zip"); state.saved = state.model.undoStack.length; render(); },
  exportCsv: () => download(state.fileName.replace(/\.wsproj$/, "") + ".csv", toCsv(), "text/csv"),
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
  today: () => { const sc = timescale(visibleRows(state.model, state.collapsed), state.zoom, state.model.doc.start); $("wp-chart").scrollLeft = Math.max(0, sc.x(new Date().toISOString().slice(0, 10)) - 120); },
};

function startForNew() {
  const t = first() && state.model.task(first());
  return t ? finishOf(t) : state.model.doc.start;
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
  const h = Math.max(rows.length * ROW_H + ROW_H * 3, $("wp-chart").clientHeight - 46);
  const selSet = new Set(state.sel);
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
      svg += `<rect class="wp-bar" x="${b.x}" y="${b.y + 8}" width="${b.w}" height="14" rx="4"/>`;
      if (b.progress) svg += `<rect class="wp-bar-done" x="${b.x}" y="${b.y + 8}" width="${(b.w * b.progress) / 100}" height="14" rx="4"/>`;
      if (r.owner) svg += `<text class="wp-label" x="${b.x + b.w + 6}" y="${b.y + 19}">${esc(r.owner)}</text>`;
      svg += `<rect class="wp-hit" data-drag="move" data-id="${b.id}" x="${b.x}" y="${b.y + 4}" width="${Math.max(0, b.w - 6)}" height="22"/><rect class="wp-grip" data-drag="size" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + 4}" width="10" height="22"/>`;
    }
    if (selSet.has(b.id)) svg += `<rect class="wp-sel-bar" x="${b.x - 3}" y="${b.y + 4}" width="${b.w + 6}" height="22" rx="5"/>`;
  }
  const today = new Date().toISOString().slice(0, 10), tx = sc.x(today) + sc.dayW / 2;
  if (tx >= 0 && tx <= sc.width) svg += `<line class="wp-today" x1="${tx}" x2="${tx}" y1="0" y2="${h}"/>`;
  $("wp-chart").innerHTML = svg + "</svg>";
  state.scale = sc;
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
  const rows = visibleRows(state.model, state.collapsed);
  renderGrid(rows);
  renderChart(rows);
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
  $("wp-status").innerHTML = `<span>${state.model.tasks.length} task${state.model.tasks.length === 1 ? "" : "s"}</span>${finish ? `<span>Finish: ${fmt(finish)}</span>` : ""}<span>${state.model.doc.links.length} link${state.model.doc.links.length === 1 ? "" : "s"}</span>${state.message ? `<span class="err" role="alert">${esc(state.message)}</span>` : ""}`;
}

/* ---- events ---- */
document.querySelectorAll(".wp-tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
function showTab(name) {
  document.querySelectorAll(".wp-tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
  document.querySelectorAll(".wp-group").forEach((g) => g.classList.toggle("is-on", g.dataset.tab === name));
}
$("wp-ribbon").addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b && !b.disabled) commands[b.dataset.cmd](); });
$("wp-zoom").addEventListener("change", (e) => { state.zoom = e.target.value; render(); });
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
  if (e.ctrlKey || e.metaKey) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
  else if (e.shiftKey && state.sel.length) {
    const rows = visibleRows(state.model, state.collapsed).map((r) => r.id), a = rows.indexOf(state.sel[0]), b = rows.indexOf(id);
    state.sel = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else state.sel = [id];
  render();
  $("wp-grid").focus();
});
$("wp-grid").addEventListener("dblclick", (e) => {
  const td = e.target.closest("td"), tr = e.target.closest("tr[data-id]");
  if (!td || !tr) return;
  startEdit(tr.dataset.id, COLS[td.cellIndex].key);
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
  const furn = m.addTask({ name: "Furniture", start: "2026-02-12", duration: 8, progress: 10, owner: "Ayesha" }, net);
  const sec = m.addTask({ name: "Security and access", start: "2026-02-20", duration: 5, owner: "Ravi" }, furn);
  const insp = m.addTask({ name: "Inspection", start: "2026-02-27", duration: 4, owner: "Nimal" }, sec);
  const mv = m.addTask({ name: "Move", start: "2026-03-05", duration: 7 }, fit);
  const pack = m.addTask({ name: "Pack and label", level: 1, start: "2026-03-05", duration: 3, owner: "Team" }, mv);
  const day = m.addTask({ name: "Moving day", start: "2026-03-10", duration: 2, owner: "Movers" }, pack);
  const it = m.addTask({ name: "IT check and go-live", start: "2026-03-12", duration: 2, owner: "Ravi" }, day);
  const open = m.addMilestone({ name: "Open for business", start: "2026-03-13" }, it);
  [[site, lease], [lease, signed], [net, sec], [sec, insp], [insp, pack], [pack, day], [day, it], [it, open]].forEach(([a, b]) => m.link(a, b));
  state.model = new ProjectModel(m.doc);
  state.fileName = "Office move.wsproj";
}
if (new URLSearchParams(location.search).has("readonly")) state.readOnly = true;
else applyLicence();
showTab("task");
render();
