/*
 * Sinhala input: type Singlish in the document, pick Sinhala words from a candidate window (Google
 * Input Tools style). Turned on and off from the Sinhala Tools tab ("Sinhala input") or with
 * Ctrl+Shift+Y (Cmd+Shift+Y on a Mac) in the editor.
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
  var STATE_KEY = "worksuite-sinhala-input";
  var LEARN_KEY = "worksuite-sinhala-input-learned";
  var SHORTCUT = { keyCode: 89, shift: true }; // Y, with Ctrl (Cmd on a Mac) and Shift: unused by the editors
  var WIDTH = 240;

  function load(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage may be unavailable */ }
  }

  var on = load(STATE_KEY) === true;
  var lexicon = null;
  var learner = new S.Learner(load(LEARN_KEY));
  var ime = null;

  function editorType() { return (plugin.info && plugin.info.editorType) || "word"; }

  function engine() {
    if (!ime) {
      if (!lexicon) lexicon = new S.Lexicon(window.WorkSuiteSinhalaWords || []);
      // documents can tell the word before the cursor, so Backspace edits the composition there
      ime = new S.SinhalaIme({ lexicon: lexicon, learner: learner, canResync: editorType() === "word", words: 5, completions: 4 });
    }
    return ime;
  }

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
          plugin.executeMethod("InputText", [a.text, a.replace]);
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

  // --- the editor's events ----------------------------------------------------------------------
  plugin.event_onInputHelperInput = function (data) {
    if (!on || !data) return;
    apply(engine().input(typeof data.text === "string" ? data.text : ""));
  };

  plugin.event_onInputHelperClear = function () {
    if (!on || !ime) return;
    apply(ime.cleared());
  };

  plugin.event_onKeyDown = function (data) {
    if (!data) return;
    if ((data.ctrlKey || data.metaKey) && !!data.shiftKey === SHORTCUT.shift && !data.altKey && data.keyCode === SHORTCUT.keyCode) {
      setOn(!on);
      return;
    }
    if (!on || !ime || !ime.isVisible) return;
    apply(ime.key(data.keyCode));
  };

  function setOn(value) {
    on = !!value;
    save(STATE_KEY, on);
    if (!on && ime) apply(ime.stop());
    if (window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.imeChanged) window.WorkSuiteSinhalaTools.imeChanged();
  }

  // --- for plugin.js (the toolbar button and the panel) -------------------------------------------
  window.WorkSuiteSinhalaIme = {
    isOn: function () { return on; },
    toggle: function () { setOn(!on); },
    learnedCount: function () { return Object.keys(learner.data.words).length; },
    forget: function () {
      learner.forget();
      save(LEARN_KEY, learner.data);
      if (window.WorkSuiteSinhalaTools && window.WorkSuiteSinhalaTools.imeChanged) window.WorkSuiteSinhalaTools.imeChanged();
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
