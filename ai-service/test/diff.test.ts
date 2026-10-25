import { describe, expect, it } from "vitest";
import { applyEdits, wordDiff } from "../src/text/diff";
import { validateModelEdits } from "../src/text/service";

describe("word diff", () => {
  const cases: [string, string][] = [
    ["I has a bad day.", "I had a good day."],
    ["The quick brown fox", "A quick red fox jumps"],
    ["", "new text"],
    ["remove all of this", ""],
    ["ශ්‍රී ලංකාව ලස්සනයි", "ශ්‍රී ලංකාව ඉතා ලස්සනයි"],
    ["same", "same"],
    ["Hello,world", "Hello, world!"],
  ];
  it.each(cases)("edits turn %j into %j", (a, b) => {
    const edits = wordDiff(a, b, "improve");
    expect(applyEdits(a, edits)).toBe(b);
    for (const e of edits) { expect(e.start).toBeLessThanOrEqual(e.end); expect(e.end).toBeLessThanOrEqual(a.length); expect(e.reason).toBe("improve"); }
  });
  it("marks only the changed words", () => {
    expect(wordDiff("I has a bad day.", "I had a good day.", "improve")).toEqual([
      { start: 2, end: 5, replacement: "had", reason: "improve" },
      { start: 8, end: 11, replacement: "good", reason: "improve" },
    ]);
  });
});

describe("model edit validation", () => {
  const text = "I dont know, she said.";
  it("keeps edits whose original matches, relocates wrong offsets, drops the rest", () => {
    const reply = JSON.stringify({ edits: [
      { start: 2, end: 6, original: "dont", replacement: "don't", kind: "grammar", message: "m" },
      { start: 9, end: 13, original: "know", replacement: "knew", kind: "grammar", message: "relocated" },
      { start: 0, end: 1, original: "xyz", replacement: "q", kind: "grammar" },
      { start: 0, end: 1, original: "I", replacement: "I", kind: "grammar" },
      { start: 0, end: 1, original: "I", replacement: "We", kind: "spelling" },
      { start: "a", end: 3, original: "she", replacement: "He", kind: "grammar" },
    ] });
    const out = validateModelEdits(text, "Sure! ```json\n" + reply + "\n```", ["grammar"])!;
    expect(out.map((i) => [i.start, i.end, i.replacements[0]])).toEqual([[2, 6, "don't"], [7, 11, "knew"], [13, 16, "He"]]);
  });
  it("rejects malformed output", () => {
    expect(validateModelEdits(text, "I think it's fine", ["grammar"])).toBeNull();
    expect(validateModelEdits(text, '{"changes": []}', ["grammar"])).toBeNull();
    expect(validateModelEdits(text, '{"edits": [', ["grammar"])).toBeNull();
  });
  it("drops ambiguous relocations", () => {
    expect(validateModelEdits("a a", JSON.stringify({ edits: [{ start: 9, end: 10, original: "a", replacement: "b", kind: "grammar" }] }), ["grammar"])).toEqual([]);
  });
});
