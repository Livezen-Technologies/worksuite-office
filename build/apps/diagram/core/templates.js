/*
 * WorkSuite Diagram: templates (roadmap stage 6). Pure ES module, no DOM.
 *
 * Each template is a starter page drawn with WorkSuite's own shapes: a flowchart, a cross-functional (swimlane)
 * flowchart, a BPMN process, an org chart, a UML use case diagram, a UML class diagram, a database (ERD) diagram, a
 * network diagram, a mind map and a project timeline. templatePage(id, newId) gives the page, ready to add to a
 * diagram; newId(prefix) makes the ids, so they never clash with what the diagram already has.
 */

import { makeLanes } from "./swimlane.js";

export const TEMPLATES = [
  { id: "flowchart", name: "Basic flowchart", group: "Flowchart", about: "Start, steps, a decision and an end." },
  { id: "swimlane", name: "Cross-functional flowchart", group: "Flowchart", about: "A process across teams, one lane each." },
  { id: "bpmn", name: "BPMN process", group: "Business", about: "Start and end events, tasks and a gateway." },
  { id: "org", name: "Org chart", group: "Business", about: "A director, managers and their teams." },
  { id: "timeline", name: "Project timeline", group: "Business", about: "Milestones along a line." },
  { id: "usecase", name: "UML use case", group: "Software", about: "Actors, use cases and the system boundary." },
  { id: "class", name: "UML class diagram", group: "Software", about: "Classes with fields and methods, and how they relate." },
  { id: "erd", name: "Database (ERD)", group: "Software", about: "Tables with their columns and keys." },
  { id: "network", name: "Network diagram", group: "IT", about: "Internet, firewall, servers and storage." },
  { id: "mindmap", name: "Mind map", group: "Ideas", about: "A central idea with branches." },
  { id: "brainstorm", name: "Brainstorm", group: "Ideas", about: "A question and sticky notes, grouped by theme." },
  { id: "cloud", name: "Cloud architecture", group: "IT", about: "Users, a load balancer, app containers, functions, a queue and storage." },
  { id: "rack", name: "Equipment rack", group: "IT", about: "A 12U rack with patch panel, switch, servers and storage." },
  { id: "floorplan", name: "Office floor plan", group: "Facilities", about: "Rooms, walls, doors, desks and a 1:100 scale." },
  { id: "valuestream", name: "Value stream map", group: "Business", about: "Supplier to customer: process steps, inventory and lead times." },
];

/** A new page for a template: { name, width, height, layers, items } with fresh ids. */
export function templatePage(id, newId) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  const layer = newId("l"), items = [];
  const S = (type, x, y, w, h, text, extra = {}) => { const s = { id: newId("s"), kind: "shape", type, layer, x, y, w, h, rotate: 0, text, style: {}, ...extra }; items.push(s); return s.id; };
  const C = (from, to, text = "", fp = "right", tp = "left", extra = {}) => { items.push({ id: newId("c"), kind: "connector", layer, from: { shape: from, point: fp }, to: { shape: to, point: tp }, route: "elbow", text, style: { arrowEnd: true }, ...extra }); };
  let width = 842, height = 595;
  BUILD[id]({ S, C });
  if (id === "swimlane" || id === "timeline" || id === "erd" || id === "valuestream") width = 1000;
  return { name: t.name, width, height, layers: [{ id: layer, name: "Layer 1", visible: true, locked: false }], items, ...(id === "floorplan" ? { scale: { paper: 1, paperUnit: "cm", real: 1, realUnit: "m" } } : {}) };
}

const CM = 720 / 25.4; // a centimetre in points: a metre at 1:100
const BUILD = {
  brainstorm({ S }) {
    S("ellipse", 321, 40, 200, 80, "How do we cut delivery time?");
    const groups = [["Process", 60, ["Pack the night before", "Fewer handovers"]], ["Tools", 340, ["Route planning app", "Barcode scanners"]], ["People", 620, ["Second driver at peaks", "Train the new team"]]];
    for (const [title, x, notes] of groups) {
      S("rounded", x, 160, 170, 40, title, { style: { fill: "#e2e8f0", line: "#64748b" } });
      notes.forEach((n, i) => S("note", x + 10, 220 + i * 90, 150, 70, n));
    }
  },
  cloud({ S, C }) {
    const L = (x, y, text) => S("rect", x - 50, y, 100, 20, text, { style: { fill: "none", line: "none", fontSize: 11 } }); // a label under an icon
    const icon = (type, x, y, w, h, text) => { L(x + w / 2, y + h + 4, text); return S(type, x, y, w, h, ""); };
    const users = icon("person", 40, 240, 60, 70, "Users"), lb = icon("loadbalancer", 170, 245, 60, 60, "Load balancer");
    const apps = [icon("appcontainer", 320, 140, 64, 70, "App 1"), icon("appcontainer", 320, 340, 64, 70, "App 2")];
    const fn = icon("function", 480, 150, 60, 60, "Resize images"), q = S("queue", 470, 360, 100, 40, "Orders queue");
    const db = S("database", 650, 230, 100, 90, "Database"), st = icon("bucket", 660, 80, 64, 64, "Files");
    C(users, lb); apps.forEach((a) => C(lb, a)); C(apps[0], fn); C(fn, st, "", "right", "left"); C(apps[1], q); C(q, db, "", "right", "bottom"); C(apps[0], db, "", "right", "left");
  },
  rack({ S }) {
    const U = 34, x = 320, top = 60;
    S("rect", x - 12, top - 12, 224, 12 * U + 24, "", { style: { fill: "#334155", line: "#1e293b" } });
    const units = [[1, "Patch panel", "server"], [1, "Switch, 48 port", "server"], [1, "Firewall", "server"], [2, "Server 1", "server"], [2, "Server 2", "server"], [2, "Storage", "server"], [1, "UPS", "server"]];
    let u = 0;
    for (const [n, label] of units) { S(n > 1 ? "server" : "rect", x, top + u * U, 200, n * U - 2, label, n > 1 ? {} : { style: { fill: "#e2e8f0", line: "#475569" } }); u += n; }
    for (let i = 0; i < 12; i++) S("rect", x - 46, top + i * U + 8, 26, 18, String(12 - i), { style: { fill: "#ffffff", line: "#ffffff" } });
  },
  floorplan({ S }) {
    const ox = 60, oy = 60, W = 14 * CM, H = 9 * CM;
    S("wall", ox, oy, W, 8, ""); S("wall", ox, oy + H, W, 8, ""); S("wall", ox, oy, 8, H + 8, ""); S("wall", ox + W, oy, 8, H + 8, "");
    S("room", ox + 8, oy + 8, 8 * CM - 8, H - 8, "Open office");
    S("room", ox + 8 * CM + 8, oy + 8, 6 * CM - 8, 4 * CM, "Meeting room");
    S("room", ox + 8 * CM + 8, oy + 4 * CM + 16, 6 * CM - 8, 5 * CM - 16, "Kitchen");
    S("door", ox + 3 * CM, oy + H - 40, 40, 40, ""); S("door", ox + 8 * CM, oy + 2 * CM, 40, 40, "");
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) S("desk", ox + 40 + c * 2.4 * CM, oy + 1.6 * CM + r * 3.8 * CM, 60, 44, "");
    S("table", ox + 12.4 * CM, oy + 0.35 * CM, 40, 40, "");
    S("dimension", ox, oy + H + 20, W, 28, "");
  },
  valuestream({ S, C }) {
    const sup = S("rect", 40, 60, 130, 60, "Supplier", { style: { fill: "#f1f5f9", line: "#475569" } }), cus = S("rect", 830, 60, 130, 60, "Customer", { style: { fill: "#f1f5f9", line: "#475569" } });
    const steps = ["Cutting", "Welding", "Painting", "Assembly"].map((t, i) => S("rect", 90 + i * 220, 260, 140, 70, t, { data: [{ label: "Cycle time (min)", value: [3, 7, 5, 4][i] }, { label: "Operators", value: [1, 2, 1, 2][i] }], style: { showData: true } }));
    const inv = [0, 1, 2].map((i) => S("triangle", 255 + i * 220, 270, 50, 44, `${[400, 250, 300][i]}`));
    C(sup, steps[0], "Weekly", "bottom", "top");
    steps.slice(0, -1).forEach((s, i) => { C(s, inv[i]); C(inv[i], steps[i + 1]); });
    C(steps[3], cus, "Daily", "top", "bottom");
    S("rect", 90, 470, 800, 6, "", { style: { fill: "#475569", line: "#475569" } });
    S("rounded", 90, 490, 800, 40, "Lead time 9.5 days · processing time 19 min", { style: { fill: "#ffffff", line: "#475569" } });
  },
  flowchart({ S, C }) {
    const a = S("terminator", 60, 240, 130, 54, "Start"), b = S("rect", 240, 237, 140, 60, "Receive request");
    const c = S("diamond", 430, 222, 150, 90, "Approved?"), d = S("rect", 640, 237, 140, 60, "Do the work");
    const e = S("rect", 435, 400, 140, 60, "Tell the requester"), f = S("terminator", 645, 403, 130, 54, "End");
    C(a, b); C(b, c); C(c, d, "Yes"); C(c, e, "No", "bottom", "top"); C(d, f, "", "bottom", "top"); C(e, f);
  },
  swimlane({ S, C }) {
    for (const l of makeLanes(["Customer", "Sales", "Finance"], { x: 30, y: 40, length: 940, size: 160 })) S(l.type, l.x, l.y, l.w, l.h, l.text, { lane: l.lane });
    const a = S("terminator", 100, 93, 120, 54, "Order"), b = S("rect", 280, 250, 130, 60, "Check stock");
    const c = S("diamond", 470, 235, 140, 90, "In stock?"), d = S("rect", 680, 410, 130, 60, "Send invoice");
    const e = S("rect", 680, 90, 130, 60, "Receive goods"), f = S("terminator", 850, 93, 100, 54, "Done");
    C(e, f); C(a, b, "", "bottom", "left"); C(b, c); C(c, d, "Yes", "bottom", "left"); C(c, e, "No: wait", "top", "left"); C(d, e, "", "top", "bottom");
  },
  bpmn({ S, C }) {
    const a = S("event", 60, 255, 44, 44, ""), b = S("task", 150, 242, 140, 70, "Review claim");
    const g = S("gateway", 340, 249, 56, 56, ""), c = S("task", 450, 150, 140, 70, "Approve"), d = S("task", 450, 340, 140, 70, "Reject");
    const e = S("endevent", 660, 255, 44, 44, "");
    C(a, b); C(b, g); C(g, c, "Valid", "top", "left"); C(g, d, "Not valid", "bottom", "left"); C(c, e, "", "right", "top"); C(d, e, "", "right", "bottom");
  },
  org({ S, C }) {
    const top = S("rounded", 341, 50, 160, 60, "Name\nManaging Director");
    const heads = ["Finance", "Operations", "Sales"].map((t, i) => S("rounded", 91 + i * 250, 200, 160, 60, `Name\n${t}`));
    heads.forEach((h) => C(top, h, "", "bottom", "top"));
    heads.forEach((h, i) => { const k = S("rounded", 101 + i * 250, 340, 140, 54, `Name\n${["Accounts", "Logistics", "Accounts team"][i]}`); C(h, k, "", "bottom", "top"); });
  },
  timeline({ S }) {
    S("rect", 40, 290, 920, 6, "", { style: { fill: "#475569", line: "#475569" } });
    ["Kick-off", "Design", "Build", "Test", "Launch"].forEach((t, i) => {
      const x = 80 + i * 210;
      S("ellipse", x - 10, 283, 20, 20, "");
      S("rounded", x - 70, i % 2 ? 330 : 180, 140, 60, `${t}\nWeek ${1 + i * 3}`);
    });
  },
  usecase({ S, C }) {
    S("container", 260, 30, 340, 520, "Online shop");
    const cust = S("actor", 90, 200, 60, 100, "Customer"), staff = S("actor", 690, 260, 60, 100, "Staff");
    const u = ["Browse products", "Place order", "Pay", "Ship order"].map((t, i) => S("usecase", 330, 90 + i * 110, 200, 70, t));
    for (const x of u.slice(0, 3)) C(cust, x, "", "right", "left", { style: { arrowEnd: false }, route: "straight" });
    C(staff, u[3], "", "left", "right", { style: { arrowEnd: false }, route: "straight" });
  },
  class({ S, C }) {
    const a = S("class", 80, 80, 200, 190, "Customer\n- name: string\n- email: string\n+ placeOrder()");
    const b = S("class", 380, 80, 200, 200, "Order\n- number: string\n- total: decimal\n+ addLine()\n+ submit()");
    const c = S("class", 380, 360, 200, 150, "OrderLine\n- quantity: int\n- price: decimal");
    C(a, b, "places 1..*"); C(b, c, "has 1..*", "bottom", "top");
  },
  erd({ S, C }) {
    const t = (x, y, text) => S("class", x, y, 220, 230, text);
    const a = t(60, 80, "customers\nPK id\n   name\n   email");
    const b = t(390, 80, "orders\nPK id\nFK customer_id\n   ordered_on\n   total");
    const c = t(720, 80, "order_lines\nPK id\nFK order_id\nFK product_id\n   quantity");
    const d = t(720, 350, "products\nPK id\n   name\n   price");
    C(a, b, "1 : many"); C(b, c, "1 : many"); C(d, c, "1 : many", "top", "bottom");
  },
  network({ S, C }) {
    const net = S("cloud", 340, 40, 160, 100, "Internet"), fw = S("rect", 345, 190, 150, 50, "Firewall");
    const sw = S("rect", 345, 290, 150, 40, "Switch");
    const srv = ["Web server", "App server", "Database"].map((t, i) => S(i === 2 ? "database" : "server", 160 + i * 200, 400, i === 2 ? 100 : 80, 110, t));
    C(net, fw, "", "bottom", "top"); C(fw, sw, "", "bottom", "top"); srv.forEach((s) => C(sw, s, "", "bottom", "top"));
  },
  mindmap({ S, C }) {
    const mid = S("ellipse", 341, 247, 160, 100, "Main idea");
    [["Goals", 120, 90], ["People", 590, 90], ["Budget", 90, 420], ["Timeline", 600, 420], ["Risks", 345, 470]].forEach(([t, x, y]) => {
      const b = S("rounded", x, y, 140, 54, t);
      C(mid, b, "", y < 250 ? "top" : "bottom", y < 250 ? "bottom" : "top", { route: "curved", style: { arrowEnd: false } });
    });
  },
};
