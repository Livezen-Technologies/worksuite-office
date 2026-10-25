/*
 * Inline suggestions (W5) as a state machine with no timers or I/O of its own: every input returns the
 * actions for plugin.js to carry out, so it never blocks typing and is testable.
 *
 *   idle --key--> waiting (debounce 150 ms) --timer--> requesting --response--> showing
 *   any key cancels the request in flight and hides the ghost; Tab accepts (writes it), Esc dismisses.
 *
 * Actions: {type:"schedule", ms, token}, {type:"request", token}, {type:"cancel"}, {type:"show", text},
 * {type:"hide"}, {type:"insert", text}, {type:"swallow"} (the key is ours: the editor should not get it).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiGhost = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY = { TAB: 9, ESC: 27, SHIFT: 16, CTRL: 17, ALT: 18, META: 91, META_R: 93, CAPS: 20 };
  var NAV = { 33: 1, 34: 1, 35: 1, 36: 1, 37: 1, 38: 1, 39: 1, 40: 1, 13: 1, 45: 1 };

  function GhostMachine(opts) {
    opts = opts || {};
    this.debounce = opts.debounceMs || 150;
    this.enabled = opts.enabled !== false;
    this.state = "idle";
    this.text = "";
    this.token = 0;
  }

  GhostMachine.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (!on) return this._reset();
    return [];
  };

  GhostMachine.prototype._reset = function () {
    var acts = [];
    if (this.state === "requesting") acts.push({ type: "cancel" });
    if (this.state === "showing") acts.push({ type: "hide" });
    this.state = "idle";
    this.text = "";
    this.token++;
    return acts;
  };

  /* k: {keyCode, ctrlKey, metaKey, altKey} */
  GhostMachine.prototype.key = function (k) {
    var code = k.keyCode;
    if (code === KEY.SHIFT || code === KEY.CTRL || code === KEY.ALT || code === KEY.META || code === KEY.META_R || code === KEY.CAPS) return [];
    if (this.state === "showing" && code === KEY.TAB && !k.ctrlKey && !k.metaKey && !k.altKey && !k.shiftKey) {
      var text = this.text;
      this.state = "idle"; this.text = ""; this.token++;
      return [{ type: "swallow" }, { type: "hide" }, { type: "insert", text: text }];
    }
    if (code === KEY.ESC) {
      var shown = this.state === "showing";
      var acts = this._reset();
      if (shown) acts.unshift({ type: "swallow" });
      return acts;
    }
    var out = this._reset();
    if (!this.enabled || k.ctrlKey || k.metaKey || k.altKey || NAV[code]) return out;
    this.state = "waiting";
    out.push({ type: "schedule", ms: this.debounce, token: this.token });
    return out;
  };

  GhostMachine.prototype.timer = function (token) {
    if (token !== this.token || this.state !== "waiting" || !this.enabled) return [];
    this.state = "requesting";
    return [{ type: "request", token: this.token }];
  };

  /* ghost: {text, score} | null */
  GhostMachine.prototype.response = function (token, ghost) {
    if (token !== this.token || this.state !== "requesting") return [];
    if (!ghost || !ghost.text || !/\S/.test(ghost.text)) { this.state = "idle"; return []; }
    this.state = "showing";
    this.text = ghost.text;
    return [{ type: "show", text: ghost.text }];
  };

  GhostMachine.prototype.failed = function (token) {
    if (token === this.token && this.state === "requesting") this.state = "idle";
    return [];
  };

  /* the editor lost the caret's context (click, selection change, focus) */
  GhostMachine.prototype.blur = function () { return this._reset(); };

  /*
   * Where suggestions stay off (W5 rules): nothing to go on, or a cell of numbers. The caret must be at
   * the end of what was read (the sentence before the caret, with nothing after it).
   */
  function shouldSuggest(before, after) {
    if (!before || after && /\S/.test(after)) return false;
    var tail = before.slice(-40);
    if (!/[A-Za-z඀-෿஀-௿]/.test(tail)) return false;
    var digits = (tail.match(/[0-9.,%\-+]/g) || []).length;
    return digits / tail.replace(/\s/g, "").length < 0.5;
  }

  function langOf(text) {
    var si = (text.match(/[඀-෿]/g) || []).length;
    var ta = (text.match(/[஀-௿]/g) || []).length;
    var lat = (text.match(/[A-Za-z]/g) || []).length;
    if (si && lat) return "mixed";
    if (si) return "si";
    if (ta) return "auto";
    return lat ? "en" : "auto";
  }

  return { GhostMachine: GhostMachine, shouldSuggest: shouldSuggest, langOf: langOf, KEY: KEY };
});
