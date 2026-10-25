/* The Sinhala Tools panel: settings, the same actions as the toolbar tab, and their results. */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var state = null;

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function translate() {
    var nodes = document.querySelectorAll("[data-tr]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tr(nodes[i].getAttribute("data-tr"));
  }

  function fill(select, options, value) {
    var keep = select.id === "profile" ? 1 : 0;
    while (select.options.length > keep) select.remove(keep);
    options.forEach(function (o) {
      var opt = el("option", o.text);
      opt.value = o.value;
      select.appendChild(opt);
    });
    select.value = value;
  }

  function renderState() {
    if (!state) return;
    var profiles = state.profiles.map(function (p) { return { value: p.id, text: p.name + " " + p.version }; });
    fill($("profile"), profiles, state.settings.profile);
    fill($("legacyProfile"), profiles, state.settings.legacyProfile);
    fill($("font"), state.fonts.map(function (f) { return { value: f, text: f }; }), state.settings.font);
    var ime = state.ime || { on: false, learned: 0 };
    fill($("mode"), (state.modes || []).map(function (m) { return { value: m.id, text: tr(m.label) }; }), ime.mode || "english");
    var cat = state.catalog || { unicode: [], legacy: [] };
    var fsel = $("typingFont");
    fsel.textContent = "";
    [["Unicode fonts", cat.unicode.map(function (f) { return { value: "u:" + f.name, text: f.name + (f.installed ? "" : " (" + tr("not installed") + ")") }; })],
     ["Legacy fonts", cat.legacy.map(function (f) { return { value: f.mapped ? "l:" + f.profile + ":" + (f.installed ? f.name : "") : "", text: f.label + (f.mapped ? f.installed ? "" : " (" + tr("not installed") + ")" : " (" + tr("map not available") + ")"), disabled: !f.mapped }; })]
    ].forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = tr(g[0]);
      g[1].forEach(function (o) { var opt = el("option", o.text); opt.value = o.value; opt.disabled = !!o.disabled; og.appendChild(opt); });
      fsel.appendChild(og);
    });
    var ty = ime.typing || {};
    for (var oi = 0; oi < fsel.options.length; oi++) {
      var v = fsel.options[oi].value;
      if (ty.mode === "legacy" ? v.indexOf("l:" + ty.legacyProfile + ":") === 0 : v === "u:" + ty.unicodeFont) { fsel.selectedIndex = oi; break; }
    }
    $("suggestions").checked = ty.suggestions !== false;
    $("acceptSpace").checked = ty.acceptSpace !== false;
    $("acceptTab").checked = !!ty.acceptTab;
    $("ai").checked = !!ty.ai;
    $("imeToggle").textContent = ime.on ? tr("Turn Sinhala input off") : tr("Turn Sinhala input on");
    $("imeStatus").textContent = (ime.on ? fmt("Typing in %1.", ime.font || "") : tr("Sinhala input is off.")) + " " + fmt("%1 words learned from your picks.", ime.learned);
    $("imeForget").disabled = !ime.learned;
    var docs = state.editor === "word";
    var buttons = document.querySelectorAll(".ws-doc");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !docs;
  }

  function sendSettings() {
    plugin.sendToPlugin("onPanelSettings", {
      profile: $("profile").value, legacyProfile: $("legacyProfile").value, font: $("font").value
    });
  }

  function list(items, line) {
    var ul = el("ul");
    items.forEach(function (item) {
      var li = el("li");
      line(item, li);
      ul.appendChild(li);
    });
    return ul;
  }

  function unmappedList(r) {
    if (!r.unmappedCount) return null;
    var box = el("div");
    box.appendChild(el("div", fmt("%1 characters have no mapping and were left as they are:", r.unmappedCount)));
    box.appendChild(list(r.unmapped, function (u, li) {
      if (u.paragraph) li.appendChild(document.createTextNode(fmt("Paragraph %1", u.paragraph) + ": "));
      li.appendChild(el("code", u.codePoint + " " + u.text));
      li.appendChild(document.createTextNode(" … " + u.context + " …"));
    }));
    if (r.unmapped.length < r.unmappedCount) box.appendChild(el("div", fmt("and %1 more", r.unmappedCount - r.unmapped.length)));
    return box;
  }

  function fontNote(r) {
    if (!r.font) return null;
    return r.fontApplied ? el("div", fmt("Font: %1. Undo restores the text and its font in one step.", r.font))
      : el("div", fmt("Set the font %1 on the converted text: it could not be set here.", r.font), "ws-error");
  }

  var ISSUES = {
    "not-nfc": "Not in Unicode normal form (NFC)",
    "sign-without-base": "Vowel sign without a letter",
    "kombuva-before-consonant": "Kombuva before its consonant (legacy order)",
    "double-vowel-sign": "Two vowel signs in a row",
    "zwj-order": "Joiner before the al-lakuna",
    "stray-zwj": "Stray zero-width joiner",
    "stray-zwnj": "Stray zero-width non-joiner"
  };

  function profilesText(r) {
    var names = Object.keys(r.profiles || {});
    return names.map(function (n) { return n + " " + r.profiles[n]; }).join(", ");
  }

  function renderResult(r) {
    var box = $("result");
    box.textContent = "";
    if (!r) return;
    if (r.error) { box.appendChild(el("div", r.error, "ws-error")); return; }
    var add = function (node) { if (node) box.appendChild(node); };
    switch (r.action) {
      case "typing":
        add(el("div", r.warning, "ws-error"));
        break;
      case "convertSelection":
        add(el("div", fmt("Converted %1 characters from %2 %3.", r.characters, r.profile, r.profileVersion)));
        add(fontNote(r));
        if (r.how === "detected") add(el("div", fmt("The font was guessed from the text (confidence %1 %). Undo if it is wrong and choose the font above.", Math.round(r.confidence * 100))));
        add(unmappedList(r));
        break;
      case "convertToLegacy":
        add(el("div", fmt("Converted %1 characters to %2 %3.", r.characters, r.profile, r.profileVersion)));
        add(fontNote(r));
        add(unmappedList(r));
        break;
      case "convertDocument":
        if (!r.matched) { add(el("div", tr("No text in a legacy font was found."))); break; }
        add(el("div", fmt("%1 runs in legacy fonts (%2) will be converted to %3.", r.changed, profilesText(r), r.font)));
        if (r.skipped) add(el("div", fmt("%1 runs with tabs, line breaks or pictures are left as they are.", r.skipped)));
        add(unmappedList(r));
        var apply = el("button", tr("Convert"), "btn-text-default");
        apply.addEventListener("click", function () { plugin.sendToPlugin("onPanelAction", { action: "convertDocumentApply" }); });
        add(apply);
        add(el("div", tr("It is one step: Undo restores the document.")));
        break;
      case "convertDocumentApply":
        add(el("div", fmt("Converted %1 runs (%2) to %3.", r.changed, profilesText(r), r.font)));
        if (r.skipped) add(el("div", fmt("%1 runs with tabs, line breaks or pictures are left as they are.", r.skipped)));
        add(unmappedList(r));
        break;
      case "detect":
        add(el("div", r.changed ? fmt("Highlighted %1 runs of legacy text.", r.changed) : tr("No legacy text was found.")));
        if (profilesText(r)) add(el("div", fmt("Fonts: %1", profilesText(r))));
        break;
      case "fonts":
        add(el("div", fmt("%1 set on %2 runs of Sinhala text.", r.font, r.changed)));
        break;
      case "validate":
        add(el("div", r.issueCount ? fmt("%1 problems in %2 runs of Sinhala text:", r.issueCount, r.matched) : fmt("No problems in %1 runs of Sinhala text.", r.matched)));
        if (r.issueCount) {
          add(list(r.issues, function (i, li) {
            li.appendChild(document.createTextNode(fmt("Paragraph %1", i.paragraph) + ": " + tr(ISSUES[i.code] || i.code) + " … "));
            li.appendChild(el("span", i.context, "ws-sinhala"));
            li.appendChild(document.createTextNode(" …"));
          }));
        }
        break;
    }
  }

  plugin.init = function () {
    translate();
    ["profile", "legacyProfile", "font"].forEach(function (id) { $(id).addEventListener("change", sendSettings); });
    $("mode").addEventListener("change", function () { plugin.sendToPlugin("onPanelTyping", { mode: $("mode").value }); });
    $("typingFont").addEventListener("change", function () {
      var v = $("typingFont").value.split(":");
      if (v[0] === "u") plugin.sendToPlugin("onPanelTyping", { font: { unicode: v.slice(1).join(":") } });
      else if (v[0] === "l") plugin.sendToPlugin("onPanelTyping", { font: { profile: v[1], name: v.slice(2).join(":") } });
    });
    ["suggestions", "acceptSpace", "acceptTab", "ai"].forEach(function (id) {
      $(id).addEventListener("change", function () { var o = {}; o[id] = $(id).checked; plugin.sendToPlugin("onPanelTyping", { set: o }); });
    });
    var buttons = document.querySelectorAll("[data-action]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (e) {
        plugin.sendToPlugin("onPanelAction", { action: e.currentTarget.getAttribute("data-action") });
      });
    }
    plugin.sendToPlugin("onPanelReady", {});
  };

  plugin.attachEvent("onState", function (s) { state = s; renderState(); });
  plugin.attachEvent("onResult", renderResult);
  plugin.onTranslate = translate;
  plugin.onThemeChanged = function (theme) {
    if (plugin.onThemeChangedBase) plugin.onThemeChangedBase(theme);
  };
  plugin.button = function () { /* no buttons */ };
})(window, document);
