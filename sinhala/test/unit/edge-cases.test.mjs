// Script edge cases (blueprint section 9): yansaya, rakaransaya, repaya, touching letters, ZWJ/ZWNJ,
// kombuva + al-lakuna, numbers and punctuation inside legacy runs, mixed Sinhala-English lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

const fm = S.getProfile("fm-abhaya");
const dl = S.getProfile("dl-manel");

test("yansaya is al-lakuna + ZWJ + ya", () => {
  assert.equal(S.toUnicode("lH", fm).text, "ක්‍ය");
  assert.equal(S.toUnicode("flHd", fm).text, "ක්‍යො", "kombuva goes after the whole cluster");
  assert.equal(S.toLegacy("ක්‍යො", fm).text, "flHd");
});

test("rakaransaya is al-lakuna + ZWJ + ra (FM only)", () => {
  assert.equal(S.toUnicode("m%", fm).text, "ප්‍ර");
  assert.equal(S.toUnicode("fm%a", fm).text, "ප්‍රේ");
  const dlResult = S.toLegacy("ප්‍ර", dl);
  assert.equal(dlResult.text, "ma‍r", "DL has no rakaransaya mapping yet: the joiner is kept");
  assert.deepEqual(dlResult.unmapped.map((u) => u.codePoint), ["U+200D"]);
});

test("repaya and touching letters are reported, never dropped", () => {
  const repaya = "කර්‍ම"; // කර්‍ම
  const r = S.toLegacy(repaya, fm);
  assert.equal(r.text, "lra‍u");
  assert.deepEqual(r.unmapped, [{ offset: 3, text: "‍", codePoint: "U+200D" }]);
  const touching = "බ‍්බ"; // බ‍්බ
  const t = S.toLegacy(touching, fm);
  assert.equal(t.text, "n‍an");
  assert.equal(t.unmapped.length, 1);
  assert.equal(S.toUnicode(t.text, fm).text, touching, "a joiner in legacy text is kept as it is");
});

test("kombuva + al-lakuna, aela-pilla and gayanukitta compose", () => {
  assert.equal(S.toUnicode("fla", fm).text, "කේ");
  assert.equal(S.toUnicode("fld", fm).text, "කො");
  assert.equal(S.toUnicode("flda", fm).text, "කෝ");
  assert.equal(S.toUnicode("flA", fm).text, "කෞ");
  assert.equal(S.toUnicode("ffl", fm).text, "කෛ");
  for (const u of ["කේ", "කො", "කෝ", "කෞ", "කෛ"]) assert.equal(S.toUnicode(S.toLegacy(u, fm).text, fm).text, u);
});

test("decomposed Unicode input encodes like composed", () => {
  assert.equal(S.toLegacy("කෝ", fm).text, "flda");
});

test("numbers pass; unknown punctuation inside legacy runs is kept and reported", () => {
  const r = S.toUnicode("wxl 12$3", fm);
  assert.equal(r.text, "අංක 12$3");
  assert.deepEqual(r.unmapped, [{ offset: 6, text: "$", codePoint: "U+0024" }]);
});

test("unmapped characters keep their place and offsets", () => {
  const r = S.toUnicode("úu¾Ykh", fm);
  assert.equal(r.text, "úම¾ශනය");
  assert.deepEqual(r.unmapped.map((u) => [u.offset, u.text]), [[0, "ú"], [2, "¾"]]);
  const astral = S.toUnicode("l😀l", fm);
  assert.equal(astral.text, "ක😀ක");
  assert.deepEqual(astral.unmapped.map((u) => [u.offset, u.codePoint]), [[1, "U+1F600"]]);
});

test("English letters in Unicode text are not encoded into a legacy font", () => {
  const r = S.toLegacy("සිංහල Office", fm);
  assert.equal(r.text, "isxy, Office");
  assert.equal(r.unmapped.map((u) => u.text).join(""), "Office");
});

test("Unicode Sinhala and joiners inside a legacy run are left alone", () => {
  const r = S.toUnicode("isxy, සිංහල ‌", fm);
  assert.equal(r.text, "සිංහල සිංහල ‌");
  assert.deepEqual(r.unmapped, []);
});

test("a lone kombuva with no consonant after it stays where it is", () => {
  assert.equal(S.toUnicode("f", fm).text, "ෙ");
  assert.equal(S.toUnicode("f 1", fm).text, "ෙ 1");
});

test("conversion is deterministic", () => {
  const a = S.toUnicode("Y%S ,xld rcfha mqj;am;", fm);
  const b = S.toUnicode("Y%S ,xld rcfha mqj;am;", fm);
  assert.deepEqual(a, b);
  assert.equal(a.profileVersion, fm.version);
  assert.equal(a.profile, "fm-abhaya");
});
