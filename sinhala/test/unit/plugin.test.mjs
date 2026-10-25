// The plugin build: deterministic, its config, its translations, and the bundled core working with
// no DOM and no Node (as in an editor command).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import S from "../../core/dist/src/index.js";
import { COMMANDS } from "../../plugin/icons/registry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "ws-sinhala-"));
const build = (name) => {
  const out = join(tmp, name);
  execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", out], { stdio: "pipe" });
  return out;
};
const a = build("a");
const b = build("b");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("the build is deterministic", () => {
  assert.equal(readFileSync(join(a, "files.sha256"), "utf8"), readFileSync(join(b, "files.sha256"), "utf8"));
});

test("config.json: fixed guid, name, a background variation with the toolbar event", () => {
  const config = JSON.parse(readFileSync(join(a, "config.json"), "utf8"));
  assert.equal(config.guid, "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}");
  assert.equal(config.name, "Sinhala Tools");
  const v = config.variations[0];
  assert.equal(v.url, "index.html");
  assert.equal(v.type, "background");
  for (const e of ["onToolbarMenuClick", "onInputHelperInput", "onInputHelperClear", "onKeyDown"]) assert.ok(v.events.includes(e), e);
  for (const f of v.icons) readFileSync(join(a, f));
  const files = readFileSync(join(a, "files.sha256"), "utf8");
  for (const f of ["index.html", "panel.html", "scripts/plugin.js", "scripts/panel.js", "scripts/sinhala-core.js",
    "scripts/ime.js", "scripts/sinhala-words.js", "scripts/toolbar.js", "licenses/lucide-icons-ISC.txt", "resources/ime.css", "licenses/word-lists.json",
    "licenses/slwdc-Sinhala-Words-List-GPL-3.0.txt", "translations/langs.json", "translations/si-LK.json", "translations/ta-LK.json"]) {
    assert.ok(files.includes("  " + f + "\n"), f);
  }
});

test("every string the plugin shows is translated into Sinhala and Tamil", () => {
  const sources = ["scripts/plugin.js", "scripts/panel.js", "scripts/ime.js", "panel.html"].map((f) => readFileSync(join(a, f), "utf8")).join("\n");
  const keys = new Set();
  for (const m of sources.matchAll(/\b(?:tr|fmt)\("((?:[^"\\]|\\.)+)"/g)) keys.add(m[1]);
  for (const m of sources.matchAll(/data-tr="([^"]+)"/g)) keys.add(m[1]);
  for (const c of COMMANDS) { keys.add(c.label); keys.add(c.hint); }
  for (const m of sources.matchAll(/^\s+"[a-z-]+": "([A-Z][^"]+)",?$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 30);
  for (const lang of JSON.parse(readFileSync(join(a, "translations", "langs.json"), "utf8"))) {
    const t = JSON.parse(readFileSync(join(a, "translations", lang + ".json"), "utf8"));
    for (const k of keys) assert.ok(t[k], `${lang}: "${k}"`);
  }
});

test("the bundled core runs with no DOM or Node, and as an editor command gets it", () => {
  const code = readFileSync(join(a, "scripts", "sinhala-core.js"), "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  const W = vm.runInContext("WorkSuiteSinhala", ctx);
  const fm = W.getProfile("fm-abhaya");
  assert.equal(W.toUnicode("Y%S ,xld", fm).text, "ශ්‍රී ලංකා");
  assert.equal(W.toUnicode("Y%S ,xld", fm).text, S.toUnicode("Y%S ,xld", S.getProfile("fm-abhaya")).text);
  // what plugin.js hands to callCommand: the factory's source, evaluated on its own
  const source = "(" + vm.runInContext("__worksuiteSinhalaFactory.toString()", ctx) + ")()";
  const fresh = vm.runInContext(source, vm.createContext({}));
  assert.equal(fresh.detect("isxy,", { fontNames: "FMAbhaya" }).profile, "fm-abhaya");
});

test("the plugin's document command converts runs in legacy fonts in one pass", () => {
  // a stand-in for the editor's Api: paragraphs of runs, one in a hyperlink
  const run = (text, font) => ({
    text, font, highlight: null,
    GetClassType: () => "run", GetText() { return this.text; }, GetFontNames() { return [this.font]; },
    ClearContent() { this.text = ""; }, AddText(t) { this.text += t; }, SetFontFamily(f) { this.font = f; },
    SetHighlight(c) { this.highlight = c; },
  });
  const container = (els, type) => ({ GetClassType: () => type, GetElementsCount: () => els.length, GetElement: (i) => els[i],
    GetAllDrawingObjects: () => [] });
  const runs = [run("isxy, ", "FMAbhaya"), run("Office", "Calibri"), run("mqj;am;", "DL-Manel-bold"), run("a\tb", "FMAbhaya"), run("ශ්‍රී", "Iskoola Pota")];
  const paragraphs = [container([runs[0], runs[1]], "paragraph"), container([container([runs[2]], "hyperlink"), runs[3], runs[4]], "paragraph")];
  const code = readFileSync(join(a, "scripts", "plugin.js"), "utf8");
  const command = code.match(/function documentCommand\(\) \{[\s\S]*?\n  \}\n/)[0];
  const core = readFileSync(join(a, "scripts", "sinhala-core.js"), "utf8");
  const ctx = vm.createContext({ Api: { GetDocument: () => ({ GetAllParagraphs: () => paragraphs }) }, Asc: { scope: {} } });
  vm.runInContext(core, ctx);
  ctx.Asc.scope = { core: "(" + vm.runInContext("__worksuiteSinhalaFactory.toString()", ctx) + ")()", mode: "convert", dryRun: true, font: "Noto Sans Sinhala", max: 200 };
  vm.runInContext(command, ctx);
  const preview = vm.runInContext("documentCommand()", ctx);
  assert.equal(preview.matched, 3);
  assert.equal(preview.changed, 2);
  assert.equal(preview.skipped, 1);
  assert.equal(runs[0].text, "isxy, ", "a preview changes nothing");
  ctx.Asc.scope.dryRun = false;
  const done = vm.runInContext("documentCommand()", ctx);
  assert.equal(done.changed, 2);
  assert.deepEqual(runs.map((r) => [r.text, r.font]), [
    ["සිංහල ", "Noto Sans Sinhala"], ["Office", "Calibri"], ["පුවත්පත", "Noto Sans Sinhala"], ["a\tb", "FMAbhaya"], ["ශ්‍රී", "Iskoola Pota"]]);
  ctx.Asc.scope.mode = "validate";
  ctx.Asc.scope.dryRun = true;
  const v = vm.runInContext("documentCommand()", ctx);
  assert.equal(v.issueCount, 0);
  assert.equal(v.matched, 3);
  ctx.Asc.scope.mode = "fonts";
  ctx.Asc.scope.dryRun = false;
  vm.runInContext("documentCommand()", ctx);
  assert.equal(runs[4].font, "Noto Sans Sinhala");
});

test("Sinhala input in the plugin frame: input helper events in, ShowInputHelper / InputText out", () => {
  const calls = [];
  const storage = new Map();
  const el = () => ({ textContent: "", children: [], appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener() {} });
  const nodes = { "ime-latin": el(), "ime-items": el() };
  const plugin = {
    info: { guid: "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}", editorType: "word" },
    executeMethod(name, args, cb) { calls.push([name, args]); if (name === "GetCurrentWord" && cb) cb("amm"); },
    attachToolbarMenuClickEvent() {}, callCommand() {}, tr: (t) => t,
  };
  const window = {
    Asc: { plugin, scope: {}, PluginWindow: function () {} },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  };
  const document = { getElementById: (id) => nodes[id], createElement: el, documentElement: { style: { setProperty() {} } } };
  const ctx = vm.createContext({ window, document, JSON, Object, Math, String, Number });
  window.window = window;
  for (const f of ["scripts/sinhala-core.js", "scripts/sinhala-words.js"]) vm.runInContext(readFileSync(join(a, f), "utf8") + "\nwindow.WorkSuiteSinhala = WorkSuiteSinhala; window.__worksuiteSinhalaFactory = __worksuiteSinhalaFactory;" + (f.includes("words") ? "window.WorkSuiteSinhalaWords = WorkSuiteSinhalaWords;" : ""), ctx);
  vm.runInContext(readFileSync(join(a, "scripts", "plugin.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(join(a, "scripts", "ime.js"), "utf8"), ctx);

  // off: typing is ignored
  plugin.event_onInputHelperInput({ text: "amma" });
  assert.equal(calls.length, 0);
  // Ctrl+Shift+Y turns it on (and the state is kept)
  plugin.event_onKeyDown({ keyCode: 89, ctrlKey: true, shiftKey: true });
  assert.equal(window.WorkSuiteSinhalaIme.isOn(), true);
  assert.equal(storage.get("worksuite-sinhala-input"), "true");
  plugin.event_onInputHelperInput({ text: "amma" });
  assert.equal(calls.at(-1)[0], "ShowInputHelper");
  assert.equal(calls.at(-1)[1][3], false, "the editor keeps the keyboard");
  assert.equal(nodes["ime-latin"].textContent, "amma");
  assert.equal(nodes["ime-items"].children[0].children[1].textContent, "අම්මා");
  // Down, then Enter writes the second candidate
  plugin.event_onKeyDown({ keyCode: 40 });
  plugin.event_onKeyDown({ keyCode: 13 });
  assert.deepEqual(calls.slice(-2).map((c) => c[0]), ["UnShowInputHelper", "InputText"]);
  assert.deepEqual(Array.from(calls.at(-1)[1]), ["අම්ම", "amma"]);
  assert.ok(JSON.parse(storage.get("worksuite-sinhala-input-learned")).picks.amma, "learned locally");
  // Backspace in a document: the word before the cursor continues the composition
  plugin.event_onInputHelperInput({ text: "ammaa" });
  plugin.event_onInputHelperClear();
  assert.equal(JSON.stringify(calls.at(-2)), JSON.stringify(["GetCurrentWord", ["before"]]));
  assert.equal(nodes["ime-latin"].textContent, "amm");
  // off again: the window closes
  window.WorkSuiteSinhalaIme.toggle();
  assert.equal(calls.at(-1)[0], "UnShowInputHelper");
  const n = calls.length;
  plugin.event_onInputHelperInput({ text: "amma" });
  assert.equal(calls.length, n);
});

test("the toolbar tab: eight buttons in four groups, each with its own icon, input state as pressed + caption", () => {
  const calls = [];
  const storage = new Map();
  const plugin = {
    info: { guid: "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}", editorType: "word" },
    executeMethod(name, args) { calls.push([name, JSON.parse(JSON.stringify(args))]); },
    attachToolbarMenuClickEvent() {}, callCommand() {}, tr: (t) => t,
  };
  const window = {
    Asc: { plugin, scope: {}, PluginWindow: function () {} },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  };
  const el = () => ({ textContent: "", children: [], appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener() {} });
  const document = { getElementById: () => el(), createElement: el, documentElement: { style: { setProperty() {} } } };
  const ctx = vm.createContext({ window, document, JSON, Object, Math, String, Number });
  window.window = window;
  for (const f of ["scripts/sinhala-core.js", "scripts/sinhala-words.js", "scripts/toolbar.js"]) {
    vm.runInContext(readFileSync(join(a, f), "utf8") + "\nwindow.WorkSuiteSinhala = WorkSuiteSinhala; window.__worksuiteSinhalaFactory = __worksuiteSinhalaFactory; window.WorkSuiteSinhalaWords = typeof WorkSuiteSinhalaWords === 'undefined' ? undefined : WorkSuiteSinhalaWords; window.WorkSuiteSinhalaToolbar = typeof WorkSuiteSinhalaToolbar === 'undefined' ? undefined : WorkSuiteSinhalaToolbar;", ctx);
  }
  vm.runInContext(readFileSync(join(a, "scripts", "plugin.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(join(a, "scripts", "ime.js"), "utf8"), ctx);
  plugin.init();
  const [name, [menu]] = calls.at(-1);
  assert.equal(name, "AddToolbarMenuItem");
  const items = menu.tabs[0].items;
  assert.deepEqual(items.map((i) => i.text), ["Sinhala input: off", "Convert", "To legacy", "Convert doc", "Detect", "Fonts", "Validate", "Panel"]);
  assert.deepEqual(items.map((i) => !!i.separator), [false, true, false, false, true, false, false, true]);
  assert.equal(new Set(items.map((i) => i.icons)).size, 8);
  for (const i of items) assert.ok(i.hint, i.id);
  assert.equal(items[0].pressed, false);
  window.WorkSuiteSinhalaIme.toggle();
  const [name2, [menu2]] = calls.filter((c) => c[0].endsWith("ToolbarMenuItem")).at(-1);
  assert.equal(name2, "UpdateToolbarMenuItem");
  assert.equal(menu2.tabs[0].items[0].text, "Sinhala input: on");
  assert.equal(menu2.tabs[0].items[0].pressed, true);
  assert.match(menu2.tabs[0].items[0].hint, /Singlish \(phonetic\)/);
});
