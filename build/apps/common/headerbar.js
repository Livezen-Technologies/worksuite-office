/*
 * The right-hand end of the header and tab bar, as in the document editors: the person's initials at the top; then,
 * at the end of the tabs, an "Editing ▾" switch (Editing / Viewing), a folder button to open a file, and search.
 * Shared by WorkSuite Project and WorkSuite Diagram; each app says what opening, searching and the two modes do.
 */
import { iconSvg } from "./ribbon.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Initials of a name: "Hasa Rinda" → "HR", "mia" → "M". */
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The person's name, if the desktop shell or the editors have told us. */
export function userName(win = window) {
  try { const r = win.RendererProcessVariable; const n = r && (r.userName || (r.user && r.user.name)); if (n) return String(n); } catch (e) { /* not in the shell */ }
  try { return win.localStorage.getItem("ws-user-name") || win.localStorage.getItem("username") || ""; } catch (e) { return ""; }
}

const PENCIL = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 16l1-4 8-8 3 3-8 8-4 1z M11.5 5.5l3 3"/></svg>';
const EYE = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/></svg>';
const FOLDER = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 5.5h5l1.5 2h8.5v8.5h-15z"/><path d="M12 13.5h4m-1.5-1.5 1.5 1.5-1.5 1.5"/></svg>';
const SEARCH = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.5 12.5l4.5 4.5"/></svg>';

/**
 * Puts the controls in. opts: { header, tabs, isViewing(), canEdit(), setViewing(on), open(), search(text) → count }.
 * Returns refresh(), to call after the mode changes elsewhere.
 */
export function mountHeaderbar(opts) {
  const doc = opts.header.ownerDocument;
  const end = opts.header.querySelector(".os-header-end");
  const who = userName(doc.defaultView);
  if (end && initials(who)) end.innerHTML = `<span class="os-avatar" title="${esc(who)}">${esc(initials(who))}</span>`;

  const box = doc.createElement("div");
  box.className = "os-tab-end";
  box.innerHTML = `<div class="os-mode"><button type="button" class="os-mode-btn" aria-haspopup="menu" aria-expanded="false"></button>
      <div class="os-menu" role="menu" hidden><button type="button" role="menuitemradio" data-mode="edit">${PENCIL}<span>Editing</span></button><button type="button" role="menuitemradio" data-mode="view">${EYE}<span>Viewing</span></button></div></div>
    <button type="button" class="os-icon" data-hb="open" title="Open a file" aria-label="Open a file">${FOLDER}</button>
    <div class="os-find"><button type="button" class="os-icon" data-hb="search" title="Search" aria-label="Search">${SEARCH}</button>
      <form class="os-find-box" hidden><input type="search" placeholder="Search" aria-label="Search"><span class="os-find-count" aria-live="polite"></span></form></div>`;
  opts.tabs.appendChild(box);

  const btn = box.querySelector(".os-mode-btn"), menu = box.querySelector(".os-menu");
  const refresh = () => {
    const viewing = opts.isViewing();
    btn.innerHTML = `${viewing ? EYE : PENCIL}<span>${viewing ? "Viewing" : "Editing"}</span><span class="os-caret">⌄</span>`;
    btn.title = viewing ? "Viewing: changes are off" : "Editing";
    menu.querySelectorAll("[data-mode]").forEach((m) => {
      m.setAttribute("aria-checked", String((m.dataset.mode === "view") === viewing));
      m.disabled = m.dataset.mode === "edit" && !opts.canEdit();
      m.title = m.disabled ? "Editing needs WorkSuite Office Pro" : "";
    });
  };
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  menu.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    if (!m || m.disabled) return;
    opts.setViewing(m.dataset.mode === "view");
    close();
    refresh();
  });
  doc.addEventListener("click", (e) => { if (!box.contains(e.target)) { close(); } });

  box.querySelector('[data-hb="open"]').addEventListener("click", () => opts.open());
  const findBox = box.querySelector(".os-find-box"), input = findBox.querySelector("input"), count = findBox.querySelector(".os-find-count");
  box.querySelector('[data-hb="search"]').addEventListener("click", () => { findBox.hidden = !findBox.hidden; if (!findBox.hidden) input.focus(); });
  findBox.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { count.textContent = ""; return; }
    const n = opts.search(q);
    count.textContent = n ? `${n} found` : "No matches";
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { findBox.hidden = true; } });
  refresh();
  return refresh;
}
