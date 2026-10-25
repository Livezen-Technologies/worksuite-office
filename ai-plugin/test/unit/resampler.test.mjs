// The microphone path: resampling to 16 kHz s16le frames, levels, WAV encoding and joining, the lag watch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { Resampler, toS16, rms, meterLevel, encodeWav, readWav, concatWav, LagWatch } = lib("resampler");

const sine = (rate, hz, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate));
const all = (frames) => { const n = frames.reduce((s, f) => s + f.length, 0); const out = new Int16Array(n); let o = 0; for (const f of frames) { out.set(f, o); o += f.length; } return out; };
const crossings = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };

for (const rate of [48000, 44100, 22050, 16000, 8000]) {
  test(`${rate} Hz -> 16 kHz keeps length and pitch, in 40 ms frames`, () => {
    const r = new Resampler(rate, 16000, 40);
    const frames = r.push(sine(rate, 440, 1));
    for (const f of frames) assert.equal(f.length, 640);
    const last = r.flush();
    const out = all(last ? frames.concat([last]) : frames);
    assert.ok(Math.abs(out.length - 16000) <= 640 + 2, `got ${out.length}`);
    const hz = crossings(out) / 2 / (out.length / 16000);
    assert.ok(Math.abs(hz - 440) < 6, `pitch ${hz}`);
    assert.ok(Math.abs(rms(out) - 0.5 / Math.SQRT2) < 0.03, `level ${rms(out)}`);
  });
}

test("any chunking gives the same samples", () => {
  const input = sine(48000, 1000, 0.5);
  const a = new Resampler(48000, 16000, 20), b = new Resampler(48000, 16000, 20);
  const fa = all(a.push(input));
  const fb = [];
  for (let i = 0; i < input.length; i += 128) fb.push(...b.push(input.subarray(i, i + 128)));
  assert.deepEqual(Array.from(all(fb)), Array.from(fa));
});

test("downsampling filters what 16 kHz cannot hold (a 7.9 kHz tone at 48 kHz is attenuated)", () => {
  const r = new Resampler(48000, 16000, 40);
  const out = all(r.push(sine(48000, 7900, 0.5, 0.9)));
  assert.ok(rms(out) < 0.9 / Math.SQRT2 * 0.5, `rms ${rms(out)}`);
});

test("s16 conversion clips and scales", () => {
  assert.equal(toS16(1), 32767);
  assert.equal(toS16(-1), -32768);
  assert.equal(toS16(2), 32767);
  assert.equal(toS16(0), 0);
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(1), 1);
  assert.ok(meterLevel(0.01) > 0.3 && meterLevel(0.01) < 0.4);
});

test("WAV: encode, read back, join", () => {
  const a = Int16Array.from([1, 2, 3]), b = Int16Array.from([4, 5]);
  const w1 = encodeWav([a], 16000), w2 = encodeWav([b], 16000);
  const r = readWav(w1);
  assert.deepEqual(r.fmt, { format: 1, channels: 1, rate: 16000, bits: 16 });
  const joined = readWav(concatWav([w1, w2]));
  assert.deepEqual(Array.from(new Int16Array(joined.data.slice().buffer)), [1, 2, 3, 4, 5]);
  assert.throws(() => concatWav([w1, encodeWav([b], 22050)]), /differ/);
  assert.throws(() => readWav(new ArrayBuffer(4)), /not a WAV/);
});

test("the lag watch: too slow only when finals lag more and more", () => {
  const w = new LagWatch(8);
  w.audio(16000 * 5, 16000); w.final(4);
  assert.equal(w.tooSlow(), false);
  w.audio(16000 * 10, 16000); w.final(5);
  assert.equal(w.tooSlow(), true);
  const ok = new LagWatch(8);
  ok.audio(16000 * 20, 16000); ok.final(19);
  assert.equal(ok.tooSlow(), false);
});
