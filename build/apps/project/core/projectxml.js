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
import { ProjectModel, newProject, validate, finishOf } from "./project.js";
import { parseFormula } from "./formula.js";
import { fieldValue } from "./fields.js";
import { costs } from "./costs.js";
import { unitsOf, workOf } from "./tasktypes.js";

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

/* ---- custom fields ↔ Microsoft Project's Text, Number, Date and Flag fields (the PjField task constants) ---- */
const seq = (from, n) => Array.from({ length: n }, (_, i) => from + i);
export const FIELD_IDS = {
  text: [188743731, 188743734, 188743737, 188743740, 188743743, ...seq(188743746, 1), ...seq(188743747, 4), ...seq(188743997, 20)], // Text1-30
  number: [...seq(188743767, 5), ...seq(188743982, 15)], // Number1-20
  date: seq(188743945, 10), // Date1-10
  flag: [...seq(188743752, 10), ...seq(188743972, 10)], // Flag1-20
};
/** Microsoft Project's accrual codes: 1 at the start, 2 at the end, 3 prorated (its default, so not written). */
const ACCRUE_OUT = { start: 1, end: 2, prorated: 3 };
const FIELD_LABEL = { text: "Text", number: "Number", date: "Date", flag: "Flag" };
const typeOfFieldId = (id) => Object.keys(FIELD_IDS).find((k) => FIELD_IDS[k].includes(id));

/* ---- durations: PT24H0M0S (hours of work) ↔ working days at 8 hours ---- */
export function durationDays(iso) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || "");
  if (!m) return null;
  const hours = Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600;
  return Math.round(hours / HOURS_PER_DAY);
}
export const daysDuration = (days) => `PT${days * HOURS_PER_DAY}H0M0S`;
const lagDays = (tenthsOfMinutes) => Math.round(Number(tenthsOfMinutes || 0) / (HOURS_PER_DAY * 600));

/* ---- task types: Project XML Type 0 fixed units, 1 fixed duration, 2 fixed work ---- */
const TASKTYPE_IN = { 0: "fixedUnits", 1: "fixedDuration", 2: "fixedWork" };
const TASKTYPE_OUT = { fixedUnits: 0, fixedDuration: 1, fixedWork: 2 };
/** PT40H0M0S → 40 (hours of work), or null. */
function hoursOf(iso) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || "");
  if (!m || !iso) return null;
  return Math.round((Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600) * 100) / 100;
}

/* ---- reading ---- */

/** A WorkSuite Project document from Project XML text. Throws with the reason when it cannot. */
export function fromProjectXml(text) {
  const top = parseXml(text);
  if (local(top.name) !== "Project") throw new Error("not a Project XML file (no <Project> element)");
  const name = val(top, "Name") || val(top, "Title") || "Imported project";
  const start = (val(top, "StartDate") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const doc = newProject(name, start);
  if (/^\d{4}-\d{2}-\d{2}/.test(val(top, "StatusDate"))) doc.statusDate = val(top, "StatusDate").slice(0, 10);
  const problems = [];
  // custom fields: the project's ExtendedAttribute definitions, by FieldID, named by their alias
  const fieldById = new Map();
  const extEl = kid(top, "ExtendedAttributes");
  for (const e of extEl ? kids(extEl, "ExtendedAttribute") : []) {
    const id = Number(val(e, "FieldID")), type = typeOfFieldId(id);
    if (!type || fieldById.has(id)) continue;
    const f = { key: "f" + (fieldById.size + 1), name: val(e, "Alias") || val(e, "FieldName") || FIELD_LABEL[type] + (FIELD_IDS[type].indexOf(id) + 1), type };
    if (val(e, "Formula")) { try { parseFormula(val(e, "Formula")); f.formula = val(e, "Formula"); } catch { problems.push(`the formula of ${f.name} was left out: ${val(e, "Formula")}`); } }
    fieldById.set(id, f);
  }
  if (fieldById.size) doc.fields = [...fieldById.values()];
  const tasksEl = kid(top, "Tasks");
  const taskEls = tasksEl ? kids(tasksEl, "Task") : [];
  const byUid = new Map();

  // owners: resource names by UID, then each task's assignments
  const resources = new Map(), resType = new Map(); // material and cost resources by UID
  const resEl = kid(top, "Resources");
  for (const r of resEl ? kids(resEl, "Resource") : []) {
    if (!val(r, "Name")) continue;
    resources.set(val(r, "UID"), val(r, "Name"));
    const rtype = { 0: "material", 2: "cost" }[val(r, "Type")];
    if (rtype) resType.set(val(r, "UID"), rtype);
    // the Resource Sheet: a rate per hour (StandardRateFormat 2, the default) and a cost per use
    const rate = Number(val(r, "StandardRate")), perUse = Number(val(r, "CostPerUse"));
    const fmt = val(r, "StandardRateFormat") || "2", perHour = { 1: 1 / 60, 2: 1, 3: 1 / 8, 4: 1 / 40, 5: 1 / 160, 7: 1 / 2080 }[fmt] ?? 1;
    const row = { name: val(r, "Name") };
    if (rtype) row.type = rtype;
    if (rtype === "material" && val(r, "MaterialLabel")) row.unit = val(r, "MaterialLabel");
    const acc = { 1: "start", 2: "end" }[val(r, "AccrueAt")];
    if (acc) row.accrue = acc;
    const maxU = Number(val(r, "MaxUnits"));
    if (!rtype && val(r, "MaxUnits") && maxU > 0 && maxU <= 100 && Math.abs(maxU - 1) > 1e-9) row.maxUnits = Math.round(maxU * 100) / 100;
    if (rate > 0) row.rate = Math.round(rate * perHour * 100) / 100;
    if (perUse > 0) row.costPerUse = Math.round(perUse * 100) / 100;
    if ((row.rate || row.costPerUse || row.type || row.maxUnits || row.accrue) && !doc.resources.some((x) => x.name === row.name)) doc.resources.push(row);
  }
  const owners = new Map();
  const asgEl = kid(top, "Assignments");
  for (const a of asgEl ? kids(asgEl, "Assignment") : []) {
    const who = resources.get(val(a, "ResourceUID"));
    if (!who) continue;
    const t = val(a, "TaskUID");
    const units = Number(val(a, "Units") || 1), kind = resType.get(val(a, "ResourceUID"));
    // a material's Units are its quantity; a cost resource's amount is the assignment's Cost
    const entry = kind === "material" ? { name: who, units: 0, amount: units > 0 ? units : 1 } : kind === "cost" ? { name: who, units: 0, amount: Math.max(0, Number(val(a, "Cost") || 0)) } : { name: who, units: units > 0 ? units : 1 };
    owners.set(t, [...(owners.get(t) || []), entry]);
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
    if (/^\d{4}-\d{2}-\d{2}/.test(val(t, "Deadline"))) task.deadline = val(t, "Deadline").slice(0, 10);
    if (val(t, "Active") === "0") task.inactive = true;
    const type = TASKTYPE_IN[val(t, "Type")];
    if (type && type !== "fixedUnits") task.type = type;
    if (val(t, "EffortDriven") === "1") task.effortDriven = true;
    const prio = Number(val(t, "Priority"));
    if (val(t, "Priority") && Number.isInteger(prio) && prio !== 500 && prio >= 0 && prio <= 1000) task.priority = prio;
    const delay = Math.round(Number(val(t, "LevelingDelay") || 0) / (HOURS_PER_DAY * 600)); // tenths of minutes → working days
    if (delay > 0) task.levelDelay = delay;
    if (Number(val(t, "FixedCost")) > 0) task.fixedCost = Math.round(Number(val(t, "FixedCost")) * 100) / 100;
    const fca = { 1: "start", 2: "end" }[val(t, "FixedCostAccrual")];
    if (fca && task.fixedCost) task.fixedCostAccrual = fca;
    const workHours = hoursOf(val(t, "Work"));
    if (workHours !== null && !milestone && workHours > 0) task.work = workHours;
    if (val(t, "ActualFinish") && task.actualStart) task.actualFinish = val(t, "ActualFinish").slice(0, 10);
    const con = CON_IN[val(t, "ConstraintType")];
    if (con && val(t, "ConstraintDate")) task.constraint = { type: con, date: val(t, "ConstraintDate").slice(0, 10) };
    for (const e of kids(t, "ExtendedAttribute")) {
      const f = fieldById.get(Number(val(e, "FieldID"))), raw = val(e, "Value");
      if (!f || raw === "") continue;
      const v = f.type === "number" ? Number(raw) : f.type === "flag" ? raw === "1" || /^true$/i.test(raw) : f.type === "date" ? raw.slice(0, 10) : raw;
      if (f.type === "flag" && !v) continue;
      if ((f.type === "number" && !Number.isFinite(v)) || (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v))) { problems.push(`task "${task.name}": ${f.name} "${raw}" was left out`); continue; }
      task.custom = { ...(task.custom || {}), [f.key]: v };
    }
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
  const resources = [...new Set([...doc.tasks.flatMap((t) => assignmentsOf(t).map((a) => a.name)), ...(doc.resources || []).map((r) => r.name)])];
  const rid = new Map(resources.map((r, i) => [r, i + 1]));
  // custom fields take Microsoft Project's fields of their type in order (Text1, Text2, …); any past the last are left out
  const costById = costs(doc).byId; // formula fields go out with their worked-out values
  const slot = { text: 0, number: 0, date: 0, flag: 0 };
  const outFields = (doc.fields || []).map((f) => ({ ...f, id: FIELD_IDS[f.type][slot[f.type]], n: ++slot[f.type] })).filter((f) => f.id);
  const extXml = outFields.map((f) => `<ExtendedAttribute><FieldID>${f.id}</FieldID><FieldName>${FIELD_LABEL[f.type]}${f.n}</FieldName>${el("Alias", f.name)}${el("Formula", f.formula)}</ExtendedAttribute>`).join("\n    ");
  const custom = (t) => outFields.map((f) => [f, f.formula ? fieldValue(doc, t, f, { finish: (x) => finishOf(x, isWork), cost: (x) => costById.get(x.id) || 0, work: (x) => (unitsOf(x) > 0 ? workOf(x) : 0) }).value : t.custom?.[f.key]])
    .filter(([, v]) => v !== undefined && v !== "" && v !== null).map(([f, v]) => {
    return `<ExtendedAttribute><FieldID>${f.id}</FieldID>${el("Value", f.type === "flag" ? (v ? 1 : 0) : f.type === "date" ? `${v}T08:00:00` : v)}</ExtendedAttribute>`;
  }).join("");
  const tasks = doc.tasks.map((t, i) => {
    const v = m.view(t.id);
    const links = doc.links.filter((l) => l.to === t.id).map((l) =>
      `<PredecessorLink><PredecessorUID>${uid.get(l.from)}</PredecessorUID><Type>${TYPE_OUT[l.type]}</Type><CrossProject>0</CrossProject><LinkLag>${l.lag * HOURS_PER_DAY * 600}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("");
    const con = t.constraint && CON_OUT[t.constraint.type] !== undefined ? `<ConstraintType>${CON_OUT[t.constraint.type]}</ConstraintType><ConstraintDate>${t.constraint.date}T08:00:00</ConstraintDate>` : "<ConstraintType>0</ConstraintType>";
    const work = !v.summary && !v.milestone && t.work !== undefined ? `<Work>PT${t.work}H0M0S</Work>` : "";
    return `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID>${el("Name", t.name)}<Type>${TASKTYPE_OUT[t.type || "fixedUnits"]}</Type><IsNull>0</IsNull>` +
      `<EffortDriven>${t.effortDriven ? 1 : 0}</EffortDriven>${work}` + (t.fixedCost ? `<FixedCost>${t.fixedCost}</FixedCost>` + (t.fixedCostAccrual && t.fixedCostAccrual !== "prorated" ? `<FixedCostAccrual>${ACCRUE_OUT[t.fixedCostAccrual]}</FixedCostAccrual>` : "") : "") + `<Priority>${t.priority ?? 500}</Priority>` +
      (t.levelDelay ? `<LevelingDelay>${t.levelDelay * HOURS_PER_DAY * 600}</LevelingDelay><LevelingDelayFormat>7</LevelingDelayFormat>` : "") +
      `<OutlineLevel>${t.level + 1}</OutlineLevel><Start>${v.start}T08:00:00</Start><Finish>${v.finish}T17:00:00</Finish>` +
      `<Duration>${daysDuration(v.duration)}</Duration><DurationFormat>7</DurationFormat>` +
      `<Milestone>${v.milestone ? 1 : 0}</Milestone><Summary>${v.summary ? 1 : 0}</Summary><PercentComplete>${v.progress}</PercentComplete>` +
      (t.actualStart ? `<ActualStart>${t.actualStart}T08:00:00</ActualStart>` : "") +
      (t.deadline ? `<Deadline>${t.deadline}T17:00:00</Deadline>` : "") + (t.inactive ? "<Active>0</Active>" : "") + (t.actualFinish ? `<ActualFinish>${t.actualFinish}T17:00:00</ActualFinish>` : "") +
      `${con}${el("Notes", t.notes)}${links}${custom(t)}</Task>`;
  }).join("\n    ");
  const sheet = new Map((doc.resources || []).map((r) => [r.name, r]));
  const resXml = resources.map((r) => {
    const s = sheet.get(r) || {};
    const type = s.type || (doc.tasks.some((t) => assignmentsOf(t).some((a) => a.name === r && a.amount !== undefined)) ? "material" : "work");
    return `<Resource><UID>${rid.get(r)}</UID><ID>${rid.get(r)}</ID>${el("Name", r)}<Type>${{ work: 1, material: 0, cost: 2 }[type]}</Type>` + (type === "material" ? el("MaterialLabel", s.unit) : "") + (type === "work" && s.maxUnits ? `<MaxUnits>${s.maxUnits}</MaxUnits>` : "") + (s.accrue && s.accrue !== "prorated" ? `<AccrueAt>${ACCRUE_OUT[s.accrue]}</AccrueAt>` : "") +
      (s.rate ? `<StandardRate>${s.rate}</StandardRate><StandardRateFormat>2</StandardRateFormat>` : "") + (s.costPerUse ? `<CostPerUse>${s.costPerUse}</CostPerUse>` : "") + `</Resource>`;
  }).join("\n    ");
  let a = 0;
  const asgXml = doc.tasks.flatMap((t) => assignmentsOf(t).map((r) =>
    `<Assignment><UID>${++a}</UID><TaskUID>${uid.get(t.id)}</TaskUID><ResourceUID>${rid.get(r.name)}</ResourceUID>` +
    (r.amount === undefined ? `<Units>${r.units}</Units>` : sheet.get(r.name)?.type === "cost" ? `<Units>1</Units><Cost>${r.amount}</Cost>` : `<Units>${r.amount}</Units>`) + `</Assignment>`)).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="${NS}">
  ${el("Name", doc.name)}
  ${el("Title", doc.name)}
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${doc.start}T08:00:00</StartDate>${doc.statusDate ? `\n  <StatusDate>${doc.statusDate}T17:00:00</StatusDate>` : ""}
  <MinutesPerDay>${HOURS_PER_DAY * 60}</MinutesPerDay>
  <MinutesPerWeek>${HOURS_PER_DAY * 60 * 5}</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>${extXml ? `\n  <ExtendedAttributes>\n    ${extXml}\n  </ExtendedAttributes>` : ""}
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
