/*
 * Smart Typing: Sinhala and English autocomplete, next-word prediction, spelling and light grammar
 * suggestions in a popup at the caret, and Singlish typing (Google Input Tools style). Input modes:
 * English (Sinhala input off: English suggestions), Sinhala Unicode, Sinhala legacy font (the word encoded
 * with the chosen font's map) and Smart Mixed (per word: English, Singlish or Sinhala, see
 * docs/sinhala/smart-typing.md). Ctrl+Shift+Y (Cmd+Shift+Y on a Mac) turns Sinhala input on and off,
 * Ctrl+Alt+Shift+Y goes to the next mode, Ctrl/Cmd+Space opens the suggestions by hand. Suggestions
 * never stop because Sinhala input is off: they switch to English.
 *
 * It uses the editor's input helper API, as ONLYOFFICE's autocomplete plugins do: the editor reports
 * what is typed (onInputHelperInput, onInputHelperClear), shows this frame next to the caret as the
 * popup (ShowInputHelper, without taking the keyboard) and hands it Tab, Enter, Esc and the navigation
 * keys while it is open (onKeyDown). A chosen word is written by one editor command in documents (select
 * the typed letters, set the Sinhala font, type the word: one undo step) and by InputText elsewhere.
 *
 * The engine (SmartEngine) runs in a worker (scripts/smart-worker.js) where the browser allows it, else
 * in this frame; the key handling is SmartTyping, both in @worksuite/sinhala-core. What the user writes
 * and picks is learned in this plugin's localStorage only; it never leaves the computer.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var S = window.WorkSuiteSinhala;
  var STATE_KEY = "worksuite-sinhala-input";          // the old on/off flag (read once, for the move to modes)
  var TYPING_KEY = "worksuite-sinhala-typing";        // mode, fonts and the typing and suggestion settings
  var LEARN_KEY = "worksuite-sinhala-input-learned";  // Singlish picks (Learner)
  var PERSONAL_KEY = "worksuite-sinhala-personal";    // words, pairs, language overrides, custom dictionary
  var SHORTCUT = { keyCode: 89, shift: true }; // Y, with Ctrl (Cmd on a Mac) and Shift: unused by the editors
  var MODES = ["english", "unicode", "legacy", "smart"];
  var AI_DELAY = 250;    // ms of pause in typing before the local AI is asked (never per keystroke)
  var AI_TIMEOUT = 1500; // ms: a slower answer is dropped (typing never waits for it)

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function load(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage may be unavailable */ }
  }

  // what is kept on this computer: the mode, the last Sinhala mode (for the on/off toggle), the fonts, and
  // the Suggestions › Settings choices
  var DEFAULTS = {
    mode: "english", lastSinhala: "unicode", suggestions: true, acceptSpace: true, acceptTab: true,
    unicodeFont: "Noto Sans Sinhala", legacyProfile: "fm-abhaya", legacyFont: "",
    ai: false,
    english: true, sinhala: true, autocomplete: true, nextWord: true, spelling: true, grammar: true,
    ghost: true, personal: true, mixed: true, maxItems: 7, delay: 0, acceptKey: "tab", output: "unicode"
  };
  var CHOICES = { acceptKey: ["tab", "enter", "both"], output: ["unicode", "legacy"] };
  var settings = {};
  (function () {
    var saved = load(TYPING_KEY) || {};
    for (var k in DEFAULTS) settings[k] = typeof saved[k] === typeof DEFAULTS[k] ? saved[k] : DEFAULTS[k];
    if (!saved.mode && load(STATE_KEY) === true) settings.mode = "unicode";
    if (MODES.indexOf(settings.mode) < 0) settings.mode = "english";
    if (MODES.indexOf(settings.lastSinhala) < 1) settings.lastSinhala = "unicode";
    if (!knownProfile(settings.legacyProfile)) settings.legacyProfile = DEFAULTS.legacyProfile;
    for (var c in CHOICES) if (CHOICES[c].indexOf(settings[c]) < 0) settings[c] = DEFAULTS[c];
    settings.maxItems = Math.max(5, Math.min(7, Math.round(settings.maxItems)));
    settings.delay = Math.max(0, Math.min(1000, Math.round(settings.delay)));
  })();
  function knownProfile(id) { return S.builtinProfiles.some(function (p) { return p.id === id; }); }
  function on() { return settings.mode !== "english"; }
  function editorType() { return (plugin.info && plugin.info.editorType) || "word"; }
  function engineSettings() {
    return { english: settings.english, sinhala: settings.sinhala, autocomplete: settings.autocomplete, nextWord: settings.nextWord,
      spelling: settings.spelling, grammar: settings.grammar, personal: settings.personal, mixed: settings.mixed, maxItems: settings.maxItems };
  }
  /** Is any suggestion source on for this mode? (Sinhala modes always compose Singlish.) */
  function active() { return on() || settings.english || settings.sinhala; }

  var learner = new S.Learner(load(LEARN_KEY));
  var personal = new S.Personal(load(PERSONAL_KEY));
  var warned = {};

  // --- the engine: a worker where possible, else this frame -------------------------------------
  var worker = null;
  var local = null;
  var waiting = {};
  function smartData() {
    var data = {};
    var d = window.WorkSuiteSmartData || {};
    for (var k in d) data[k] = d[k];
    data.englishWords = window.WorkSuiteEnglishWords || [];
    data.sinhalaWords = window.WorkSuiteSinhalaWords || [];
    return data;
  }
  function localEngine() {
    if (!local) {
      local = new S.SmartEngine(smartData(), personal, learner);
      local.configure(engineSettings());
    }
    return local;
  }
  function startWorker() {
    if (worker !== null || typeof window.Worker !== "function") return;
    try {
      worker = new window.Worker("scripts/smart-worker.js");
      worker.onmessage = function (e) {
        var m = e.data || {};
        var cb = waiting[m.seq];
        delete waiting[m.seq];
        if (cb && m.type === "result") cb(m.result);
        else if (cb) cb(localEngine().suggest(cb.query)); // the worker failed this one: answer here
      };
      worker.onerror = function () { worker = false; flushToLocal(); };
      worker.postMessage({ type: "init", settings: engineSettings(), personal: personal.data, learned: learner.data });
    } catch (e) { worker = false; }
  }
  function flushToLocal() {
    var seqs = Object.keys(waiting);
    seqs.forEach(function (s) { var cb = waiting[s]; delete waiting[s]; cb(localEngine().suggest(cb.query)); });
  }
  function post(msg) { if (worker) worker.postMessage(msg); }
  function lookup(seq, query, done) {
    startWorker();
    if (worker) {
      // only the latest query matters: older callbacks are dropped by SmartTyping's seq check anyway
      waiting = {};
      done.query = query;
      waiting[seq] = done;
      worker.postMessage({ type: "query", seq: seq, query: query });
    } else {
      done(localEngine().suggest(query));
    }
  }
  function reconfigure() {
    if (local) local.configure(engineSettings());
    post({ type: "configure", settings: engineSettings() });
  }

  // --- the key handling --------------------------------------------------------------------------
  var typing = null;
  function machine() {
    if (!typing) {
      typing = new S.SmartTyping({ mode: settings.mode, showWindow: settings.suggestions, acceptSpace: settings.acceptSpace,
        acceptKey: settings.acceptTab === false && settings.acceptKey === "tab" ? "enter" : settings.acceptKey,
        canResync: editorType() === "word" });
    }
    return typing;
  }
  var lastResult = null;
  var delayTimer = null;

  // --- the local AI service (optional, off by default) ------------------------------------------
  // POST <baseUrl>/v1/text/complete {text, caret, lang, mode, singlish, max} with a Bearer token; answer
  // {words:[{text, source, score}], ghost?}. Base URL and token come from the desktop bridge, injected as
  // window.WSAiEndpoint = {baseUrl, token}; without it this stays off. Asked once per pause in typing
  // (AI_DELAY), cancelled by the next keystroke, dropped when it answers for a word no longer typed.
  function aiEndpoint() {
    var e = window.WSAiEndpoint;
    return e && typeof e.baseUrl === "string" && e.baseUrl && typeof e.token === "string" && e.token ? e : null;
  }
  var aiSeq = 0;
  var ai = new S.AiScheduler({
    delay: AI_DELAY,
    setTimer: function (fn, ms) { return window.setTimeout(fn, ms); },
    clearTimer: function (t) { window.clearTimeout(t); },
    run: function (key, done) {
      var endpoint = aiEndpoint();
      var r = lastResult;
      if (!endpoint || typeof window.fetch !== "function" || !r) return function () {};
      var ctrl = typeof window.AbortController === "function" ? new window.AbortController() : null;
      var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, AI_TIMEOUT);
      var d = r.decision;
      var lang = !d ? "auto" : d.lang === "en" ? (settings.mode === "smart" ? "mixed" : "en") : "si";
      var text = r.before;
      window.fetch(endpoint.baseUrl.replace(/\/+$/, "") + "/v1/text/complete", {
        method: "POST", signal: ctrl ? ctrl.signal : undefined,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + endpoint.token, "X-Request-Id": "ws-si-" + Date.now().toString(36) + "-" + (++aiSeq) },
        body: JSON.stringify({ text: text, caret: text.length, lang: lang, mode: "word", singlish: !!d && d.lang === "singlish", max: 5 })
      }).then(function (res) { return res.json(); }).then(function (json) {
        window.clearTimeout(timer);
        done(json && Array.isArray(json.words) ? json.words : []);
      }).catch(function () { window.clearTimeout(timer); /* unreachable, cancelled or too slow: local words only */ });
      return function () { window.clearTimeout(timer); if (ctrl) ctrl.abort(); };
    },
    use: function (key, list) {
      if (!lastResult || lastResult.key !== key || !typing) return;
      var merged = S.SmartEngine.prototype.merge.call({ settings: engineSettings() }, lastResult, list.slice(0, 5));
      apply(typing.update(merged));
    }
  });

  // --- the popup (this frame) --------------------------------------------------------------------
  var TAGS = { correction: "Fix", "case": "Aa", grammar: "Grammar", next: "Next", loan: "සිං", ai: "AI" };
  function render(a) {
    var latin = document.getElementById("ime-latin");
    var list = document.getElementById("ime-items");
    if (!latin || !list) return;
    latin.textContent = "";
    var typed = document.createElement("span");
    typed.className = "typed";
    typed.textContent = a.token || "…";
    latin.appendChild(typed);
    if (settings.ghost && a.ghost && a.selected < 0) {
      var g = document.createElement("span");
      g.className = "ghost";
      g.textContent = a.ghost;
      latin.appendChild(g);
    }
    list.textContent = "";
    a.items.forEach(function (item, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = item.kind + " lang-" + item.lang + (i === a.selected ? " selected" : "") + (i === 0 && a.selected < 0 ? " default" : "");
      if (i === a.selected) li.setAttribute("aria-selected", "true");
      var n = document.createElement("span");
      n.className = "n";
      n.textContent = i < 9 ? String(i + 1) : "";
      var w = document.createElement("span");
      w.className = "w";
      w.textContent = item.text;
      li.appendChild(n);
      li.appendChild(w);
      if (TAGS[item.kind]) {
        var t = document.createElement("span");
        t.className = "tag";
        t.textContent = tr(TAGS[item.kind]);
        li.appendChild(t);
      }
      li.addEventListener("mousedown", function (e) { if (e && e.preventDefault) e.preventDefault(); apply(machine().pick(i)); });
      list.appendChild(li);
    });
    var foot = document.getElementById("ime-foot");
    if (foot) foot.textContent = a.composing ? tr("Space writes the first word, Esc keeps the letters") : tr("Tab accepts, Esc closes");
  }

  function popupSize(a) {
    var longest = a.items.reduce(function (m, i) { return Math.max(m, i.text.length); }, (a.token || "").length + (a.ghost || "").length);
    return [Math.round(Math.max(200, Math.min(320, 84 + longest * 9))), 24 + 26 * a.items.length + 20 + 2];
  }

  function apply(actions) {
    (actions || []).forEach(function (a) {
      switch (a.type) {
        case "query": runQuery(a); break;
        case "show": {
          render(a);
          var size = popupSize(a);
          plugin.executeMethod("ShowInputHelper", [plugin.info.guid, size[0], size[1], false]);
          break;
        }
        case "hide":
          ai.cancel();
          plugin.executeMethod("UnShowInputHelper", [plugin.info.guid, !!a.clear]);
          break;
        case "input":
          ai.cancel();
          write(a.item, a.text, a.replace);
          learn(a.item, a.token);
          break;
        case "pass":
          // Enter with nothing selected was the editor's: give it back (documents: a paragraph break)
          if (a.key === "enter" && editorType() === "word") plugin.callCommand(enterCommand, false, true);
          break;
        case "resync":
          plugin.executeMethod("GetCurrentWord", ["before"], function (word) { apply(machine().resync(word)); });
          break;
        case "finished":
          if (settings.personal && a.word) {
            personal.word(/[A-Za-z]/.test(a.word) ? a.word.toLowerCase() : a.word, a.prev);
            if (local) local.invalidate();
            post({ type: "finished", word: /[A-Za-z]/.test(a.word) ? a.word.toLowerCase() : a.word, prev: a.prev });
            save(PERSONAL_KEY, personal.data);
          }
          break;
        case "kept":
          if (settings.mode === "smart" && settings.personal) {
            personal.confirm(a.token, "en");
            if (local) local.invalidate();
            post({ type: "kept", token: a.token });
            save(PERSONAL_KEY, personal.data);
          }
          break;
      }
    });
  }

  function runQuery(a) {
    if (delayTimer) { window.clearTimeout(delayTimer); delayTimer = null; }
    var go = function () {
      lookup(a.seq, { before: a.before, mode: a.mode, manual: a.manual }, function (result) {
        result.before = a.before;
        result.key = a.seq + ":" + result.token;
        if (typing && result.items.length) lastResult = result;
        apply(machine().deliver(a.seq, result));
        if (settings.ai && result.items.length && typing && typing.isVisible) ai.schedule(result.key);
      });
    };
    if (settings.delay > 0 && !a.manual) delayTimer = window.setTimeout(go, settings.delay); else go();
  }

  function learn(item, token) {
    var prev = lastResult && lastResult.before ? (S.words(lastResult.before.slice(0, lastResult.before.length - token.length)).slice(-1)[0] || null) : null;
    if (!settings.personal) return;
    if (local) local.learn(item, token, prev);
    else {
      personal.word(item.lang === "en" ? item.text.toLowerCase() : item.text, prev);
      if (/^[A-Za-z]+$/.test(token)) { personal.confirm(token, item.lang); if (item.lang === "si") learner.record(token, item.text); }
    }
    post({ type: "learn", item: { text: item.text, lang: item.lang }, token: token, prev: prev });
    save(PERSONAL_KEY, personal.data);
    save(LEARN_KEY, learner.data);
  }

  // --- writing the chosen word ------------------------------------------------------------------
  // Documents: one editor command selects the letters just typed, sets the Sinhala font on them and types
  // the word over them, so the word takes the font (typing over a selection keeps its other formatting),
  // the caret ends in that run and what is typed next stays in the font; one undo step. English words keep
  // the formatting as it is (no font). Legacy mode encodes the Unicode word with the font's own map first.
  // Spreadsheets and presentations: InputText, which replaces the typed letters (no font there).
  function sinhalaFont() { return settings.mode === "legacy" ? legacyFontName() : settings.unicodeFont; }
  function write(item, unicode, replace) {
    var text = unicode;
    var font = item.lang === "si" ? sinhalaFont() : "";
    if (item.lang === "si" && settings.mode === "legacy") {
      var r = S.toLegacy(unicode, S.getProfile(settings.legacyProfile));
      text = r.text;
      var fresh = r.unmapped.filter(function (u) { return !warned[settings.legacyProfile + u.text]; });
      fresh.forEach(function (u) { warned[settings.legacyProfile + u.text] = true; });
      if (fresh.length && window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.typingWarning) {
        window.WorkSuiteSinhalaTools.typingWarning({ profile: settings.legacyProfile, unmapped: fresh.map(function (u) { return { text: u.text, codePoint: u.codePoint }; }) });
      }
    }
    if (editorType() !== "word") { plugin.executeMethod("InputText", [text, replace]); return; }
    window.Asc.scope.typing = { text: text, replace: Array.from(replace).length, font: font };
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

  // Runs in the editor: Enter that the open popup held back.
  function enterCommand() {
    Api.GetDocument().InsertParagraphBreak();
    return true;
  }

  function legacyFontName() {
    var p = S.getProfile(settings.legacyProfile);
    return settings.legacyFont || p.fontNames[0];
  }
  /** The font typed Sinhala is written in, for the current mode. */
  function currentFont() { return sinhalaFont(); }

  // --- the editor's events ----------------------------------------------------------------------
  var context = "";
  plugin.event_onInputHelperInput = function (data) {
    if (!active() || !data) return;
    var text = typeof data.text === "string" ? data.text : "";
    context = text;
    // spreadsheets: never while a formula is being written
    if (editorType() === "cell" && /^[=+]/.test(text)) { if (typing && typing.isVisible) apply(typing.stop()); return; }
    ai.cancel(); // a new keystroke: the last question is moot
    apply(machine().input(text));
  };

  plugin.event_onInputHelperClear = function () {
    context = "";
    if (!typing) return;
    ai.cancel();
    apply(typing.cleared());
  };

  // a click in the document moves the caret (or the selection): the popup goes
  plugin.event_onClick = function () {
    context = "";
    if (typing && typing.isVisible) apply(typing.stop());
  };

  plugin.event_onKeyDown = function (data) {
    if (!data) return;
    if ((data.ctrlKey || data.metaKey) && !!data.shiftKey === SHORTCUT.shift && data.keyCode === SHORTCUT.keyCode) {
      // Ctrl+Shift+Y: Sinhala input on/off; Ctrl+Alt+Shift+Y: the next input mode
      if (data.altKey) setMode(MODES[(MODES.indexOf(settings.mode) + 1) % MODES.length]);
      else setMode(on() ? "english" : settings.lastSinhala);
      return;
    }
    if ((data.ctrlKey || data.metaKey) && !data.shiftKey && !data.altKey && data.keyCode === 32) {
      // Ctrl/Cmd+Space: the suggestions now (documents read the sentence before the caret)
      if (!active() || !settings.suggestions) return;
      if (editorType() === "word") {
        plugin.executeMethod("GetCurrentSentence", ["before"], function (s) { apply(machine().open(typeof s === "string" ? s : context)); });
      } else apply(machine().open(context));
      return;
    }
    if (!typing || !typing.isVisible) return;
    apply(typing.key(data.keyCode));
  };

  function changed() {
    save(TYPING_KEY, settings);
    if (window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.imeChanged) window.WorkSuiteSinhalaTools.imeChanged();
  }

  function restart() {
    if (typing) apply(typing.stop());
    typing = null;
    lastResult = null;
    ai.cancel();
  }

  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) return;
    restart();
    settings.mode = mode;
    if (mode === "unicode" || mode === "legacy") { settings.lastSinhala = mode; settings.output = mode; }
    else if (mode !== "english") settings.lastSinhala = settings.lastSinhala || "unicode";
    changed();
    // the suggestions follow the mode at once: ask again for what is before the caret
    if (context && active()) apply(machine().input(context));
  }

  // --- for plugin.js (the toolbar, the panel and Suggestions › Settings) --------------------------
  window.WorkSuiteSinhalaIme = {
    isOn: on,
    mode: function () { return settings.mode; },
    setMode: setMode,
    toggle: function () { setMode(on() ? "english" : settings.lastSinhala); },
    settings: function () { var c = {}; for (var k in settings) c[k] = settings[k]; return c; },
    defaults: function () { var c = {}; for (var k in DEFAULTS) c[k] = DEFAULTS[k]; return c; },
    font: currentFont,
    /** Change typing and suggestion settings (any key of DEFAULTS but mode, with the same type). */
    set: function (values) {
      for (var k in values) {
        if (k === "mode" || !(k in DEFAULTS) || typeof values[k] !== typeof DEFAULTS[k]) continue;
        if (k === "legacyProfile" && !knownProfile(values[k])) continue;
        if (CHOICES[k] && CHOICES[k].indexOf(values[k]) < 0) continue;
        settings[k] = values[k];
      }
      settings.maxItems = Math.max(5, Math.min(7, Math.round(settings.maxItems)));
      settings.delay = Math.max(0, Math.min(1000, Math.round(settings.delay)));
      if ("acceptKey" in values && CHOICES.acceptKey.indexOf(values.acceptKey) >= 0) settings.acceptTab = values.acceptKey !== "enter";
      // the preferred Sinhala output: what Sinhala input turns on to, and the mode now if Sinhala is on
      if (values.output && (settings.mode === "unicode" || settings.mode === "legacy") && settings.mode !== settings.output) {
        settings.lastSinhala = settings.output;
        settings.mode = settings.output;
      } else if (values.output) settings.lastSinhala = settings.output;
      restart();
      reconfigure();
      changed();
    },
    learnedCount: function () { return Object.keys(learner.data.words).length + Object.keys(personal.data.words).length; },
    customWords: function () { return personal.data.custom.slice(); },
    addWord: function (w) { personal.addCustom(String(w || "")); save(PERSONAL_KEY, personal.data); if (local) local.invalidate(); post({ type: "personal", personal: personal.data, learned: learner.data }); },
    removeWord: function (w) { personal.removeCustom(String(w || "")); save(PERSONAL_KEY, personal.data); if (local) local.invalidate(); post({ type: "personal", personal: personal.data, learned: learner.data }); },
    forget: function () {
      learner.forget();
      personal.forget();
      save(LEARN_KEY, learner.data);
      save(PERSONAL_KEY, personal.data);
      if (local) { local.personal = personal; local.learner = learner; local.invalidate(); }
      post({ type: "personal", personal: personal.data, learned: learner.data });
      changed();
    },
    /** For tests and the benchmark: one lookup in this frame. */
    suggest: function (before, mode, manual) { return localEngine().suggest({ before: before, mode: mode || settings.mode, manual: !!manual }); }
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
    set("--ime-selected", theme["highlight-button-pressed"] || theme["highlight-button-hover"]);
    set("--ime-hover", theme["highlight-button-hover"]);
    set("--ime-accent", theme["border-control-focus"]);
    set("--ime-completion", theme["text-normal"]);
    if (document.documentElement.setAttribute) document.documentElement.setAttribute("data-theme", theme.type === "dark" ? "dark" : "light");
  };
})(window, document);
