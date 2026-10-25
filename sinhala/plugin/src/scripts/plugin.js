/*
 * Sinhala Tools (worksuite-sinhala-tools): a "Sinhala Tools" toolbar tab and a side panel.
 *
 *   Convert selection   legacy font text -> Unicode (profile from the selection's font, or detected)
 *   Convert to legacy   Unicode -> the chosen legacy font's encoding
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
      ime: { on: imeOn(), learned: ime() ? ime().learnedCount() : 0 },
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

  // The selection's font, in documents (null elsewhere or when the selection has several).
  function getSelectionFont(callback) {
    if (!isDocument()) { callback(null); return; }
    plugin.callCommand(function () {
      var range = Api.GetDocument().GetRangeBySelect();
      var textPr = range && range.GetTextPr ? range.GetTextPr() : null;
      return textPr ? textPr.GetFontFamily() : null;
    }, false, false, function (font) { callback(typeof font === "string" ? font : null); });
  }

  function chooseProfile(text, font) {
    if (settings.profile !== "auto") return { profile: S.getProfile(settings.profile), how: "chosen" };
    var byFont = S.profileForFont(font);
    if (byFont) return { profile: byFont, how: "font" };
    var detected = S.detect(text);
    if (detected.profile) return { profile: S.getProfile(detected.profile), how: "detected", confidence: detected.confidence };
    return null;
  }

  function replaceSelection(text, font, callback) {
    plugin.executeMethod("ReplaceTextSmart", [text.split("\n"), "\t", "\r"], function () {
      if (!font || !isDocument()) { if (callback) callback(); return; }
      window.Asc.scope.font = font;
      plugin.callCommand(function () {
        var range = Api.GetDocument().GetRangeBySelect();
        if (range) range.SetFontFamily(Asc.scope.font);
      }, false, true, function () { if (callback) callback(); });
    });
  }

  function listUnmapped(unmapped, text) {
    return unmapped.slice(0, MAX_LIST).map(function (u) {
      return { offset: u.offset, text: u.text, codePoint: u.codePoint, context: text.substr(Math.max(0, u.offset - 6), 13) };
    });
  }

  function convertSelection(fromPanel) {
    getSelection(function (text) {
      if (!text.replace(/\s+/g, "")) { fail("convertSelection", tr("Select the text to convert first."), fromPanel); return; }
      getSelectionFont(function (font) {
        var choice = chooseProfile(text, font);
        if (!choice) { fail("convertSelection", tr("The selection does not look like legacy Sinhala text. Choose its font in the panel."), fromPanel); return; }
        var result = S.toUnicode(text, choice.profile);
        replaceSelection(result.text, settings.font, function () {
          report({
            action: "convertSelection", profile: choice.profile.name, profileVersion: result.profileVersion,
            how: choice.how, confidence: choice.confidence, characters: text.length,
            unmapped: listUnmapped(result.unmapped, text), unmappedCount: result.unmapped.length
          }, fromPanel);
        });
      });
    });
  }

  function convertToLegacy(fromPanel) {
    getSelection(function (text) {
      if (!text.replace(/\s+/g, "")) { fail("convertToLegacy", tr("Select the text to convert first."), fromPanel); return; }
      var profile = S.getProfile(settings.legacyProfile);
      var result = S.toLegacy(text, profile);
      replaceSelection(result.text, profile.fontNames[0], function () {
        report({
          action: "convertToLegacy", profile: profile.name, profileVersion: result.profileVersion, characters: text.length,
          unmapped: listUnmapped(result.unmapped, text.normalize("NFC")), unmappedCount: result.unmapped.length
        }, fromPanel);
      });
    });
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
    convertSelection: convertSelection,
    convertToLegacy: convertToLegacy,
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

  // --- the toolbar tab ------------------------------------------------------------------------
  // Items, icons, labels and tooltips come from scripts/toolbar.js (built from plugin/icons/registry.mjs).
  // Each item's `icons` is the editor's template string, relative to this plugin's folder: the editor
  // prefixes the plugin's base URL and picks resources/icons/<light|dark>/<name>[@1.25x..@2x].png by theme
  // and screen scale. v10 never changes an existing button's icon on UpdateToolbarMenuItem (only its
  // caption, hint, disabled and pressed state), so Sinhala input shows its state by being pressed and by
  // its caption, not by swapping to keyboard-off.
  var TOOLBAR = window.WorkSuiteSinhalaToolbar || { fallback: "", items: [] };
  var documentOnly = { convertDocument: true, detect: true, fonts: true, validate: true };
  var toolbarAdded = false;

  function toolbar() {
    var on = imeOn();
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
          if (b.id === "ime") {
            item.text = on ? tr("Sinhala input: on") : tr("Sinhala input: off");
            item.hint = tr(b.hint) + " \u2014 " + (on ? tr("On: Singlish (phonetic)") : tr("Off"));
            item.enableToggle = true;
            item.pressed = on;
          }
          return item;
        })
      }]
    };
  }

  function addToolbar() {
    plugin.executeMethod(toolbarAdded ? "UpdateToolbarMenuItem" : "AddToolbarMenuItem", [toolbar()]);
    toolbarAdded = true;
  }

  TOOLBAR.items.forEach(function (b) {
    plugin.attachToolbarMenuClickEvent("ws-sinhala-" + b.id, function () { run(b.id, false); });
  });

  // scripts/ime.js tells us when Sinhala input is turned on or off, or forgets what it learned
  window.WorkSuiteSinhalaTools = {
    imeChanged: function () {
      if (toolbarAdded) addToolbar();
      if (panel && panelReady) panel.command("onState", panelState());
    }
  };

  plugin.init = function () {
    addToolbar();
  };

  plugin.onTranslate = function () {
    if (toolbarAdded) addToolbar();
  };

  plugin.button = function () { /* a background plugin has no buttons */ };
})(window);
