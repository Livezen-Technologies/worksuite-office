/*
 * WorkSuite Diagram: a diagram from a table (#88, roadmap stage 4). Pure ES module, no DOM.
 *
 * Paste rows from a spreadsheet (tab-separated) or CSV:
 *   an org chart:  Name, Role?, Reports to        (a row with no "reports to" is at the top)
 *   a flowchart:   From, To, Label?               (each row is a line between two steps)
 * The first row is a header when it names the columns; without one, a table where some row has an empty last
 * column is an org chart, otherwise a flowchart. Steps ending in "?" become decisions; where a flowchart starts
 * and ends become start/end shapes.
 */
import { autoLayout, applyLayout } from "./layout.js";

/** Rows of cells from pasted text: tab, then comma, then semicolon separated; "quoted, cells" are kept whole. */
export function parseTable(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : "\t";
  return lines.map((line) => {
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"' && !cur.trim()) { q = true; cur = ""; }
      else if (c === sep) { cells.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  });
}

const H = {
  name: /^(name|person|employee|position|title of post)$/i,
  role: /^(role|title|job|job title|position title|department)$/i,
  parent: /^(reports to|manager|parent|boss|supervisor|line manager)$/i,
  from: /^(from|source|step|start)$/i,
  to: /^(to|target|next|next step|then)$/i,
  label: /^(label|condition|when|text|answer)$/i,
};

/** What the table describes: { kind: "org" | "flow", nodes: [{ key, text, type }], edges: [{ from, to, text }] }. */
export function readTable(rows) {
  if (!rows.length) throw new Error("The table is empty");
  const head = rows[0].map((c) => c.toLowerCase());
  const col = (re) => head.findIndex((c) => re.test(c));
  let kind, map, body = rows;
  if (col(H.parent) >= 0) { kind = "org"; map = { name: Math.max(0, col(H.name)), role: col(H.role), parent: col(H.parent) }; body = rows.slice(1); }
  else if (col(H.from) >= 0 && col(H.to) >= 0) { kind = "flow"; map = { from: col(H.from), to: col(H.to), label: col(H.label) }; body = rows.slice(1); }
  else {
    const width = Math.max(...rows.map((r) => r.length));
    if (width < 2) throw new Error("Each row needs two columns: a name and who they report to, or a step and the next step");
    const orgLike = rows.some((r) => !(r[width - 1] || "").trim());
    kind = orgLike ? "org" : "flow";
    map = orgLike ? { name: 0, role: width > 2 ? 1 : -1, parent: width - 1 } : { from: 0, to: 1, label: width > 2 ? 2 : -1 };
  }
  const nodes = new Map(), edges = [];
  const node = (text, extra = "") => {
    const key = text.trim().toLowerCase();
    if (!key) return null;
    if (!nodes.has(key)) nodes.set(key, { key, text: text.trim(), sub: extra });
    else if (extra && !nodes.get(key).sub) nodes.get(key).sub = extra;
    return key;
  };
  for (const r of body) {
    if (kind === "org") {
      const me = node(r[map.name] || "", map.role >= 0 ? r[map.role] || "" : "");
      const boss = node(r[map.parent] || "");
      if (me && boss && me !== boss) edges.push({ from: boss, to: me, text: "" });
    } else {
      const a = node(r[map.from] || ""), b = node(r[map.to] || "");
      if (a && b && a !== b) edges.push({ from: a, to: b, text: map.label >= 0 ? r[map.label] || "" : "" });
    }
  }
  if (!nodes.size) throw new Error("No names or steps found in the table");
  if (nodes.size > 500) throw new Error("The table has more than 500 names or steps");
  const into = new Set(edges.map((e) => e.to)), outof = new Set(edges.map((e) => e.from));
  const list = [...nodes.values()].map((n) => {
    let type = "rounded";
    if (kind === "flow") type = /\?\s*$/.test(n.text) ? "diamond" : !into.has(n.key) || !outof.has(n.key) ? "terminator" : "rect";
    return { key: n.key, text: n.sub ? `${n.text}\n${n.sub}` : n.text, type };
  });
  return { kind, nodes: list, edges };
}

const SIZE = { rounded: [160, 60], rect: [150, 60], diamond: [150, 90], terminator: [150, 50] };

/**
 * Adds the table's diagram to a page (inside DiagramModel.edit: one undo step) and lays it out, top to bottom
 * for an org chart, left to right for a flowchart. newId(prefix) gives fresh ids. Returns what it added.
 */
export function addTable(page, table, newId) {
  const layer = page.layers.find((l) => l.visible && !l.locked) || page.layers[0];
  const ids = new Map();
  for (const n of table.nodes) {
    const [w, h] = SIZE[n.type];
    const id = newId("s");
    ids.set(n.key, id);
    page.items.push({ id, kind: "shape", type: n.type, layer: layer.id, x: 20, y: 20, w, h, rotate: 0, text: n.text, style: {} });
  }
  for (const e of table.edges) page.items.push({ id: newId("c"), kind: "connector", layer: layer.id, from: { shape: ids.get(e.from), point: "bottom" }, to: { shape: ids.get(e.to), point: "top" }, route: "elbow", text: e.text, style: { arrowEnd: true } });
  const shapeIds = [...ids.values()];
  applyLayout(page, autoLayout(page, { direction: table.kind === "org" ? "down" : "right", ids: shapeIds, origin: { x: 20, y: 20 } }));
  return { shapes: shapeIds.length, connectors: table.edges.length, kind: table.kind };
}
