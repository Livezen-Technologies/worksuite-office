/*
 * WorkSuite Project and Diagram: a small dialog for pasting text (an outline, a table), in the start page's
 * tokens (--card, --ink, --line, --brand), light and dark.
 */

/**
 * Asks for text. options: { title, hint, placeholder, sample (a "Try an example" fill), checkbox (label, or
 * null), checked, ok }. Resolves { text, checked }, or null when cancelled.
 */
export function askText({ title, hint = "", placeholder = "", sample = "", checkbox = null, checked = true, ok = "Create" } = {}, doc = document) {
  if (!doc.getElementById("ws-ask-css")) { const st = doc.createElement("style"); st.id = "ws-ask-css"; st.textContent = DIALOG_CSS; doc.head.append(st); }
  return new Promise((resolve) => {
    const d = doc.createElement("dialog");
    d.className = "ws-ask";
    d.innerHTML = `<form method="dialog">
      <h2></h2><p class="hint"></p>
      <textarea rows="12" spellcheck="false"></textarea>
      ${checkbox ? '<label class="check"><input type="checkbox"> <span></span></label>' : ""}
      <div class="row">${sample ? '<button type="button" class="link" data-sample>Try an example</button>' : ""}<span class="err" role="alert"></span>
        <button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary"></button></div></form>`;
    d.querySelector("h2").textContent = title;
    d.querySelector(".hint").textContent = hint;
    const ta = d.querySelector("textarea");
    ta.placeholder = placeholder;
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
dialog.ws-ask button.link { border: 0; padding: 6px 0; color: var(--brand); background: none; }
`;
