// build/editors/.../controller/ProUpgrade.js: the PDF Editor's Pro upsell shown on an HTTP 402
// (payment_required) from the local AI service. is402() recognises the refusal; prompt() shows a
// warning with an Upgrade button that opens the upgrade page in the browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "editors", "apps", "pdfeditor", "main", "app", "controller", "ProUpgrade.js"),
  "utf8",
);

function load() {
  const calls = { warning: [], opened: [] };
  const win = { open: (url, target) => calls.opened.push({ url, target }) };
  const Common = { UI: { warning: (opts) => calls.warning.push(opts) } };
  let mod;
  const ctx = vm.createContext({ window: win, Common, define: (deps, f) => { mod = f(); } });
  vm.runInContext(src, ctx);
  return { mod, calls };
}

test("is402 matches only the service's payment_required refusal", () => {
  const { mod } = load();
  assert.equal(mod.is402({ code: "payment_required" }), true);
  assert.equal(mod.is402({ code: "service_unavailable" }), false);
  assert.equal(mod.is402({ code: "internal" }), false);
  assert.equal(mod.is402(null), false);
  assert.equal(mod.is402(undefined), false);
});

test("prompt shows a warning with an Upgrade primary button and the given text", () => {
  const { mod, calls } = load();
  mod.prompt({ title: "WorkSuite Office Pro", msg: "OCR is Pro", upgrade: "Upgrade to Pro", close: "Close" });
  assert.equal(calls.warning.length, 1);
  const w = calls.warning[0];
  assert.equal(w.title, "WorkSuite Office Pro");
  assert.equal(w.msg, "OCR is Pro");
  assert.equal(w.primary, "upgrade");
  const upgrade = w.buttons.find((b) => b.value === "upgrade");
  assert.ok(upgrade && upgrade.primary && upgrade.caption === "Upgrade to Pro");
  assert.ok(w.buttons.find((b) => b.value === "close" && b.caption === "Close"));
});

test("choosing Upgrade opens the upgrade page in the browser; Close does not", () => {
  const { mod, calls } = load();
  mod.prompt({ msg: "x" });
  const cb = calls.warning[0].callback;
  cb("close");
  assert.equal(calls.opened.length, 0);
  cb("upgrade");
  assert.equal(calls.opened.length, 1);
  assert.equal(calls.opened[0].url, mod.UPGRADE_URL);
  assert.match(mod.UPGRADE_URL, /^https:\/\//);
});

test("openUpgrade survives a missing window.open", () => {
  const { mod } = load();
  mod.openUpgrade(); // window.open present: fine
  const noop = (() => {
    const ctx = vm.createContext({ window: {}, Common: { UI: { warning() {} } }, define: (d, f) => (ctx.__m = f()) });
    vm.runInContext(src, ctx);
    return ctx.__m;
  })();
  assert.doesNotThrow(() => noop.openUpgrade());
});
