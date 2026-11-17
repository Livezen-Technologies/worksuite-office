/*
 * WorkSuite Project: open and save Project XML (#84, stage 3 of #71), the documented exchange format of
 * Microsoft Project (namespace http://schemas.microsoft.com/project), also read and written by other planning tools.
 * Pure ES module, no DOM: a small XML reader is included.
 *
 * What travels: the project name and start; tasks (outline level, name, start, duration, % complete, milestone,
 * notes, constraint); links (FS, SS, FF, SF with lag); owners (resource names assigned to a task). Durations and
 * lags use an 8-hour working day, the format's default. What does not travel yet: costs, calendars beyond the
 * default, baselines, custom fields. They come with stage 5 (#90–#94).
 */
import { assignmentsOf, ownerText } from "./resources.js";
import { ProjectModel, newProject, validate } from "./project.js";

const NS = "http://schemas.microsoft.com/project";
const HOURS_PER_DAY = 8;
// Project XML link types: 0 FF, 1 FS, 2 SF, 3 SS
const TYPE_IN = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };
const TYPE_OUT = { FF: 0, FS: 1, SF: 2, SS: 3 };
// constraint types: 0 ASAP, 4 SNET, 2 MSO, 7 FNLT
const CON_IN = { 2: "MSO", 4: "SNET", 7: "FNLT" };
const CON_OUT = { MSO: 2, SNET: 4, FNLT: 7 };

/* ---- a small XML reader: elements, attributes, text, CDATA, comments, entities ---- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

export function parseXml(text) {
  let i = 0;
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const fail = (msg) => { throw new Error(`not valid XML: ${msg} at character ${i}`); };
  while (i < text.length) {
    if (text[i] !== "<") {
      const j = text.indexOf("<", i);
      const chunk = text.slice(i, j < 0 ? text.length : j);
      stack[stack.length - 1].text += unescape(chunk);
      i = j < 0 ? text.length : j;
      continue;
    }
    if (text.startsWith("<!--", i)) { const j = text.indexOf("-->", i); if (j < 0) fail("comment not closed"); i = j + 3; continue; }
    if (text.startsWith("<![CDATA[", i)) { const j = text.indexOf("]]>", i); if (j < 0) fail("CDATA not closed"); stack[stack.length - 1].text += text.slice(i + 9, j); i = j + 3; continue; }
    if (text.startsWith("<?", i) || text.startsWith("<!", i)) { const j = text.indexOf(">", i); if (j < 0) fail("declaration not closed"); i = j + 1; continue; }
    if (text[i + 1] === "/") {
      const j = text.indexOf(">", i), name = text.slice(i + 2, j).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not close <${open && open.name}>`);
      i = j + 1;
      continue;
    }
    const m = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(text.slice(i, i + 4096));
    if (!m) fail("a tag that cannot be read");
    const el = { name: m[1], attrs: {}, children: [], text: "" };
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = unescape(a[2] ?? a[3]);
    stack[stack.length - 1].children.push(el);
    if (!m[3]) stack.push(el);
    i += m[0].length;
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1].name}> is not closed`);
  const top = root.children[0];
  if (!top) fail("no element");
  return top;
}
const local = (n) => n.replace(/^.*:/, "");
const kids = (el, name) => el.children.filter((c) => local(c.name) === name);
const kid = (el, name) => kids(el, name)[0];
const val = (el, name) => { const k = el && kid(el, name); return k ? k.text.trim() : ""; };

/* ---- durations: PT24H0M0S (hours of work) ↔ working days at 8 hours ---- */
export function durationDays(iso) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || "");
  if (!m) return null;
  const hours = Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600;
  return Math.round(hours / HOURS_PER_DAY);
}
export const daysDuration = (days) => `PT${days * HOURS_PER_DAY}H0M0S`;
const lagDays = (tenthsOfMinutes) => Math.round(Number(tenthsOfMinutes || 0) / (HOURS_PER_DAY * 600));

/* ---- reading ---- */

/** A WorkSuite Project document from Project XML text. Throws with the reason when it cannot. */
export function fromProjectXml(text) {
  const top = parseXml(text);
  if (local(top.name) !== "Project") throw new Error("not a Project XML file (no <Project> element)");
  const name = val(top, "Name") || val(top, "Title") || "Imported project";
  const start = (val(top, "StartDate") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const doc = newProject(name, start);
  if (/^\d{4}-\d{2}-\d{2}/.test(val(top, "StatusDate"))) doc.statusDate = val(top, "StatusDate").slice(0, 10);
  const tasksEl = kid(top, "Tasks");
  const taskEls = tasksEl ? kids(tasksEl, "Task") : [];
  const byUid = new Map();
  const problems = [];

  // owners: resource names by UID, then each task's assignments
  const resources = new Map();
  const resEl = kid(top, "Resources");
  for (const r of resEl ? kids(resEl, "Resource") : []) if (val(r, "Name")) resources.set(val(r, "UID"), val(r, "Name"));
  const owners = new Map();
  const asgEl = kid(top, "Assignments");
  for (const a of asgEl ? kids(asgEl, "Assignment") : []) {
    const who = resources.get(val(a, "ResourceUID"));
    if (!who) continue;
    const t = val(a, "TaskUID");
    const units = Number(val(a, "Units") || 1);
    owners.set(t, [...(owners.get(t) || []), { name: who, units: units > 0 ? units : 1 }]);
  }

  for (const t of taskEls) {
    const uid = val(t, "UID");
    if (uid === "0" || val(t, "IsNull") === "1") continue; // the project's own summary row, and empty rows
    const level = Math.max(0, Number(val(t, "OutlineLevel") || 1) - 1);
    const milestone = val(t, "Milestone") === "1";
    let duration = durationDays(val(t, "Duration"));
    if (duration === null) { problems.push(`task "${val(t, "Name")}": duration ${val(t, "Duration")} was read as 1 day`); duration = 1; }
    if (milestone) duration = 0;
    const task = {
      id: "t" + uid,
      name: val(t, "Name") || "Task",
      level,
      start: (val(t, "Start") || start).slice(0, 10),
      duration,
      progress: Math.min(100, Math.max(0, Math.round(Number(val(t, "PercentComplete") || 0)))),
    };
    const owner = owners.get(uid);
    if (owner) task.owner = ownerText(owner);
    if (val(t, "Notes")) task.notes = val(t, "Notes");
    if (val(t, "ActualStart")) task.actualStart = val(t, "ActualStart").slice(0, 10);
    if (val(t, "ActualFinish") && task.actualStart) task.actualFinish = val(t, "ActualFinish").slice(0, 10);
    const con = CON_IN[val(t, "ConstraintType")];
    if (con && val(t, "ConstraintDate")) task.constraint = { type: con, date: val(t, "ConstraintDate").slice(0, 10) };
    byUid.set(uid, task);
    doc.tasks.push(task);
  }
  // a level may not skip a step (the model's rule): clamp, and say so
  for (let i = 0; i < doc.tasks.length; i++) {
    const max = i === 0 ? 0 : doc.tasks[i - 1].level + 1;
    if (doc.tasks[i].level > max) { problems.push(`task "${doc.tasks[i].name}" was moved up to outline level ${max + 1}`); doc.tasks[i].level = max; }
  }
  for (const t of taskEls) {
    const to = byUid.get(val(t, "UID"));
    if (!to) continue;
    for (const p of kids(t, "PredecessorLink")) {
      const from = byUid.get(val(p, "PredecessorUID"));
      if (!from) { problems.push(`a link to task UID ${val(p, "PredecessorUID")} was left out: that task is not in the file`); continue; }
      doc.links.push({ from: from.id, to: to.id, type: TYPE_IN[val(p, "Type") || "1"] || "FS", lag: lagDays(val(p, "LinkLag")) });
    }
  }
  validate(doc);
  return { doc, problems };
}

/* ---- writing ---- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const el = (name, value) => (value === undefined || value === null || value === "" ? "" : `<${name}>${esc(value)}</${name}>`);

/** Project XML text for a WorkSuite Project document (the same plan, readable by Microsoft Project). */
export function toProjectXml(doc, isWork = null) {
  const m = new ProjectModel(doc);
  m.isWork = isWork;
  const uid = new Map(doc.tasks.map((t, i) => [t.id, i + 1]));
  const resources = [...new Set(doc.tasks.flatMap((t) => assignmentsOf(t).map((a) => a.name)))];
  const rid = new Map(resources.map((r, i) => [r, i + 1]));
  const tasks = doc.tasks.map((t, i) => {
    const v = m.view(t.id);
    const links = doc.links.filter((l) => l.to === t.id).map((l) =>
      `<PredecessorLink><PredecessorUID>${uid.get(l.from)}</PredecessorUID><Type>${TYPE_OUT[l.type]}</Type><CrossProject>0</CrossProject><LinkLag>${l.lag * HOURS_PER_DAY * 600}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("");
    const con = t.constraint && CON_OUT[t.constraint.type] !== undefined ? `<ConstraintType>${CON_OUT[t.constraint.type]}</ConstraintType><ConstraintDate>${t.constraint.date}T08:00:00</ConstraintDate>` : "<ConstraintType>0</ConstraintType>";
    return `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID>${el("Name", t.name)}<Type>1</Type><IsNull>0</IsNull>` +
      `<OutlineLevel>${t.level + 1}</OutlineLevel><Start>${v.start}T08:00:00</Start><Finish>${v.finish}T17:00:00</Finish>` +
      `<Duration>${daysDuration(v.duration)}</Duration><DurationFormat>7</DurationFormat>` +
      `<Milestone>${v.milestone ? 1 : 0}</Milestone><Summary>${v.summary ? 1 : 0}</Summary><PercentComplete>${v.progress}</PercentComplete>` +
      (t.actualStart ? `<ActualStart>${t.actualStart}T08:00:00</ActualStart>` : "") + (t.actualFinish ? `<ActualFinish>${t.actualFinish}T17:00:00</ActualFinish>` : "") +
      `${con}${el("Notes", t.notes)}${links}</Task>`;
  }).join("\n    ");
  const resXml = resources.map((r) => `<Resource><UID>${rid.get(r)}</UID><ID>${rid.get(r)}</ID>${el("Name", r)}<Type>1</Type></Resource>`).join("\n    ");
  let a = 0;
  const asgXml = doc.tasks.flatMap((t) => assignmentsOf(t).map((r) =>
    `<Assignment><UID>${++a}</UID><TaskUID>${uid.get(t.id)}</TaskUID><ResourceUID>${rid.get(r.name)}</ResourceUID><Units>${r.units}</Units></Assignment>`)).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="${NS}">
  ${el("Name", doc.name)}
  ${el("Title", doc.name)}
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${doc.start}T08:00:00</StartDate>${doc.statusDate ? `\n  <StatusDate>${doc.statusDate}T17:00:00</StatusDate>` : ""}
  <MinutesPerDay>${HOURS_PER_DAY * 60}</MinutesPerDay>
  <MinutesPerWeek>${HOURS_PER_DAY * 60 * 5}</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <Tasks>
    ${tasks}
  </Tasks>
  <Resources>
    ${resXml}
  </Resources>
  <Assignments>
    ${asgXml}
  </Assignments>
</Project>
`;
}

/* ---- Microsoft Project's own .mpp files ---- */

/**
 * WorkSuite Project does not read .mpp files: the format is closed and undocumented (decision in
 * docs/project-diagram/roadmap.md). Microsoft Project saves any plan as Project XML, which opens here.
 */
export const MPP_HELP = "This is a Microsoft Project file (.mpp), which WorkSuite Project cannot open. In Microsoft Project, choose File › Save As, pick \"XML Format (*.xml)\", and open that file here: tasks, links, dates and people all come across.";

/** True for an .mpp: by name, or by content (a Microsoft compound file, D0 CF 11 E0 A1 B1 1A E1). */
export function isMpp(bytes, name = "") {
  if (/\.mp[pt]$/i.test(name)) return true;
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return !!bytes && bytes.length >= 8 && sig.every((b, i) => bytes[i] === b);
}
