// The mixed-language detection rules of docs/sinhala/smart-typing.md, one test (or more) per rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";
import { shared } from "./smart-data.mjs";

const ctx = (extra = {}) => ({ english: shared.english, sinhala: shared.sinhala, markers: shared.markers, ...extra });
const det = (t, mode = "smart", extra) => S.detectToken(t, mode, ctx(extra));

test("R1: Sinhala script anywhere in the token is Sinhala Unicode, in every mode", () => {
  for (const mode of ["english", "unicode", "legacy", "smart"]) {
    assert.deepEqual([det("ලිය", mode).lang, det("ලිය", mode).rule], ["si", "R1"]);
  }
  assert.equal(det("ශ්‍රී").lang, "si");
  assert.equal(det("xඩ").lang, "si", "mixed script counts as Sinhala");
});

test("R2: URLs, e-mail addresses, numbers and file names stay English, even with Sinhala input on", () => {
  for (const t of ["https://worksuite.lk", "www.example", "a.perera@mail.lk", "2026", "v10", "report.docx", "budget.xlsx"]) {
    for (const mode of ["unicode", "smart"]) assert.deepEqual([det(t, mode).lang, det(t, mode).rule], ["en", "R2"], t + " " + mode);
  }
});

test("R3: acronyms and capitalised words inside a sentence stay English (Smart Mixed); a sentence start does not count", () => {
  assert.deepEqual([det("PDF").lang, det("PDF").rule], ["en", "R3"]);
  assert.deepEqual([det("Kamal").lang, det("Kamal").rule], ["en", "R3"]);
  assert.notEqual(det("Kamal", "smart", { sentenceStart: true }).rule, "R3");
  assert.equal(det("PDF", "unicode").lang, "singlish", "with Sinhala input on, capitals are Singlish letters (T ඨ)");
});

test("R4: punctuation and symbols are neither language", () => {
  for (const t of ["...", "—", "&", "(:"]) assert.deepEqual([det(t).lang, det(t).rule], ["other", "R4"], t);
});

test("R5: outside Smart Mixed the mode decides: English with Sinhala off, Singlish with it on", () => {
  assert.deepEqual([det("kanna", "english").lang, det("kanna", "english").rule], ["en", "R5"]);
  assert.deepEqual([det("meeting", "unicode").lang, det("meeting", "unicode").rule], ["singlish", "R5"]);
  assert.equal(det("comp", "legacy").lang, "singlish");
});

test("R6: what the user settled for a token wins over the scores", () => {
  const personal = new S.Personal();
  assert.equal(det("game", "smart", { personal }).lang, "en");
  personal.confirm("game", "si");
  assert.deepEqual([det("game", "smart", { personal }).lang, det("game", "smart", { personal }).rule], ["singlish", "R6"]);
  personal.confirm("game", "en");
  assert.notEqual(det("game", "smart", { personal }).rule, "R6", "equal counts: not settled");
  personal.confirm("game", "en");
  assert.deepEqual([det("game", "smart", { personal }).lang, det("game", "smart", { personal }).rule], ["en", "R6"]);
});

test("R7: code-switch markers are Singlish, after English too", () => {
  for (const t of ["eka", "ekak", "kiyala", "nam", "da", "ne", "wage", "gena"]) {
    assert.deepEqual([det(t, "smart", { previous: ["en", "en", "en"] }).lang, det(t).rule], ["singlish", "R7"], t);
  }
});

test("R8: colloquial Singlish spellings that are not common English words are Singlish", () => {
  for (const t of ["mama", "oya", "kohomada", "mokakda"]) assert.deepEqual([det(t).lang, det(t).rule], ["singlish", "R8"], t);
  assert.notEqual(det("api").rule, "R8", "api is a common (technical) English word");
});

test("R9: English and Singlish scores with a 0.2 margin", () => {
  assert.equal(S.THRESHOLD, 0.2);
  // common English: e = 1
  assert.equal(S.englishScore("meeting", ctx()), 1);
  assert.equal(S.englishScore("aardvark", ctx()), 0.8, "SCOWL only");
  assert.equal(S.englishScore("docu", ctx()), 0.5, "the start of a word");
  assert.equal(S.englishScore("kanna", ctx()), 0);
  // Singlish: a rendering in the Sinhala word list, or the letters
  assert.equal(S.singlishScore("kanna", ctx()), 0.75);
  assert.equal(S.phonotactic("gedara"), 0.5);
  assert.equal(S.phonotactic("karanawa"), 0.65);
  assert.equal(S.phonotactic("street"), 0.1, "three consonants in a row: 0.3 + 0.1 (ee) - 0.3");
  assert.equal(S.phonotactic("quick"), 0);
  const k = det("kanna");
  assert.deepEqual([k.lang, k.rule], ["singlish", "R9"]);
  const m = det("meeting");
  assert.deepEqual([m.lang, m.rule], ["en", "R9"]);
  assert.deepEqual([det("comp").lang, det("comp").rule], ["en", "R9"], "0.3 - 0.5 = -0.2: exactly the margin");
});

test("R10: a tie follows the previous three tokens, nearest weighing most", () => {
  assert.deepEqual(S.CONTEXT_WEIGHTS, [1, 0.6, 0.3]);
  assert.equal(S.contextLean(["en", "en", "singlish"]), 0.05);
  assert.equal(S.contextLean(["singlish", "singlish", "en"]), -0.05);
  assert.equal(S.contextLean(["si", "singlish"]), 1);
  assert.equal(S.contextLean(["en", "en", "en", "singlish"]).toFixed(2), "0.05", "only the last three");
  // "api": e 1 (a common technical word), s 1 (colloquial අපි) -> a tie
  assert.equal(det("api", "smart", { previous: ["singlish", "singlish"] }).rule, "R10");
  assert.equal(det("api", "smart", { previous: ["singlish", "singlish"] }).lang, "singlish");
  assert.equal(det("api", "smart", { previous: ["en"] }).lang, "en");
  assert.equal(det("api", "smart", { previous: ["singlish", "singlish", "en"] }).rule, "R11", "a lean of -0.05 is under 0.3");
});

test("R11: a tie with no leaning context is English, and marked ambiguous", () => {
  const d = det("api");
  assert.deepEqual([d.lang, d.rule, d.ambiguous], ["en", "R11", true]);
});

test("R12: one letter is English (a, I)", () => {
  assert.deepEqual([det("a").lang, det("a").rule], ["en", "R12"]);
  assert.deepEqual([det("I").lang, det("I").rule], ["en", "R12"]);
});

test("words that are both: game and tea are English first, game offers Sinhala second, mama is Singlish", () => {
  const game = shared.suggest({ before: "the game", mode: "smart" });
  assert.equal(game.decision.lang, "en");
  assert.equal(game.decision.ambiguous, true);
  assert.equal(game.items[0].lang, "en");
  assert.equal(game.items[1].lang, "si", "the Sinhala reading is offered second");
  const tea = shared.suggest({ before: "tea", mode: "smart" });
  assert.equal(tea.decision.ambiguous, false);
  assert.ok(tea.items.every((i) => i.lang === "en"));
  const mama = shared.suggest({ before: "mama", mode: "smart" });
  assert.equal(mama.items[0].text, "මම");
  // api: a tie, English first with no context; after Sinhala words, Sinhala first
  assert.equal(shared.suggest({ before: "api", mode: "smart" }).items[0].lang, "en");
  assert.equal(shared.suggest({ before: "mama oya api", mode: "smart" }).items[0].text, "අපි");
});

test("the worked examples of docs/sinhala/smart-typing.md §2.7", () => {
  const rows = [
    ["meeting", "R9", "en", ["meetings", "මීටිං", "මීටින්ග්"]],
    ["meeting eka", "R7", "singlish", ["එක", "එක්ක", "එකක්"]],
    ["kanna", "R9", "singlish", ["කන්න", "කන්නට", "කන්නේ"]],
    ["docu", "R9", "en", ["document", "documents", "documentation"]],
    ["send to Kamal", "R3", "en", []],
    ["see report.docx", "R2", "en", []],
    ["PDF", "R3", "en", []],
    ["the game", "R9", "en", ["games", "ගමෙ", "ගමේ"]],
    ["tea", "R9", "en", ["team", "tear", "teach"]],
    ["api", "R11", "en", ["api", "අපි", "අපිම"]],
    ["mama oya api", "R10", "singlish", ["අපි"]],
    ["ලිය", "R1", "si", ["ලියන්න", "ලියනවා", "ලියවිල්ල"]]
  ];
  for (const [before, rule, lang, top] of rows) {
    const r = shared.suggest({ before, mode: "smart" });
    assert.deepEqual([r.decision.rule, r.decision.lang], [rule, lang], before);
    assert.deepEqual(r.items.slice(0, top.length).map((i) => i.text), top, before);
  }
});
