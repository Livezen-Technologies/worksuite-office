// Issue #46: the converter's engine. Sample words round-trip through every Wijesekara profile (FM Abhaya,
// DL Manel), DL Manel writes rakaransaya on "%" like the rest of its family, characters a legacy font
// would show as another letter are reported with what they would read as, and recommend() picks the
// direction from the text (and its font).
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

const WORDS = ["ශ්‍රී ලංකාව", "කොළඹ", "පොත", "කෝපි", "කෞතුකය", "මගේ", "ප්‍රශ්නය", "ක්‍රියාව", "ද්‍යුතිය", "සිංහල",
  "ආයුබෝවන්", "ඒ", "ඕනෑ", "ඇය", "ගෙදර", "ලෝකය", "ස්ත්‍රී", "කෘෂිකර්මය", "ඛ ඝ ඡ ඣ ඨ ඪ ඵ ඹ", "කු කූ කෘ",
  "නිවාඩුව\nදෙවන පේළිය", "  දෙ  වන\t1990  "];

for (const id of ["fm-abhaya", "dl-manel"]) {
  const p = S.getProfile(id);
  for (const w of WORDS) {
    test(`${id}: ${JSON.stringify(w)} round-trips with nothing unmapped`, () => {
      const legacy = S.toLegacy(w, p);
      assert.deepEqual(legacy.unmapped, []);
      assert.doesNotMatch(legacy.text, /[඀-෿‍]/);
      assert.equal(S.toUnicode(legacy.text, p).text, w.normalize("NFC"));
    });
  }
}

test("DL Manel: rakaransaya is % (the DL family's glyph), as in FM", () => {
  const dl = S.getProfile("dl-manel");
  assert.equal(S.toLegacy("ප්‍රශ්නය", dl).text, "m%Yakh");
  assert.equal(S.toUnicode("m%Yakh", dl).text, "ප්‍රශ්නය");
  assert.equal(S.toUnicode("fm%a", dl).text, "ප්‍රේ");
});

test("a character the legacy font shows as another letter is reported with what it would read as", () => {
  const fm = S.getProfile("fm-abhaya");
  const r = S.toLegacy("පොත, (අද).", fm);
  const byChar = Object.fromEntries(r.unmapped.map((u) => [u.text, u.reads]));
  assert.equal(byChar[","], "ල", "a comma in FMAbhaya is the letter ල");
  assert.equal(byChar["."], "ග");
  assert.equal(byChar["("], undefined, "( is not a key: shown as itself");
  assert.equal(S.toLegacy("Office", fm).unmapped.find((u) => u.text === "O").reads, "ධ");
});

test("recommend(): the direction and profile from the text and its font", () => {
  assert.deepEqual(pick(S.recommend("ශ්‍රී ලංකාව")), { direction: "toLegacy", kind: "unicode" });
  const fm = S.recommend("Y%S ,xldj iy wdKavqj");
  assert.equal(fm.direction, "toUnicode");
  assert.equal(fm.profile, "fm-abhaya");
  const dl = S.recommend("hello", "DL-Manel");
  assert.equal(dl.direction, "toUnicode");
  assert.equal(dl.profile, "dl-manel");
  assert.equal(dl.confidence, 1);
  assert.deepEqual(pick(S.recommend("Hello world")), { direction: null, kind: "latin" });
  assert.deepEqual(pick(S.recommend("  ")), { direction: null, kind: "empty" });
  const mixed = S.recommend("ශ්‍රී ලංකාව සහ Y%S ,xldj");
  assert.equal(mixed.kind, "mixed");
  assert.equal(mixed.direction, "toUnicode", "legacy text in a mixed selection is what needs converting");
  // Sinhala Unicode with English words is Unicode text to encode, not legacy text
  assert.equal(S.recommend("සිංහල Office").direction, "toLegacy");
});

function pick(r) { return { direction: r.direction, kind: r.kind }; }
