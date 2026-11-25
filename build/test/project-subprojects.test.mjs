// Linked subprojects: an inserted plan that remembers its file, is refreshed from it and saved back to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectModel, newProject, serialize, parse } from "../apps/project/core/project.js";
import { toProjectXml, fromProjectXml } from "../apps/project/core/projectxml.js";

function plan(names) {
  const m = new ProjectModel(newProject("Fit-out", "2026-12-07"));
  const ids = names.map((n, i) => m.addTask({ name: n, start: "2026-12-07", duration: 2 + i, owner: i ? "Nimal" : "" }));
  for (let i = 1; i < ids.length; i++) m.link(ids[i - 1], ids[i]);
  m.setResource("Nimal", { rate: 10 });
  return m.doc;
}

test("a subproject is inserted linked, refreshed from a newer file, saved back, and unlinked", () => {
  const m = new ProjectModel(newProject("Office move", "2026-12-01"));
  const before = m.addTask({ name: "Sign lease", start: "2026-12-01", duration: 3 });
  const sub = m.insertProject(plan(["Order", "Install"]), "Fit-out", { file: "fit-out.wsproj", at: "2026-12-01" });
  m.link(before, sub);
  assert.deepEqual(m.task(sub).subproject, { file: "fit-out.wsproj", at: "2026-12-01" });
  const kids = () => m.doc.tasks.slice(m.indexOf(sub) + 1).map((t) => t.name);
  assert.deepEqual(kids(), ["Order", "Install"]);
  const inner = m.doc.tasks.find((t) => t.name === "Install").id;
  m.link(before, inner); // a link into the old tasks goes on refresh
  m.refreshSubproject(sub, plan(["Order", "Deliver", "Install"]), "2026-12-05");
  assert.deepEqual(kids(), ["Order", "Deliver", "Install"]);
  assert.equal(m.task(sub).subproject.at, "2026-12-05");
  assert.ok(m.doc.links.some((l) => l.from === before && l.to === sub), "the link to the summary stays");
  assert.ok(!m.doc.links.some((l) => l.to === inner), "the link to an old task is gone");
  assert.equal(m.doc.links.filter((l) => kids().length && m.doc.tasks.some((t) => t.id === l.to && t.level === 1)).length, 2, "the plan's own links come in");
  const out = m.subprojectDoc(sub);
  assert.equal(out.name, "Fit-out");
  assert.deepEqual(out.tasks.map((t) => [t.name, t.level]), [["Order", 0], ["Deliver", 0], ["Install", 0]]);
  assert.equal(out.links.length, 2);
  assert.deepEqual(out.resources.map((r) => r.name), ["Nimal"]);
  assert.equal(parse(serialize(m.doc)).tasks.find((t) => t.id === sub).subproject.file, "fit-out.wsproj");
  m.undo();
  assert.deepEqual(kids(), ["Order", "Install"], "a refresh is one undo step");
  m.unlinkSubproject(sub);
  assert.equal(m.task(sub).subproject, undefined);
  assert.throws(() => m.refreshSubproject(sub, plan(["X"])), /not a linked subproject/);
  assert.throws(() => m.set(before, { subproject: { file: "", at: "x" } }));
});

test("a subproject travels through Project XML as Microsoft Project's IsSubproject and SubprojectName", () => {
  const m = new ProjectModel(newProject("Office move", "2026-12-01"));
  const sub = m.insertProject(plan(["Order"]), "Fit-out", { file: "fit-out.wsproj", at: "2026-12-01" });
  const xml = toProjectXml(m.doc);
  assert.match(xml, /<IsSubproject>1<\/IsSubproject><IsSubprojectReadOnly>0<\/IsSubprojectReadOnly><SubprojectName>fit-out\.wsproj<\/SubprojectName>/);
  const { doc } = fromProjectXml(xml.replace("<SubprojectName>fit-out.wsproj", "<SubprojectName>C:\\Plans\\fit-out.wsproj"));
  const back = doc.tasks.find((t) => t.name === "Fit-out");
  assert.equal(back.subproject.file, "fit-out.wsproj", "the path is left behind, the file name kept");
  assert.equal(doc.tasks.find((t) => t.name === "Order").level, 1);
  assert.ok(sub);
});
