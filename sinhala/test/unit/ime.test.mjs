// The input method's state machine: what it does with the editor's input helper events.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";
import { buildWordList } from "../../scripts/wordlist.mjs";

const lexicon = new S.Lexicon(buildWordList());
const make = (opts = {}) => new S.SinhalaIme({ lexicon, learner: new S.Learner(), ...opts });
const types = (actions) => actions.map((a) => a.type);
const typeWord = (ime, word) => { let last; for (let i = 1; i <= word.length; i++) last = ime.input(word.slice(0, i)); return last; };

test("typing shows the candidate window with the composition", () => {
  const ime = make();
  const a = typeWord(ime, "amma");
  assert.equal(a[0].type, "show");
  assert.equal(a[0].latin, "amma");
  assert.equal(a[0].items[0].text, "අම්මා");
  assert.equal(a[0].selected, 0);
  assert.ok(ime.isVisible);
});

test("Space writes the highlighted candidate over the Latin, keeping the space, and learns", () => {
  const ime = make();
  typeWord(ime, "amma");
  const a = ime.input("amma ");
  assert.deepEqual(types(a), ["hide", "input", "learned"]);
  assert.deepEqual(a[1], { type: "input", text: "අම්මා ", replace: "amma " });
  assert.ok(!ime.isVisible);
  assert.deepEqual(ime.cleared(), [], "the editor clearing after our input does nothing");
  assert.equal(ime.input("අම්මා ").length, 0);
});

test("punctuation commits too; a number picks that candidate", () => {
  const ime = make();
  typeWord(ime, "amma");
  assert.deepEqual(ime.input("amma,").find((x) => x.type === "input"), { type: "input", text: "අම්මා,", replace: "amma," });
  typeWord(ime, "amma");
  assert.deepEqual(ime.input("amma2").find((x) => x.type === "input"), { type: "input", text: "අම්ම", replace: "amma2" });
  typeWord(ime, "amma");
  assert.deepEqual(types(ime.input("amma9")).includes("input"), ime.items.length >= 9);
});

test("arrows, Tab, Home and End move the highlight; Enter writes it; Esc keeps the Latin", () => {
  const ime = make();
  typeWord(ime, "lanka");
  assert.equal(ime.key(40)[0].selected, 1);
  assert.equal(ime.key(9)[0].selected, 2);
  assert.equal(ime.key(38)[0].selected, 1);
  assert.equal(ime.key(36)[0].selected, 0);
  assert.equal(ime.key(35)[0].selected, ime.items.length - 1);
  ime.key(36);
  ime.key(40);
  const second = ime.items[1].text;
  const a = ime.key(13);
  assert.deepEqual(a.find((x) => x.type === "input"), { type: "input", text: second, replace: "lanka" });
  typeWord(ime, "lanka");
  assert.deepEqual(ime.key(27), [{ type: "hide", clear: true }]);
  assert.ok(!ime.isVisible);
  assert.deepEqual(ime.key(13), [], "keys do nothing with the window closed");
});

test("a click picks a candidate", () => {
  const ime = make();
  typeWord(ime, "mama");
  assert.deepEqual(ime.pick(0).find((x) => x.type === "input"), { type: "input", text: "මම", replace: "mama" });
  assert.deepEqual(ime.pick(0), []);
});

test("Backspace edits the composition in documents (resync with the word before the cursor)", () => {
  const ime = make({ canResync: true });
  typeWord(ime, "ammaa");
  assert.deepEqual(ime.cleared(), [{ type: "resync" }]);
  const r = ime.resync("amma");
  assert.equal(r[0].type, "show");
  assert.equal(r[0].latin, "amma");
  // the editor's text starts again after the clear: the new letters continue the word
  const a = ime.input("u");
  assert.equal(a[0].latin, "ammau");
  assert.deepEqual(ime.input("u ").find((x) => x.type === "input").replace, "ammau ");
});

test("a clear that is not Backspace ends the composition", () => {
  const ime = make({ canResync: true });
  typeWord(ime, "amma");
  ime.cleared();
  assert.deepEqual(ime.resync("ammaxyz"), [{ type: "hide", clear: undefined }]);
  const ime2 = make({ canResync: false });
  typeWord(ime2, "amma");
  assert.deepEqual(types(ime2.cleared()), ["hide"]);
});

test("other text hides the window; stop() closes it", () => {
  const ime = make();
  typeWord(ime, "amma");
  assert.deepEqual(ime.input("amma-xy")[0].latin, "xy", "a new word after a hyphen");
  assert.deepEqual(types(ime.input("12")), ["hide"]);
  typeWord(ime, "oba");
  assert.deepEqual(ime.stop(), [{ type: "hide", clear: true }]);
});

test("the learned pick ranks first next time", () => {
  const learner = new S.Learner();
  const ime = make({ learner });
  typeWord(ime, "amma");
  ime.input("amma2");
  const a = typeWord(ime, "amma");
  assert.equal(a[0].items[0].text, "අම්ම");
});
