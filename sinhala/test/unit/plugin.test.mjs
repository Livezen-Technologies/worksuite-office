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
  assert.ok(v.events.includes("onToolbarMenuClick"));
  for (const f of v.icons) readFileSync(join(a, f));
  const files = readFileSync(join(a, "files.sha256"), "utf8");
  for (const f of ["index.html", "panel.html", "scripts/plugin.js", "scripts/panel.js", "scripts/sinhala-core.js",
    "translations/langs.json", "translations/si-LK.json", "translations/ta-LK.json"]) {
    assert.ok(files.includes("  " + f + "\n"), f);
  }
});

test("every string the plugin shows is translated into Sinhala and Tamil", () => {
  const sources = ["scripts/plugin.js", "scripts/panel.js", "panel.html"].map((f) => readFileSync(join(a, f), "utf8")).join("\n");
  const keys = new Set();
  for (const m of sources.matchAll(/\b(?:tr|fmt)\("((?:[^"\\]|\\.)+)"/g)) keys.add(m[1]);
  for (const m of sources.matchAll(/data-tr="([^"]+)"/g)) keys.add(m[1]);
  for (const m of sources.matchAll(/\["\w+", "([A-Z][^"]+)", "([A-Z][^"]+)"\]/g)) { keys.add(m[1]); keys.add(m[2]); }
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
