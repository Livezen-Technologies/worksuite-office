// Edits: fingerprints, normalising, diffs, rebasing, undo, and applying them in a (fake) ONLYOFFICE document.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lib, src } from "./helpers.mjs";

const E = lib("edits");

test("fingerprint: length, hash and paragraph ids", () => {
  assert.equal(E.hash(""), "811c9dc5");
  assert.notEqual(E.hash("abc"), E.hash("abd"));
  assert.equal(E.fingerprint("abc", "p1", "p2"), "3:" + E.hash("abc") + ":p1:p2");
  assert.notEqual(E.fingerprint("abc", "p1", "p2"), E.fingerprint("abc", "p1", "p3"));
});

test("normalize: sorted, clipped, no overlaps or no-ops, originals kept", () => {
  const t = "The cat sat.";
  const n = E.normalize(t, [{ start: 8, end: 11, replacement: "sits" }, { start: 4, end: 7, replacement: "cat" }, { start: 0, end: 3, replacement: "A" }, { start: 1, end: 5, replacement: "x" }, { start: 10, end: 99, replacement: "!" }]);
  assert.deepEqual(n.map((e) => [e.start, e.end, e.replacement, e.original]), [[0, 3, "A", "The"], [8, 11, "sits", "sat"]]);
});

test("check issues become edits from their first replacement", () => {
  const t = "teh cat ,";
  const edits = E.fromIssues(t, [{ start: 0, end: 3, kind: "spelling", message: "Spelling", replacements: ["the", "tea"] }, { start: 4, end: 7, message: "no fix", replacements: [] }]);
  assert.equal(edits.length, 1);
  assert.equal(E.apply(t, edits), "the cat ,");
  assert.equal(edits[0].reason, "Spelling");
});

test("diff: a result without edits becomes word edits that rebuild it", () => {
  for (const [a, b] of [["The quick brown fox jumps.", "The fast brown fox leaps over."], ["a b c", "a b c"], ["", "new text"], ["remove all of this", ""], ["මම ගෙදර යනවා", "මම නිවසට යනවා"]]) {
    const d = E.diff(a, b);
    assert.equal(E.apply(a, d), b, `${a} -> ${b}`);
  }
  assert.equal(E.diff("The quick brown fox", "The fast brown fox").length, 1);
});

test("accepting one edit rebases the others; invert undoes it", () => {
  const t = "teh cat sat on teh mat";
  const edits = E.fromIssues(t, [{ start: 0, end: 3, replacements: ["the"], message: "" }, { start: 15, end: 18, replacements: ["the"], message: "" }, { start: 4, end: 7, replacements: ["kitten"], message: "" }]);
  const [first] = edits.filter((e) => e.original === "cat");
  const after = E.apply(t, [first]);
  assert.equal(after, "teh kitten sat on teh mat");
  const rest = E.rebase(edits, first);
  assert.equal(E.apply(after, rest), "the kitten sat on the mat");
  assert.equal(E.apply(after, [E.invert(first)]), t);
});

test("insertions are widened to a character so a range can address them", () => {
  const w = E.widen("abc", { start: 2, end: 2, replacement: "X", original: "" });
  assert.deepEqual([w.start, w.end, w.original, w.replacement], [1, 2, "b", "bX"]);
  const z = E.widen("abc", { start: 0, end: 0, replacement: "X", original: "" });
  assert.deepEqual([z.start, z.end, z.original, z.replacement], [0, 1, "a", "Xa"]);
});

test("side by side: the same text and the marked changes", () => {
  const t = "a b c";
  const parts = E.sideBySide(t, E.normalize(t, [{ start: 2, end: 3, replacement: "B" }]));
  assert.deepEqual(parts.map((p) => [p.kind, p.before, p.after]), [["same", "a ", "a "], ["change", "b", "B"], ["same", " c", " c"]]);
});

// --- a fake ONLYOFFICE document: text with paragraph marks, runs with a "bold" property ---------------
function fakeApi(text, opts = {}) {
  const inclusive = !!opts.inclusive;
  const doc = { chars: [...text].map((c) => ({ c, bold: false })), track: !!opts.track, ops: [] };
  (opts.bold || []).forEach(([s, e]) => { for (let i = s; i < e; i++) doc.chars[i].bold = true; });
  const str = () => doc.chars.map((x) => x.c).join("");
  const paraIds = () => { const ids = []; let id = 0; for (const x of doc.chars) { ids.push("p" + id); if (x.c === "\n") id++; } ids.push("p" + id); return ids; };
  function range(s, e) { // [s, e) internally
    return {
      GetText: () => str().slice(s, e),
      GetStartPos: () => s,
      GetEndPos: () => (inclusive ? e - 1 : e),
      GetAllParagraphs: () => { const ids = paraIds(); const a = ids[s], b = ids[Math.max(s, e - 1)]; return [{ GetInternalId: () => a }, { GetInternalId: () => b }]; },
      Delete: () => { doc.ops.push(["delete", s, e]); doc.chars.splice(s, e - s); },
      AddText: (t, where) => { assert.equal(where, "before"); const bold = doc.chars[s] ? doc.chars[s].bold : false; doc.ops.push(["add", s, t]); doc.chars.splice(s, 0, ...[...t].map((c) => ({ c, bold }))); },
      Select: () => {}
    };
  }
  const api = {
    GetDocument: () => ({
      GetRange: (s, e) => (s === undefined ? range(0, doc.chars.length) : range(s, inclusive ? e + 1 : e)),
      GetRangeBySelect: () => range(opts.sel[0], opts.sel[1]),
      IsTrackRevisions: () => doc.track
    })
  };
  return { api, doc, str, bold: () => doc.chars.map((x) => (x.bold ? "B" : ".")).join("") };
}

for (const inclusive of [false, true]) {
  test(`applyInDocument (${inclusive ? "inclusive" : "exclusive"} range ends): every span, last first, formatting kept`, () => {
    const text = "Intro.\nteh cat sat on teh mat\nEnd.";
    const f = fakeApi(text, { inclusive, sel: [7, 29], bold: [[11, 14]] }); // "cat" is bold
    const target = E.readTarget(f.api, false);
    assert.equal(target.text, "teh cat sat on teh mat");
    const edits = E.normalize(target.text, [{ start: 0, end: 3, replacement: "the" }, { start: 4, end: 7, replacement: "dog" }, { start: 15, end: 18, replacement: "the" }, { start: 22, end: 22, replacement: "!" }]);
    const res = E.applyInDocument(f.api, { target, edits });
    assert.equal(res.ok, true);
    assert.equal(f.str(), "Intro.\nthe dog sat on the mat!\nEnd.");
    assert.equal(f.bold().slice(11, 14), "BBB"); // "dog" took the run properties of "cat"
    assert.equal(res.target.text, "the dog sat on the mat!");
    // a second accept against the returned target works too (fingerprint follows)
    const again = E.applyInDocument(f.api, { target: res.target, edits: E.normalize(res.target.text, [{ start: 4, end: 7, replacement: "cat" }]) });
    assert.equal(again.ok, true);
    assert.equal(f.str(), "Intro.\nthe cat sat on the mat!\nEnd.");
  });
}

test("applyInDocument refuses when the text changed (fingerprint), and changes nothing", () => {
  const f = fakeApi("teh cat", { sel: [0, 7] });
  const target = E.readTarget(f.api, false);
  f.doc.chars.splice(0, 1, { c: "T", bold: false }); // the user typed
  const res = E.applyInDocument(f.api, { target, edits: E.normalize(target.text, [{ start: 0, end: 3, replacement: "the" }]) });
  assert.deepEqual(res, { ok: false, reason: "changed" });
  assert.equal(f.str(), "Teh cat");
});

test("applyInDocument without positions is unsupported; track changes is reported, never changed", () => {
  const f = fakeApi("abc", { sel: [0, 3], track: true });
  const target = E.readTarget(f.api, false);
  assert.equal(target.track, true);
  assert.deepEqual(E.applyInDocument(f.api, { target: Object.assign({}, target, { startPos: null }), edits: [] }), { ok: false, reason: "unsupported" });
  assert.equal(f.doc.track, true);
});

test("the factory runs on its own, as the editor command evaluates it", () => {
  const code = readFileSync(join(src, "lib", "edits.js"), "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  const L = vm.runInContext("(" + ctx.__wsAiEditsFactory.toString() + ")()", vm.createContext({}));
  assert.equal(L.hash("abc"), E.hash("abc"));
});
