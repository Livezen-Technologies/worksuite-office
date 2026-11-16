// build/apps/project/core/project.js: the WorkSuite Project document (.wsproj, schema 1) and its
// task model (#74): validation, migration, canonical save, outline edits, links without loops, summary roll-ups,
// undo and redo, and a 200-task round trip that saves to the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP, SCHEMA_VERSION, newProject, validate, migrate, serialize, parse, hasCycle, finishOf, ProjectModel,
} from "../apps/project/core/project.js";

function officeMove() {
  const m = new ProjectModel(newProject("Office move", "2026-02-02"));
  const plan = m.addTask({ name: "Planning", start: "2026-02-02", duration: 8 });
  const site = m.addTask({ name: "Choose new site", level: 1, start: "2026-02-02", duration: 4, progress: 100 }, plan);
  const lease = m.addTask({ name: "Sign lease", start: "2026-02-06", duration: 3, progress: 60 }, site);
  const signed = m.addMilestone({ name: "Lease signed", start: "2026-02-11" }, lease);
  m.link(site, lease);
  m.link(lease, signed);
  return { m, plan, site, lease, signed };
}

test("a new project is valid and empty", () => {
  const d = newProject("Plan", "2026-03-02");
  assert.equal(d.app, APP);
  assert.equal(d.v, SCHEMA_VERSION);
  assert.deepEqual(validate(d).tasks, []);
});

test("validate lists every problem", () => {
  const d = newProject();
  d.tasks = [
    { id: "a", name: "A", level: 1, start: "2026-01-05", duration: 1, progress: 0 },
    { id: "a", name: "B", level: 0, start: "5 Jan", duration: -1, progress: 120 },
  ];
  d.links = [{ from: "a", to: "zz", type: "XX", lag: 0.5 }];
  const msg = assert.throws(() => validate(d), (e) => {
    for (const bit of ["level skips", "duplicate id", "start must be a date", "duration must be whole days", "progress must be 0-100", "unknown task", "type must be", "lag must be whole days"])
      assert.ok(e.message.includes(bit), bit);
    return true;
  });
  void msg;
});

test("links may not form a loop", () => {
  assert.equal(hasCycle([{ from: "a", to: "b" }, { from: "b", to: "c" }]), false);
  assert.equal(hasCycle([{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]), true);
  const { m, site, signed } = officeMove();
  assert.throws(() => m.link(signed, site), /loop/);
  assert.throws(() => m.link(site, site), /itself/);
});

test("a newer schema is refused, not misread", () => {
  assert.throws(() => migrate({ app: APP, v: SCHEMA_VERSION + 1 }), /newer WorkSuite Office/);
  assert.throws(() => migrate({ app: "something.else", v: 1 }), /not a WorkSuite project/);
});

test("outline: add after, indent, outdent move the whole subtree", () => {
  const { m, plan, site, lease } = officeMove();
  assert.deepEqual(m.tasks.map((t) => [t.name, t.level]), [["Planning", 0], ["Choose new site", 1], ["Sign lease", 1], ["Lease signed", 1]]);
  assert.ok(m.isSummary(plan));
  m.indent(lease);
  assert.equal(m.task(lease).level, 2);
  assert.ok(m.isSummary(site));
  assert.throws(() => m.indent(plan), /nothing above/);
  m.outdent(site); // takes "Sign lease" with it
  assert.deepEqual(m.tasks.map((t) => t.level), [0, 0, 1, 1]);
  assert.throws(() => m.outdent(plan), /top level/);
});

test("removing a task removes its subtasks and their links", () => {
  const { m, plan } = officeMove();
  m.removeTask(plan);
  assert.equal(m.tasks.length, 0);
  assert.equal(m.doc.links.length, 0);
});

test("summaries roll up dates and duration-weighted progress; milestones finish the day they start", () => {
  const { m, plan, signed, lease } = officeMove();
  assert.equal(finishOf(m.task(lease)), "2026-02-08");
  const v = m.view(plan);
  assert.equal(v.summary, true);
  assert.equal(v.start, "2026-02-02");
  assert.equal(v.finish, "2026-02-11");
  assert.equal(v.duration, 10);
  assert.equal(v.progress, Math.round((100 * 4 + 60 * 3 + 0 * 1) / 8));
  assert.equal(m.view(signed).milestone, true);
  assert.equal(m.view(signed).finish, "2026-02-11");
});

test("undo and redo step through edits; a refused edit changes nothing", () => {
  const { m, lease } = officeMove();
  const n = m.tasks.length;
  m.set(lease, { name: "Sign the lease" });
  assert.throws(() => m.set(lease, { duration: -2 }));
  assert.equal(m.task(lease).name, "Sign the lease");
  assert.ok(m.undo());
  assert.equal(m.task(lease).name, "Sign lease");
  assert.ok(m.redo());
  assert.equal(m.task(lease).name, "Sign the lease");
  while (m.undo());
  assert.equal(m.tasks.length, 0);
  assert.equal(n, 4);
});

test("a 200-task project round-trips to the same bytes", () => {
  const m = new ProjectModel(newProject("Big", "2026-01-05"));
  let prev = null, parent = null;
  for (let i = 0; i < 200; i++) {
    const id = i % 10 === 0
      ? (parent = m.addTask({ name: `Phase ${i / 10 + 1}`, start: "2026-01-05", duration: 5 }, parent))
      : m.addTask({ name: `Task ${i}`, level: 1, start: "2026-01-05", duration: 1 + (i % 7), progress: (i * 7) % 101 }, prev && m.task(prev).level === 1 ? prev : parent);
    if (prev && i % 10 !== 0) m.link(prev, id, ["FS", "SS", "FF", "SF"][i % 4], i % 3);
    prev = id;
  }
  assert.equal(m.tasks.length, 200);
  const text = serialize(m.doc);
  const again = serialize(parse(text));
  assert.equal(again, text);
  const reloaded = new ProjectModel(parse(text));
  assert.equal(reloaded.addTask({ name: "next" }).length > 1, true); // ids keep counting past the loaded ones
  assert.equal(new Set(reloaded.tasks.map((t) => t.id)).size, 201);
});
