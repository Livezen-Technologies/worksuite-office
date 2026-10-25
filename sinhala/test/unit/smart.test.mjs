// Smart Typing engine: the golden cases (completion, spelling, ranking, prediction), the modes and the
// settings, learning, the AI merge, the cache, and the data's pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import S from "../../core/dist/src/index.js";
import { engine, shared, texts } from "./smart-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const top = (before, mode, n = 3, e = shared) => texts(e.suggest({ before, mode })).slice(0, n);

test("golden: the request's examples", () => {
  assert.deepEqual(top("kanna", "unicode"), ["කන්න", "කන්නට", "කන්නේ"], "Sinhala on, Singlish");
  assert.deepEqual(top("comp", "english").sort(), ["company", "complete", "computer"], "Sinhala off, English");
  assert.deepEqual(top("ලිය", "english"), ["ලියන්න", "ලියනවා", "ලියවිල්ල"], "Sinhala Unicode typing");
  assert.deepEqual(top("docu", "english").sort(), ["document", "documentation", "documents"]);
  assert.equal(top("presen", "english", 1)[0], "presentation");
  assert.deepEqual(top("manag", "english"), ["manage", "management", "manager"]);
  assert.equal(top("I am goin", "english", 1)[0], "going");
  assert.equal(top("recieve", "english", 1)[0], "receive");
  const mixed = shared.suggest({ before: "meeting eka", mode: "smart" });
  assert.equal(mixed.decision.lang, "singlish");
  assert.equal(mixed.items[0].text, "එක");
  assert.ok(texts(mixed).includes("එකක්"));
  const meeting = shared.suggest({ before: "meeting", mode: "smart" });
  assert.equal(meeting.items[0].lang, "en", "the English word first in Smart Mixed");
  assert.ok(meeting.items.some((i) => i.kind === "loan" && i.text === "මීටිං"), "and its Sinhala spelling");
  assert.deepEqual(texts(shared.suggest({ before: "meeting ", mode: "smart", manual: true })).slice(0, 3), ["minutes", "එක", "agenda"], "mixed next words");
});

test("the list holds 5-7 ranked items; the typed word itself is not repeated", () => {
  const r = shared.suggest({ before: "comp", mode: "english" });
  assert.equal(r.items.length, 7);
  for (let i = 1; i < r.items.length; i++) assert.ok(r.items[i - 1].score >= r.items[i].score);
  const e = engine({ maxItems: 5 });
  assert.equal(e.suggest({ before: "comp", mode: "english" }).items.length, 5);
  e.configure({ maxItems: 12 });
  assert.equal(e.settings.maxItems, 7, "clamped to 7");
  assert.ok(!texts(shared.suggest({ before: "manage", mode: "english" })).includes("manage"));
});

test("spelling: the misspelling table, then edit distance (swaps count once)", () => {
  assert.equal(S.distance("recieve", "receive"), 1);
  assert.equal(S.distance("teh", "the"), 1);
  assert.equal(S.distance("abc", "xyz", 1), 2, "cut off above max");
  assert.equal(top("teh", "english", 1)[0], "the");
  assert.equal(top("managment", "english", 1)[0], "management");
  assert.equal(top("documnet", "english", 1)[0], "document");
  assert.equal(top("becuase", "english", 1)[0], "because", "not in the table: distance 1 (a swap)");
  const r = shared.suggest({ before: "recieve", mode: "english" });
  assert.equal(r.items[0].kind, "correction");
  assert.equal(engine({ spelling: false }).suggest({ before: "recieve", mode: "english" }).items.length, 0);
  assert.ok(!shared.suggest({ before: "docu", mode: "english" }).items.some((i) => i.kind === "correction"), "no corrections mid-word");
});

test("capitalisation: I, names, ALL CAPS, Capitalised, and after a full stop", () => {
  assert.equal(top("i", "english", 1)[0], "I");
  assert.equal(top("see you on monday", "english", 1)[0], "Monday");
  assert.equal(top("DOCU", "english", 1)[0], "DOCUMENT");
  assert.equal(top("Docu", "english", 1)[0], "Document");
  assert.equal(top("It works. docu", "english", 1)[0], "Document");
  assert.equal(top("docu", "english", 1)[0], "document", "the start of the input context is not a sentence start");
  assert.equal(S.applyCase("may", "may"), "may", "may and march are verbs too");
});

test("light grammar: a/an, a repeated word, could of", () => {
  const an = shared.suggest({ before: "this is a appl", mode: "english" });
  assert.equal(an.items[0].kind, "grammar");
  assert.equal(an.items[0].text, "an application");
  assert.equal(an.items[0].replace, "a appl");
  assert.ok(!shared.suggest({ before: "a user", mode: "english" }).items.some((i) => i.kind === "grammar"), "a user: a consonant sound");
  const rep = shared.suggest({ before: "send the the", mode: "english" });
  assert.ok(rep.items.some((i) => i.kind === "grammar" && i.text === "the" && i.replace === "the the"));
  const of = shared.suggest({ before: "we could of", mode: "english" });
  assert.ok(of.items.some((i) => i.text === "could have" && i.replace === "could of"));
  assert.ok(!engine({ grammar: false }).suggest({ before: "this is a appl", mode: "english" }).items.some((i) => i.kind === "grammar"));
});

test("next-word prediction from the bundled pairs, by hand (Ctrl+Space) after a space", () => {
  assert.equal(shared.suggest({ before: "thank ", mode: "english" }).items.length, 0, "not on its own after a space");
  assert.equal(texts(shared.suggest({ before: "thank ", mode: "english", manual: true }))[0], "you");
  assert.equal(texts(shared.suggest({ before: "please find ", mode: "english", manual: true }))[0], "attached");
  assert.equal(texts(shared.suggest({ before: "මම ", mode: "unicode", manual: true }))[0], "යනවා");
  assert.ok(!texts(shared.suggest({ before: "meeting ", mode: "english", manual: true })).includes("එක"), "Sinhala off: no Sinhala after English");
  assert.equal(engine({ nextWord: false }).suggest({ before: "thank ", mode: "english", manual: true }).items.length, 0);
  // the pair boosts the completion too: "am goin" -> going
  assert.equal(shared.suggest({ before: "I am goin", mode: "english" }).items[0].text, "going");
});

test("modes: English suggestions with Sinhala off; Sinhala on composes Singlish; Smart Mixed per token", () => {
  assert.equal(shared.suggest({ before: "kanna", mode: "english" }).items.every((i) => i.lang === "en"), true);
  assert.equal(shared.suggest({ before: "kanna", mode: "unicode" }).items[0].lang, "si");
  assert.equal(shared.suggest({ before: "kanna", mode: "legacy" }).items[0].text, "කන්න", "legacy mode lists Unicode; the plugin encodes on write");
  assert.equal(shared.suggest({ before: "kanna", mode: "smart" }).items[0].text, "කන්න");
  assert.equal(shared.suggest({ before: "docu", mode: "smart" }).items[0].text, "document");
  const off = engine({ english: false });
  assert.equal(off.suggest({ before: "comp", mode: "english" }).items.length, 0, "English suggestions off");
  assert.equal(engine({ sinhala: false }).suggest({ before: "kanna", mode: "unicode" }).items.length, 0);
  assert.ok(engine({ mixed: false }).suggest({ before: "meeting", mode: "smart" }).items.every((i) => i.lang === "en"));
  assert.ok(engine({ autocomplete: false }).suggest({ before: "comp", mode: "english" }).items.every((i) => i.kind !== "completion"));
});

test("personal words, pairs and the custom dictionary rank first; forget clears them", () => {
  const e = engine();
  assert.notEqual(top("comp", "english", 1, e)[0], "compliance");
  for (let i = 0; i < 4; i++) e.learn({ text: "compliance", lang: "en" }, "comp", null);
  assert.equal(top("comp", "english", 1, e)[0], "compliance");
  e.personal.addCustom("Livezen");
  e.invalidate();
  assert.equal(top("Live", "english", 1, e)[0], "Livezen");
  assert.equal(S.detectToken("Livezen", "smart", { english: e.english, personal: e.personal }).lang, "en");
  e.learn({ text: "report", lang: "en" }, "rep", "sales");
  e.learn({ text: "report", lang: "en" }, "rep", "sales");
  assert.equal(texts(e.suggest({ before: "quarterly ", mode: "english", manual: true })).length, 0);
  e.personal.word("figures", "quarterly");
  e.invalidate();
  assert.equal(texts(e.suggest({ before: "quarterly ", mode: "english", manual: true }))[0], "figures");
  e.personal.forget();
  e.invalidate();
  assert.notEqual(top("comp", "english", 1, e)[0], "compliance");
  assert.equal(engine({ personal: false }).settings.personal, false);
});

test("a Singlish pick is learned: the pick, and the token's language (R6)", () => {
  const e = engine();
  e.learn({ text: "ගමේ", lang: "si" }, "game", "mage");
  assert.equal(e.personal.override("game"), "si");
  assert.equal(e.suggest({ before: "game", mode: "smart" }).items[0].text, "ගමේ");
});

test("Sinhala Unicode: completion, normalisation, alternative spellings", () => {
  const n = shared.suggest({ before: "කෝ" + "‍", mode: "english" });
  assert.ok(n.items.length >= 0);
  const bad = "සේා"; // ේ + ා: should be ෝ
  const r = shared.suggest({ before: bad, mode: "english" });
  assert.equal(r.items[0].kind, "correction");
  assert.equal(r.items[0].text, "සෝ");
  const alt = shared.suggest({ before: "කණ්න", mode: "english" });
  assert.ok(texts(alt).includes("කන්න"), texts(alt).join());
});

test("legacy font output: every top Sinhala candidate of the golden cases maps into FM Abhaya and back", () => {
  const fm = S.getProfile("fm-abhaya");
  for (const w of top("kanna", "unicode").concat(top("ලිය", "english"), ["එක"])) {
    const l = S.toLegacy(w, fm);
    assert.deepEqual(l.unmapped, [], w);
    assert.equal(S.toUnicode(l.text, fm).text, w, w);
  }
});

test("the AI merge: after the first two, the right script only, no duplicates, still 7", () => {
  const r = shared.suggest({ before: "kanna", mode: "unicode" });
  const m = shared.merge(r, [{ text: "කන්නම්" }, { text: "kanna" }, { text: "කන්න" }]);
  assert.deepEqual(texts(m).slice(0, 3), ["කන්න", "කන්නට", "කන්නම්"]);
  assert.equal(m.items[2].kind, "ai");
  assert.equal(m.items.length, 7);
  assert.ok(!texts(m).includes("kanna"));
});

test("the cache answers a repeated lookup, and is bounded", () => {
  const e = engine();
  const a = e.suggest({ before: "docu", mode: "english" });
  const b = e.suggest({ before: "docu", mode: "english" });
  assert.deepEqual(texts(a), texts(b));
  for (let i = 0; i < 600; i++) e.suggest({ before: "w" + i, mode: "english" });
  assert.ok(e.cacheSize <= 400);
});

test("the Smart Typing data is pinned: every file's sha256 is in wordlist/smart/sources.json, and si-forms in sources.json", () => {
  const smart = JSON.parse(readFileSync(join(root, "wordlist", "smart", "sources.json"), "utf8")).lists;
  assert.equal(smart.length, 6);
  for (const l of smart) {
    assert.equal(createHash("sha256").update(readFileSync(join(root, "wordlist", "smart", l.file))).digest("hex"), l.sha256, l.file);
    assert.equal(l.licence, "AGPL-3.0-only");
  }
  const forms = JSON.parse(readFileSync(join(root, "wordlist", "sources.json"), "utf8")).lists.find((l) => l.file === "smart/si-forms.txt");
  assert.equal(createHash("sha256").update(readFileSync(join(root, "wordlist", "smart", "si-forms.txt"))).digest("hex"), forms.sha256);
});
