/*
 * WorkSuite Project and Diagram: a small dialog for pasting text (an outline, a table), in the start page's
 * tokens (--card, --ink, --line, --brand), light and dark.
 */

/**
 * Asks for text. options: { title, hint, placeholder, sample (a "Try an example" fill), checkbox (label, or
 * null), checked, ok, value (text to start with), rows }. Resolves { text, checked }, or null when cancelled.
 */
export function askText({ title, hint = "", placeholder = "", sample = "", checkbox = null, checked = true, ok = "Create", value = "", rows = 12 } = {}, doc = document) {
  if (!doc.getElementById("ws-ask-css")) { const st = doc.createElement("style"); st.id = "ws-ask-css"; st.textContent = DIALOG_CSS; doc.head.append(st); }
  return new Promise((resolve) => {
    const d = doc.createElement("dialog");
    d.className = "ws-ask";
    d.innerHTML = `<form method="dialog">
      <h2></h2><p class="hint"></p>
      <textarea rows="12"></textarea>
      ${checkbox ? '<label class="check"><input type="checkbox"> <span></span></label>' : ""}
      <div class="row">${sample ? '<button type="button" class="link" data-sample>Try an example</button>' : ""}<span class="err" role="alert"></span>
        <button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary"></button></div></form>`;
    d.querySelector("h2").textContent = title;
    d.querySelector(".hint").textContent = hint;
    const ta = d.querySelector("textarea");
    ta.placeholder = placeholder; ta.value = value; ta.rows = rows;
    d.querySelector(".primary").textContent = ok;
    const box = d.querySelector(".check input");
    if (box) { box.checked = checked; d.querySelector(".check span").textContent = checkbox; }
    d.querySelector("[data-sample]")?.addEventListener("click", () => { ta.value = sample; ta.focus(); });
    d.addEventListener("close", () => {
      const out = d.returnValue === "ok" && ta.value.trim() ? { text: ta.value, checked: box ? box.checked : false } : null;
      d.remove();
      resolve(out);
    });
    doc.body.append(d);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    ta.focus();
  });
}

export const DIALOG_CSS = `
dialog.ws-ask { width: min(560px, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); color: var(--ink); box-shadow: 0 12px 40px rgba(0,0,0,.25); }
dialog.ws-ask::backdrop { background: rgba(0,0,0,.35); }
dialog.ws-ask h2 { margin: 0 0 4px; font-size: 16px; }
dialog.ws-ask .hint { margin: 0 0 10px; color: var(--ink2); font-size: 12.5px; white-space: pre-line; }
dialog.ws-ask textarea { width: 100%; box-sizing: border-box; font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px; resize: vertical; }
dialog.ws-ask .check { display: flex; gap: 6px; align-items: center; margin-top: 8px; color: var(--ink2); font-size: 12.5px; }
dialog.ws-ask .row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
dialog.ws-ask .row .err { flex: 1; }
dialog.ws-ask button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 7px; padding: 6px 14px; cursor: pointer; }
dialog.ws-ask button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
dialog.ws-form .grid { display: grid; gap: 10px; margin-top: 6px; }
dialog.ws-form label.row { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 4px 12px; font-size: 13px; color: var(--ink2); }
dialog.ws-form label.row[hidden] { display: none; }
dialog.ws-form label.row small { grid-column: 2; color: var(--ink3); font-size: 11.5px; }
dialog.ws-form input:not([type=checkbox]):not([type=radio]), dialog.ws-form select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 5px 8px; min-width: 0; }
dialog.ws-form .days, dialog.ws-form .radios { display: flex; flex-wrap: wrap; gap: 4px 10px; }
dialog.ws-form .days label, dialog.ws-form .radios label { display: flex; align-items: center; gap: 4px; }
dialog.ws-form .row-end { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
dialog.ws-form .row-end .err { flex: 1; color: #dc2626; font-size: 12.5px; }
dialog.ws-ask button.link { border: 0; padding: 6px 0; color: var(--brand); background: none; }
`;

/**
 * Asks for a few values. fields: [{ key, label, type: "text" | "number" | "date" | "select" | "days" | "radio",
 * value, options: [[value, label]], min, max, hint }]. A "days" field is Mon–Sun toggles (value: [1..7]).
 * check(values) returns an error text to show (the dialog stays open) or null. Resolves the values, or null.
 */
export function askForm({ title, hint = "", fields = [], ok = "Create", check = () => null } = {}, doc = document) {
  if (!doc.getElementById("ws-ask-css")) { const st = doc.createElement("style"); st.id = "ws-ask-css"; st.textContent = DIALOG_CSS; doc.head.append(st); }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const control = (f) => {
    if (f.type === "select") return `<select name="${f.key}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    if (f.type === "radio") return `<span class="radios">${f.options.map(([v, l]) => `<label><input type="radio" name="${f.key}" value="${esc(v)}" ${v === f.value ? "checked" : ""}> ${esc(l)}</label>`).join("")}</span>`;
    if (f.type === "days") return `<span class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="${f.key}" value="${i + 1}" ${(f.value || []).includes(i + 1) ? "checked" : ""}> ${d}</label>`).join("")}</span>`;
    return `<input name="${f.key}" type="${f.type || "text"}" value="${esc(f.value)}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""}>`;
  };
  return new Promise((resolve) => {
    const d = doc.createElement("dialog");
    d.className = "ws-ask ws-form";
    d.innerHTML = `<form method="dialog"><h2></h2><p class="hint"></p><div class="grid">${fields.map((f) => `<label class="row" data-field="${f.key}"><span>${esc(f.label)}</span>${control(f)}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`).join("")}</div>
      <div class="row-end"><span class="err" role="alert"></span><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary"></button></div></form>`;
    d.querySelector("h2").textContent = title;
    d.querySelector(".hint").textContent = hint;
    d.querySelector(".primary").textContent = ok;
    const values = () => {
      const fd = new FormData(d.querySelector("form")), out = {};
      for (const f of fields) {
        if (f.type === "days") out[f.key] = fd.getAll(f.key).map(Number);
        else if (f.type === "number") out[f.key] = fd.get(f.key) === "" ? null : Number(fd.get(f.key));
        else out[f.key] = fd.get(f.key) ?? "";
      }
      return out;
    };
    const sync = () => { for (const f of fields) if (f.showIf) d.querySelector(`[data-field="${f.key}"]`).hidden = !f.showIf(values()); };
    d.querySelector("form").addEventListener("change", sync);
    sync();
    d.querySelector(".primary").addEventListener("click", (e) => {
      const err = check(values());
      if (err) { e.preventDefault(); d.querySelector(".err").textContent = err; }
    });
    d.addEventListener("close", () => { const out = d.returnValue === "ok" ? values() : null; d.remove(); resolve(out); });
    doc.body.append(d);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    d.querySelector("input, select")?.focus();
  });
}
