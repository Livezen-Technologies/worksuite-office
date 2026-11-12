// The cold-start Singlish defect (10.1.20): typed quickly right after the editor opened, "mama gedhara"
// came out as "මම එදර" or left "gedhara" in Latin. The editor side (keys dropped during a plugin
// command) is build/patch-sdkjs-keys.py, tested in build/test/sdkjs-keys.test.mjs. These tests cover the
// plugin side, on the built ime.js in a sandbox: a word ended while its suggestions are still on their
// way is written, and the editor's command engine is warmed up when the plugin starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// a fresh build of the plugin, as plugin.test.mjs does (npm test runs before build:plugin)
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "ws-sinhala-cold-"));
execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", join(tmp, "p")], { stdio: "pipe" });
const dist = join(tmp, "p", "scripts");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function sandbox({ worker }) {
  const commands = [];
  const methods = [];
  const store = new Map();
  const plugin = {
    info: { editorType: "word", guid: "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}" },
    executeMethod(name, args, cb) { methods.push({ name, args }); if (cb) cb(name === "GetCurrentWord" ? "" : undefined); },
    callCommand(f, close, calc, cb) { commands.push({ f, scope: JSON.parse(JSON.stringify(window.Asc.scope)) }); if (cb) cb(true); },
    tr: (s) => s,
  };
  const window = {
    Asc: { plugin, scope: {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    setTimeout, clearTimeout, console,
    Worker: worker,
  };
  window.window = window;
  const document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), body: { appendChild() {} } };
  const ctx = vm.createContext({ window, document, navigator: { platform: "Linux" }, setTimeout, clearTimeout, console });
  for (const f of ["sinhala-core.js", "sinhala-words.js", "english-words.js", "smart-data.js"]) {
    vm.runInContext(readFileSync(join(dist, f), "utf8") + "\n;window.WorkSuiteSinhala = typeof WorkSuiteSinhala !== 'undefined' ? WorkSuiteSinhala : window.WorkSuiteSinhala;", ctx);
  }
  vm.runInContext(readFileSync(join(dist, "ime.js"), "utf8"), ctx);
  return { window, plugin, commands, methods, ime: window.WorkSuiteSinhalaIme };
}

// A suggestion worker that is still starting: it takes queries and never answers them.
class ColdWorker { constructor() { this.posted = []; } postMessage(m) { this.posted.push(m); } }

test("cold start: a word ended while its suggestions are still on their way is written, not left in Latin", () => {
  const s = sandbox({ worker: ColdWorker });
  s.ime.setMode("unicode");
  s.ime.set({ delay: 0 });
  const t = "mama gedhara";
  for (let i = "mama ".length + 1; i <= t.length; i++) s.plugin.event_onInputHelperInput({ text: t.slice("mama ".length, i) });
  assert.equal(s.commands.length, 0, "nothing written yet: the worker has not answered");
  s.plugin.event_onInputHelperInput({ text: "gedhara " });
  const writes = s.commands.filter((c) => c.scope.typing);
  assert.equal(writes.length, 1, "the space wrote the word");
  assert.equal(writes[0].scope.typing.text, "ගෙදර ");
  assert.equal(writes[0].scope.typing.replace, "gedhara ".length);
});

test("cold start: plugin.init runs one empty command first, so the user's first word does not pay the engine's start-up", () => {
  const s = sandbox({ worker: ColdWorker });
  s.ime.warmUp();
  s.ime.warmUp(); // only once
  assert.equal(s.commands.length, 1);
  assert.equal(s.commands[0].scope.typing, undefined, "the warm-up writes nothing");
  assert.equal(s.commands[0].f(), true);
});

test("warm: with suggestions already shown, Space writes the word as before", () => {
  const s = sandbox({ worker: undefined }); // no worker: lookups answer at once
  s.ime.setMode("unicode");
  s.ime.set({ delay: 0 });
  for (const t of ["m", "ma", "mam", "mama"]) s.plugin.event_onInputHelperInput({ text: t });
  s.plugin.event_onInputHelperInput({ text: "mama " });
  const writes = s.commands.filter((c) => c.scope.typing);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope.typing.text, "මම ");
});
