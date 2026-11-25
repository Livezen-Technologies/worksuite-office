// Sinhala Tools in Project and Diagram (common/sinhala-tools.js over the plugin's sinhala-core bundle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const core = readFileSync(new URL("../apps/common/sinhala-core.js", import.meta.url), "utf8");
vm.runInThisContext(core + ";globalThis.WorkSuiteSinhala = WorkSuiteSinhala;");
const T = await import("../apps/common/sinhala-tools.js");

test("Singlish turns the word before the caret into Sinhala, and leaves the rest", () => {
  assert.deepEqual(T.singlishAt("ammaa", 5), { value: "අම්මා", caret: 5 });
  assert.deepEqual(T.singlishAt("Task: gedara", 12), { value: "Task: ගෙදර", caret: 10 });
  assert.equal(T.singlishAt("අම්මා ", 6), null, "nothing latin before the caret");
  assert.equal(T.singlishAt("x 12", 4), null);
});

test("legacy fonts to Unicode, and fixing Sinhala", () => {
  assert.deepEqual(T.profiles().map((p) => p.id), ["fm-abhaya", "dl-manel", "kaputa", "lastech", "kandy"]);
  assert.equal(T.toUnicode("wdhqfndajka", "fm-abhaya").text, "ආයුබෝවන්");
  assert.equal(typeof T.fix("කා"), "string");
  assert.throws(() => T.toUnicode("x", "no-such-font"));
});

test("the bundle is the same as the plugin's core version, and both apps load it and show the tab", () => {
  const ver = JSON.parse(readFileSync(new URL("../../sinhala/core/package.json", import.meta.url), "utf8")).version;
  assert.match(core.slice(0, 200), new RegExp(`@worksuite/sinhala-core ${ver.replace(/\./g, "\\.")}`), "rebuild with sinhala/scripts/build-plugin.mjs and copy");
  for (const app of ["project", "diagram"]) {
    const html = readFileSync(new URL(`../apps/${app}/editor/index.html`, import.meta.url), "utf8");
    assert.match(html, /common\/sinhala-core\.js/);
    assert.match(html, /data-tab="sinhala">Sinhala Tools</);
  }
});
