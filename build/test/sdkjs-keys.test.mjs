// build/patch-sdkjs-keys.py: keys typed while a plugin command runs are queued and replayed in order,
// not dropped (10.1.20: "mama gedhara" typed quickly after opening became "මම එදර"). The patch is
// applied to minimal copies of the two sdkjs sources it edits, with the exact upstream text it anchors
// on, and the patched editor code is then driven with a fake editor and clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const patch = join(repo, "build", "patch-sdkjs-keys.py");

// The upstream text the patch anchors on (ONLYOFFICE sdkjs v10.0.0.176), in a runnable skeleton.
const TEXT_INPUT = `(function(window) {
	var AscCommon = window.AscCommon;
	function CTextInput(api) { this.Api = api; this.Text = ""; this.added = []; this.downs = []; }
	var CTextInputPrototype = CTextInput.prototype;
	CTextInputPrototype.addText = function(text) { this.added.push(text); this.Api.doc += text; };
	// input
	CTextInputPrototype.onKeyDown = function(e)
	{
		if (this.Api.isLongAction())
		{
			AscCommon.stopEvent(e);
			return false;
		}
		this.downs.push(e.key);
		if (1 === Array.from(e.key).length && !e.wsReplayed) this.addText(e.key);
		return true;
	};
	CTextInputPrototype.onInput = function(e)
	{
		this.Text = this.Api.doc;
		if (window.g_asc_plugins)
			window.g_asc_plugins.onPluginEvent("onInputHelperInput", { "text" : this.Text });
	};
	window.CTextInput = CTextInput;
})(window);
`;
const PLUGINS = `(function(window) {
	var AscCommon = window.AscCommon; // in scope in sdkjs's plugins.js too (AscCommon.isValidJs, safePluginEval)
	window.Plugins = {
		callCommandInternal : function(value, task)
		{
			try
			{
				if (task.interface)
				{
				}
				else if (!this.api.isLongAction())
				{
					let _t = this;
					this.api.runBuilderScript(function() {
						value();
						function onEndScript()
						{
							_t.api.onEndBuilderScript(function(result)
							{
								_t.shiftCommand();
							});
						}
						onEndScript();
					}, value);
					return;
				}
			}
			catch (err)
			{
			}
		},
		shiftCommand : function() {}
	};
})(window);
`;

function patched() {
  const dir = mkdtempSync(join(tmpdir(), "ws-sdkjs-"));
  mkdirSync(join(dir, "common"));
  writeFileSync(join(dir, "common", "text_input2.js"), TEXT_INPUT);
  writeFileSync(join(dir, "common", "plugins.js"), PLUGINS);
  execFileSync("python3", [patch, dir]);
  const first = [readFileSync(join(dir, "common", "text_input2.js"), "utf8"), readFileSync(join(dir, "common", "plugins.js"), "utf8")];
  execFileSync("python3", [patch, dir]); // again: no change
  const second = [readFileSync(join(dir, "common", "text_input2.js"), "utf8"), readFileSync(join(dir, "common", "plugins.js"), "utf8")];
  rmSync(dir, { recursive: true, force: true });
  return { first, second };
}

// A fake editor: a long action while a plugin command's fonts load; a manual clock for the timers.
function editor() {
  const timers = [];
  let now = 0;
  const clock = {
    setTimeout: (f, ms) => { const t = { f, at: now + (ms || 0) }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const t = timers.shift(); now = Math.max(now, t.at); t.f();
      }
      now = end;
    },
  };
  const helpers = [];
  const window = {
    AscCommon: { stopEvent() {} },
    g_asc_plugins: { onPluginEvent: (name, data) => (helpers.push(data.text), ["asc.{SINHALA}"]) },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
  const api = { doc: "", long: 0, isLongAction() { return this.long > 0; },
    runBuilderScript(f) { f(); },
    // the command's fonts load as a long action, ending later (the clock decides when)
    onEndBuilderScript(cb) { this.long++; clock.setTimeout(() => { this.long--; cb(true); }, this.fontMs); },
    fontMs: 100 };
  return { window, api, clock, helpers };
}

function load(src, e) {
  const ctx = vm.createContext({ window: e.window, setTimeout: e.clock.setTimeout, clearTimeout: e.clock.clearTimeout, Date: { now: () => e.clock.now ?? 0 }, Array, Math });
  // the hold uses Date.now(): tie it to the fake clock
  let t = 0; const advance = e.clock.advance; e.clock.advance = (ms) => { const end = t + ms; advance(ms); t = end; };
  ctx.Date = { now: () => t };
  for (const s of src) vm.runInContext(s, ctx);
  const input = new e.window.CTextInput(e.api);
  e.window.Plugins.api = e.api;
  return { input, plugins: e.window.Plugins };
}
const key = (input, k) => input.onKeyDown({ key: k, keyCode: k.toUpperCase().charCodeAt(0), which: 0, charCode: 0, code: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });

test("the patch applies to sdkjs's text_input2.js and plugins.js, and again changes nothing", () => {
  const { first, second } = patched();
  assert.deepEqual(second, first);
  assert.match(first[0], /wsQueueKey\(this, e, false\)/);
  assert.match(first[1], /wsPluginCommands/);
});

test("keys typed while a plugin command holds the editor are replayed in order once it ends", () => {
  const { first } = patched();
  const e = editor();
  const { input, plugins } = load(first, e);
  // the plugin writes a word: the command's fonts hold the editor for 100 ms
  plugins.callCommandInternal(() => { e.api.doc = "මම "; }, {});
  assert.equal(e.api.isLongAction(), true);
  key(input, "g"); key(input, "e"); key(input, "d");
  assert.equal(e.api.doc, "මම ", "nothing typed during the command reached the document yet");
  e.clock.advance(100); // fonts loaded, command over
  e.clock.advance(50);
  assert.equal(e.api.doc, "මම ged", "replayed in the order typed");
  key(input, "h"); // after the queue is empty: straight in
  assert.equal(e.api.doc, "මම gedh");
});

test("while replayed keys are still waiting, newer keys queue behind them (no overtaking)", () => {
  const { first } = patched();
  const e = editor();
  const { input, plugins } = load(first, e);
  plugins.callCommandInternal(() => { e.api.doc = "මම "; }, {});
  key(input, "g"); key(input, "e");
  e.clock.advance(100);
  key(input, "d"); // the command is over, but "g" and "e" have not been replayed yet
  e.clock.advance(50);
  assert.equal(e.api.doc, "මම ged");
});

test("after a word-ending key went to an input helper, the next keys wait for its command", () => {
  const { first } = patched();
  const e = editor();
  const { input, plugins } = load(first, e);
  e.api.doc = "mama ";
  input.onInput({}); // the helper gets "mama ": it will write the word
  key(input, "g"); // typed before the command arrived
  assert.equal(e.api.doc, "mama ", "held");
  plugins.callCommandInternal(() => { e.api.doc = e.api.doc.replace(/mama $/, "මම "); }, {});
  e.clock.advance(200);
  assert.equal(e.api.doc, "මම g", "the word was written first, then the held key");
});

test("with no command coming, held keys go in after the short hold; outside commands nothing is queued", () => {
  const { first } = patched();
  const e = editor();
  const { input } = load(first, e);
  e.api.doc = "hello ";
  input.onInput({});
  key(input, "w");
  e.clock.advance(300);
  assert.equal(e.api.doc, "hello w");
  key(input, "o");
  assert.equal(e.api.doc, "hello wo", "typed at once");
});

test("during a long action that is not a plugin command (saving, loading) keys are ignored, as before", () => {
  const { first } = patched();
  const e = editor();
  const { input } = load(first, e);
  e.api.long = 1; // e.g. saving
  key(input, "x");
  e.api.long = 0;
  e.clock.advance(500);
  assert.equal(e.api.doc, "");
});
