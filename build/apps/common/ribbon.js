/*
 * WorkSuite Project and Diagram: the ribbon's icons (own drawings, 20×20, stroked in currentColor so they follow
 * the light and dark themes). A button with data-icon gets its icon; class "big" stacks icon over label.
 */
import { EDITOR_ICONS } from "./editor-icons.js";

const I = {
  new: "M5 2.5h7l3.5 3.5v11.5h-10.5z M12 2.5v3.5h3.5",
  open: "M2.5 5.5v10h13l2-7h-13l-2 7 M2.5 5.5h5l1.5 2h6v1.5",
  save: "M3.5 3.5h10.5l2.5 2.5v10.5h-13z M6.5 3.5v4h6v-4 M6 16.5v-5h8v5",
  print: "M5.5 7.5v-4.5h9v4.5 M3.5 7.5h13v6h-2.5 M5.5 13.5h-2v-6 M5.5 11h9v6h-9z",
  export: "M10 13v-10 M6.5 6.5l3.5-3.5 3.5 3.5 M3.5 12v4.5h13v-4.5",
  outline: "M3 5h2 M8 5h9 M5.5 10h2 M10 10h7 M5.5 15h2 M10 15h7",
  ai: "M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z M15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  table: "M2.5 4h15v12h-15z M2.5 8h15 M2.5 12h15 M8 4v12",
  task: "M2.5 6h11v4h-11z M6.5 13h11v4h-11z M15.5 3v6 M12.5 6h6",
  milestone: "M10 3.5l6.5 6.5-6.5 6.5-6.5-6.5z",
  remove: "M4 5.5h12 M8 5.5v-2h4v2 M5.5 5.5l1 11h7l1-11 M8.5 8.5v5.5 M11.5 8.5v5.5",
  indent: "M3 4h14 M9 8h8 M9 12h8 M3 16h14 M3 8l3 2-3 2z",
  outdent: "M3 4h14 M9 8h8 M9 12h8 M3 16h14 M6 8l-3 2 3 2z",
  link: "M8.5 11.5l3-3 M7 9.5l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2 M13 10.5l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2",
  unlink: "M7 9.5l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2 M13 10.5l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2 M3 3l14 14",
  p0: "M10 3.5a6.5 6.5 0 1 0 .01 0z",
  p50: "M10 3.5a6.5 6.5 0 1 0 .01 0z M10 3.5v13",
  p100: "M10 3.5a6.5 6.5 0 1 0 .01 0z M6.8 10.2l2.2 2.2 4.2-4.6",
  undo: "M7 5l-3.5 3.5 3.5 3.5 M3.5 8.5h8.5a4.5 4.5 0 0 1 0 9h-3",
  redo: "M13 5l3.5 3.5-3.5 3.5 M16.5 8.5h-8.5a4.5 4.5 0 0 0 0 9h3",
  schedule: "M3 4.5h14v12h-14z M3 8h14 M6.5 2.5v4 M13.5 2.5v4 M6.5 11.5l2 2 5-4.5",
  calendar: "M3 4.5h14v12h-14z M3 8h14 M6.5 2.5v4 M13.5 2.5v4 M6 11h2 M9 11h2 M12 11h2 M6 14h2 M9 14h2",
  critical: "M2.5 6h6v3h-6z M8.5 12h9v3h-9z M8.5 7.5h2.5v6",
  baseline: "M2.5 5h10v3h-10z M2.5 10.5h13 M7 13.5h10v3h-10z",
  statusdate: "M10 2.5v15 M3 6h5v3h-5z M12 11h5v3h-5z M8 2.5h4",
  today: "M3 4.5h14v12h-14z M3 8h14 M10 10.5a2.5 2.5 0 1 0 .01 0z",
  zoomin: "M8.5 3a5.5 5.5 0 1 0 .01 0z M12.5 12.5l4.5 4.5 M6 8.5h5 M8.5 6v5",
  zoomout: "M8.5 3a5.5 5.5 0 1 0 .01 0z M12.5 12.5l4.5 4.5 M6 8.5h5",
  fit: "M3 7v-4h4 M13 3h4v4 M17 13v4h-4 M7 17h-4v-4 M7 7h6v6h-6z",
  gantt: "M3 4v13h14 M5.5 6h5v2.5h-5z M8.5 10h6v2.5h-6z M11.5 14h4v2h-4z",
  workload: "M3 16.5h14 M4.5 16.5v-6h3v6 M8.5 16.5v-11h3v11 M12.5 16.5v-8h3v8",
  team: "M7 9a2.8 2.8 0 1 0 .01 0z M2.5 17c0-3 2-4.8 4.5-4.8s4.5 1.8 4.5 4.8 M13.5 8a2.3 2.3 0 1 0 .01 0z M12.5 12.4c2.6-.6 5 .9 5 4.1",
  pointer: "M5 3l10 6.5-4.5 1 2.5 5-2 1-2.5-5-3.5 3z",
  connector: "M3.5 5h4v4h-4z M12.5 11h4v4h-4z M7.5 7h3v6h2",
  duplicate: "M7 7h9.5v9.5h-9.5z M4 13h-.5v-9.5h9.5v.5",
  alignleft: "M3 2.5v15 M5 5h9v3.5h-9z M5 11.5h6v3.5h-6z",
  aligncenter: "M10 2.5v15 M4.5 5h11v3.5h-11z M6.5 11.5h7v3.5h-7z",
  aligntop: "M2.5 3h15 M5 5h3.5v9h-3.5z M11.5 5h3.5v6h-3.5z",
  distribute: "M3 3v14 M17 3v14 M6 7h2.5v6h-2.5z M11.5 7h2.5v6h-2.5z",
  alignright: "M17 2.5v15 M6 5h9v3.5h-9z M9 11.5h6v3.5h-6z",
  alignmiddle: "M2.5 10h15 M5 4.5h3.5v11h-3.5z M11.5 6.5h3.5v7h-3.5z",
  alignbottom: "M2.5 17h15 M5 6h3.5v9h-3.5z M11.5 9h3.5v6h-3.5z",
  distributev: "M3 3h14 M3 17h14 M7 6h6v2.5h-6z M7 11.5h6v2.5h-6z",
  ruler: "M2.5 7h15v6h-15z M5.5 7v3 M8.5 7v2 M11.5 7v3 M14.5 7v2",
  comment: "M3 4h14v9h-8l-4 3v-3h-2z M10 6.5v4 M8 8.5h4",
  comments: "M3 4h11v7h-6l-3 3v-3h-2z M16 7h1v7h-2v3l-3-3h-4",
  template: "M3 3h6v6h-6z M11 3h6v6h-6z M3 11h6v6h-6z M11 11h6v6h-6z M5 6h2 M13 5h2v2h-2z",
  report: "M4 2.5h9l3 3v12h-12z M7 9h6 M7 12h6 M7 15h4",
  list: "M3 3h14v14h-14z M3 6.5h14 M6 9.5h8 M6 12h8 M6 14.5h8",
  check: "M3 3h14v14h-14z M6 10l3 3 5-6",
  theme: "M10 2.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.9 1.2-1.8-.5-1 .1-2.2 1.3-2.2h1.6a3.4 3.4 0 0 0 3.4-3.4c0-4.3-3.4-7.6-7.5-7.6z M6 9a1 1 0 1 0 .01 0z M9 5.5a1 1 0 1 0 .01 0z M13 6.5a1 1 0 1 0 .01 0z",
  pageframe: "M3 3h14v14h-14z M3 6.5h14 M10.5 13h4.5v4",
  autoalign: "M2.5 8h4v4h-4z M8 8h4v4h-4z M13.5 8h4v4h-4z M6.5 10h1.5 M12 10h1.5 M4.5 5.5v-2 M15.5 5.5v-2 M4.5 3.5h11",
  group: "M2.5 2.5h15v15h-15z M5.5 5.5h4v4h-4z M10.5 10.5h4v4h-4z",
  ungroup: "M5.5 5.5h4v4h-4z M10.5 10.5h4v4h-4z M2.5 4.5v-2h2 M15.5 2.5h2v2 M17.5 15.5v2h-2 M4.5 17.5h-2v-2",
  front: "M7 7h10v10h-10z M3 13v-10h10",
  back: "M3 3h10v10h-10z M7 13v4h10v-10h-4",
  layoutdown: "M8 2.5h4v3h-4z M3 13h4v3h-4z M13 13h4v3h-4z M10 5.5v4 M5 13v-3.5h10v3.5",
  layoutright: "M2.5 8h3v4h-3z M13 3h3v4h-3z M13 13h3v4h-3z M5.5 10h4 M13 5h-3.5v10h3.5",
  grid: "M3 3h14v14h-14z M7.7 3v14 M12.3 3v14 M3 7.7h14 M3 12.3h14",
  inactive: "M10 3a7 7 0 1 0 .01 0z M5 15L15 5",
  money: "M3 5h14v10h-14z M10 7.5a2.5 2.5 0 1 0 .01 0z M5.5 7.5v5 M14.5 7.5v5",
  level: "M3 16.5h14 M4.5 16.5v-5h3v5 M8.5 16.5v-5h3v5 M12.5 16.5v-5h3v5 M3 8.5h14 M10 3v4 M8 5l2 2 2-2",
  recurring: "M15.5 7.5a6 6 0 1 0 .8 4 M16 3.5v4h-4 M8 9.5h4 M8 12h4",
  board: "M3 3.5h4v13h-4z M8 3.5h4v9h-4z M13 3.5h4v6h-4z",
  network: "M2.5 7h5v6h-5z M12.5 3h5v5h-5z M12.5 12h5v5h-5z M7.5 10h2.5v-4.5h2.5 M10 10v4.5h2.5",
  page: "M5 2.5h7l3.5 3.5v11.5h-10.5z M12 2.5v3.5h3.5 M10 9.5v5 M7.5 12h5",
};

export const ICONS = I;

/** The SVG for an icon name, or "" when there is none: the document editors' own icon where there is one
 * (editor-icons.js; its big version for big buttons), else ours. */
export function iconSvg(name, size = 20) {
  const e = EDITOR_ICONS[name], v = e && (size > 20 && e.big ? e.big : e.small || e.big);
  if (v) return `<svg class="rb-ic" width="${size}" height="${size}" viewBox="${v.viewBox}" fill="none" aria-hidden="true">${v.body}</svg>`;
  const d = I[name];
  return d ? `<svg class="rb-ic" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "";
}

/** Gives every [data-icon] button in `root` its icon (once), its label in a span, and the label as a tooltip. */
export function decorateRibbon(root) {
  for (const b of root.querySelectorAll("[data-icon]")) {
    if (b.querySelector(".rb-ic")) continue;
    const label = b.textContent.trim();
    if (!b.title) b.title = label;
    b.innerHTML = iconSvg(b.dataset.icon, b.classList.contains("big") ? 26 : 16) + `<span>${label}</span>`;
  }
}

export const RIBBON_CSS = `
.rb-group { display: none; align-items: stretch; gap: 2px; padding: 2px 8px 16px; border-inline-end: 1px solid var(--line); position: relative; height: 86px; box-sizing: border-box; }
.rb-group.is-on { display: flex; }
.rb-group > .rb-stack { display: grid; grid-auto-flow: column; grid-template-rows: repeat(3, 22px); gap: 1px 2px; align-content: start; }
.rb-group button { font: inherit; color: var(--ink); background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 2px 7px; white-space: nowrap; font-size: 12px; line-height: 16px; }
.rb-group button.big { flex-direction: column; justify-content: flex-start; gap: 3px; padding: 4px 6px; min-width: 52px; max-width: 76px; white-space: normal; text-align: center; line-height: 1.15; }
.rb-group button.big .rb-ic { color: var(--brand); }
.rb-group button:hover:not(:disabled) { background: var(--hover); border-color: var(--line); }
.rb-group button.is-on, .rb-group button[aria-pressed="true"] { background: var(--brand-soft, var(--sel)); border-color: transparent; color: var(--brand); }
.rb-group button:disabled { color: var(--ink3); cursor: default; opacity: .55; }
.rb-group button:disabled .rb-ic { color: inherit; }
.rb-group .rb-field { display: flex; align-items: center; gap: 6px; color: var(--ink2); font-size: 12px; padding: 0 4px; height: 22px; white-space: nowrap; }
.rb-group .rb-field select, .rb-group .rb-field input[type="date"] { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; height: 22px; }
.rb-group .rb-field input[type="checkbox"] { margin: 0; accent-color: var(--brand); }
.rb-glabel { position: absolute; bottom: 1px; left: 0; right: 0; text-align: center; font-size: 10.5px; color: var(--ink3); white-space: nowrap; }
`;

/** Adds the ribbon styles to the page once. */
export function ribbonStyles(doc = document) {
  if (doc.getElementById("rb-css")) return;
  const st = doc.createElement("style"); st.id = "rb-css"; st.textContent = RIBBON_CSS; doc.head.append(st);
}
