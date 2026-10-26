// The model package manifest (spec: "Model package (.wsmodel) manifest"), signed with the WorkSuite model key.
import { ApiError } from "./errors";
import { checkSignature, devMode, SignatureCheck } from "./signing";
import type { KeyObject } from "node:crypto";
import type { Task } from "./settings";

export type ModelTask = Task | "diarization";
export type EngineName = "whisper.cpp" | "llama.cpp" | "piper";

export interface ManifestFile { path: string; size: number; sha256: string }

export interface Manifest {
  id: string;
  name?: string;
  version: string;
  tasks: ModelTask[];
  languages: string[];
  engine: EngineName;
  engineMin?: string;
  files: ManifestFile[];
  ramMB: number;
  backends: string[];
  license: string;
  source?: string;
  /** {si: {wer: 0.31, set: "ws-si-stt-v1"}} for speech; {si: {mos: 3.7}} for voices; {si: {grammar: 0.82}} for text */
  evaluation?: Record<string, Record<string, number | string>>;
  /** for tts models */
  voice?: { lang: string; gender?: string; quality?: string; sampleRate?: number };
  /** for llama.cpp models: context size to start llama-server with */
  contextSize?: number;
  signature?: string;
}

/** What goes into the signed manifest (catalog entries carry more: download URLs, approval, sizes). */
export const MANIFEST_KEYS: (keyof Manifest)[] = ["id", "name", "version", "tasks", "languages", "engine", "engineMin", "files", "ramMB", "backends", "license", "source", "evaluation", "voice", "contextSize", "signature"];

export function manifestOf(entry: Record<string, unknown>): Manifest {
  const m: Record<string, unknown> = {};
  for (const k of MANIFEST_KEYS) if (entry[k] !== undefined) m[k] = entry[k];
  return m as unknown as Manifest;
}

const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;

/** Shape checks: ids and paths are safe file names, hashes are hex (or "TODO" in a seed that is not approved). */
export function validateManifest(m: Manifest): void {
  const bad = (msg: string) => { throw new ApiError("integrity_failed", `Manifest: ${msg}`); };
  if (!m || typeof m !== "object") bad("not an object");
  if (typeof m.id !== "string" || !SAFE_ID.test(m.id)) bad("bad id");
  if (typeof m.version !== "string" || !/^[0-9A-Za-z.+-]{1,40}$/.test(m.version)) bad("bad version");
  if (!Array.isArray(m.tasks) || !m.tasks.length) bad("no tasks");
  if (!["whisper.cpp", "llama.cpp", "piper"].includes(m.engine)) bad("unknown engine");
  if (!Array.isArray(m.files) || !m.files.length) bad("no files");
  for (const f of m.files) {
    if (typeof f.path !== "string" || !SAFE_PATH.test(f.path) || f.path.split("/").includes("..")) bad(`bad file path ${String(f.path)}`);
    if (!Number.isInteger(f.size) || f.size < 0) bad(`bad size for ${f.path}`);
    if (typeof f.sha256 !== "string" || !(/^[0-9a-f]{64}$/.test(f.sha256) || f.sha256 === "TODO")) bad(`bad sha256 for ${f.path}`);
  }
}

/** Signature gate for install, import and load. Unsigned (or unknown-key) manifests only with WS_AI_DEV=1. */
export function requireSigned(m: Manifest, keys: KeyObject[], env = process.env): SignatureCheck {
  const check = checkSignature(m as unknown as Record<string, unknown>, keys);
  if (check === "valid") return check;
  if (devMode(env)) return check;
  if (check === "invalid") throw new ApiError("integrity_failed", "The model's signature does not verify", { id: m.id });
  throw new ApiError("integrity_failed", "The model is not signed by WorkSuite (set WS_AI_DEV=1 to install unsigned models for development)", { id: m.id, signature: "unsigned" });
}

/** Evaluation gates (spec, Delivery plan): Sinhala STT WER <= 0.25, Sinhala TTS MOS >= 3.5, Sinhala grammar >= 0.8 correct. */
export const GATES = { sttWer: 0.25, ttsMos: 3.5, grammar: 0.8 };
export function passesSiStt(m: Manifest): boolean {
  const wer = Number(m.evaluation?.si?.wer);
  return m.languages.includes("si") && Number.isFinite(wer) && wer <= GATES.sttWer;
}
export function passesSiTts(m: Manifest): boolean {
  const mos = Number(m.evaluation?.si?.mos);
  return (m.voice?.lang === "si" || m.languages.includes("si")) && Number.isFinite(mos) && mos >= GATES.ttsMos;
}
export function passesSiGrammar(m: Manifest): boolean {
  const g = Number(m.evaluation?.si?.grammar);
  return m.languages.includes("si") && Number.isFinite(g) && g >= GATES.grammar;
}
