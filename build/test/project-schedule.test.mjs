// build/apps/project/core/schedule.js: working calendars and automatic scheduling (#83): weekends and holidays,
// the four link types with lags, constraints, the critical path and slack, summaries, and writing the schedule
// back as one undo step. Dates in February 2026: Mon 2, Fri 6, Mon 9 … (4 Feb is Independence Day).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { makeCalendar, STANDARD, SRI_LANKA, LK_FIXED_HOLIDAYS, workFinish, workDays, schedule, criticalPath, applySchedule } from "../apps/project/core/schedule.js";

test("calendars: weekends, fixed yearly holidays and one-off holidays", () => {
  assert.equal(STANDARD.isWork(Date.parse("2026-02-07T00:00:00Z") / 864e5), false); // Saturday
  assert.equal(SRI_LANKA.isWork(Date.parse("2026-02-04T00:00:00Z") / 864e5), false); // Independence Day
  assert.equal(SRI_LANKA.isWork(Date.parse("2027-05-03T00:00:00Z") / 864e5), true); // Monday, not 1 May
  const poya = makeCalendar({ yearly: LK_FIXED_HOLIDAYS, holidays: ["2026-02-02"] }); // a gazetted day, added by hand
  assert.equal(workFinish(poya, "2026-02-02", 1), "2026-02-03");
  assert.throws(() => makeCalendar({ workdays: [] }), /at least one working day/);
});

test("durations count working days and skip weekends and holidays", () => {
  assert.equal(workFinish(STANDARD, "2026-02-05", 3), "2026-02-09"); // Thu, Fri, Mon
  assert.equal(workFinish(SRI_LANKA, "2026-02-02", 3), "2026-02-05"); // Mon, Tue, (Wed holiday), Thu
  assert.equal(workFinish(STANDARD, "2026-02-07", 1), "2026-02-09"); // a Saturday start moves to Monday
  assert.equal(workFinish(STANDARD, "2026-02-02", 0), "2026-02-02"); // a milestone
  assert.equal(workDays(STANDARD, "2026-02-02", "2026-02-13"), 10);
  assert.equal(workDays(SRI_LANKA, "2026-02-02", "2026-02-06"), 4);
});

function plan(links, durations = { a: 3, b: 2, c: 4, d: 1 }) {
  const doc = newProject("P", "2026-02-02");
  doc.tasks = Object.entries(durations).map(([id, duration]) => ({ id, name: id.toUpperCase(), level: 0, start: "2026-02-02", duration, progress: 0 }));
  doc.links = links.map(([from, to, type = "FS", lag = 0]) => ({ from, to, type, lag }));
  return doc;
}

test("FS: the successor starts the working day after the predecessor finishes", () => {
  const r = schedule(plan([["a", "b"], ["b", "c"]]), STANDARD).tasks;
  assert.deepEqual([r.a.start, r.a.finish], ["2026-02-02", "2026-02-04"]);
  assert.deepEqual([r.b.start, r.b.finish], ["2026-02-05", "2026-02-06"]);
  assert.deepEqual([r.c.start, r.c.finish], ["2026-02-09", "2026-02-12"]); // over the weekend
});

test("SS, FF and SF, with positive and negative lags", () => {
  const r = schedule(plan([["a", "b", "SS", 1], ["a", "c", "FF", 0], ["a", "d", "SF", 2]]), STANDARD).tasks;
  assert.equal(r.b.start, "2026-02-03"); // starts a day after A starts
  assert.deepEqual([r.c.start, r.c.finish], ["2026-02-02", "2026-02-05"]); // already finishes after A: not moved
  const ff = schedule(plan([["a", "b", "FF", 2]]), STANDARD).tasks;
  assert.deepEqual([ff.b.start, ff.b.finish], ["2026-02-05", "2026-02-06"]); // pushed: finishes 2 days after A
  assert.equal(r.d.finish, "2026-02-04"); // finishes two working days after A starts
  const lead = schedule(plan([["a", "b", "FS", -1]]), STANDARD).tasks;
  assert.equal(lead.b.start, "2026-02-04"); // one day of overlap
});

test("constraints: start no earlier than, must start on, finish no later than", () => {
  const doc = plan([["a", "b"]]);
  doc.tasks[1].constraint = { type: "SNET", date: "2026-02-16" };
  assert.equal(schedule(doc, STANDARD).tasks.b.start, "2026-02-16");
  doc.tasks[1].constraint = { type: "MSO", date: "2026-02-03" }; // earlier than A allows
  const r = schedule(doc, STANDARD);
  assert.equal(r.tasks.b.start, "2026-02-03");
  assert.match(r.problems[0], /must start on 2026-02-03/);
  doc.tasks[1].constraint = { type: "FNLT", date: "2026-02-05" };
  assert.match(schedule(doc, STANDARD).problems[0], /finishes after 2026-02-05/);
});

test("the critical path and slack", () => {
  // A(3) → B(2) → D(1); A → C(4) → D: the C branch is longer, so B has 2 days of slack
  const r = schedule(plan([["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]), STANDARD);
  assert.deepEqual(criticalPath(r), ["a", "c", "d"]);
  assert.equal(r.tasks.b.slack, 2);
  assert.equal(r.tasks.b.critical, false);
  assert.equal(r.finish, "2026-02-11");
  assert.equal(r.tasks.b.lateStart, "2026-02-09");
});

test("summaries span their subtasks; links to summaries are reported, not followed", () => {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  const ph = m.addTask({ name: "Phase", duration: 1 });
  const x = m.addTask({ name: "X", level: 1, duration: 3 }, ph);
  const y = m.addTask({ name: "Y", duration: 2 }, x);
  const z = m.addTask({ name: "Z", level: 0, duration: 1 }, ph);
  m.link(x, y);
  m.link(ph, z);
  const r = schedule(m.doc, STANDARD);
  assert.deepEqual([r.tasks[ph].start, r.tasks[ph].finish], ["2026-02-02", "2026-02-06"]);
  assert.equal(r.tasks[ph].summary, true);
  assert.match(r.problems[0], /summary tasks are ignored/);
  assert.equal(r.tasks[z].start, "2026-02-02");
});

test("applySchedule writes the starts back as one undo step", () => {
  const m = new ProjectModel(plan([["a", "b"], ["b", "c"]]));
  applySchedule(m, STANDARD);
  assert.equal(m.task("c").start, "2026-02-09");
  assert.ok(m.undo());
  assert.equal(m.task("c").start, "2026-02-02");
});

test("a 200-task chain schedules quickly and lands where the calendar says", () => {
  const n = 200, doc = newProject("Big", "2026-01-05");
  doc.tasks = Array.from({ length: n }, (_, i) => ({ id: "t" + i, name: "T" + i, level: 0, start: "2026-01-05", duration: 1, progress: 0 }));
  doc.links = doc.tasks.slice(1).map((t, i) => ({ from: "t" + i, to: t.id, type: "FS", lag: 0 }));
  const t0 = Date.now(), r = schedule(doc, STANDARD);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.tasks.t199.start, workFinish(STANDARD, "2026-01-05", 200));
  assert.equal(criticalPath(r).length, n);
});

test("with a working calendar the model's view counts working days, as the scheduler does", () => {
  const m = new ProjectModel(newProject("P", "2026-02-02"));
  const ph = m.addTask({ name: "Phase", duration: 1 });
  const a = m.addTask({ name: "A", level: 1, start: "2026-02-05", duration: 3 }, ph); // Thu
  assert.equal(m.view(a).finish, "2026-02-07"); // no calendar: calendar days (Sat)
  m.isWork = STANDARD.isWork;
  assert.equal(m.view(a).finish, "2026-02-09"); // working days: Thu, Fri, Mon
  assert.equal(m.view(a).finish, workFinish(STANDARD, "2026-02-05", 3));
  assert.equal(m.view(ph).duration, 3); // the summary counts working days too
});
