/*
 * The Convert dialog (legacy.html): Unicode -> a legacy font, or legacy -> Unicode, with the font, whether
 * it is installed, a live preview and the problems found. plugin.js sends onLegacyInit (the selection, its
 * font, the installed fonts, the last choices) and gets onLegacyApply { direction, profile, font } or
 * onLegacyCancel; plugin.js does the conversion in the document.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var S = window.WorkSuiteSinhala;
  var KEY = "worksuite-sinhala-tools-legacy";
  // which profiles share an encoding: a profile's map is used only for its own family's fonts
  var FAMILY = { "fm-abhaya": "FM (Wijesekara)", "dl-manel": "DL (Wijesekara)", "kaputa": "Kaputa", "lastech": "Lastech", "kandy": "Kandy" };
  // one option per font family; families sharing a profile (DL-Sarala, Kumudu, ... with DL Manel) convert alike
  var CHOICES = S.legacyFonts();
  var SINHALA = /[඀-෿]/;
  var init = null;
  var direction = "toLegacy";

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }
  function $(id) { return document.getElementById(id); }
  function known(id) { return S.builtinProfiles.some(function (p) { return p.id === id; }); }
  // the option for a profile: the remembered family if it is one of the profile's, else its first family
  function choiceFor(id, family) {
    var at = -1;
    CHOICES.forEach(function (c, i) { if (c.profile === id && (at < 0 || c.family === family)) at = i; });
    return at;
  }
  function choice() { return CHOICES[Number($("profile").value)] || CHOICES[0]; }
  function familyNames(family) {
    var bare = family.replace(/\.$/, "");
    return [family, bare, bare.replace(/[-\s]+/g, " "), bare.replace(/[-\s]+/g, "")];
  }
  function remembered() { try { return window.localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function remember(id) { try { window.localStorage.setItem(KEY, id); } catch (e) { /* ignore */ } }

  function translate() {
    var nodes = document.querySelectorAll("[data-tr]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tr(nodes[i].getAttribute("data-tr"));
  }

  function installedName(names) {
    if (!init) return null;
    var lower = init.installed.map(function (n) { return n.toLowerCase(); });
    for (var i = 0; i < names.length; i++) {
      var at = lower.indexOf(names[i].toLowerCase());
      if (at >= 0) return init.installed[at];
    }
    return null;
  }

  function fillProfiles() {
    var select = $("profile");
    select.textContent = "";
    var auto = direction === "toUnicode" ? S.profileForFont(init.selectionFont) : null;
    CHOICES.forEach(function (c, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = c.family.replace(/\.$/, "") + " — " + fmt("%1 encoding", FAMILY[c.profile] || S.getProfile(c.profile).name);
      select.appendChild(o);
    });
    var last = remembered().split("|");
    var at = auto ? choiceFor(auto.id, init.selectionFont)
      : known(last[0]) ? choiceFor(last[0], last[1])
      : known(init.legacyProfile) ? choiceFor(init.legacyProfile, init.legacyFamily) : 0;
    if (direction === "toUnicode" && !auto) {
      var d = S.detect(init.text);
      if (d.profile) at = choiceFor(d.profile, "");
    }
    select.value = String(at < 0 ? 0 : at);
  }

  function setDirection(dir) {
    direction = dir;
    $("dirToLegacy").setAttribute("aria-checked", String(dir === "toLegacy"));
    $("dirToUnicode").setAttribute("aria-checked", String(dir === "toUnicode"));
    $("fontLabel").textContent = dir === "toLegacy" ? tr("Legacy font") : tr("The text's legacy font");
    fillProfiles();
    update();
  }

  function update() {
    if (!init) return;
    var picked = choice();
    var profile = S.getProfile(picked.profile);
    var problems = [];
    var warnings = [];
    var text = init.text;
    var out = "";
    var targetFont;
    if (!text.replace(/\s+/g, "")) problems.push(tr("Select the text to convert first."));
    if (direction === "toLegacy") {
      if (!SINHALA.test(text)) problems.push(tr("There is no Sinhala Unicode text in the selection."));
      var r = S.toLegacy(text, profile);
      out = r.text;
      if (r.unmapped.length) warnings.push(unmapped(r.unmapped));
      targetFont = installedName(familyNames(picked.family).concat(picked === CHOICES[choiceFor(profile.id, "")] ? profile.fontNames : []));
      status(targetFont, picked.family.replace(/\.$/, ""));
    } else {
      if (SINHALA.test(text) && !/[A-Za-z]/.test(text)) problems.push(tr("The selection is already Sinhala Unicode."));
      if (init.mixed) warnings.push(tr("The selection mixes fonts: all of it is converted with the font chosen here."));
      else if (init.selectionFont && !S.profileForFont(init.selectionFont)) warnings.push(fmt("%1 is not a legacy Sinhala font Sinhala Tools knows. Choose its font.", init.selectionFont));
      var u = S.toUnicode(text, profile);
      out = u.text;
      if (u.unmapped.length) warnings.push(unmapped(u.unmapped));
      targetFont = installedName([init.unicodeFont]) || init.unicodeFont;
      status(installedName([init.unicodeFont]), init.unicodeFont);
    }
    var preview = $("preview");
    preview.textContent = out.length > 600 ? out.slice(0, 600) + "…" : out;
    preview.style.fontFamily = targetFont ? "\"" + targetFont + "\", sans-serif" : "";
    $("previewNote").textContent = targetFont ? fmt("Shown in %1.", targetFont)
      : tr("The font is not installed here, so the preview shows the encoded letters, not the Sinhala glyphs.");
    var box = $("problems");
    box.textContent = "";
    box.className = "lg-problems" + (problems.length ? "" : " warn");
    problems.concat(warnings).forEach(function (m) {
      var d = document.createElement("div");
      if (typeof m === "string") d.textContent = m; else d.appendChild(m);
      box.appendChild(d);
    });
    $("apply").disabled = problems.length > 0;
  }

  function status(installed, name) {
    var s = $("fontStatus");
    if (!init.fontListKnown) { s.className = "lg-status"; s.textContent = ""; return; }
    s.className = "lg-status " + (installed ? "ok" : "warn");
    s.textContent = installed ? fmt("%1 is installed.", installed)
      : fmt("%1 is not installed: the converted text shows as Latin letters until it is.", name);
  }

  function unmapped(list) {
    var span = document.createElement("span");
    var seen = {};
    var chars = [];
    list.forEach(function (u) { if (!seen[u.text]) { seen[u.text] = true; chars.push(u.codePoint + " " + u.text); } });
    span.appendChild(document.createTextNode(fmt("%1 characters have no mapping and are left as they are:", list.length) + " "));
    var code = document.createElement("code");
    code.textContent = chars.slice(0, 12).join(", ") + (chars.length > 12 ? ", …" : "");
    span.appendChild(code);
    return span;
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    for (var k in theme) if (typeof theme[k] === "string" && /^[a-z][a-z0-9-]*$/.test(k)) root.style.setProperty("--" + k, theme[k]);
    root.setAttribute("data-theme-type", theme.type === "dark" ? "dark" : "light");
  }

  plugin.init = function () {
    translate();
    $("dirToLegacy").addEventListener("click", function () { setDirection("toLegacy"); });
    $("dirToUnicode").addEventListener("click", function () { setDirection("toUnicode"); });
    $("profile").addEventListener("change", update);
    $("cancel").addEventListener("click", function () { plugin.sendToPlugin("onLegacyCancel", {}); });
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if ($("apply").disabled) return;
      var c = choice();
      if (direction === "toLegacy") remember(c.profile + "|" + c.family);
      plugin.sendToPlugin("onLegacyApply", { direction: direction, profile: c.profile, font: c.family });
    });
    document.addEventListener("keydown", function (e) { if (e.keyCode === 27) plugin.sendToPlugin("onLegacyCancel", {}); });
    if (plugin.theme) applyTheme(plugin.theme);
    plugin.sendToPlugin("onLegacyReady", {});
  };

  plugin.attachEvent("onLegacyInit", function (data) {
    init = data;
    init.installed = init.installed || [];
    setDirection(data.direction === "toUnicode" ? "toUnicode" : "toLegacy");
  });
  plugin.onTranslate = function () { translate(); if (init) setDirection(direction); };
  plugin.onThemeChanged = function (theme) {
    if (plugin.onThemeChangedBase) plugin.onThemeChangedBase(theme);
    applyTheme(theme);
  };
  plugin.button = function () { plugin.sendToPlugin("onLegacyCancel", {}); };
})(window, document);
