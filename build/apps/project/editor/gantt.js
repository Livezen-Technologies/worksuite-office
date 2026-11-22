/*
 * WorkSuite Project: the Gantt chart's geometry (#76). Pure functions, no DOM, so the tests cover them:
 * which rows show (collapsed summaries hide their subtasks), the timescale, where each bar goes, how links are
 * drawn, and what a drag does to a task.
 */
import { toDay, fromDay } from "../core/project.js";

export const ROW_H = 30;
export const ZOOMS = { day: 32, week: 18, month: 6, quarter: 2.4 }; // pixels per day

/** The rows the grid and chart show, in order: a collapsed summary hides its subtasks. */
export function visibleRows(model, collapsed = new Set()) {
  const out = [];
  let hideBelow = Infinity;
  for (const t of model.tasks) {
    if (t.level > hideBelow) continue;
    hideBelow = Infinity;
    out.push(model.view(t.id));
    if (collapsed.has(t.id) && model.isSummary(t.id)) hideBelow = t.level;
  }
  return out;
}

/** The timescale: from the Monday on or before the earliest start to a week past the latest finish. */
export function timescale(rows, zoom = "week", fallbackStart = "2026-01-05") {
  const dayW = ZOOMS[zoom] || ZOOMS.week;
  let s = rows.length ? Math.min(...rows.map((r) => toDay(r.start))) : toDay(fallbackStart);
  let e = rows.length ? Math.max(...rows.map((r) => toDay(r.finish))) : s + 28;
  s -= (new Date(s * 86400000).getUTCDay() + 6) % 7; // back to Monday
  e += 7 + (6 - ((new Date(e * 86400000).getUTCDay() + 6) % 7));
  return { start: s, end: e, dayW, width: (e - s + 1) * dayW, x: (iso) => (toDay(iso) - s) * dayW };
}

/** Header cells: weeks (or months) on top, days (or weeks) below, with weekend shading positions. */
export function headers(scale, zoom = "week") {
  const top = [], bottom = [], weekends = [];
  for (let d = scale.start; d <= scale.end; d++) {
    const date = new Date(d * 86400000), dow = (date.getUTCDay() + 6) % 7, dom = date.getUTCDate();
    const x = (d - scale.start) * scale.dayW;
    if (dow >= 5) weekends.push({ x, w: scale.dayW });
    const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    if (zoom === "day" || zoom === "week") {
      if (dow === 0) top.push({ x, label });
      bottom.push({ x, w: scale.dayW, label: zoom === "day" ? String(dom) : "MTWTFSS"[dow] });
    } else {
      if (dom === 1) top.push({ x, label: date.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) });
      if (dow === 0) bottom.push({ x, w: 7 * scale.dayW, label: String(dom) });
    }
  }
  return { top, bottom, weekends };
}

/** Where each row's bar goes. Milestones are a point; summaries span their subtasks. */
export function bars(rows, scale) {
  return rows.map((r, i) => {
    const x = scale.x(r.start), y = i * ROW_H;
    if (r.milestone) return { id: r.id, kind: "milestone", x: x + scale.dayW / 2, y, w: 0, row: i };
    const w = Math.max(scale.dayW * 0.5, (toDay(r.finish) - toDay(r.start) + 1) * scale.dayW);
    return { id: r.id, kind: r.summary ? "summary" : "task", x, y, w, row: i, progress: r.progress };
  });
}

/**
 * A link's path as points, from the predecessor's side to the successor's side for its type
 * (FS: finish to start, SS: start to start, FF: finish to finish, SF: start to finish).
 */
export function linkPath(from, to, type = "FS") {
  const mid = (b) => b.y + ROW_H / 2;
  const startX = (b) => b.x, endX = (b) => b.x + b.w;
  const fx = type === "FS" || type === "FF" ? endX(from) : startX(from);
  const tx = type === "FS" || type === "SS" ? startX(to) : endX(to);
  const goesRight = type === "FS" || type === "SS"; // the arrow enters the successor from the left
  const out = goesRight ? Math.min(fx, tx) - 8 : Math.max(fx, tx) + 8;
  const leave = type === "FS" || type === "FF" ? fx + 8 : fx - 8;
  if (type === "FS" && tx - fx >= 16) return [[fx, mid(from)], [fx + 8, mid(from)], [fx + 8, mid(to)], [tx, mid(to)]];
  const between = to.y > from.y ? to.y : from.y; // row boundary between the two
  return [[fx, mid(from)], [leave, mid(from)], [leave, between], [out, between], [out, mid(to)], [tx, mid(to)]];
}

/** A dragged bar: the new start, whole days, from a pixel offset. */
export const dragStart = (task, dxPx, dayW) => fromDay(toDay(task.start) + Math.round(dxPx / dayW));
/** A dragged bar end: the new duration, whole days, at least one. */
export const dragDuration = (task, dxPx, dayW) => Math.max(1, task.duration + Math.round(dxPx / dayW));

/** Parses what a person types in the Duration column: "5", "5d", "2w", "0" (a milestone). */
export function parseDuration(text) {
  const m = String(text).trim().toLowerCase().match(/^(\d+)\s*(d|day|days|w|wk|week|weeks)?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] && m[2].startsWith("w") ? 7 : 1);
}

/**
 * The progress line (Microsoft Project's): from the status date down the chart, out to each task's progress point and
 * back. A task in progress, or one that should have started, bends the line to the end of its done part: left of the
 * status date when it is behind, right when ahead. Tasks not due yet, done tasks, summaries, milestones and group
 * headings leave the line at the status date. Returns the polyline's points, or [] with no status date on the chart.
 */
export function progressLine(rows, barList, scale, statusDate) {
  if (!statusDate) return [];
  const sx = scale.x(statusDate) + scale.dayW; // the end of the status date
  if (sx < 0 || sx > scale.width) return [];
  const pts = [[sx, 0]];
  barList.forEach((b) => {
    const r = rows[b.row], mid = b.y + ROW_H / 2;
    const counts = b.kind === "task" && !r.inactive && r.start <= statusDate && (r.progress || 0) < 100;
    if (!counts) return;
    const px = b.x + (b.w * (r.progress || 0)) / 100;
    if (Math.abs(px - sx) < 0.5) return;
    pts.push([sx, b.y + 4], [px, mid], [sx, b.y + ROW_H - 4]);
  });
  pts.push([sx, rows.length * ROW_H]);
  return pts;
}
