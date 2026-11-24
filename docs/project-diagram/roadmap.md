# WorkSuite Project and WorkSuite Diagram

Two new apps for WorkSuite Office:

- **WorkSuite Project** plans work on a timeline: a task list with a Gantt chart, dependencies,
  scheduling, resources and progress.
- **WorkSuite Diagram** draws flowcharts, org charts, network diagrams and floor plans, and opens and
  edits Visio drawings.

Both are WorkSuite's own designs. They work with the industry's file formats (Project XML, VSDX), but
their screens, icons and names are ours.

## Where each one starts

| | WorkSuite Project | WorkSuite Diagram |
|---|---|---|
| In the engine today | Nothing. A new editor | `visioeditor`: opens VSDX, VSD and VSDM to view and print (ONLYOFFICE 9+, in our 10.x builds) |
| How it gets built | A new web app in the editor shell, next to the PDF Editor overlay | Stage 2: a drawing canvas in the editor shell. Stage 3: editing on the engine's VSDX model |
| Its own file | `.wsproj`: zipped JSON (tasks, links, calendars, resources), versioned schema | `.wsdiagram`: zipped JSON (pages, shapes, connectors, styles), versioned schema |
| Industry formats | Project XML (open spec): read and write. MPP: not read (closed format); opening one explains how to save it as Project XML | VSDX: read (now), write (stage 3). VSD: read only |
| Exports | PDF, XLSX, CSV, PNG of the Gantt chart | PDF, PNG, SVG |

## Architecture

```
Start page (desktop-apps/common/loginpage)
  Home › Quick actions: Project, Diagram ──► #/apps/<id> (stage 1)
                                         └─► create:new project | diagram (stage 2, native)
Native shell (desktop-apps win-linux, macos)
  new document types: project, diagram; file associations .wsproj, .wsdiagram, .xml (Project), .vsdx
  opens each in an editor tab like Document / Spreadsheet
Editors (web-apps, patched in CI like the PDF Editor overlay)
  apps/projecteditor   task grid + Gantt canvas, scheduling engine in a web worker
  apps/diagrameditor   canvas, shape libraries, connector router
worksuite-ai (local service)
  /v1/project/export   XLSX, CSV; PDF through the engine's converter
  AI assistant tools   "make a plan from this text", "draw this process"
```

The editors are web apps like the others, so Windows, Linux and macOS get them from one code base.
Each editor saves through the native shell's local file API, so recent files, autosave and recovery
work as for documents.

## Licensing

Decided: **viewing is free, creating and editing is Pro**, for both apps.

| | Free | Pro |
|---|---|---|
| WorkSuite Project | Open `.wsproj` and Project XML files; read the task list and Gantt chart; zoom, scroll, print, export to PDF | Create projects; edit tasks, links, calendars, baselines and resources; save; export to XLSX and CSV; AI plan from text |
| WorkSuite Diagram | Open `.wsdiagram`, VSDX, VSD and VSDM files; view pages and layers; zoom, print, export to PDF and PNG | Create diagrams; edit shapes, connectors and pages; save, including VSDX; export to SVG; AI diagram from text |

How it works:

- Two new keys, `project.edit` and `diagram.edit`, join `PRO_FEATURES` in `ai-service/src/license.ts` in stage 2, when the
  editors exist. Policy and `WS_AI_LICENSE_ALL=1` work for them as for the others.
- Without Pro, a file opens read-only: the editing tools are shown but disabled, with an Upgrade button, and
  **New project** / **New diagram** opens the upgrade prompt (the 402 upsell the PDF Editor already uses).
- A file is never locked away: anyone can open, read, print and export to PDF what someone else made, and a
  lapsed licence still opens every file read-only.
- Today (stage 1) nothing changes: opening Visio drawings to view and print stays free.

## Status (November 2026, 10.1.101)

About 87% of the roadmap has shipped.

| Stage | Done | Notes |
|---|---|---|
| 1. On the start page | 100% | 10.1.36 |
| 2. First editors | 100% | |
| 3. Industry files | 100% | Project XML, VSDX edit and save, VSD read |
| 4. Team and AI | ~95% | |
| 5. Full project management | ~93% | Left: linked subprojects, split tasks in Project XML |
| 6. Full diagramming | ~65% | See below |

Stage 6, shipped:

- Swimlanes, containers and callouts; hyperlinks between pages and to web addresses
- Themes and variants; backgrounds and borders
- Line jumps, re-layout of a page (swimlanes kept), auto align and spacing
- Shape data, linking to XLSX and CSV with refresh, data graphics
- Smart shapes: shape data formulas and text fields
- Ten templates: flowchart, cross-functional, BPMN, org chart, timeline, UML use case and class, ERD, network,
  mind map
- Diagram validation for flowcharts and BPMN; comments and review
- Drawing scale, dimension lines and print tiling
- Shape reports to CSV and Excel
- Visio export of data graphic colours, backgrounds and borders

Stage 6, left:

- Files: VSDM, stencils (VSSX/VSS) and templates (VSTX/VST); user-built masters and stencils
- Templates: P&ID, site plans

Alongside (worksuite repository, `ops/document-server`): a terminal and a web setup wizard for the Document Server,
and its admin panel and API (status, actions, logs, settings, secret rotation, fonts, users and roles,
collaboration, features). They have been tried as dry runs and against stand-ins, not yet on a real server.

## Roadmap

### Stage 1: on the start page (10.1.36)

- Home's quick actions show **Project** and **Diagram**, four cards to a row.
- Each opens its page, which says what the app does now and what each stage brings.
- **Diagram** opens Visio drawings in the diagram viewer through the Open dialog.
- **Project** creates nothing yet. Its page says so.

Done when: tiles and pages ship in all three builds, with start page tests (`new-apps.test.mjs`).

### Stage 2: first editors (about 8 to 10 weeks)

**Project: Plan**

- A task grid with outline levels (indent, outdent), duration, start, finish, % complete and notes.
- A Gantt chart beside the grid: bars, summary bars, milestones and today's line, zooming from days
  to quarters.
- Links: finish-to-start, start-to-start, finish-to-finish and start-to-finish, with lag. Drag a bar
  to move it, drag its end to change its duration.
- Undo and redo, autosave, save as `.wsproj`, export PDF, CSV and XLSX, print.

**Diagram: Draw**

- A canvas with pages, a grid, snapping, zoom, layers, and groups.
- Shapes with text and styles. Connectors that stay attached to shapes and route around them.
- Libraries: basic shapes, flowchart, org chart and network.
- Undo and redo, autosave, save as `.wsdiagram`, export PDF, PNG and SVG, print.

**Both**

- Native `create:new project` and `create:new diagram`. The start page tiles create a file instead of
  opening the stage 1 page.
- File associations and icons in the Windows, Linux and macOS installers.
- Pro gating as decided (see Licensing): `project.edit` and `diagram.edit` join `PRO_FEATURES`.

Done when: a project with 200 tasks and a diagram with 300 shapes stay smooth, save, reopen and export
the same, on all three platforms. Unit tests for the schema, the editors' models and the exports.

### Stage 3: industry files (about 6 to 8 weeks)

**Project: Schedule**

- Automatic scheduling from links and constraints, critical path, slack.
- Working calendars: working days and hours, holidays (with Sri Lankan public holidays built in).
- Baselines: save one, then compare actual against plan in the Gantt chart.
- Open and save Project XML. MPP is not read: decided against bundling a Java runtime for a converter; opening an .mpp explains how to save it as Project XML in Microsoft Project.

**Diagram: Visio files**

- Open VSDX for editing, save VSDX. Shapes WorkSuite cannot edit stay as they are when saved.
- Insert a diagram into a document or presentation as a picture that opens in Diagram for editing.

Done when: a test set of real Project XML and VSDX files opens and saves with no lost tasks,
links or shapes (checked by comparing the files' models before and after).

### Stage 4: team and AI (about 6 to 8 weeks)

**Project: Team**

- Resources and assignments, workload view, over-allocation warnings.
- Progress tracking: % complete, actual dates, status date.

**Diagram: More**

- More libraries: floor plans, UML, BPMN and cloud architecture icons we draw ourselves.
- Auto-layout of org charts and flowcharts.

**Both**

- AI assistant: a plan from text ("plan a 3-month office move"), a diagram from text or from a table.
- Files in WorkSuite Drive, shared and edited together, like documents.

### Stage 5: full project management (about 12 to 16 weeks)

Parity with a professional project-planning tool, in WorkSuite's own design.

- Task types (fixed units, fixed duration, fixed work), effort-driven scheduling, recurring tasks, inactive tasks,
  deadlines, task calendars, WBS codes, split tasks.
- Resources: work, material and cost resources; rates and cost per use; availability over time; assignment
  contours; resource levelling with priorities; shared resource pools across projects.
- Costs: fixed costs and accrual, budgets, earned value (BCWS, BCWP, ACWP, SPI, CPI) and cost variance.
- Tracking: up to 11 baselines, interim plans, progress lines, variance columns, status date updates.
- Views: Tracking Gantt, network diagram, calendar, timeline, task and resource usage, resource sheet, team planner,
  task board (Kanban), with tables, filters, groups, highlights and saved views.
- Custom fields with formulas, lookup tables and graphical indicators.
- Multiple projects: subprojects, master projects, links across projects.
- Reports: dashboards (burndown, cost overview, resource overview, late tasks), custom reports, print to scale.

### Stage 6: full diagramming (about 12 to 16 weeks)

Parity with a professional diagramming tool, in WorkSuite's own design.

- Templates and stencils: cross-functional (swimlane) flowcharts, BPMN 2.0, UML (all diagram types), ERD and
  database, network and rack, cloud architecture, electrical and engineering (P&ID), floor and site plans, mind maps,
  timelines and calendars, value stream maps, brainstorming, org charts. Every shape drawn by WorkSuite.
- Smart shapes: shape data (properties), shape behaviour (resize, text, connection points) and formulas, so users
  can build their own masters and stencils.
- Data: link shapes to XLSX, CSV or a database; data graphics (icons, bars, colours by value); refresh; build
  org charts and diagrams from data; reports on shape data.
- Containers, lists and callouts; themes and variants; backgrounds and borders; hyperlinks between pages and to
  files.
- Connectors: dynamic glue, line jumps, re-layout of a whole page, auto-align and spacing.
- Scale drawings with measurements (floor plans), print tiling across pages.
- Diagram validation with rules (flowchart, BPMN), comments and review.
- Files: VSDX, VSD, VSDM, VSSX/VSS (stencils) and VSTX/VST (templates); export PDF, PNG, SVG, VSDX.

### Parity catalogue

Every feature of both apps, with the stage that brings it. Progress is tracked in the issues under #71.

| Area | WorkSuite Project | Stage | Area | WorkSuite Diagram | Stage |
|---|---|---|---|---|---|
| Tasks | Outline, durations, milestones, summaries | 2 | Canvas | Pages, layers, groups, snapping, guides | 2 |
| Links | FS, SS, FF, SF with lag | 2 | Shapes | Text, fill, line, shadow, properties | 2 |
| Gantt | Bars, summaries, milestones, links, zoom | 2 | Connectors | Glued, elbow, curved, routing, labels | 2 |
| Files | `.wsproj`, PDF, CSV, XLSX | 2 | Libraries | Basic, flowchart, org chart, network | 2 |
| Scheduling | Auto-schedule, constraints, critical path | 3 | Files | `.wsdiagram`, PDF, PNG, SVG | 2 |
| Calendars | Working time, holidays (Sri Lanka built in) | 3 | Visio files | VSDX edit and save, VSD read | 3 |
| Baselines | One baseline, plan against actual | 3 | Embedding | Diagrams in documents and slides | 3 |
| Project files | Project XML read/write (MPP: save as XML) | 3 | Libraries | Floor plan, UML, BPMN, cloud | 4 |
| Resources | Assignments, workload, over-allocation | 4 | Layout | Auto-layout org charts, flowcharts | 4 |
| Tracking | % complete, actuals, status date | 4 | AI | Diagram from text or a table | 4 |
| AI | Plan from text | 4 | Together | Shared editing in WorkSuite Drive | 4 |
| Together | Shared editing in WorkSuite Drive | 4 | Templates | Swimlane, BPMN 2.0, UML, ERD, P&ID, more | 6 |
| Task types | Fixed units/duration/work, effort-driven | 5 | Smart shapes | Shape data, behaviour, formulas, own stencils | 6 |
| Advanced tasks | Recurring, inactive, deadlines, splits, WBS | 5 | Data | Link to XLSX/CSV/DB, data graphics, refresh | 6 |
| Resources | Work/material/cost, rates, contours, pools | 5 | Data diagrams | Org charts and diagrams from data, reports | 6 |
| Levelling | Resource levelling with priorities | 5 | Structure | Containers, lists, callouts, themes, links | 6 |
| Costs | Fixed costs, budgets, earned value | 5 | Connectors | Line jumps, re-layout, auto-align | 6 |
| Tracking | 11 baselines, interim plans, progress lines | 5 | Scale | Measured drawings, print tiling | 6 |
| Views | Tracking Gantt, network, calendar, timeline, usage, team planner, board | 5 | Validation | Rules for flowchart and BPMN, review | 6 |
| Fields | Custom fields, formulas, indicators | 5 | Visio files | Stencils (VSSX/VSS), templates (VSTX/VST) | 6 |
| Multi-project | Subprojects, master projects, cross-links | 5 | | | |
| Reports | Dashboards, burndown, custom reports | 5 | | | |

Altogether stages 2 to 6 are about 44 to 58 weeks of work: roughly a year to full parity, with a usable editor for
each app after stage 2 (about 2 months) and every stage shipping on its own.

## Risks

| Risk | What we do |
|---|---|
| MPP is a closed format | Decided: not read. Project XML is the exchange format both ways; an .mpp opened by mistake explains how to save it as XML |
| VSDX editing is large | Stage 2 draws in our own format first; stage 3 edits VSDX on the engine's model, keeping what we cannot edit |
| Native shell changes on three platforms | New document types follow the PDF Editor's path; each stage ships only when all three builds are green |
| Scope | Each stage ships on its own, with a version, changelog and release notes |

## Shipping

Each stage is its own version: `build/set-version.sh`, a CHANGELOG section, `build/release-notes/<v>.md`.
Start page and native changes land in worksuite-office-desktop-apps and ship through the
`DESKTOP_APPS_REF` pin in the three 10.x build workflows. Editor code is patched into web-apps in CI,
like the PDF Editor overlay.
