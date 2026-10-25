/*
 * Sinhala Tools (worksuite-sinhala-tools): a "Sinhala Tools" toolbar tab and a side panel.
 *
 *   Convert selection   legacy font text -> Unicode (profile from the selection's font, or detected)
 *   Convert to legacy   a dialog (legacy.html): Unicode -> a legacy font, or legacy -> Unicode, with a preview;
 *                       text and font change in one editor command (one undo step)
 *   Convert document    every run in a legacy font, in one undo step, after a preview (documents)
 *   Detect              highlights runs in a legacy font or that look like legacy text (documents)
 *   Fonts               Noto Sans / Noto Serif Sinhala on runs with Unicode Sinhala (documents)
 *   Validate            lists broken conjuncts, stray joiners, vowel signs in legacy order (documents)
 *   Sinhala input       Singlish typing with a candidate window, on and off (scripts/ime.js)
 *
 * The engine is @worksuite/sinhala-core (scripts/sinhala-core.js). Whole-document work runs as an
 * editor command (callCommand over Api.GetDocument()); the command gets the engine as source text in
 * Asc.scope, because a command runs in the editor, not in this frame.
 */
(function (window) {
  "use strict";

  var plugin = window.Asc.plugin;
  var S = window.WorkSuiteSinhala;
  var CORE_SOURCE = "(" + window.__worksuiteSinhalaFactory.toString() + ")()";
  var FONTS = ["Noto Sans Sinhala", "Noto Serif Sinhala"];
  var SETTINGS_KEY = "worksuite-sinhala-tools";
  var MAX_LIST = 200;

  var settings = { profile: "auto", legacyProfile: "fm-abhaya", font: FONTS[0] };
  try {
    var saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && typeof saved === "object") {
      for (var k in settings) if (typeof saved[k] === "string") settings[k] = saved[k];
    }
  } catch (e) { /* storage may be unavailable: defaults */ }

  function saveSettings() {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function editorType() { return (plugin.info && plugin.info.editorType) || "word"; }
  function isDocument() { return editorType() === "word"; }

  // --- the panel ------------------------------------------------------------------------------
  var panel = null;
  var panelReady = false;
  var queued = [];

  function panelState() {
    return {
      settings: settings,
      fonts: FONTS,
      editor: editorType(),
      ime: { on: imeOn(), learned: ime() ? ime().learnedCount() : 0, mode: ime() ? ime().mode() : "english",
        typing: ime() ? ime().settings() : null, font: ime() ? ime().font() : null },
      modes: TOOLBAR.modes,
      catalog: fontCatalog(),
      profiles: S.builtinProfiles.map(function (p) {
        return { id: p.id, name: p.name, version: p.version, status: p.status };
      })
    };
  }

  function openPanel(reopen) {
    if (panel && !reopen) return;
    if (panel) { try { panel.close(); } catch (e) { /* already closed */ } }
    panelReady = false;
    panel = new window.Asc.PluginWindow();
    panel.attachEvent("onPanelReady", function () {
      panelReady = true;
      panel.command("onState", panelState());
      while (queued.length) panel.command("onResult", queued.shift());
    });
    panel.attachEvent("onPanelAction", function (data) { run(data && data.action, true); });
    panel.attachEvent("onPanelTyping", function (data) {
      if (!data || !ime()) return;
      if (typeof data.mode === "string") ime().setMode(data.mode);
      if (data.font) chooseFont(data.font);
      if (data.set) ime().set(data.set);
    });
    panel.attachEvent("onPanelSettings", function (data) {
      if (!data) return;
      for (var key in settings) if (typeof data[key] === "string") settings[key] = data[key];
      saveSettings();
    });
    panel.show({
      url: "panel.html",
      description: tr("Sinhala Tools"),
      isVisual: true,
      isModal: false,
      isCanDocked: true,
      buttons: [],
      type: "panelRight",
      EditorsSupport: ["word", "cell", "slide"],
      icons: "resources/%theme-type%(light|dark)/icon%scale%(100|200).%extension%(png)",
      size: [320, 520]
    });
  }

  // Results go to the panel. A toolbar click opens it anew (it may have been closed); a click in the
  // panel answers there.
  function report(result, fromPanel) {
    if (!fromPanel) openPanel(true);
    if (panel && panelReady) panel.command("onResult", result);
    else queued.push(result);
  }

  function fail(action, message, fromPanel) {
    report({ action: action, error: message }, fromPanel);
  }

  // --- selection ------------------------------------------------------------------------------
  var SELECTED_TEXT_OPTIONS = {
    Numbering: false, Math: false, TableCellSeparator: "\n", TableRowSeparator: "\n",
    ParaSeparator: "\n", TabSymbol: "\t", NewLineSeparator: "\r"
  };

  function getSelection(callback) {
    plugin.executeMethod("GetSelectedText", [SELECTED_TEXT_OPTIONS], function (text) {
      callback(typeof text === "string" ? text : "");
    });
  }

  // The selection's font, in documents: { font, mixed } (font null elsewhere, or when it has several).
  function getSelectionFont(callback) {
    if (!isDocument()) { callback({ font: null, mixed: false }); return; }
    plugin.callCommand(function () {
      var range = Api.GetDocument().GetRangeBySelect();
      if (!range) return null;
      var textPr = range.GetTextPr ? range.GetTextPr() : null;
      var font = textPr ? textPr.GetFontFamily() : null;
      return { font: typeof font === "string" && font ? font : null, mixed: !(typeof font === "string" && font) };
    }, false, false, function (r) { callback(r && typeof r === "object" ? r : { font: null, mixed: false }); });
  }

  function chooseProfile(text, font, forced) {
    if (forced) return { profile: S.getProfile(forced), how: "chosen" };
    if (settings.profile !== "auto") return { profile: S.getProfile(settings.profile), how: "chosen" };
    var byFont = S.profileForFont(font);
    if (byFont) return { profile: byFont, how: "font" };
    var detected = S.detect(text);
    if (detected.profile) return { profile: S.getProfile(detected.profile), how: "detected", confidence: detected.confidence };
    return null;
  }

  // The selection becomes `text` in `font`, as one editor command, so one undo step. The font goes on the
  // selected range first and the text is then replaced in place (Api.ReplaceTextSmart keeps every run's
  // size, colour, bold, italic and the paragraphs), so the new text is in the font. Replacing first and
  // setting the font after, as before, lost the font: ReplaceTextSmart ends with the selection removed,
  // so GetRangeBySelect() then had no range. Calls back with { fontApplied, error }.
  function replaceSelection(text, font, callback) {
    window.Asc.scope.lines = text.split("\n");
    window.Asc.scope.font = font || null;
    window.Asc.scope.editor = editorType();
    plugin.callCommand(replaceCommand, false, true, function (res) {
      callback(res && typeof res === "object" ? res : { fontApplied: false });
    });
  }

  // Runs in the editor: no closure over this frame, only Asc.scope.
  function replaceCommand() {
    var font = Asc.scope.font;
    var res = { fontApplied: false };
    if (font) {
      if (Asc.scope.editor === "word") {
        var range = Api.GetDocument().GetRangeBySelect();
        if (!range) return { error: "no-selection" };
        res.fontApplied = range.SetFontFamily(font) !== null;
      } else if (Asc.scope.editor === "cell") {
        var cells = Api.GetSelection();
        if (cells && cells.SetFontName) { cells.SetFontName(font); res.fontApplied = true; }
      }
    }
    Api.ReplaceTextSmart(Asc.scope.lines, "\t", "\r");
    return res;
  }

  function listUnmapped(unmapped, text) {
    return unmapped.slice(0, MAX_LIST).map(function (u) {
      return { offset: u.offset, text: u.text, codePoint: u.codePoint, context: text.substr(Math.max(0, u.offset - 6), 13) };
    });
  }

  var SINHALA = /[\u0D80-\u0DFF]/;

  // Checks for a conversion; null when it can go ahead, else the message.
  function checkSelection(direction, text, sel, profile) {
    if (!text.replace(/\s+/g, "")) return tr("Select the text to convert first.");
    if (direction === "toLegacy") {
      if (!SINHALA.test(text)) return tr("There is no Sinhala Unicode text in the selection.");
      return null;
    }
    if (SINHALA.test(text) && !/[A-Za-z]/.test(text)) return tr("The selection is already Sinhala Unicode.");
    if (!profile) {
      if (sel && sel.mixed) return tr("The selection mixes fonts. Select text in one legacy font, or choose its font.");
      if (sel && sel.font) return fmt("%1 is not a legacy Sinhala font Sinhala Tools knows. Choose its font.", sel.font);
      return tr("The selection does not look like legacy Sinhala text. Choose its font in the panel.");
    }
    return null;
  }

  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }

  // Legacy font text -> Unicode in settings.font. `forced`: a profile id the user chose (else by font/detection).
  function convertSelection(fromPanel, forced) {
    getSelection(function (text) {
      if (!text.replace(/\s+/g, "")) { fail("convertSelection", tr("Select the text to convert first."), fromPanel); return; }
      getSelectionFont(function (sel) {
        var choice = chooseProfile(text, sel.font, forced);
        var problem = checkSelection("toUnicode", text, sel, choice);
        if (problem) { fail("convertSelection", problem, fromPanel); return; }
        var result = S.toUnicode(text, choice.profile);
        replaceSelection(result.text, settings.font, function (done) {
          if (done.error) { fail("convertSelection", tr("Select the text to convert first."), fromPanel); return; }
          report({
            action: "convertSelection", profile: choice.profile.name, profileVersion: result.profileVersion,
            how: choice.how, confidence: choice.confidence, characters: text.length, font: settings.font,
            fontApplied: done.fontApplied, mixed: !!sel.mixed,
            unmapped: listUnmapped(result.unmapped, text), unmappedCount: result.unmapped.length
          }, fromPanel);
        });
      });
    });
  }

  // The legacy font's name as this computer has it installed (FMAbhaya, FM Abhaya, ...), else its usual name.
  var installedFonts = [];
  function legacyFontName(profile) {
    var lower = installedFonts.map(function (n) { return n.toLowerCase(); });
    for (var i = 0; i < profile.fontNames.length; i++) {
      var at = lower.indexOf(profile.fontNames[i].toLowerCase());
      if (at >= 0) return installedFonts[at];
    }
    return profile.fontNames[0];
  }

  // Unicode -> settings.legacyProfile's encoding, in that profile's font.
  function convertToLegacyNow(fromPanel) {
    getSelection(function (text) {
      var problem = checkSelection("toLegacy", text);
      if (problem) { fail("convertToLegacy", problem, fromPanel); return; }
      var profile = S.getProfile(settings.legacyProfile);
      var result = S.toLegacy(text, profile);
      var font = legacyFontName(profile);
      replaceSelection(result.text, font, function (done) {
        if (done.error) { fail("convertToLegacy", tr("Select the text to convert first."), fromPanel); return; }
        report({
          action: "convertToLegacy", profile: profile.name, profileVersion: result.profileVersion, characters: text.length,
          font: font, fontApplied: done.fontApplied,
          unmapped: listUnmapped(result.unmapped, text.normalize("NFC")), unmappedCount: result.unmapped.length
        }, fromPanel);
      });
    });
  }

  // --- the Convert to legacy dialog (legacy.html) -----------------------------------------------
  var dialog = null;

  function fontNames(list) {
    var names = [];
    (list || []).forEach(function (f) {
      var n = typeof f === "string" ? f : f && (f.m_wsFontName || f.name || f.Name);
      if (typeof n === "string" && n) names.push(n);
    });
    return names;
  }

  function openLegacyDialog(prefer) {
    getSelection(function (text) {
      if (!text.replace(/\s+/g, "")) { fail("convertToLegacy", tr("Select the text to convert first."), false); return; }
      getSelectionFont(function (sel) {
        plugin.executeMethod("GetFontList", [], function (list) {
          installedFonts = fontNames(list);
          var init = {
            direction: prefer === "toLegacy" || prefer === "toUnicode" ? prefer : SINHALA.test(text) ? "toLegacy" : "toUnicode",
            text: text, selectionFont: sel.font, mixed: !!sel.mixed,
            legacyProfile: settings.legacyProfile, unicodeFont: settings.font,
            installed: installedFonts, fontListKnown: Array.isArray(list)
          };
          if (dialog) { try { dialog.close(); } catch (e) { /* closed */ } }
          dialog = new window.Asc.PluginWindow();
          dialog.attachEvent("onLegacyReady", function () { dialog.command("onLegacyInit", init); });
          dialog.attachEvent("onLegacyCancel", closeDialog);
          dialog.attachEvent("onLegacyApply", function (data) {
            closeDialog();
            if (!data) return;
            if (data.direction === "toUnicode") { convertSelection(false, knownProfile(data.profile) ? data.profile : null); return; }
            if (knownProfile(data.profile)) { settings.legacyProfile = data.profile; saveSettings(); }
            convertToLegacyNow(false);
          });
          dialog.show({
            url: "legacy.html", description: tr("Convert Sinhala text"), isVisual: true, isModal: true,
            buttons: [], EditorsSupport: ["word", "cell", "slide"], size: [480, 420]
          });
        });
      });
    });
  }

  function knownProfile(id) { return S.builtinProfiles.some(function (p) { return p.id === id; }); }

  function closeDialog() {
    if (dialog) { try { dialog.close(); } catch (e) { /* closed */ } }
    dialog = null;
  }

  // --- the whole document (one editor command = one undo step) --------------------------------
  // Runs in the editor: no closure over this frame, only Asc.scope.
  function documentCommand() {
    var S = eval(Asc.scope.core);
    var mode = Asc.scope.mode;
    var dryRun = Asc.scope.dryRun;
    var font = Asc.scope.font;
    var max = Asc.scope.max;
    var res = { paragraphs: 0, runs: 0, matched: 0, changed: 0, skipped: 0, profiles: {}, unmapped: [], unmappedCount: 0, issues: [], issueCount: 0 };

    function eachRun(element, fn) {
      if (!element) return;
      var type = element.GetClassType ? element.GetClassType() : "";
      if (type === "run") { fn(element); return; }
      if (element.GetElementsCount && element.GetElement) {
        for (var i = 0, n = element.GetElementsCount(); i < n; i++) eachRun(element.GetElement(i), fn);
      }
    }

    var paragraphs = Api.GetDocument().GetAllParagraphs();
    res.paragraphs = paragraphs.length;
    for (var p = 0; p < paragraphs.length; p++) {
      var paragraph = paragraphs[p];
      // a run's text leaves out pictures and text boxes, so a run that holds one is never rewritten
      var hasDrawings = paragraph.GetAllDrawingObjects && paragraph.GetAllDrawingObjects().length > 0;
      eachRun(paragraph, function (run) {
        var text = run.GetText();
        if (!text) return;
        res.runs++;
        var profile = S.profileForFont(run.GetFontNames ? run.GetFontNames() : []);
        if (mode === "convert") {
          if (!profile) return;
          res.matched++;
          res.profiles[profile.name] = profile.version;
          if (hasDrawings || /[\t\r\n]/.test(text)) { res.skipped++; return; }
          var converted = S.toUnicode(text, profile);
          res.unmappedCount += converted.unmapped.length;
          for (var u = 0; u < converted.unmapped.length && res.unmapped.length < max; u++) {
            var item = converted.unmapped[u];
            res.unmapped.push({ paragraph: p + 1, text: item.text, codePoint: item.codePoint, context: text.substr(Math.max(0, item.offset - 6), 13) });
          }
          if (!dryRun) {
            run.ClearContent();
            run.AddText(converted.text);
            run.SetFontFamily(font);
          }
          res.changed++;
        } else if (mode === "detect") {
          var looksLegacy = !!profile;
          if (!looksLegacy) {
            var d = S.detect(text);
            looksLegacy = d.kind === "legacy" || d.kind === "mixed";
          }
          if (!looksLegacy) return;
          res.matched++;
          if (profile) res.profiles[profile.name] = profile.version;
          if (!dryRun) run.SetHighlight("yellow");
          res.changed++;
        } else if (mode === "fonts") {
          if (profile || !/[඀-෿]/.test(text)) return;
          res.matched++;
          if (!dryRun) run.SetFontFamily(font);
          res.changed++;
        } else if (mode === "validate") {
          if (!/[඀-෿]/.test(text)) return;
          res.matched++;
          var issues = S.validate(text);
          res.issueCount += issues.length;
          for (var v = 0; v < issues.length && res.issues.length < max; v++) {
            var issue = issues[v];
            res.issues.push({ paragraph: p + 1, code: issue.code, fixable: issue.fixable, context: text.substr(Math.max(0, issue.offset - 6), 13 + issue.length) });
          }
        }
      });
    }
    return res;
  }

  function runDocument(action, mode, dryRun, fromPanel, then) {
    if (!isDocument()) { fail(action, tr("This works in documents. In spreadsheets and presentations, convert a selection."), fromPanel); return; }
    window.Asc.scope.core = CORE_SOURCE;
    window.Asc.scope.mode = mode;
    window.Asc.scope.dryRun = !!dryRun;
    window.Asc.scope.font = settings.font;
    window.Asc.scope.max = MAX_LIST;
    plugin.callCommand(documentCommand, false, !dryRun, function (res) {
      if (!res || typeof res !== "object") { fail(action, tr("The document could not be read."), fromPanel); return; }
      res.action = action;
      res.dryRun = !!dryRun;
      res.font = settings.font;
      if (then) then(res); else report(res, fromPanel);
    });
  }

  // --- actions --------------------------------------------------------------------------------
  function ime() { return window.WorkSuiteSinhalaIme; }
  function imeOn() { return !!(ime() && ime().isOn()); }

  var ACTIONS = {
    ime: function () { if (ime()) ime().toggle(); },
    imeForget: function () { if (ime()) ime().forget(); },
    // the toolbar's Convert opens the dialog the way the selection reads; To legacy opens it to legacy;
    // To Unicode converts at once (the font from the runs). The panel converts with its own choices.
    convertSelection: function (fromPanel) { if (fromPanel) convertSelection(true); else openLegacyDialog("auto"); },
    convertToLegacy: function (fromPanel) { if (fromPanel) convertToLegacyNow(true); else openLegacyDialog("toLegacy"); },
    toLegacy: function (fromPanel) { if (fromPanel) convertToLegacyNow(true); else openLegacyDialog("toLegacy"); },
    toUnicode: function (fromPanel) { convertSelection(!!fromPanel); },
    inputMode: function () { /* a menu */ },
    sinhalaFont: function () { openFontPicker(); },
    suggestions: function () { if (ime()) ime().set({ suggestions: !ime().settings().suggestions }); },
    fontPicker: function () { openFontPicker(); },
    // a preview first; the panel's Convert button applies it
    convertDocument: function (fromPanel) { runDocument("convertDocument", "convert", true, fromPanel); },
    convertDocumentApply: function (fromPanel) { runDocument("convertDocumentApply", "convert", false, fromPanel); },
    detect: function (fromPanel) { runDocument("detect", "detect", false, fromPanel); },
    fonts: function (fromPanel) { runDocument("fonts", "fonts", false, fromPanel); },
    validate: function (fromPanel) { runDocument("validate", "validate", true, fromPanel); },
    panel: function () { openPanel(true); }
  };

  function run(action, fromPanel) {
    var fn = ACTIONS[action];
    if (!fn) return;
    try {
      fn(!!fromPanel);
    } catch (e) {
      fail(action, String(e && e.message ? e.message : e), fromPanel);
    }
  }

  // --- Sinhala fonts for typing ---------------------------------------------------------------
  // The editor's font list (GetFontList) names the fonts but not their scripts, so Unicode Sinhala fonts
  // are recognised by name. Legacy fonts are offered only with a map; known legacy fonts without one are
  // listed disabled in the picker ("map not available"), never typed with another font's map.
  var UNICODE_FONTS = ["Noto Sans Sinhala", "Noto Serif Sinhala", "Iskoola Pota", "Nirmala UI", "Sinhala MN",
    "Sinhala Sangam MN", "Noto Sans Sinhala UI", "Abhaya Libre", "Yaldevi", "Gemunu Libre", "Malithi Web", "LKLUG"];
  var LEGACY_NO_MAP = ["FM Bindumathi", "FM Ganganee", "FM Malithi", "FM Derana", "FM Basuru", "FM Emanee",
    "DL Araliya", "DL Paras", "DL Sarala", "Kandy"];
  var BUNDLED = ["Noto Sans Sinhala", "Noto Serif Sinhala"];
  var installedFontList = null; // null until GetFontList answers

  function fontCatalog() {
    var have = installedFontList || [];
    var lower = have.map(function (n) { return n.toLowerCase(); });
    function installed(names) {
      for (var i = 0; i < names.length; i++) { var at = lower.indexOf(names[i].toLowerCase()); if (at >= 0) return have[at]; }
      return null;
    }
    var unicode = [];
    UNICODE_FONTS.forEach(function (n) {
      var name = installed([n]);
      if (name || BUNDLED.indexOf(n) >= 0) unicode.push({ name: name || n, installed: !!name || installedFontList === null, bundled: BUNDLED.indexOf(n) >= 0 });
    });
    have.forEach(function (n) {
      if (/sinhala/i.test(n) && !unicode.some(function (u) { return u.name.toLowerCase() === n.toLowerCase(); })) unicode.push({ name: n, installed: true });
    });
    var legacy = S.builtinProfiles.map(function (p) {
      var name = installed(p.fontNames);
      return { profile: p.id, name: name || p.fontNames[0], label: p.name, installed: !!name, mapped: true };
    });
    LEGACY_NO_MAP.forEach(function (n) {
      legacy.push({ profile: null, name: installed([n, n.replace(/ /g, "")]) || n, label: n, installed: !!installed([n, n.replace(/ /g, "")]), mapped: false });
    });
    return { unicode: unicode, legacy: legacy, known: installedFontList !== null };
  }

  function loadFonts(then) {
    plugin.executeMethod("GetFontList", [], function (list) {
      installedFontList = fontNames(list);
      installedFonts = installedFontList;
      if (then) then();
    });
  }

  function chooseFont(choice) {
    var t = ime();
    if (!t || !choice) return;
    if (choice.profile) {
      if (!knownProfile(choice.profile)) return;
      t.set({ legacyProfile: choice.profile, legacyFont: choice.name || "" });
      if (t.mode() !== "legacy") t.setMode("legacy");
    } else if (choice.unicode) {
      t.set({ unicodeFont: choice.unicode });
      if (t.mode() === "legacy" || t.mode() === "english") t.setMode("unicode");
    }
  }

  // the searchable font picker (fonts.html), a modal
  var picker = null;
  function openFontPicker() {
    loadFonts(function () {
      if (picker) { try { picker.close(); } catch (e) { /* closed */ } }
      picker = new window.Asc.PluginWindow();
      picker.attachEvent("onFontsReady", function () {
        picker.command("onFontsInit", { catalog: fontCatalog(), typing: ime() ? ime().settings() : {}, sample: "ශ්‍රී ලංකාව සුබ උදෑසනක්" });
      });
      picker.attachEvent("onFontsCancel", closePicker);
      picker.attachEvent("onFontsChoose", function (choice) { closePicker(); chooseFont(choice); });
      picker.show({ url: "fonts.html", description: tr("Sinhala font"), isVisual: true, isModal: true, buttons: [],
        EditorsSupport: ["word", "cell", "slide"], size: [440, 460] });
    });
  }
  function closePicker() { if (picker) { try { picker.close(); } catch (e) { /* closed */ } } picker = null; }

  // --- the toolbar tab ------------------------------------------------------------------------
  // Items, icons, labels and tooltips come from scripts/toolbar.js (built from plugin/icons/registry.mjs).
  // Each item's `icons` is the editor's template string, relative to this plugin's folder: the editor
  // prefixes the plugin's base URL and picks resources/icons/<light|dark>/<name>[@1.25x..@2x].png by theme
  // and screen scale. v10's toolbar has buttons, big buttons and buttons with a menu (and split buttons),
  // no combo box; a menu item has no checked or disabled state, so the current choice is marked "✓". v10
  // never changes an existing button's icon on UpdateToolbarMenuItem (only caption, hint, disabled,
  // pressed and menu items), so toggles show their state by being pressed and by their caption.
  var TOOLBAR = window.WorkSuiteSinhalaToolbar || { fallback: "", modes: [], items: [] };
  var documentOnly = { convertDocument: true, detect: true, validate: true };
  var toolbarAdded = false;
  var menuIds = {};

  function mark(text, current) { return (current ? "✓ " : "  ") + text; }
  function short(name) { return name.length > 16 ? name.slice(0, 15) + "…" : name; }
  function modeLabel(id) {
    for (var i = 0; i < TOOLBAR.modes.length; i++) if (TOOLBAR.modes[i].id === id) return tr(TOOLBAR.modes[i].label);
    return id;
  }

  function menuFor(id) {
    var t = ime();
    var st = t ? t.settings() : { mode: "english", unicodeFont: "Noto Sans Sinhala", legacyProfile: "fm-abhaya" };
    if (id === "inputMode") {
      return TOOLBAR.modes.map(function (m) {
        menuIds["mode-" + m.id] = function () { if (ime()) ime().setMode(m.id); };
        return { id: "ws-sinhala-mode-" + m.id, text: mark(tr(m.label), st.mode === m.id) };
      });
    }
    if (id === "sinhalaFont") {
      var cat = fontCatalog();
      var uni = cat.unicode.map(function (f, i) {
        menuIds["font-u-" + i] = function () { chooseFont({ unicode: f.name }); };
        return { id: "ws-sinhala-font-u-" + i, text: mark(f.name + (f.installed ? "" : " (" + tr("not installed") + ")"), st.mode !== "legacy" && st.unicodeFont === f.name) };
      });
      var leg = cat.legacy.filter(function (f) { return f.mapped; }).map(function (f) {
        menuIds["font-l-" + f.profile] = function () { chooseFont({ profile: f.profile, name: f.installed ? f.name : "" }); };
        return { id: "ws-sinhala-font-l-" + f.profile, text: mark(f.label + (f.installed ? "" : " (" + tr("not installed") + ")"), st.mode === "legacy" && st.legacyProfile === f.profile) };
      });
      menuIds["font-more"] = openFontPicker;
      return [
        { id: "ws-sinhala-font-unicode", text: tr("Unicode fonts"), items: uni },
        { id: "ws-sinhala-font-legacy", text: tr("Legacy fonts"), items: leg },
        { id: "ws-sinhala-font-more", text: tr("All fonts…"), separator: true }
      ];
    }
    return null;
  }

  function toolbar() {
    var t = ime();
    var st = t ? t.settings() : { mode: "english", suggestions: true, unicodeFont: "Noto Sans Sinhala" };
    var on = st.mode !== "english";
    return {
      guid: plugin.info.guid,
      tabs: [{
        id: "worksuite-sinhala-tools",
        text: tr("Sinhala Tools"),
        items: TOOLBAR.items.map(function (b, i) {
          var item = {
            id: "ws-sinhala-" + b.id, type: "big-button", text: tr(b.label), hint: tr(b.hint),
            icons: b.icons || TOOLBAR.fallback,
            lockInViewMode: b.id !== "validate" && b.id !== "panel",
            disabled: !isDocument() && !!documentOnly[b.id],
            separator: i > 0 && b.group
          };
          if (b.menu) item.items = menuFor(b.id);
          if (b.id === "inputMode") item.text = modeLabel(st.mode);
          if (b.id === "sinhalaFont") { item.text = short(t ? t.font() : st.unicodeFont); item.split = true; }
          if (b.id === "ime") {
            item.text = on ? tr("Singlish: on") : tr("Singlish: off");
            item.hint = tr(b.hint) + " — " + modeLabel(st.mode);
            item.enableToggle = true;
            item.pressed = on;
          }
          if (b.id === "suggestions") { item.enableToggle = true; item.pressed = !!st.suggestions; }
          return item;
        })
      }]
    };
  }

  function addToolbar() {
    var menu = toolbar();
    plugin.executeMethod(toolbarAdded ? "UpdateToolbarMenuItem" : "AddToolbarMenuItem", [menu]);
    toolbarAdded = true;
    // menu items report clicks by their id, like buttons
    Object.keys(menuIds).forEach(function (k) {
      if (attached[k]) return;
      attached[k] = true;
      plugin.attachToolbarMenuClickEvent("ws-sinhala-" + k, function () { try { menuIds[k](); } catch (e) { fail("typing", String(e && e.message || e), false); } });
    });
  }
  var attached = {};

  TOOLBAR.items.forEach(function (b) {
    plugin.attachToolbarMenuClickEvent("ws-sinhala-" + b.id, function () { run(b.id, false); });
  });

  // scripts/ime.js tells us when the mode or a typing setting changes, or what it learned is forgotten
  window.WorkSuiteSinhalaTools = {
    imeChanged: function () {
      if (toolbarAdded) addToolbar();
      if (panel && panelReady) panel.command("onState", panelState());
    },
    typingWarning: function (w) {
      var p = S.getProfile(w.profile);
      var msg = ({ action: "typing", warning: fmt("%1 has no mapping for %2: typed as it is, it will not show as Sinhala.", p.name,
        w.unmapped.map(function (u) { return u.codePoint + " " + u.text; }).join(", ")) });
      // shown in the panel when it is open, never opening it while someone types
      if (panel && panelReady) panel.command("onResult", msg); else queued.push(msg);
    }
  };

  plugin.init = function () {
    addToolbar();
    loadFonts(function () { addToolbar(); });
  };

  plugin.onTranslate = function () {
    if (toolbarAdded) addToolbar();
  };

  plugin.button = function () { /* a background plugin has no buttons */ };
})(window);
