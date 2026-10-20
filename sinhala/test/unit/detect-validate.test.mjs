import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

test("detect: a run in a legacy font is legacy, with that font's profile", () => {
  const d = S.detect("isxy, 2026", { fontNames: ["DL-Manel-bold"] });
  assert.equal(d.kind, "legacy");
  assert.equal(d.profile, "dl-manel");
  assert.equal(d.confidence, 1);
  assert.deepEqual(d.segments, [{ start: 0, end: 10, kind: "legacy" }]);
});

test("detect: Unicode, Latin, mixed and empty", () => {
  assert.equal(S.detect("ශ්‍රී ලංකා").kind, "unicode");
  assert.equal(S.detect("The school and the paper").kind, "latin");
  assert.equal(S.detect("").kind, "empty");
  const mixed = S.detect("ශ්‍රී ලංකා mqj;am; wOHdmkh", {});
  assert.equal(mixed.kind, "mixed");
  assert.equal(mixed.profile, "fm-abhaya");
  assert.ok(mixed.confidence > 0 && mixed.confidence < 1);
  assert.deepEqual(mixed.segments.map((s) => s.kind), ["unicode", "legacy"]);
});

test("detect: segments cover the text in order", () => {
  const text = "Office isxy, ශ්‍රී";
  const d = S.detect(text, { fontNames: "Calibri" });
  for (let i = 1; i < d.segments.length; i++) assert.ok(d.segments[i].start >= d.segments[i - 1].end);
  assert.equal(d.segments[d.segments.length - 1].end, text.length);
});

test("validate: clean text has no issues", () => {
  for (const t of ["ශ්‍රී ලංකා", "කෝ", "ක්‍යො", "බ‍්බ", "අංක 12"]) assert.deepEqual(S.validate(t), [], t);
});

test("validate: legacy-order kombuva, stray joiners, signs without base", () => {
  const codes = (t) => S.validate(t).map((i) => i.code);
  assert.deepEqual(codes("ෙක"), ["kombuva-before-consonant"]);
  assert.deepEqual(codes("ක‍ල"), ["stray-zwj"]);
  assert.deepEqual(codes("ක‌ල"), ["stray-zwnj"]);
  assert.deepEqual(codes(" ා"), ["sign-without-base"]);
  assert.deepEqual(codes("කාි"), ["double-vowel-sign"]);
  assert.deepEqual(codes("ක‍්ය"), ["zwj-order"]);
  assert.ok(codes("කො").includes("not-nfc"));
});

test("normalize: NFC, joiner order, stray joiners, vowel-sign order", () => {
  assert.equal(S.normalize("කො").text, "කො");
  assert.equal(S.normalize("ක‍්ය").text, "ක්‍ය");
  assert.equal(S.normalize("ක‍ල").text, "කල");
  assert.equal(S.normalize("ක්‍‍ය").text, "ක්‍ය");
  assert.equal(S.normalize("කේා").text, "කෝ");
  const clean = "ශ්‍රී ලංකා";
  assert.deepEqual(S.normalize(clean), { text: clean, changed: false });
  for (const t of ["කො", "ක‍්ය", "ක‍ල"]) {
    assert.deepEqual(S.validate(S.normalize(t).text).filter((i) => i.fixable), [], t);
  }
});
