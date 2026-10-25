import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Harness, start, tone, silence, STD_MODELS } from "./helpers/harness";
import { pcmToWav, wavTo16k, floatToS16 } from "../src/audio";

let h: Harness;
const siModel = { id: "whisper-si-gated", tasks: ["stt"], engine: "whisper.cpp", languages: ["en", "si"], files: { "g.bin": Buffer.alloc(10, 1) }, evaluation: { si: { wer: 0.2, set: "ws-si-stt-v1" } } };
const diar = { id: "diar-test", tasks: ["diarization", "stt"], engine: "whisper.cpp", files: { "d.bin": Buffer.alloc(10, 2) } };
beforeAll(async () => {
  h = await start({ models: [...STD_MODELS, siModel, diar] });
  expect((await h.install("whisper-test")).state).toBe("done");
});
afterAll(async () => { await h.close(); });

function open(query: string): Promise<{ ws: WebSocket; msgs: any[]; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/v1/speech/stream?${query}`, { headers: { authorization: `Bearer ${h.token}` } });
    const msgs: any[] = [];
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    ws.on("open", () => resolve({ ws, msgs, closed }));
    ws.on("error", reject);
  });
}
const until = async (fn: () => boolean, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 10)); } };
async function sendFrames(ws: WebSocket, pcm: Buffer, frameMs = 50, delayMs = 2) {
  const step = 16 * 2 * frameMs;
  for (let o = 0; o < pcm.length; o += step) { ws.send(pcm.subarray(o, o + step)); await new Promise((r) => setTimeout(r, delayMs)); }
}

describe("WS /v1/speech/stream", () => {
  it("sends partials while speaking and a final per segment, then closed", async () => {
    const { ws, msgs, closed } = await open("lang=en&punctuate=true");
    await until(() => msgs.some((m) => m.type === "state" && m.state === "listening"));
    await sendFrames(ws, tone(2500));
    await sendFrames(ws, silence(900));
    await until(() => msgs.some((m) => m.type === "final"));
    await sendFrames(ws, tone(600));
    ws.send(JSON.stringify({ type: "end" }));
    await closed;
    const partial = msgs.find((m) => m.type === "partial");
    expect(partial).toEqual({ type: "partial", text: "Hello, world.", segmentId: 1 });
    const finals = msgs.filter((m) => m.type === "final");
    expect(finals).toHaveLength(2);
    expect(finals[0]).toEqual({ type: "final", segmentId: 1, text: "Hello, world.", lang: "en", start: 0, end: expect.any(Number), confidence: expect.any(Number) });
    expect(finals[0].end).toBeGreaterThan(2.4);
    expect(finals[1].segmentId).toBe(2);
    expect(finals[1].start).toBeGreaterThan(finals[0].end);
    expect(msgs[msgs.length - 1]).toEqual({ type: "closed" });
  });
  it("pause drops audio; punctuate=false strips punctuation", async () => {
    const { ws, msgs, closed } = await open("lang=en&punctuate=false");
    await until(() => msgs.some((m) => m.state === "listening"));
    ws.send(JSON.stringify({ type: "pause" }));
    await until(() => msgs.some((m) => m.state === "paused"));
    await sendFrames(ws, tone(1500));
    ws.send(JSON.stringify({ type: "resume" }));
    await sendFrames(ws, tone(800));
    ws.send(JSON.stringify({ type: "end" }));
    await closed;
    const finals = msgs.filter((m) => m.type === "final");
    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe("Hello world");
    expect(finals[0].end - finals[0].start).toBeLessThan(1);
  });
  it("Sinhala is gated: capability_unavailable unless the model passes WER <= 0.25", async () => {
    const { msgs, closed } = await open("lang=si");
    await closed;
    expect(msgs).toEqual([{ type: "error", code: "capability_unavailable", message: expect.any(String) }, { type: "closed" }]);
    expect((await h.call("GET", "/v1/info")).json.capabilities).not.toContain("speech.stt.si");
    expect((await h.install("whisper-si-gated")).state).toBe("done");
    await h.call("PUT", "/v1/defaults", { stt: "whisper-si-gated" });
    expect((await h.call("GET", "/v1/info")).json.capabilities).toContain("speech.stt.si");
    const s = await open("lang=si");
    await until(() => s.msgs.some((m) => m.state === "listening"));
    s.ws.close();
    await h.call("PUT", "/v1/defaults", { stt: "whisper-test" });
  });
  it("without a speech model: model_not_installed", async () => {
    const h2 = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${h2.port}/v1/speech/stream?lang=en`, { headers: { authorization: `Bearer ${h2.token}` } });
    const msgs: any[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("close", r));
    expect(msgs[0]).toMatchObject({ type: "error", code: "model_not_installed" });
    await h2.close();
  });
});

describe("POST /v1/speech/transcribe", () => {
  const wav = pcmToWav(Buffer.concat([tone(1000), silence(500), tone(1000)]));
  const post = (file: Buffer, name: string, opts: unknown) => {
    const fd = new FormData();
    fd.append("file", new Blob([file]), name);
    fd.append("options", JSON.stringify(opts));
    return h.call("POST", "/v1/speech/transcribe", fd);
  };
  it("transcribes a WAV with timestamps", async () => {
    const r = await post(wav, "talk.wav", { lang: "en", punctuate: true, timestamps: true, diarize: false });
    expect(r.status).toBe(202);
    const job = await h.svc.jobs.wait(r.json.jobId);
    expect(job.state).toBe("done");
    expect(job.result).toEqual({ lang: "en", durationSec: 2.5, segments: [{ start: 0, end: expect.any(Number), text: "Hello, world.", confidence: expect.any(Number) }] });
  });
  it("diarization needs a diarization model", async () => {
    const r = await post(wav, "talk.wav", { lang: "en", diarize: true });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("capability_unavailable");
    expect((await h.install("diar-test")).state).toBe("done");
    const ok = await post(wav, "talk.wav", { lang: "en", diarize: true });
    const job = await h.svc.jobs.wait(ok.json.jobId);
    expect((job.result as any).segments.map((s: any) => s.speaker)).toEqual(["S1", "S2"]);
  });
  it("refuses unsupported media", async () => {
    const r = await post(Buffer.from("hello"), "notes.txt", { lang: "en" });
    expect(r.json.error.code).toBe("unsupported_media");
  });
});

describe("audio", () => {
  it("converts stereo 44.1 kHz float WAV to 16 kHz mono", () => {
    const n = 4410;
    const b = Buffer.alloc(44 + n * 8);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 8, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34);
    b.write("data", 36); b.writeUInt32LE(n * 8, 40);
    for (let i = 0; i < n * 2; i++) b.writeFloatLE(0.5, 44 + i * 4);
    const out = wavTo16k(b);
    expect(out.length).toBe(1600 * 2);
    expect(out.readInt16LE(100)).toBe(floatToS16(new Float32Array([0.5])).readInt16LE(0));
  });
});
