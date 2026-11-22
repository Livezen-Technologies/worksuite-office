// build/apps/project/editor/gantt.js: the Project editor's Gantt geometry (#76): visible rows with collapsed
// summaries, the timescale and its headers, bar positions, link paths for every link type, drag rules and
// typed durations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { ROW_H, ZOOMS, visibleRows, timescale, headers, bars, linkPath, dragStart, dragDuration, parseDuration } from "../apps/project/editor/gantt.js";

function plan() {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  const sum = m.addTask({ name: "Phase", start: "2026-02-02", duration: 1 });
  const a = m.addTask({ name: "A", level: 1, start: "2026-02-04", duration: 3 }, sum); // Wed
  const b = m.addTask({ name: "B", start: "2026-02-09", duration: 2 }, a);
  const ms = m.addMilestone({ name: "Done", start: "2026-02-11" }, b);
  m.link(a, b);
  return { m, sum, a, b, ms };
}

test("collapsed summaries hide their subtasks", () => {
  const { m, sum } = plan();
  assert.equal(visibleRows(m).length, 4);
  assert.deepEqual(visibleRows(m, new Set([sum])).map((r) => r.name), ["Phase"]);
});

test("the timescale starts on a Monday and ends a week past the last finish", () => {
  const { m } = plan();
  const sc = timescale(visibleRows(m), "week");
  assert.equal(new Date(sc.start * 86400000).toISOString().slice(0, 10), "2026-02-02");
  assert.equal(new Date(sc.start * 86400000).getUTCDay(), 1);
  assert.equal(new Date(sc.end * 86400000).getUTCDay(), 0);
  assert.equal(sc.dayW, ZOOMS.week);
  assert.equal(sc.x("2026-02-04"), 2 * ZOOMS.week);
});

test("headers: weeks over days, weekends shaded", () => {
  const { m } = plan();
  const sc = timescale(visibleRows(m), "week"), h = headers(sc, "week");
  assert.equal(h.bottom.length, sc.end - sc.start + 1);
  assert.equal(h.bottom[0].label, "M");
  assert.equal(h.top[0].label, "2 Feb");
  assert.equal(h.weekends.length, (2 * h.bottom.length) / 7);
  const mh = headers(timescale(visibleRows(m), "month"), "month");
  assert.ok(mh.bottom.every((c) => c.w === 7 * ZOOMS.month));
});

test("bars: tasks span their days, summaries their subtasks, milestones are a point", () => {
  const { m, sum, a, ms } = plan();
  const rows = visibleRows(m), sc = timescale(rows, "day"), bs = bars(rows, sc);
  const by = Object.fromEntries(bs.map((b) => [b.id, b]));
  assert.deepEqual([by[a].x, by[a].w, by[a].y], [2 * ZOOMS.day, 3 * ZOOMS.day, ROW_H]);
  assert.equal(by[sum].kind, "summary");
  assert.equal(by[sum].x, 2 * ZOOMS.day);
  assert.equal(by[sum].w, 8 * ZOOMS.day);
  assert.equal(by[ms].kind, "milestone");
  assert.equal(by[ms].w, 0);
});

test("link paths leave and enter on the right sides for each type", () => {
  const A = { x: 0, w: 100, y: 0 }, B = { x: 200, w: 50, y: ROW_H };
  const fs = linkPath(A, B, "FS");
  assert.deepEqual(fs[0], [100, ROW_H / 2]);
  assert.deepEqual(fs.at(-1), [200, ROW_H * 1.5]);
  assert.equal(fs.length, 4); // room to go straight across
  assert.deepEqual(linkPath(A, B, "SS")[0], [0, ROW_H / 2]);
  assert.deepEqual(linkPath(A, B, "SS").at(-1), [200, ROW_H * 1.5]);
  assert.deepEqual(linkPath(A, B, "FF").at(-1), [250, ROW_H * 1.5]);
  assert.deepEqual(linkPath(A, B, "SF")[0], [0, ROW_H / 2]);
  const back = linkPath({ x: 0, w: 300, y: 0 }, B, "FS"); // the successor starts before the predecessor ends
  assert.equal(back.length, 6);
  assert.ok(back.at(-2)[0] < 200);
});

test("drags snap to whole days; a duration never drops below one day", () => {
  const t = { start: "2026-02-04", duration: 3 };
  assert.equal(dragStart(t, 2.4 * 18, 18), "2026-02-06");
  assert.equal(dragStart(t, -18, 18), "2026-02-03");
  assert.equal(dragDuration(t, 18 * 2, 18), 5);
  assert.equal(dragDuration(t, -18 * 10, 18), 1);
});

test("typed durations: days, weeks, and nonsense refused", () => {
  assert.equal(parseDuration("5"), 5);
  assert.equal(parseDuration("5d"), 5);
  assert.equal(parseDuration(" 2 w "), 14);
  assert.equal(parseDuration("0"), 0);
  assert.equal(parseDuration("five"), null);
  assert.equal(parseDuration("-3"), null);
});

test("progressLine: bends left to a task behind, right to one ahead; done, future and summary rows keep it straight", async () => {
  const { progressLine } = await import("../apps/project/editor/gantt.js");
  const rows = [
    { id: "s", summary: true, start: "2026-02-02", finish: "2026-02-13", progress: 40 },
    { id: "a", start: "2026-02-02", finish: "2026-02-11", progress: 20 }, // behind: 20% of 10 days by the 6th
    { id: "b", start: "2026-02-02", finish: "2026-02-06", progress: 100 },
    { id: "c", start: "2026-02-03", finish: "2026-02-04", progress: 50 }, // should be done: behind
    { id: "d", start: "2026-02-04", finish: "2026-02-05", progress: 100 },
    { id: "e", start: "2026-02-09", finish: "2026-02-13", progress: 0 }, // not due
    { id: "f", start: "2026-02-02", finish: "2026-02-05", progress: 90 },
  ];
  const sc = timescale(rows, "week", "2026-02-02");
  const bl = bars(rows, sc);
  const pts = progressLine(rows, bl, sc, "2026-02-04");
  const sx = sc.x("2026-02-04") + sc.dayW;
  assert.deepEqual(pts[0], [sx, 0]);
  assert.deepEqual(pts.at(-1), [sx, rows.length * ROW_H]);
  const bends = pts.filter((p) => p[0] !== sx);
  assert.equal(bends.length, 3, "a, c and f bend; s, b, d and e do not");
  assert.ok(bends[0][0] < sx && bends[0][1] === ROW_H * 1.5, "a is behind");
  assert.ok(bends[2][0] > sx, "f is ahead");
  assert.deepEqual(progressLine(rows, bl, sc, null), []);
});
