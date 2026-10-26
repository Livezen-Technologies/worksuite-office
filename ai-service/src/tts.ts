// GET /v1/tts/voices and POST /v1/tts/synthesize (Piper). Sinhala voices only when the voice passes its gate.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "./errors";
import { ffmpegEncode, wavHeader } from "./audio";
import { piperSynthesize } from "./engines/clients";
import type { EngineRegistry } from "./engines/registry";
import { passesSiTts } from "./manifest";
import type { InstalledModel, ModelStore } from "./models";
import type { Runtime } from "./runtime";
import { Priority } from "./scheduler";

export interface Voice { id: string; lang: string; gender?: string; quality: string; modelId: string }
export interface Timing { kind: "sentence" | "word"; start: number; end: number; textStart: number; textEnd: number }

export function voices(models: ModelStore): Voice[] {
  return models.withTask("tts").filter((m) => models.policyAllows(m.manifest.id)).filter((m) => {
    const lang = m.manifest.voice?.lang || m.manifest.languages[0];
    return lang !== "si" || passesSiTts(m.manifest);
  }).map((m) => ({
    id: m.manifest.id, lang: m.manifest.voice?.lang || m.manifest.languages[0], ...(m.manifest.voice?.gender ? { gender: m.manifest.voice.gender } : {}),
    quality: m.manifest.voice?.quality || "medium", modelId: m.manifest.id,
  }));
}

/** Sentences with their offsets (UTF-16), for synthesis one by one and for sentence timings. */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?।\n]+[.!?।]*\s*|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0].trim()) {
    const lead = m[0].length - m[0].trimStart().length;
    out.push({ text: m[0].trim(), start: m.index + lead, end: m.index + lead + m[0].trim().length });
  }
  return out;
}

/** Word timings spread over a sentence by length: an estimate (Piper reports no word alignments). */
export function wordTimings(s: { text: string; start: number }, t0: number, t1: number): Timing[] {
  const words = [...s.text.matchAll(/\S+/g)];
  const total = words.reduce((n, w) => n + w[0].length, 0) || 1;
  let t = t0;
  return words.map((w) => {
    const d = ((t1 - t0) * w[0].length) / total;
    const out: Timing = { kind: "word", start: r3(t), end: r3(t + d), textStart: s.start + w.index!, textEnd: s.start + w.index! + w[0].length };
    t += d;
    return out;
  });
}

export function voiceFiles(m: InstalledModel): { model: string; config: string; rate: number } {
  const onnx = m.manifest.files.find((f) => f.path.endsWith(".onnx"));
  const cfg = m.manifest.files.find((f) => f.path.endsWith(".onnx.json") || f.path.endsWith(".json"));
  if (!onnx || !cfg) throw new ApiError("integrity_failed", "The voice package has no .onnx and .onnx.json");
  return { model: join(m.dir, onnx.path), config: join(m.dir, cfg.path), rate: m.manifest.voice?.sampleRate || 22050 };
}

export interface SynthOptions { text: string; voice?: string | null; rate: number; format: "wav" | "mp3" | "opus"; timings: "none" | "word" | "sentence" }

export function resolveVoice(models: ModelStore, voice?: string | null): InstalledModel {
  const m = models.resolve("tts", voice);
  const lang = m.manifest.voice?.lang || m.manifest.languages[0];
  if (lang === "si" && !passesSiTts(m.manifest)) throw new ApiError("capability_unavailable", "Sinhala voices are not available yet", { capability: "tts.si" });
  return m;
}

/** Synthesises sentence by sentence; `onAudio` gets PCM as each sentence is ready. */
export async function synthesize(o: SynthOptions, m: InstalledModel, deps: { runtime: Runtime; engines: EngineRegistry }, onAudio: (pcm: Buffer) => void | Promise<void>, signal: AbortSignal) {
  const piper = deps.engines.resolve("piper");
  if (!piper) throw new ApiError("capability_unavailable", "The Piper engine is not installed", { engine: "piper" });
  const vf = voiceFiles(m);
  if (!existsSync(vf.model)) throw new ApiError("model_not_installed", "The voice files are missing");
  const timings: Timing[] = [];
  let t = 0;
  for (const s of sentences(o.text)) {
    const pcm = await deps.runtime.withModel("tts", m.manifest.id, Priority.Interactive, () => piperSynthesize(piper, vf.model, vf.config, s.text, 1 / o.rate, signal), signal, m);
    const d = pcm.length / 2 / vf.rate;
    if (o.timings === "sentence") timings.push({ kind: "sentence", start: r3(t), end: r3(t + d), textStart: s.start, textEnd: s.end });
    if (o.timings === "word") timings.push(...wordTimings(s, t, t + d));
    t += d;
    await onAudio(pcm);
  }
  return { timings, durationSec: r3(t), sampleRate: vf.rate };
}

export async function encode(format: "mp3" | "opus", pcm: Buffer, rate: number, engines: EngineRegistry, signal?: AbortSignal): Promise<Buffer> {
  const ff = engines.resolve("ffmpeg");
  if (!ff) throw new ApiError("unsupported_media", `${format} needs the ffmpeg engine package; use wav`, { format });
  return ffmpegEncode(ff, pcm, rate, format, signal);
}

export { wavHeader };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
