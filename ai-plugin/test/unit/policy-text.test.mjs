// Policy and capabilities for the ribbon (W10), and the text helpers (sentences, transcripts, chunks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const P = lib("policy");
const T = lib("text");

test("policy locks a feature; a missing capability disables with the reason; voice still opens", () => {
  const policy = { managed: true, features: { stt: true, suggestions: false, correction: true, translate: true, tts: true, assistant: true } };
  const info = { capabilities: ["speech.stt", "text.check", "tts"] };
  assert.deepEqual(P.commandState("suggestions", policy, info), { enabled: false, locked: true, reason: "Managed by your organization" });
  assert.equal(P.commandState("improve", policy, info).enabled, false);
  assert.equal(P.commandState("spelling", policy, info).enabled, true);
  assert.equal(P.commandState("voice", policy, { capabilities: [] }).enabled, true);
  assert.equal(P.commandState("improve", null, null).enabled, true); // not reached yet
  assert.equal(P.sinhalaAvailable(info, "stt"), false);
  assert.equal(P.sinhalaAvailable({ capabilities: ["speech.stt.si"] }, "stt"), true);
  assert.equal(P.sinhalaAvailable({ capabilities: ["tts.si"] }, "tts"), true);
});

test("sentences keep their offsets", () => {
  const t = "Hello there. How are you? Fine!\nමම ගෙදර යනවා. Last";
  const s = T.sentences(t);
  assert.deepEqual(s.map((x) => x.text), ["Hello there.", "How are you?", "Fine!", "මම ගෙදර යනවා.", "Last"]);
  for (const x of s) assert.equal(t.slice(x.start, x.start + x.text.length), x.text);
  assert.deepEqual(T.sentences(""), []);
});

test("transcripts: time · text rows and text with timestamps and speakers", () => {
  const segs = [{ start: 0, end: 2, text: " Hello ", speaker: "S1" }, { start: 3725, end: 3730, text: "bye", speaker: "S2" }];
  assert.deepEqual(T.transcriptRows(segs), [["00:00", "Hello"], ["1:02:05", "bye"]]);
  assert.deepEqual(T.transcriptRows(segs, { speakers: true }), [["00:00", "S1: Hello"], ["1:02:05", "S2: bye"]]);
  assert.equal(T.transcriptText(segs), "Hello bye");
  assert.equal(T.transcriptText(segs, { timestamps: true, speakers: true }), "[00:00] S1: Hello\n[1:02:05] S2: bye");
});

test("chunks end at paragraphs and stay under the limit", () => {
  const text = Array.from({ length: 50 }, (_, i) => "Paragraph " + i + " " + "x".repeat(300)).join("\n");
  const c = T.chunks(text, 8000);
  assert.ok(c.length > 1);
  assert.equal(c.map((x) => x.text).join(""), text);
  for (const x of c) { assert.ok(x.text.length <= 8000); assert.equal(text.slice(x.start, x.start + x.text.length), x.text); }
  assert.deepEqual(T.chunks("short"), [{ start: 0, text: "short" }]);
});
