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
| Industry formats | Project XML (open spec): read and write. MPP: read-only, through a converter in worksuite-ai | VSDX: read (now), write (stage 3). VSD: read only |
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
  /v1/project/convert  MPP → Project XML (read-only import)
  /v1/project/export   XLSX, CSV; PDF through the engine's converter
  AI assistant tools   "make a plan from this text", "draw this process"
```

The editors are web apps like the others, so Windows, Linux and macOS get them from one code base.
Each editor saves through the native shell's local file API, so recent files, autosave and recovery
work as for documents.

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
- Pro gating decision: free, or a Pro feature (`project`, `diagram` in `PRO_FEATURES`).

Done when: a project with 200 tasks and a diagram with 300 shapes stay smooth, save, reopen and export
the same, on all three platforms. Unit tests for the schema, the editors' models and the exports.

### Stage 3: industry files (about 6 to 8 weeks)

**Project: Schedule**

- Automatic scheduling from links and constraints, critical path, slack.
- Working calendars: working days and hours, holidays (with Sri Lankan public holidays built in).
- Baselines: save one, then compare actual against plan in the Gantt chart.
- Open and save Project XML. Open MPP read-only: worksuite-ai converts it to Project XML.

**Diagram: Visio files**

- Open VSDX for editing, save VSDX. Shapes WorkSuite cannot edit stay as they are when saved.
- Insert a diagram into a document or presentation as a picture that opens in Diagram for editing.

Done when: a test set of real Project XML, MPP and VSDX files opens and saves with no lost tasks,
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

## Risks

| Risk | What we do |
|---|---|
| MPP is a closed format | Read-only import through a converter; Project XML is the format we write |
| VSDX editing is large | Stage 2 draws in our own format first; stage 3 edits VSDX on the engine's model, keeping what we cannot edit |
| Native shell changes on three platforms | New document types follow the PDF Editor's path; each stage ships only when all three builds are green |
| Scope | Each stage ships on its own, with a version, changelog and release notes |

## Shipping

Each stage is its own version: `build/set-version.sh`, a CHANGELOG section, `build/release-notes/<v>.md`.
Start page and native changes land in worksuite-office-desktop-apps and ship through the
`DESKTOP_APPS_REF` pin in the three 10.x build workflows. Editor code is patched into web-apps in CI,
like the PDF Editor overlay.
