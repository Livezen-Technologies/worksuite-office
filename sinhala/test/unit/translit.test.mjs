// Singlish -> Sinhala Unicode: the phonetic rules, and the alternatives the candidate list offers.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

const ZWJ = "‍";
const t = (latin) => S.transliterate(latin);
const alts = (latin, n = 64) => S.variants(latin, n).map((v) => v.text);

test("common words", () => {
  const cases = {
    mama: "මම", oba: "ඔබ", oyaa: "ඔයා", ammaa: "අම්මා", gedara: "ගෙදර", kohomadha: "කොහොමද",
    kiyanna: "කියන්න", paasala: "පාසල", kaeema: "කෑම", Aththa: "ඇත්ත", mage: "මගෙ", magee: "මගී",
    rata: "රට", lankaava: "ලන්කාව", poth: "පොත්", sthuthiyi: "ස්තුතියි", aayuboovan: "ආයුබෝවන්",
    hoNdha: "හොණ්ද", baLLaa: "බළ්ළා", wathura: "වතුර", vathura: "වතුර", fon: "ෆොන්",
  };
  for (const [latin, si] of Object.entries(cases)) assert.equal(t(latin), si, latin);
});

test("consonants without a vowel take the al-lakuna (hal kirima)", () => {
  assert.equal(t("k"), "ක්");
  assert.equal(t("mam"), "මම්");
  assert.equal(t("path"), "පත්");
  assert.equal(t("sth"), "ස්ත්");
});

test("vowels: independent at the start or after a vowel, signs after a consonant", () => {
  const ind = { a: "අ", aa: "ආ", ae: "ඇ", A: "ඇ", aee: "ඈ", Aa: "ඈ", i: "ඉ", ii: "ඊ", ee: "ඊ", u: "උ", uu: "ඌ", e: "එ", E: "ඒ", ai: "ඓ", o: "ඔ", oo: "ඕ", au: "ඖ", R: "ඍ" };
  for (const [latin, si] of Object.entries(ind)) assert.equal(t(latin), si, latin);
  const signs = { ka: "ක", kaa: "කා", kae: "කැ", kaee: "කෑ", ki: "කි", kii: "කී", kee: "කී", ku: "කු", kuu: "කූ", ke: "කෙ", kE: "කේ", kai: "කෛ", ko: "කො", koo: "කෝ", kau: "කෞ", kR: "කෘ" };
  for (const [latin, si] of Object.entries(signs)) assert.equal(t(latin), si, latin);
  assert.equal(t("aiya"), "ඓය");
  assert.equal(t("oyaa"), "ඔයා");
});

test("aspirates: with h or a capital", () => {
  assert.deepEqual(["kh", "gh", "chh", "Ch", "jh", "Th", "dh", "Dh", "ph", "bh", "B", "K", "G", "T", "D", "N", "L", "Sh", "S"].map((l) => t(l + "a")),
    ["ඛ", "ඝ", "ඡ", "ඡ", "ඣ", "ථ", "ද", "ඪ", "ඵ", "භ", "භ", "ඛ", "ඝ", "ඨ", "ඩ", "ණ", "ළ", "ෂ", "ෂ"]);
  assert.equal(t("ta"), "ට");
  assert.equal(t("tha"), "ත");
  assert.equal(t("sha"), "ශ");
});

test("yansaya and rakaransaya join with ZWJ", () => {
  assert.equal(t("vidyaava"), "විද" + "්" + ZWJ + "යාව");
  assert.equal(t("kya"), "ක්" + ZWJ + "ය");
  assert.equal(t("prashnaya"), "ප්" + ZWJ + "රශ්නය");
  assert.equal(t("shrii"), "ශ්" + ZWJ + "රී");
  assert.equal(t("kraa"), "ක්" + ZWJ + "රා");
  assert.equal(t("kaarya"), "කාර්" + ZWJ + "ය", "ra + ya: yansaya on ra");
  // y and r after a vowel are letters of their own
  assert.equal(t("maya"), "මය");
  assert.equal(t("mara"), "මර");
  // the unjoined form is an alternative
  assert.ok(alts("vidyaava").includes("විද්යාව"));
});

test("repaya (ර්‍ + consonant) is an alternative to the plain cluster", () => {
  assert.equal(t("dharmaya"), "දර්මය");
  assert.ok(alts("dharmaya").includes("දර්" + ZWJ + "මය"));
  assert.ok(alts("Dharmaya").includes("ඪර්" + ZWJ + "මය"));
});

test("anusvara, visarga, prenasalised letters and ෘ", () => {
  assert.equal(t("sinhala"), "සින්හල");
  assert.ok(alts("sinhala").includes("සිංහල"));
  assert.equal(t("laxkaa"), "ලංකා", "x is the anusvara");
  assert.equal(t("sing"), "සිං", "ng at the end is ං");
  assert.equal(t("mangala"), "මංගල");
  assert.ok(alts("ganga").includes("ගඟ"));
  assert.ok(alts("sandha").includes("සඳ") || alts("sanda").includes("සඳ"));
  assert.ok(alts("ambaa").includes("අඹා"));
  assert.equal(t("duHkha"), "දුඃඛ");
  assert.equal(t("kRuthiya"), "කෘතිය");
  assert.ok(alts("kruthi").includes("කෘති"));
  assert.ok(!alts("kiyanna").includes("කියංන"), "no anusvara before n");
});

test("ambiguous letters offer the other letters as alternatives", () => {
  const a = alts("tata", 64);
  assert.equal(a[0], "ටට");
  assert.ok(a.includes("තත") && a.includes("ටටා"));
  assert.ok(alts("sala").includes("ශල"));
  assert.ok(alts("lala").includes("ළල"));
  assert.ok(alts("amma").includes("අම්මා"));
  assert.ok(alts("thaththa").includes("තාත්තා"));
});

test("variants are unique, best first, and capped", () => {
  const v = S.variants("prashnaya", 10);
  assert.equal(v.length, 10);
  assert.equal(new Set(v.map((x) => x.text)).size, 10);
  for (let i = 1; i < v.length; i++) assert.ok(v[i].penalty >= v[i - 1].penalty);
  assert.deepEqual(S.variants(""), []);
});

test("transliterate leaves everything but Latin letters as it is", () => {
  assert.equal(t("mama 2026, oba?"), "මම 2026, ඔබ?");
  assert.equal(t("ශ්‍රී"), "ශ්‍රී");
  assert.equal(t(""), "");
});

test("output is NFC and valid Sinhala", () => {
  for (const w of ["shrii lankaava", "vidyaava", "prashnaya", "kaarya", "mangala", "kRuthiya", "aayuboovan", "duHkha"]) {
    for (const v of alts(w, 20)) {
      assert.equal(v, v.normalize("NFC"), v);
      assert.deepEqual(S.validate(v), [], `${w}: ${v}`);
    }
  }
});
