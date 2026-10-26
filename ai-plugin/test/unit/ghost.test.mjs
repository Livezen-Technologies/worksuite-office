// The inline suggestion state machine (W5): debounce, cancel per keystroke, Tab/Esc, never in the way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { GhostMachine, shouldSuggest, langOf, KEY } = lib("ghost");
const k = (keyCode, mods = {}) => Object.assign({ keyCode }, mods);
const types = (acts) => acts.map((a) => a.type);
const A = 65;

test("a keystroke schedules; the timer requests; the response shows", () => {
  const g = new GhostMachine();
  const s = g.key(k(A));
  assert.deepEqual(s, [{ type: "schedule", ms: 150, token: s[0].token }]);
  assert.deepEqual(types(g.timer(s[0].token)), ["request"]);
  assert.deepEqual(g.response(s[0].token, { text: " world", score: 0.8 }), [{ type: "show", text: " world" }]);
  assert.equal(g.state, "showing");
});

test("typing on cancels the request in flight and drops stale timers and responses", () => {
  const g = new GhostMachine();
  const t1 = g.key(k(A))[0].token;
  g.timer(t1);
  const acts = g.key(k(A + 1));
  assert.deepEqual(types(acts), ["cancel", "schedule"]);
  assert.deepEqual(g.response(t1, { text: "late" }), []);
  assert.deepEqual(g.timer(t1), []);
});

test("Tab accepts (the key is ours), Esc dismisses, any other key hides and starts over", () => {
  const show = () => { const g = new GhostMachine(); const t = g.key(k(A))[0].token; g.timer(t); g.response(t, { text: " next" }); return g; };
  let g = show();
  assert.deepEqual(g.key(k(KEY.TAB)), [{ type: "swallow" }, { type: "hide" }, { type: "insert", text: " next" }]);
  assert.equal(g.state, "idle");
  g = show();
  assert.deepEqual(types(g.key(k(KEY.ESC))), ["swallow", "hide"]);
  g = show();
  assert.deepEqual(types(g.key(k(A))), ["hide", "schedule"]);
  g = show();
  assert.deepEqual(types(g.key(k(KEY.TAB, { shiftKey: true }))), ["hide", "schedule"]);
});

test("Tab with nothing shown is the editor's; modifiers and navigation do not suggest", () => {
  const g = new GhostMachine();
  assert.deepEqual(types(g.key(k(KEY.TAB))), ["schedule"]);
  const h = new GhostMachine();
  assert.deepEqual(h.key(k(KEY.SHIFT)), []);
  assert.deepEqual(h.key(k(37)), []);
  assert.deepEqual(h.key(k(A, { ctrlKey: true })), []);
  assert.deepEqual(h.key(k(KEY.ESC)), []);
});

test("off: nothing is scheduled, and turning it off hides what shows", () => {
  const g = new GhostMachine({ enabled: false });
  assert.deepEqual(g.key(k(A)), []);
  const h = new GhostMachine();
  const t = h.key(k(A))[0].token; h.timer(t); h.response(t, { text: "x" });
  assert.deepEqual(types(h.setEnabled(false)), ["hide"]);
  assert.deepEqual(h.key(k(A)), []);
});

test("empty ghosts and failures go back to idle", () => {
  const g = new GhostMachine();
  const t = g.key(k(A))[0].token; g.timer(t);
  assert.deepEqual(g.response(t, { text: "  " }), []);
  assert.equal(g.state, "idle");
  const h = new GhostMachine();
  const u = h.key(k(A))[0].token; h.timer(u); h.failed(u);
  assert.equal(h.state, "idle");
  assert.deepEqual(types(h.blur()), []);
});

test("where suggestions stay off", () => {
  assert.equal(shouldSuggest("The quick brown", ""), true);
  assert.equal(shouldSuggest("The quick brown", " fox"), false); // mid-sentence
  assert.equal(shouldSuggest("", ""), false);
  assert.equal(shouldSuggest("12,450.00  3,200 17%", ""), false); // numbers
  assert.equal(shouldSuggest("Total 12,450.00 1,200.50 3,4", ""), false);
  assert.equal(shouldSuggest("මම ගෙදර", ""), true);
  assert.equal(langOf("hello"), "en");
  assert.equal(langOf("මම"), "si");
  assert.equal(langOf("මම office"), "mixed");
  assert.equal(langOf("123"), "auto");
});
