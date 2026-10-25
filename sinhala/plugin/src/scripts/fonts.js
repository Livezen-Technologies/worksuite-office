/*
 * The Sinhala font picker (fonts.html): Unicode fonts and legacy fonts with a map, searchable, each with
 * a sample in that font and whether it is installed; legacy fonts without a map are listed disabled.
 * plugin.js sends onFontsInit { catalog, typing, sample } and gets onFontsChoose { unicode } or
 * { profile, name }, or onFontsCancel.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var S = window.WorkSuiteSinhala;
  var data = null;
  var rows = [];
  var current = -1;

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function translate() {
    var nodes = document.querySelectorAll("[data-tr]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tr(nodes[i].getAttribute("data-tr"));
    $("search").setAttribute("placeholder", tr("Search fonts"));
  }

  function sampleFor(row) {
    return row.profile ? S.toLegacy(data.sample, S.getProfile(row.profile)).text : data.sample;
  }

  function build() {
    rows = [];
    data.catalog.unicode.forEach(function (f) { rows.push({ group: "unicode", name: f.name, label: f.name, installed: f.installed, bundled: f.bundled, enabled: true }); });
    data.catalog.legacy.forEach(function (f) { rows.push({ group: "legacy", name: f.name, label: f.label, profile: f.profile, installed: f.installed, enabled: f.mapped }); });
    var t = data.typing || {};
    current = -1;
    rows.forEach(function (r, i) {
      if (t.mode === "legacy" ? r.profile && r.profile === t.legacyProfile : !r.profile && r.name === t.unicodeFont) current = i;
    });
    render();
  }

  function render() {
    var q = $("search").value.trim().toLowerCase();
    var list = $("list");
    list.textContent = "";
    ["unicode", "legacy"].forEach(function (g) {
      var shown = rows.filter(function (r) { return r.group === g && (!q || r.label.toLowerCase().indexOf(q) >= 0); });
      if (!shown.length) return;
      list.appendChild(el("div", "lg-group", g === "unicode" ? tr("Unicode fonts") : tr("Legacy fonts")));
      shown.forEach(function (r) {
        var i = rows.indexOf(r);
        var row = el("div", "lg-row");
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === current));
        if (!r.enabled) row.setAttribute("aria-disabled", "true");
        row.appendChild(el("span", "nm", r.label));
        var chip = !r.enabled ? el("span", "chip", tr("map not available"))
          : r.installed ? el("span", "chip ok", r.bundled ? tr("bundled") : tr("installed"))
          : el("span", "chip warn", tr("not installed"));
        row.appendChild(chip);
        var sm = el("span", "sm", r.enabled ? sampleFor(r) : "");
        sm.style.fontFamily = "\"" + r.name + "\", sans-serif";
        row.appendChild(sm);
        if (r.enabled) row.addEventListener("click", function () { current = i; render(); });
        list.appendChild(row);
      });
    });
    var r = rows[current];
    $("apply").disabled = !r || !r.enabled;
    var preview = $("preview");
    preview.textContent = r ? sampleFor(r) : "";
    preview.style.fontFamily = r ? "\"" + r.name + "\", sans-serif" : "";
    var st = $("status");
    st.className = "lg-status" + (r ? r.installed ? " ok" : " warn" : "");
    st.textContent = !r ? "" : r.installed ? fmt("%1 is installed.", r.name)
      : r.profile ? fmt("%1 is not installed: the converted text shows as Latin letters until it is.", r.name)
      : fmt("%1 is not installed here: Sinhala shows in a fallback font until it is.", r.name);
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    for (var k in theme) if (typeof theme[k] === "string" && /^[a-z][a-z0-9-]*$/.test(k)) root.style.setProperty("--" + k, theme[k]);
    root.setAttribute("data-theme-type", theme.type === "dark" ? "dark" : "light");
  }

  plugin.init = function () {
    translate();
    $("search").addEventListener("input", render);
    $("cancel").addEventListener("click", function () { plugin.sendToPlugin("onFontsCancel", {}); });
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var r = rows[current];
      if (!r || !r.enabled) return;
      plugin.sendToPlugin("onFontsChoose", r.profile ? { profile: r.profile, name: r.installed ? r.name : "" } : { unicode: r.name });
    });
    document.addEventListener("keydown", function (e) { if (e.keyCode === 27) plugin.sendToPlugin("onFontsCancel", {}); });
    if (plugin.theme) applyTheme(plugin.theme);
    plugin.sendToPlugin("onFontsReady", {});
  };
  plugin.attachEvent("onFontsInit", function (d) { data = d; build(); });
  plugin.onTranslate = function () { translate(); if (data) render(); };
  plugin.onThemeChanged = function (theme) { if (plugin.onThemeChangedBase) plugin.onThemeChangedBase(theme); applyTheme(theme); };
  plugin.button = function () { plugin.sendToPlugin("onFontsCancel", {}); };
})(window, document);
