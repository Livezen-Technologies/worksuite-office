/*
 * Singlish typing: type Singlish in the document, pick Sinhala words from a candidate window (Google
 * Input Tools style). Input modes: English (off), Sinhala Unicode, Sinhala legacy font (the word encoded
 * with the chosen font's map) and Smart Auto (Sinhala only for words that are not English). Chosen on the
 * Sinhala Tools tab or in the panel; Ctrl+Shift+Y (Cmd+Shift+Y on a Mac) turns typing on and off and
 * Ctrl+Alt+Shift+Y goes to the next mode.
 *
 * It uses the editor's input helper API, as ONLYOFFICE's autocomplete plugins do: the editor reports
 * what is typed (onInputHelperInput, onInputHelperClear), shows this frame next to the cursor as the
 * candidate window (ShowInputHelper, without taking the keyboard) and hands it the navigation keys while
 * it is open (onKeyDown); InputText writes the chosen word over the Latin letters. These are events of
 * the editor this plugin runs in, nothing system-wide, and with the mode off they are ignored, except
 * for the shortcut that turns it on. The engine is SinhalaIme in @worksuite/sinhala-core.
 *
 * What the user picks is learned, in this plugin's localStorage only; it never leaves the computer.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var S = window.WorkSuiteSinhala;
  var STATE_KEY = "worksuite-sinhala-input";          // the old on/off flag (read once, for the move to modes)
  var TYPING_KEY = "worksuite-sinhala-typing";        // mode, fonts and the typing settings
  var LEARN_KEY = "worksuite-sinhala-input-learned";
  var SHORTCUT = { keyCode: 89, shift: true }; // Y, with Ctrl (Cmd on a Mac) and Shift: unused by the editors
  var MODES = ["english", "unicode", "legacy", "smart"];
  var AI_TIMEOUT = 120; // ms: typing never waits longer for the local AI service
  var WIDTH = 240;

  function load(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage may be unavailable */ }
  }

  // what is kept on this computer: the mode, the last Sinhala mode (for the on/off toggle), the fonts
  var DEFAULTS = {
    mode: "english", lastSinhala: "unicode", suggestions: true, acceptSpace: true, acceptTab: false,
    unicodeFont: "Noto Sans Sinhala", legacyProfile: "fm-abhaya", legacyFont: "",
    ai: false
  };
  var settings = {};
  (function () {
    var saved = load(TYPING_KEY) || {};
    for (var k in DEFAULTS) settings[k] = typeof saved[k] === typeof DEFAULTS[k] ? saved[k] : DEFAULTS[k];
    if (!saved.mode && load(STATE_KEY) === true) settings.mode = "unicode";
    if (MODES.indexOf(settings.mode) < 0) settings.mode = "english";
    if (MODES.indexOf(settings.lastSinhala) < 1) settings.lastSinhala = "unicode";
    if (!knownProfile(settings.legacyProfile)) settings.legacyProfile = DEFAULTS.legacyProfile;
  })();
  function knownProfile(id) { return S.builtinProfiles.some(function (p) { return p.id === id; }); }
  function on() { return settings.mode !== "english"; }

  var lexicon = null;
  var english = null;
  var learner = new S.Learner(load(LEARN_KEY));
  var ime = null;
  var warned = {};

  function editorType() { return (plugin.info && plugin.info.editorType) || "word"; }

  function engine() {
    if (!ime) {
      if (!lexicon) lexicon = new S.Lexicon(window.WorkSuiteSinhalaWords || []);
      if (!english) english = new S.EnglishWords(window.WorkSuiteEnglishWords || []);
      var smart = settings.mode === "smart";
      // documents can tell the word before the cursor, so Backspace edits the composition there
      ime = new S.SinhalaIme({
        lexicon: lexicon, learner: learner, canResync: editorType() === "word", words: 5, completions: 4,
        preferred: S.COLLOQUIAL, showWindow: settings.suggestions,
        acceptSpace: settings.acceptSpace, acceptTab: settings.acceptTab,
        gate: smart ? function (latin) { return S.smartDecision(latin, english, lexicon).suggest; } : null,
        // while the letters typed so far may still become an English word, compose without the window
        quiet: smart ? function (latin) { return english.hasLongerWord(latin); } : null
      });
    }
    return ime;
  }

  function legacyFontName() {
    var p = S.getProfile(settings.legacyProfile);
    return settings.legacyFont || p.fontNames[0];
  }

  /** The font typed Sinhala is written in, for the current mode. */
  function currentFont() { return settings.mode === "legacy" ? legacyFontName() : settings.unicodeFont; }

  // --- the candidate window (this frame) --------------------------------------------------------
  function render(action) {
    var latin = document.getElementById("ime-latin");
    var list = document.getElementById("ime-items");
    if (!latin || !list) return;
    latin.textContent = action.latin;
    list.textContent = "";
    action.items.forEach(function (item, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = item.kind + (i === action.selected ? " selected" : "");
      if (i === action.selected) li.setAttribute("aria-selected", "true");
      var n = document.createElement("span");
      n.className = "n";
      n.textContent = i < 9 ? String(i + 1) : "";
      var w = document.createElement("span");
      w.className = "w";
      w.textContent = item.text;
      li.appendChild(n);
      li.appendChild(w);
      li.addEventListener("mousedown", function (e) { e.preventDefault(); apply(engine().pick(i)); });
      list.appendChild(li);
    });
  }

  function apply(actions) {
    (actions || []).forEach(function (a) {
      switch (a.type) {
        case "show":
          render(a);
          plugin.executeMethod("ShowInputHelper", [plugin.info.guid, WIDTH, 26 + 26 * a.items.length + 2, false]);
          break;
        case "hide":
          plugin.executeMethod("UnShowInputHelper", [plugin.info.guid, !!a.clear]);
          break;
        case "input":
          write(a.text, a.replace);
          break;
        case "resync":
          plugin.executeMethod("GetCurrentWord", ["before"], function (word) { apply(engine().resync(word)); });
          break;
        case "learned":
          save(LEARN_KEY, learner.data);
          break;
      }
    });
  }

  // --- writing the chosen word ------------------------------------------------------------------
  // Documents: one editor command selects the Latin just typed, sets the font on it and types the word
  // over it, so the word takes the font (typing over a selection keeps its formatting), the cursor ends
  // in that run and what is typed next stays in the font; one undo step. Legacy mode encodes the
  // Unicode word with the font's own map first. Spreadsheets and presentations: InputText, no font.
  function write(unicode, replace) {
    var text = unicode;
    if (settings.mode === "legacy") {
      var r = S.toLegacy(unicode, S.getProfile(settings.legacyProfile));
      text = r.text;
      var fresh = r.unmapped.filter(function (u) { return !warned[settings.legacyProfile + u.text]; });
      fresh.forEach(function (u) { warned[settings.legacyProfile + u.text] = true; });
      if (fresh.length && window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.typingWarning) {
        window.WorkSuiteSinhalaTools.typingWarning({ profile: settings.legacyProfile, unmapped: fresh.map(function (u) { return { text: u.text, codePoint: u.codePoint }; }) });
      }
    }
    if (editorType() !== "word") { plugin.executeMethod("InputText", [text, replace]); return; }
    window.Asc.scope.typing = { text: text, replace: replace.length, font: currentFont() };
    plugin.callCommand(typeCommand, false, true);
  }

  // Runs in the editor: only Asc.scope.
  function typeCommand() {
    var t = Asc.scope.typing;
    var doc = Api.GetDocument();
    if (t.replace > 0) doc.MoveCursorLeft(t.replace, true);
    var range = t.font && t.replace > 0 ? doc.GetRangeBySelect() : null;
    if (range) range.SetFontFamily(t.font);
    doc.EnterText(t.text);
    return true;
  }
  window.WorkSuiteSinhalaTypeCommand = typeCommand;

  // --- the local AI service (optional, off by default) ------------------------------------------
  // POST <baseUrl>/v1/text/complete {text, caret, lang, mode, singlish, max} with a Bearer token; answer
  // {words:[{text, source, score}], ghost?}. Base URL and token come from the desktop bridge, injected as
  // window.WSAiEndpoint = {baseUrl, token}; without it this stays off. What comes back within AI_TIMEOUT
  // ms is merged; a later answer is dropped, and the next keystroke cancels a pending request.
  var aiPending = null;
  var aiSeq = 0;
  function aiEndpoint() {
    var e = window.WSAiEndpoint;
    return e && typeof e.baseUrl === "string" && e.baseUrl && typeof e.token === "string" && e.token ? e : null;
  }
  function cancelAi() {
    if (!aiPending) return;
    aiPending.done = true;
    window.clearTimeout(aiPending.timer);
    if (aiPending.ctrl) aiPending.ctrl.abort();
    aiPending = null;
  }
  function askAi(latin) {
    cancelAi();
    var endpoint = aiEndpoint();
    if (!settings.ai || !endpoint || typeof window.fetch !== "function") return;
    var req = { done: false, ctrl: typeof window.AbortController === "function" ? new window.AbortController() : null };
    req.timer = window.setTimeout(function () { if (aiPending === req) cancelAi(); }, AI_TIMEOUT);
    aiPending = req;
    var id = "ws-si-" + Date.now().toString(36) + "-" + (++aiSeq);
    window.fetch(endpoint.baseUrl.replace(/\/+$/, "") + "/v1/text/complete", {
      method: "POST", signal: req.ctrl ? req.ctrl.signal : undefined,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + endpoint.token, "X-Request-Id": id },
      body: JSON.stringify({ text: latin, caret: latin.length, lang: "si", mode: "word", singlish: true, max: 5 })
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (req.done) return;
      cancelAi();
      var list = json && Array.isArray(json.words) ? json.words : [];
      var extra = list.filter(function (x) { return x && typeof x.text === "string" && /^[\u0D80-\u0DFF\u200C\u200D]+$/.test(x.text); })
        .slice(0, 5).map(function (x, i) { return { text: x.text, kind: "word", score: 9 - i * 0.5, known: false, learned: 0 }; });
      if (ime) apply(ime.addExtra(latin, extra));
    }).catch(function () { /* unreachable, cancelled or too slow: local candidates only */ });
  }

  // --- the editor's events ----------------------------------------------------------------------
  plugin.event_onInputHelperInput = function (data) {
    if (!on() || !data) return;
    cancelAi(); // a new keystroke: the last question is moot
    var actions = engine().input(typeof data.text === "string" ? data.text : "");
    apply(actions);
    if (ime && ime.isVisible && actions.some(function (a) { return a.type === "show"; })) askAi(ime.latin);
  };

  plugin.event_onInputHelperClear = function () {
    if (!on() || !ime) return;
    apply(ime.cleared());
  };

  plugin.event_onKeyDown = function (data) {
    if (!data) return;
    if ((data.ctrlKey || data.metaKey) && !!data.shiftKey === SHORTCUT.shift && data.keyCode === SHORTCUT.keyCode) {
      // Ctrl+Shift+Y: Singlish typing on/off; Ctrl+Alt+Shift+Y: the next input mode
      if (data.altKey) setMode(MODES[(MODES.indexOf(settings.mode) + 1) % MODES.length]);
      else setMode(on() ? "english" : settings.lastSinhala);
      return;
    }
    if (!on() || !ime || !ime.isVisible) return;
    apply(ime.key(data.keyCode));
  };

  function changed() {
    save(TYPING_KEY, settings);
    if (window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.imeChanged) window.WorkSuiteSinhalaTools.imeChanged();
  }

  function restart() {
    if (ime) apply(ime.stop());
    ime = null;
  }

  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) return;
    restart();
    settings.mode = mode;
    if (mode !== "english") settings.lastSinhala = mode;
    changed();
  }

  // --- for plugin.js (the toolbar and the panel) --------------------------------------------------
  window.WorkSuiteSinhalaIme = {
    isOn: on,
    mode: function () { return settings.mode; },
    setMode: setMode,
    toggle: function () { setMode(on() ? "english" : settings.lastSinhala); },
    settings: function () { var c = {}; for (var k in settings) c[k] = settings[k]; return c; },
    font: currentFont,
    /** Change typing settings (suggestions, acceptSpace, acceptTab, unicodeFont, legacyProfile, legacyFont, ai). */
    set: function (values) {
      for (var k in values) {
        if (k === "mode" || !(k in DEFAULTS) || typeof values[k] !== typeof DEFAULTS[k]) continue;
        if (k === "legacyProfile" && !knownProfile(values[k])) continue;
        settings[k] = values[k];
      }
      restart();
      changed();
    },
    learnedCount: function () { return Object.keys(learner.data.words).length; },
    forget: function () {
      learner.forget();
      save(LEARN_KEY, learner.data);
      changed();
    }
  };

  plugin.onThemeChanged = function (theme) {
    if (plugin.onThemeChangedBase) plugin.onThemeChangedBase(theme);
    if (!theme) return;
    var root = document.documentElement.style;
    var set = function (name, value) { if (value) root.setProperty(name, value); };
    set("--ime-bg", theme["background-normal"]);
    set("--ime-text", theme["text-normal"]);
    set("--ime-muted", theme["text-secondary"]);
    set("--ime-border", theme["border-regular-control"]);
    set("--ime-selected", theme["highlight-button-hover"]);
    set("--ime-completion", theme["text-normal"]);
  };
})(window, document);
