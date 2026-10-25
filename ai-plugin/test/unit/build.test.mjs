// The plugin build: deterministic, its config, icons and translations, the worklet, and the toolbar plugin.js registers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { root } from "./helpers.mjs";

const tmp = mkdtempSync(join(tmpdir(), "ws-ai-"));
const build = (name) => { const out = join(tmp, name); execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", out], { stdio: "pipe" }); return out; };
const a = build("a"), b = build("b");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("the build is deterministic", () => {
  assert.equal(readFileSync(join(a, "files.sha256"), "utf8"), readFileSync(join(b, "files.sha256"), "utf8"));
});

test("config.json: a background plugin with the toolbar and key events", () => {
  const c = JSON.parse(readFileSync(join(a, "config.json"), "utf8"));
  assert.equal(c.guid, "asc.{7A1E5C0D-3B2F-4D6A-9E81-5C4F2B7D0A11}");
  assert.equal(c.name, "WorkSuite Local AI");
  const v = c.variations[0];
  assert.equal(v.type, "background");
  for (const e of ["onToolbarMenuClick", "onKeyDown"]) assert.ok(v.events.includes(e));
  const files = readFileSync(join(a, "files.sha256"), "utf8");
  for (const f of ["index.html", "dock.html", "transcribe.html", "review.html", "reader.html", "scripts/pcm-worklet.js", "scripts/plugin.js",
    "resources/light/voice@2x.png", "resources/dark/suggestions@1.5x.png", "resources/svg/voice.svg", "translations/si-LK.json"]) {
    assert.ok(files.includes("  " + f + "\n"), f);
  }
  assert.ok(!files.includes("pcm-worklet.src.js"));
});

test("the worklet registers its processor and turns 48 kHz into 640-sample frames", () => {
  const posted = [];
  let Proc = null;
  const ctx = vm.createContext({ sampleRate: 48000, registerProcessor: (n, c) => { assert.equal(n, "ws-ai-pcm"); Proc = c; },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } } });
  vm.runInContext(readFileSync(join(a, "scripts", "pcm-worklet.js"), "utf8"), ctx);
  const p = new Proc();
  for (let i = 0; i < 30; i++) p.process([[new Float32Array(128).fill(0.25)]]);
  assert.equal(posted.length, Math.floor(30 * 128 / 3 / 640));
  assert.equal(posted[0].pcm.byteLength, 1280);
});

function loadPlugin(editorType, info) {
  const calls = [];
  const plugin = { info: { guid: "asc.{X}", editorType }, tr: (t) => t, executeMethod: (m, args) => calls.push([m, args]), attachToolbarMenuClickEvent: () => {}, callCommand() {} };
  const storage = new Map();
  const window = { Asc: { plugin, scope: {} }, localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    fetch: async () => { throw new TypeError("no"); }, setTimeout, clearTimeout, setInterval: () => 0, console };
  window.window = window; window.self = window; window.parent = window;
  const ctx = vm.createContext(Object.assign(window, { document: { getElementById: () => null } }));
  for (const f of ["lib/discovery.js", "lib/client.js", "lib/edits.js", "lib/ghost.js", "lib/policy.js", "lib/providers.js", "lib/text.js", "scripts/plugin.js"]) {
    vm.runInContext(readFileSync(join(a, f), "utf8"), ctx, { filename: f });
  }
  return { ctx, plugin, calls };
}

test("the toolbar: the AI tab with every command, Voice typing on Home and Sinhala Tools, Read aloud on Review", () => {
  const { ctx } = loadPlugin("word");
  const tb = ctx.WsAiPlugin.toolbar();
  const byTab = JSON.parse(JSON.stringify(Object.fromEntries(tb.tabs.map((t) => [t.id, t.items.map((i) => i.id)]))));
  assert.equal(byTab.ai.length, 19);
  for (const c of ["voice", "transcribe", "readAloud", "spelling", "grammar", "improve", "rewrite", "simplify", "formal", "professional", "expand",
    "shorten", "summarize", "translate", "explain", "tone", "punctuation", "detect", "suggestions"]) assert.ok(byTab.ai.includes("ws-ai-" + c), c);
  assert.deepEqual(byTab.home, ["ws-ai-voice-home"]);
  assert.deepEqual(byTab["worksuite-sinhala-tools"], ["ws-ai-voice-sinhala"]);
  assert.deepEqual(byTab.review, ["ws-ai-readAloud-review"]);
  const ids = tb.tabs.flatMap((t) => t.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const t of tb.tabs) for (const i of t.items) {
    assert.match(i.icons, /^resources\/%theme-type%\(light\|dark\)\/\w+%scale%\(default\)\.%extension%\(png\)$/);
    assert.ok(i.hint.length > 5);
  }
  assert.match(tb.tabs[0].items[0].hint, /Ctrl\+Shift\+V/);
});

test("Ctrl+Shift+V and Cmd+Shift+V open voice typing", () => {
  const shown = [];
  const { ctx, plugin } = loadPlugin("word");
  ctx.Asc.PluginWindow = class { attachEvent() {} show(o) { shown.push(o.url); } command() {} close() {} };
  plugin.event_onKeyDown({ keyCode: 86, ctrlKey: true, shiftKey: true });
  assert.deepEqual(shown, ["dock.html"]);
  const two = loadPlugin("word");
  const s2 = [];
  two.ctx.Asc.PluginWindow = class { attachEvent() {} show(o) { s2.push(o.url); } command() {} close() {} };
  two.plugin.event_onKeyDown({ keyCode: 86, metaKey: true, shiftKey: true });
  assert.deepEqual(s2, ["dock.html"]);
});

test("spreadsheets and presentations: suggestions are documents-only", () => {
  const { ctx } = loadPlugin("cell");
  const s = ctx.WsAiPlugin.toolbar().tabs[0].items.find((i) => i.id === "ws-ai-suggestions");
  assert.equal(s.disabled, true);
});

test("undo of several accepted edits: inverses in the text after them", () => {
  const { ctx } = loadPlugin("word");
  const E = ctx.WsAiEdits;
  const t = "teh cat sat on teh mat";
  const edits = E.fromIssues(t, [{ start: 0, end: 3, replacements: ["the"] }, { start: 4, end: 7, replacements: ["kitten"] }, { start: 15, end: 18, replacements: ["the"] }]);
  const after = E.apply(t, edits);
  assert.equal(E.apply(after, ctx.WsAiPlugin.invertAll(edits)), t);
});
