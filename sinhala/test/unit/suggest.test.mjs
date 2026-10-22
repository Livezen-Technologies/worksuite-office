// Candidates: ranking by the word list, completions, learning from the user's picks; the word list's
// sources and their pinned hashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import S from "../../core/dist/src/index.js";
import { buildWordList, readSources, repairJoiners } from "../../scripts/wordlist.mjs";

const words = buildWordList();
const lexicon = new S.Lexicon(words);
const texts = (latin, opts = {}) => S.candidates(latin, { lexicon, ...opts }).map((c) => c.text);
const wordsOf = (latin, opts = {}) => S.candidates(latin, { lexicon, ...opts }).filter((c) => c.kind === "word").map((c) => c.text);

test("the word list: pinned sources, licences recorded, merged most frequent first", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wordlist");
  for (const list of readSources()) {
    assert.ok(list.licence && list.source && list.order, list.file);
    if (list.sha256) assert.equal(createHash("sha256").update(readFileSync(join(dir, list.file))).digest("hex"), list.sha256, list.file);
    if (list.url) assert.match(list.url, /\/[0-9a-f]{40}\//, `${list.file}: pinned to a commit`);
  }
  assert.ok(words.length > 20000);
  assert.equal(new Set(words).size, words.length);
  assert.equal(words[0], "සහ", "WorkSuite's common words come first");
  assert.ok(words.includes("ශ්‍රී"));
  assert.ok(!words.includes("ශ්රී"), "joiners repaired");
  assert.equal(repairJoiners("ප්රශ්නය"), "ප්‍රශ්නය");
  for (const w of words.slice(0, 2000)) assert.deepEqual(S.validate(w), [], w);
});

test("ambiguous romanisations: the word wins over the bare rule, the rule stays on the list", () => {
  assert.deepEqual(wordsOf("amma").slice(0, 2), ["අම්මා", "අම්ම"]);
  assert.equal(wordsOf("thaththa")[0], "තාත්තා");
  assert.ok(wordsOf("thaththa").includes("තත්ත"), "the rule's rendering is always offered");
  assert.equal(wordsOf("sri")[0], "ශ්‍රී");
  assert.equal(wordsOf("lanka")[0], "ලංකා");
  assert.equal(wordsOf("sinhala")[0], "සිංහල");
  assert.equal(wordsOf("kohomadha")[0], "කොහොමද");
  assert.equal(wordsOf("ganga")[0], "ගඟ");
  assert.equal(wordsOf("mage")[0], "මගේ");
  assert.equal(wordsOf("akka")[0], "අක්කා");
});

test("without a word list the rules' order is kept", () => {
  assert.equal(S.candidates("amma")[0].text, "අම්ම");
  assert.ok(S.candidates("amma").every((c) => c.kind === "word"));
  assert.deepEqual(S.candidates("12"), [], "only letters");
});

test("completions: longer words that start with what is typed, most frequent first", () => {
  const c = S.candidates("amm", { lexicon });
  assert.ok(c.some((x) => x.kind === "completion" && x.text === "අම්මා"), "an open final consonant completes");
  const lank = S.candidates("lank", { lexicon }).filter((x) => x.kind === "completion").map((x) => x.text);
  assert.ok(lank.includes("ලංකා") || lank.includes("ලංකාව"), lank.join(" "));
  assert.deepEqual(lexicon.complete("ගෙද", 3)[0], "ගෙදර");
  assert.deepEqual(lexicon.complete(""), []);
  assert.ok(lexicon.complete("අ", 5).length === 5);
  const counts = S.candidates("pas", { lexicon, words: 3, completions: 2 });
  assert.equal(counts.filter((x) => x.kind === "word").length, 3);
  assert.ok(counts.filter((x) => x.kind === "completion").length <= 2);
});

test("learning: a picked word comes first for that input next time, and survives JSON", () => {
  const learner = new S.Learner();
  assert.equal(wordsOf("amma", { learner })[0], "අම්මා");
  learner.record("amma", "අම්ම");
  assert.equal(wordsOf("amma", { learner })[0], "අම්ම");
  const again = new S.Learner(JSON.parse(JSON.stringify(learner.data)));
  assert.equal(wordsOf("amma", { learner: again })[0], "අම්ම");
  assert.equal(again.count("amma", "අම්ම"), 1);
  // a word unknown to the list, learned, is offered first
  learner.record("tata", "තට");
  assert.equal(wordsOf("tata", { learner })[0], "තට");
  learner.forget();
  assert.equal(wordsOf("amma", { learner })[0], "අම්මා");
  assert.deepEqual(new S.Learner({ junk: true }).data.picks, {}, "bad stored data is dropped");
});

test("learning is capped", () => {
  const learner = new S.Learner(undefined, 3);
  for (const w of ["a", "b", "c", "d", "e"]) learner.record(w, "අ" + w);
  assert.equal(Object.keys(learner.data.picks).length, 3);
  assert.equal(Object.keys(learner.data.words).length, 3);
});
