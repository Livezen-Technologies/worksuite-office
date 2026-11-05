// Unit tests of the PDF editor's OCR dialog settings (build/editors/.../view/OcrSettings.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../editors/apps/pdfeditor/main/app/view/OcrSettings.js");

test("matches searches names, words of names and codes", () => {
  const ara = { code: "ara", name: "Arabic" }, chi = { code: "chi_sim", name: "Chinese (Simplified)" };
  assert.ok(S.matches(ara, ""));
  assert.ok(S.matches(ara, "ARA"));
  assert.ok(S.matches(chi, "simp"));
  assert.ok(S.matches(chi, "chi_"));
  assert.ok(!S.matches(ara, "tam"));
  assert.ok(S.matches({ code: "sin", name: "සිංහල Sinhala" }, "sinh"));
});

test("initialLangs keeps the remembered languages that are still installed", () => {
  const avail = ["eng", "sin", "tam", "ara"];
  assert.deepEqual(S.initialLangs('["tam","ara"]', avail, ["eng", "sin"]), ["tam", "ara"]);
  assert.deepEqual(S.initialLangs('["fra","tam"]', avail, ["eng", "sin"]), ["tam"]);
  assert.deepEqual(S.initialLangs('["fra"]', avail, ["eng", "sin"]), ["eng", "sin"]);
  assert.deepEqual(S.initialLangs("not json", avail, ["eng", "sin"]), ["eng", "sin"]);
  assert.deepEqual(S.initialLangs(null, avail, ["eng", "sin"]), ["eng", "sin"]);
});

test("formatElapsed and percent", () => {
  assert.equal(S.formatElapsed(0), "0:00");
  assert.equal(S.formatElapsed(65_400), "1:05");
  assert.equal(S.formatElapsed(3_725_000), "1:02:05");
  assert.equal(S.percent(0.999), 99);
  assert.equal(S.percent(1, true), 100);
  assert.equal(S.percent(-1), 0);
});
