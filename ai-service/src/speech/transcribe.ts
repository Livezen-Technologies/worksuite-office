// POST /v1/speech/transcribe -> job; result {lang, durationSec, segments:[{start, end, speaker?, text, confidence}]}.
// The file is decoded to 16 kHz PCM, transcribed in 30 s windows (progress and partial segments stream as
// job events) and deleted when the job ends, unless Keep recordings is on.
import { readFileSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ApiError } from "../errors";
import { ffmpegDecode, Media, pcmToWav, RATE, wavTo16k } from "../audio";
import { whisperInference } from "../engines/clients";
import type { EngineRegistry } from "../engines/registry";
import { passesSiStt } from "../manifest";
import type { InstalledModel, ModelStore } from "../models";
import type { Runtime } from "../runtime";
import { Priority } from "../scheduler";
import type { JobControl } from "../jobs";
import { stripPunctuation } from "./stream";

export interface TranscribeOptions { lang: string; punctuate: boolean; timestamps: boolean; diarize: boolean; model?: string | null }
export interface Segment { start: number; end: number; speaker?: string; text: string; confidence: number }

export const MAX_SECONDS = 4 * 3600;
const WINDOW_S = 30;

export function chooseModel(models: ModelStore, o: TranscribeOptions): InstalledModel {
  if (o.diarize) {
    const d = models.tryResolve("diarization");
    if (!d) throw new ApiError("capability_unavailable", "Speaker labels need a diarization model; none is installed", { capability: "speech.diarization" });
    return d;
  }
  const m = models.resolve("stt", o.model);
  if (o.lang === "si" && !passesSiStt(m.manifest)) throw new ApiError("capability_unavailable", "Sinhala speech to text is not available yet", { capability: "speech.stt.si" });
  return m;
}

export async function runTranscription(job: JobControl, file: string, media: Media, o: TranscribeOptions, model: InstalledModel,
  deps: { runtime: Runtime; engines: EngineRegistry; keepDir: string | null }) {
  try {
    job.progress(0, "decoding");
    let pcm: Buffer;
    if (media === "wav") pcm = wavTo16k(readFileSync(file));
    else {
      const ff = deps.engines.resolve("ffmpeg");
      if (!ff) throw new ApiError("unsupported_media", `Decoding ${media} needs the ffmpeg engine package`, { media });
      pcm = await ffmpegDecode(ff, file, job.signal);
    }
    const durationSec = pcm.length / 2 / RATE;
    if (durationSec > MAX_SECONDS) throw new ApiError("input_too_long", "Files can be at most 4 hours long", { maxSec: MAX_SECONDS });
    const segments: Segment[] = [];
    let lang = o.lang;
    let speaker = 1;
    const win = WINDOW_S * RATE * 2;
    for (let off = 0; off < pcm.length; off += win) {
      const chunk = pcm.subarray(off, Math.min(pcm.length, off + win));
      const t0 = off / 2 / RATE;
      const r = await deps.runtime.withModel(o.diarize ? "diarization" : "stt", model.manifest.id, Priority.Batch,
        (l) => whisperInference(l.baseUrl, pcmToWav(chunk), { language: o.lang === "auto" ? "auto" : o.lang, signal: job.signal }), job.signal, model);
      if (lang === "auto" && r.language && r.language !== "auto") lang = r.language;
      if (lang === "si" && !o.diarize && !passesSiStt(model.manifest)) throw new ApiError("capability_unavailable", "Sinhala speech to text is not available yet", { capability: "speech.stt.si" });
      const fresh: Segment[] = r.segments.map((s) => {
        const seg: Segment = { start: round(t0 + s.start), end: round(t0 + s.end), text: o.punctuate ? s.text : stripPunctuation(s.text), confidence: s.confidence };
        if (o.diarize) seg.speaker = `S${speaker}`;
        if (s.speakerTurn) speaker = speaker === 1 ? 2 : 1;
        return seg;
      });
      segments.push(...fresh);
      job.partial({ segments: fresh });
      job.progress(Math.min(1, (off + chunk.length) / pcm.length), "transcribing");
    }
    const out = o.timestamps ? segments : mergeAll(segments);
    return { lang, durationSec: round(durationSec), segments: out };
  } finally {
    if (deps.keepDir) {
      try { mkdirSync(deps.keepDir, { recursive: true }); copyFileSync(file, join(deps.keepDir, `${Date.now()}-${basename(file)}`)); } catch { /* best effort */ }
    }
    rmSync(file, { force: true });
  }
}

/** timestamps:false — one segment per speaker turn (or one for the whole file). */
function mergeAll(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) { last.text += " " + s.text; last.end = s.end; last.confidence = (last.confidence + s.confidence) / 2; }
    else out.push({ ...s });
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
