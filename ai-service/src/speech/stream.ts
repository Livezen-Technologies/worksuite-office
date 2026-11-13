// WS /v1/speech/stream?lang=auto|si|en&model=&punctuate=true
// in:  binary PCM 16 kHz mono s16le frames (20–100 ms); text {type:"pause"|"resume"|"end"}
// out: {type:"partial", text, segmentId} · {type:"final", segmentId, text, lang, start, end, confidence}
//      · {type:"error", code} · {type:"closed"}; additive: {type:"state", state:"starting"|"listening"|"paused"}
// Segmentation: energy-based voice activity; a segment ends after 700 ms of silence (or at 25 s), then the
// whole segment is transcribed for the final. While speech goes on, the segment so far is transcribed about
// once a second for the partial (skipped while an inference is still running, so we never fall behind).
import type { WebSocket } from "ws";
import { ApiError } from "../errors";
import { pcmToWav, RATE, rms } from "../audio";
import { whisperInference } from "../engines/clients";
import { passesSiStt } from "../manifest";
import type { ModelStore } from "../models";
import type { Runtime } from "../runtime";
import { Priority } from "../scheduler";
import type { Loaded } from "../scheduler";
import type { InstalledModel } from "../models";
import type { Policy } from "../policy";

export interface StreamOptions { lang: string; model?: string | null; punctuate: boolean }

export const TUNING = { silenceMs: 700, maxSegmentMs: 25000, partialEveryMs: 1000, minSpeechMs: 250, minRms: 350, maxPartialRtf: 0.6 };
const EARLY_MAX_BYTES = 30 * 16000 * 2; // audio kept while the model loads: 30 s

const BYTES_PER_MS = (RATE * 2) / 1000;

export function stripPunctuation(s: string): string {
  return s.replace(/[.,!?;:"“”()…]/g, "").replace(/\s{2,}/g, " ").trim();
}

export class SpeechStream {
  private seg: Buffer[] = [];
  private segBytes = 0;
  private speechBytes = 0;
  private silenceBytes = 0;
  private sincePartial = 0;
  private totalBytes = 0;
  private segStartBytes = 0;
  private segmentId = 1;
  private paused = false;
  private ended = false;
  private busy: Promise<void> = Promise.resolve();
  private partialRunning = false;
  private noise = 200;
  private loaded: Loaded | null = null;
  private early: Buffer[] = [];
  private endRequested = false;
  private model: InstalledModel | null = null;
  private ac = new AbortController();
  private recording: Buffer[] | null;

  constructor(private ws: WebSocket, private o: StreamOptions, private models: ModelStore, private runtime: Runtime, private policy: () => Policy,
    private onRecording: ((pcm: Buffer) => void) | null = null) {
    this.recording = onRecording ? [] : null;
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private fail(code: string, message?: string): void {
    this.send({ type: "error", code, ...(message ? { message } : {}) });
    this.close();
  }

  async start(): Promise<void> {
    try {
      if (!this.policy().features.stt) throw new ApiError("forbidden_by_policy", "Speech to text is turned off by your organization");
      this.model = this.models.resolve("stt", this.o.model);
      if (this.o.lang === "si" && !passesSiStt(this.model.manifest)) throw new ApiError("capability_unavailable", "Sinhala speech to text is not available yet", { capability: "speech.stt.si" });
      this.send({ type: "state", state: "starting", model: this.model.manifest.id });
      // Audio sent while the model loads is kept and recognised once it is ready (the dock shows
      // "listening" when the socket opens, so people start speaking at once): it used to be dropped,
      // and the first words of a dictation went missing.
      this.ws.on("message", (data, isBinary) => {
        if (!isBinary) { this.control(String(data)); return; }
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (this.loaded) this.audio(frame);
        else if (this.early.reduce((n, f) => n + f.length, 0) < EARLY_MAX_BYTES) this.early.push(frame);
      });
      this.loaded = await this.runtime.pool.acquire(this.model.manifest.id, this.model.manifest.ramMB);
      this.models.touch(this.model.manifest.id);
      this.send({ type: "state", state: "listening" });
      const early = this.early;
      this.early = [];
      for (const f of early) this.audio(f);
      if (this.endRequested) void this.end();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("internal", (e as Error).message);
      this.fail(err.code, err.message);
      return;
    }
  }

  private control(text: string): void {
    let msg: { type?: string };
    try { msg = JSON.parse(text); } catch { this.send({ type: "error", code: "bad_request" }); return; }
    if (msg.type === "pause") { this.paused = true; this.send({ type: "state", state: "paused" }); }
    else if (msg.type === "resume") { this.paused = false; this.send({ type: "state", state: "listening" }); }
    else if (msg.type === "end") { if (this.loaded) void this.end(); else this.endRequested = true; }
    else this.send({ type: "error", code: "bad_request" });
  }

  private audio(frame: Buffer): void {
    if (this.paused || this.ended || !this.loaded) return;
    if (frame.length % 2) frame = frame.subarray(0, frame.length - 1);
    this.recording?.push(frame);
    const level = rms(frame);
    const speech = level > Math.max(TUNING.minRms, this.noise * 3);
    if (!speech) this.noise = this.noise * 0.95 + level * 0.05;
    this.totalBytes += frame.length;
    if (!this.segBytes && !speech) return; // leading silence is not kept
    if (!this.segBytes) this.segStartBytes = this.totalBytes - frame.length;
    this.seg.push(frame);
    this.segBytes += frame.length;
    this.sincePartial += frame.length;
    if (speech) { this.speechBytes += frame.length; this.silenceBytes = 0; } else this.silenceBytes += frame.length;
    if ((this.silenceBytes >= TUNING.silenceMs * BYTES_PER_MS && this.speechBytes >= TUNING.minSpeechMs * BYTES_PER_MS) || this.segBytes >= TUNING.maxSegmentMs * BYTES_PER_MS) {
      this.finalize();
    } else if (this.silenceBytes >= TUNING.silenceMs * BYTES_PER_MS) {
      this.reset(); // a click or breath, not speech
    } else if (this.partialsOn() && this.sincePartial >= TUNING.partialEveryMs * BYTES_PER_MS && !this.partialRunning && this.speechBytes >= TUNING.minSpeechMs * BYTES_PER_MS) {
      this.sincePartial = 0;
      this.partial();
    }
  }

  private reset(): void { this.seg = []; this.segBytes = 0; this.speechBytes = 0; this.silenceBytes = 0; this.sincePartial = 0; }

  private langParam(): string { return this.o.lang === "auto" ? "auto" : this.o.lang; }

  private infer(pcm: Buffer) {
    const l = this.loaded!;
    const t0 = Date.now();
    return this.runtime.scheduler.run(l.device, Priority.Speech, () => whisperInference(l.baseUrl, pcmToWav(pcm), { language: this.langParam(), signal: this.ac.signal }), this.ac.signal)
      .then((r) => { this.noteSpeed(Date.now() - t0, pcm.length / BYTES_PER_MS); return r; });
  }

  // Partials re-recognise the open segment about once a second. Where recognition is slower than
  // TUNING.maxPartialRtf of real time (a CPU-only computer with a small model) they would queue in front
  // of the finals and the text would come tens of seconds late, so they stop for this dictation.
  private rtf = 0;
  private noteSpeed(ms: number, audioMs: number): void {
    if (audioMs < 500) return;
    const x = ms / audioMs;
    this.rtf = this.rtf ? this.rtf * 0.5 + x * 0.5 : x;
  }
  private partialsOn(): boolean { return !this.rtf || this.rtf <= TUNING.maxPartialRtf; }

  private partial(): void {
    const pcm = Buffer.concat(this.seg);
    const id = this.segmentId;
    this.partialRunning = true;
    this.infer(pcm).then((r) => {
      if (id !== this.segmentId || this.ended && id !== this.segmentId) return;
      if (this.gatedOut(r.language)) return;
      const text = this.o.punctuate ? r.text : stripPunctuation(r.text);
      if (text) this.send({ type: "partial", text, segmentId: id });
    }).catch(() => undefined).finally(() => { this.partialRunning = false; });
  }

  private gatedOut(lang: string): boolean {
    return lang === "si" && !!this.model && !passesSiStt(this.model.manifest);
  }

  private finalize(): void {
    const pcm = Buffer.concat(this.seg);
    const id = this.segmentId++;
    const start = this.segStartBytes / BYTES_PER_MS / 1000;
    const end = start + pcm.length / BYTES_PER_MS / 1000;
    this.reset();
    this.busy = this.busy.then(async () => {
      try {
        const r = await this.infer(pcm);
        if (this.gatedOut(r.language)) { this.send({ type: "error", code: "capability_unavailable", segmentId: id, message: "Sinhala speech to text is not available yet" }); return; }
        const text = this.o.punctuate ? r.text : stripPunctuation(r.text);
        const conf = r.segments.length ? r.segments.reduce((s, x) => s + x.confidence, 0) / r.segments.length : 0;
        this.send({ type: "final", segmentId: id, text, lang: r.language === "auto" ? this.o.lang : r.language, start: round(start), end: round(end), confidence: round(conf) });
      } catch (e) {
        if (!this.ac.signal.aborted) this.send({ type: "error", code: e instanceof ApiError ? e.code : "internal", segmentId: id });
      }
    });
  }

  async end(): Promise<void> {
    if (this.ended) return;
    if (this.speechBytes >= TUNING.minSpeechMs * BYTES_PER_MS) this.finalize();
    this.ended = true;
    await this.busy;
    this.close();
  }

  close(): void {
    this.ended = true;
    if (this.recording && this.recording.length && this.onRecording) { this.onRecording(Buffer.concat(this.recording)); this.recording = null; }
    if (this.loaded) { this.runtime.pool.release(this.loaded); this.loaded = null; }
    this.send({ type: "closed" });
    this.ac.abort();
    if (this.ws.readyState === this.ws.OPEN) this.ws.close(1000);
  }

  /** the socket went away */
  abort(): void {
    this.ended = true;
    this.ac.abort();
    if (this.loaded) { this.runtime.pool.release(this.loaded); this.loaded = null; }
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
