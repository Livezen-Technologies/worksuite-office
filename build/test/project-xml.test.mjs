// build/apps/project/core/projectxml.js: Project XML (#84). A file in Microsoft Project's shape is read (the UID 0
// summary row skipped, 8-hour days, lags in tenths of minutes, resources as owners, constraints); WorkSuite's
// own plans round-trip; our output is well-formed for an independent XML parser (Python); bad input is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ProjectModel, newProject } from "../apps/project/core/project.js";
import { STANDARD } from "../apps/project/core/schedule.js";
import { parseXml, fromProjectXml, toProjectXml, durationDays, daysDuration } from "../apps/project/core/projectxml.js";

const MSP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!-- as Microsoft Project writes it, cut down -->
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Office move.xml</Name><Title>Office move</Title><StartDate>2026-02-02T08:00:00</StartDate>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Office move</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Planning</Name><OutlineLevel>1</OutlineLevel><Start>2026-02-02T08:00:00</Start><Duration>PT56H0M0S</Duration><Summary>1</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Choose new site</Name><OutlineLevel>2</OutlineLevel><Start>2026-02-02T08:00:00</Start><Duration>PT32H0M0S</Duration><PercentComplete>100</PercentComplete></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Sign lease &amp; pay deposit</Name><OutlineLevel>2</OutlineLevel><Start>2026-02-06T08:00:00</Start><Duration>PT24H0M0S</Duration><PercentComplete>60</PercentComplete>
      <Notes><![CDATA[Bring the <signed> copy]]></Notes>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>4</UID><ID>4</ID><Name>Lease signed</Name><OutlineLevel>2</OutlineLevel><Start>2026-02-11T08:00:00</Start><Duration>PT0H0M0S</Duration><Milestone>1</Milestone>
      <ConstraintType>4</ConstraintType><ConstraintDate>2026-02-11T08:00:00</ConstraintDate>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type></PredecessorLink></Task>
  </Tasks>
  <Resources><Resource><UID>0</UID><ID>0</ID></Resource><Resource><UID>1</UID><Name>Nimal</Name></Resource><Resource><UID>2</UID><Name>Ayesha</Name></Resource></Resources>
  <Assignments><Assignment><TaskUID>2</TaskUID><ResourceUID>1</ResourceUID></Assignment><Assignment><TaskUID>3</TaskUID><ResourceUID>2</ResourceUID></Assignment><Assignment><TaskUID>3</TaskUID><ResourceUID>1</ResourceUID></Assignment></Assignments>
</Project>`;

test("a file in Microsoft Project's shape", () => {
  const { doc, problems } = fromProjectXml(MSP);
  assert.equal(doc.name, "Office move.xml");
  assert.equal(doc.start, "2026-02-02");
  assert.deepEqual(doc.tasks.map((t) => [t.name, t.level, t.duration]), [["Planning", 0, 7], ["Choose new site", 1, 4], ["Sign lease & pay deposit", 1, 3], ["Lease signed", 1, 0]]);
  const sign = doc.tasks[2];
  assert.equal(sign.progress, 60);
  assert.equal(sign.owner, "Ayesha, Nimal");
  assert.equal(sign.notes, "Bring the <signed> copy");
  assert.deepEqual(doc.tasks[3].constraint, { type: "SNET", date: "2026-02-11" });
  assert.deepEqual(doc.links, [{ from: "t2", to: "t3", type: "FS", lag: 1 }, { from: "t3", to: "t4", type: "SS", lag: 0 }]);
  assert.deepEqual(problems, []);
});

test("durations and lags: 8-hour days", () => {
  assert.equal(durationDays("PT40H0M0S"), 5);
  assert.equal(durationDays("PT0H0M0S"), 0);
  assert.equal(durationDays("P2DT0H0M0S"), 6); // elapsed days are 24 hours: rounded to working days
  assert.equal(durationDays("soon"), null);
  assert.equal(daysDuration(3), "PT24H0M0S");
});

test("WorkSuite plans round-trip through Project XML", () => {
  const m = new ProjectModel(newProject("Round trip", "2026-02-02"));
  const ph = m.addTask({ name: "Phase <1>", duration: 1 });
  const a = m.addTask({ name: "A & B", level: 1, start: "2026-02-02", duration: 3, progress: 40, owner: "Ravi", notes: "line one\nline two" }, ph);
  const b = m.addTask({ name: "ලියාපදිංචිය", start: "2026-02-05", duration: 2, owner: "Ravi, Nimal" }, a);
  const ms = m.addMilestone({ name: "Done", start: "2026-02-09", constraint: { type: "FNLT", date: "2026-02-20" } }, b);
  m.link(a, b, "FS", 2);
  m.link(b, ms, "FF", -1);
  const xml = toProjectXml(m.doc, STANDARD.isWork);
  const { doc, problems } = fromProjectXml(xml);
  assert.deepEqual(problems, []);
  const pick = (t) => [t.name, t.level, t.start, t.duration, t.progress, t.owner, t.notes, t.constraint?.type];
  assert.deepEqual(doc.tasks.slice(1).map(pick), m.doc.tasks.slice(1).map(pick)); // the summary's dates come from its subtasks
  assert.deepEqual(doc.links.map((l) => [l.type, l.lag]), [["FS", 2], ["FF", -1]]);
});

test("our Project XML is well-formed for an independent parser", () => {
  const m = new ProjectModel(newProject("P <&>", "2026-02-02"));
  m.addTask({ name: "Quote \" and ' and &", owner: "A&B" });
  const xml = toProjectXml(m.doc);
  const out = execFileSync(process.platform === "win32" ? "python" : "python3", ["-I", "-c",
    "import sys,xml.dom.minidom as d;doc=d.parseString(sys.stdin.read().encode());print(doc.documentElement.namespaceURI, len(doc.getElementsByTagName('Task')))"],
  { input: xml, encoding: "utf-8" });
  assert.equal(out.trim(), "http://schemas.microsoft.com/project 1");
});

test("the XML reader: entities, comments, CDATA, attributes, and clear errors", () => {
  const x = parseXml(`<?xml version="1.0"?><!-- c --><a k='v' n="&lt;1&gt;">x &#65;&#x42; <![CDATA[<raw>]]><b/></a>`);
  assert.equal(x.name, "a");
  assert.deepEqual(x.attrs, { k: "v", n: "<1>" });
  assert.equal(x.text, "x AB <raw>");
  assert.equal(x.children[0].name, "b");
  assert.throws(() => parseXml("<a><b></a>"), /does not close/);
  assert.throws(() => parseXml("<a>"), /not closed/);
  assert.throws(() => fromProjectXml("<Workbook/>"), /not a Project XML file/);
});

test("odd files are read with the problems said, not refused", () => {
  const odd = MSP.replace("<OutlineLevel>2</OutlineLevel><Start>2026-02-02", "<OutlineLevel>4</OutlineLevel><Start>2026-02-02")
    .replace("<PredecessorUID>2</PredecessorUID>", "<PredecessorUID>99</PredecessorUID>")
    .replace("<Duration>PT24H0M0S</Duration>", "<Duration>three days</Duration>");
  const { doc, problems } = fromProjectXml(odd);
  assert.equal(doc.tasks[1].level, 1);
  assert.equal(doc.tasks[2].duration, 1);
  assert.equal(problems.length, 3);
  assert.match(problems.join(" | "), /outline level 2.*|UID 99|was read as 1 day/);
});

test("an .mpp is recognised by name or content, and the help says how to save it as Project XML", async () => {
  const { isMpp, MPP_HELP } = await import("../apps/project/core/projectxml.js");
  assert.equal(isMpp(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "plan.bin"), true); // compound file
  assert.equal(isMpp(new Uint8Array([0x3c]), "Plan.MPP"), true);
  assert.equal(isMpp(new TextEncoder().encode("<?xml?>"), "plan.xml"), false);
  assert.equal(isMpp(new Uint8Array([0x50, 0x4b, 3, 4]), "plan.wsproj"), false);
  assert.match(MPP_HELP, /Save As/);
  assert.match(MPP_HELP, /XML/);
});
