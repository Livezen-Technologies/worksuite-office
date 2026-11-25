/*
 * The theme WorkSuite Office is set to (Light, Classic Light, Dark, Contrast Dark, or the system's), so Project and
 * Diagram look like the document editors beside them. Read, in order: ?theme= in the address, the desktop shell's
 * RendererProcessVariable.theme, and the editors' own saved choice (localStorage ui-theme-id / ui-theme); otherwise
 * the system's light or dark (office.css follows prefers-color-scheme). Changes made in another window apply here
 * at once. Classic script, run before the page draws, so it never flashes the wrong colours.
 */
(function () {
  var DARK = /dark|night|black/i, CONTRAST = /contrast/i;
  function fromId(id, type) {
    if (!id && !type) return null;
    if (/system/i.test(id || "")) return "system";
    if (type === "dark" || DARK.test(id || "")) return CONTRAST.test(id || "") ? "contrast" : "dark";
    if (type === "light" || /light|white|classic/i.test(id || "")) return "light";
    return null;
  }
  function read() {
    try { var q = new URLSearchParams(location.search).get("theme"); if (q) return fromId(q, q === "dark" || q === "light" ? q : ""); } catch (e) { /* no address */ }
    try {
      var r = window.RendererProcessVariable && window.RendererProcessVariable.theme;
      if (r) { var t = fromId(r.id, r.type); if (t) return t; }
    } catch (e) { /* not in the desktop shell */ }
    try {
      var saved = localStorage.getItem("ui-theme");
      if (saved) { var o = JSON.parse(saved); var t2 = fromId(o && o.id, o && o.type); if (t2) return t2; }
      var id = localStorage.getItem("ui-theme-id");
      if (id) return fromId(id, "");
    } catch (e) { /* storage blocked */ }
    return null;
  }
  function apply() {
    var t = read(), el = document.documentElement;
    if (!t || t === "system") { el.removeAttribute("data-theme"); el.removeAttribute("data-contrast"); return; }
    el.setAttribute("data-theme", t === "light" ? "light" : "dark");
    if (t === "contrast") el.setAttribute("data-contrast", ""); else el.removeAttribute("data-contrast");
  }
  apply();
  window.addEventListener("storage", function (e) { if (!e.key || /^ui-theme/.test(e.key)) apply(); });
  window.WorkSuiteTheme = { apply: apply, read: read };
})();
