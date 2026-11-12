// Speech is cut at pauses before recognition (splitOnSilence), and whisper-server runs without
// timestamps: a Whisper model fine-tuned on short Sinhala clips stops early in a 30 s window, and with
// timestamps whisper-server split Sinhala characters across segments (U+FFFD in the text).
import { describe, expect, it } from "vitest";
import { splitOnSilence, RATE } from "../src/audio";
import { tone, silence } from "./helpers/harness";

const sec = (b: number) => b / 2 / RATE;

describe("splitOnSilence", () => {
  it("one piece per utterance, cut in the pauses, the silences left out", () => {
    const pcm = Buffer.concat([silence(1500), tone(3000), silence(1500), tone(4000), silence(1500), tone(2000), silence(1500)]);
    const pieces = splitOnSilence(pcm);
    expect(pieces).toHaveLength(3);
    // the utterance starts at 1.5 s; its piece ~300 ms before
    expect(sec(pieces[0].off)).toBeGreaterThan(1.1);
    expect(sec(pieces[0].off)).toBeLessThan(1.3);
    // each piece: its utterance (2-4 s) and at most ~0.8 s of silence
    for (const p of pieces) expect(sec(p.len)).toBeLessThan(4.9);
    expect(sec(pieces[1].off)).toBeGreaterThan(sec(pieces[0].off + pieces[0].len));
  });
  it("a short breath inside a sentence does not cut it", () => {
    const pcm = Buffer.concat([tone(2000), silence(250), tone(2000)]);
    expect(splitOnSilence(pcm)).toHaveLength(1);
  });
  it("speech with no pause is cut before the maximum length", () => {
    const pieces = splitOnSilence(tone(60000), { maxMs: 25000 });
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) expect(sec(p.len)).toBeLessThanOrEqual(25.1);
    const total = pieces.reduce((s, p) => s + p.len, 0);
    expect(sec(total)).toBeGreaterThan(59);
  });
  it("silence alone gives nothing to recognise", () => {
    expect(splitOnSilence(silence(5000))).toEqual([]);
  });
});

describe("audioCtxFor", () => {
  it("sizes whisper's window to the audio, with a margin, and uses the whole window from 30 s on", async () => {
    const { audioCtxFor } = await import("../src/engines/clients");
    const { pcmToWav } = await import("../src/audio");
    expect(audioCtxFor(pcmToWav(tone(6000)))).toBe(Math.ceil((6 / 30) * 1500) + 64);
    expect(audioCtxFor(pcmToWav(tone(29000)))).toBe(1500);
    expect(audioCtxFor(pcmToWav(tone(30000)))).toBe(0);
  });
});

describe("splitOnSilence: padding and clicks", () => {
  it("keeps silence around each utterance and leaves out a click", () => {
    // utterance, 1.5 s pause, a 80 ms click, 2 s pause, utterance
    const pcm = Buffer.concat([silence(1000), tone(3000), silence(1500), tone(80), silence(2000), tone(3000), silence(1000)]);
    const pieces = splitOnSilence(pcm);
    expect(pieces).toHaveLength(2);
    // ~300 ms before, ~500 ms after
    expect(sec(pieces[0].off)).toBeCloseTo(0.7, 1);
    expect(sec(pieces[0].off + pieces[0].len)).toBeGreaterThan(4.35);
  });
});
