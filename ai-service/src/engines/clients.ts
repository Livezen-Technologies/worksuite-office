// The three engines: whisper.cpp's whisper-server, llama.cpp's llama-server (OpenAI-compatible) and Piper.
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { join } from "node:path";
import { ApiError } from "../errors";
import type { Manifest } from "../manifest";
import { Command, freePort, ServerProcess } from "./process";

export interface WhisperSegment { start: number; end: number; text: string; confidence: number; speakerTurn?: boolean }
export interface WhisperResult { text: string; language: string; segments: WhisperSegment[] }

const threads = () => String(Math.max(1, Math.min(8, cpus().length - 1)));

export interface Running { stop(): void; readonly exited: boolean; readonly baseUrl: string }

export async function startWhisper(cmd: Command, m: Manifest, dir: string, opts: { tdrz?: boolean } = {}): Promise<ServerProcess> {
  const s = new ServerProcess("whisper-server", await freePort());
  const model = join(dir, m.files[0].path);
  const args = ["-m", model, "--host", "127.0.0.1", "--port", String(s.port), "-t", threads()];
  if (cmd.backend === "cpu") args.push("-ng");
  if (opts.tdrz) args.push("-tdrz");
  await s.start(cmd, args, "/health");
  return s;
}

export async function whisperInference(baseUrl: string, wav: Buffer, o: { language?: string; signal?: AbortSignal; prompt?: string }): Promise<WhisperResult> {
  const fd = new FormData();
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  fd.append("response_format", "verbose_json");
  fd.append("temperature", "0.0");
  fd.append("language", o.language && o.language !== "auto" ? o.language : "auto");
  if (o.prompt) fd.append("prompt", o.prompt);
  let res: Response;
  try {
    res = await fetch(baseUrl + "/inference", { method: "POST", body: fd, signal: o.signal });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new ApiError("internal", "whisper-server is not answering", { message: (e as Error).message });
  }
  if (!res.ok) throw new ApiError("internal", `whisper-server: HTTP ${res.status}`);
  const j = (await res.json()) as { text?: string; language?: string; segments?: { start: number; end: number; text: string; avg_logprob?: number; speaker_turn_next?: boolean; tokens?: unknown[] }[] };
  const segments = (j.segments || []).map((s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || "").replace(/\s*\[SPEAKER_TURN\]\s*/g, " ").trim(),
    confidence: typeof s.avg_logprob === "number" ? Math.round(Math.exp(s.avg_logprob) * 1000) / 1000 : 0.8,
    speakerTurn: !!s.speaker_turn_next || /\[SPEAKER_TURN\]/.test(String(s.text || "")),
  })).filter((s) => s.text);
  return { text: String(j.text || segments.map((s) => s.text).join(" ")).trim(), language: j.language || o.language || "auto", segments };
}

export async function startLlama(cmd: Command, m: Manifest, dir: string): Promise<ServerProcess> {
  const s = new ServerProcess("llama-server", await freePort());
  const model = join(dir, m.files[0].path);
  const args = ["-m", model, "--host", "127.0.0.1", "--port", String(s.port), "-c", String(m.contextSize || 4096), "-t", threads(),
    "-ngl", cmd.backend === "cpu" ? "0" : "999"];
  await s.start(cmd, args, "/health");
  return s;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions { temperature?: number; max_tokens?: number; stop?: string[]; json?: boolean; signal?: AbortSignal; timeoutMs?: number }

/** One non-streaming chat completion; returns the assistant's text. */
export async function llamaChat(baseUrl: string, messages: ChatMessage[], o: ChatOptions = {}): Promise<string> {
  const body: Record<string, unknown> = { messages, temperature: o.temperature ?? 0.2, max_tokens: o.max_tokens ?? 512, stream: false };
  if (o.stop) body.stop = o.stop;
  if (o.json) body.response_format = { type: "json_object" };
  const signals = [o.signal, o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined].filter(Boolean) as AbortSignal[];
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  const res = await fetch(baseUrl + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new ApiError("internal", `llama-server: HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return String(j.choices?.[0]?.message?.content ?? "");
}

/** Piper: one process per utterance; raw 16-bit mono PCM at the voice's sample rate on stdout. */
export function piperSynthesize(cmd: Command, modelPath: string, configPath: string, text: string, lengthScale: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd.cmd, [...cmd.args, "--model", modelPath, "--config", configPath, "--output_raw", "--length_scale", lengthScale.toFixed(3)],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-1000); });
    p.on("error", (e) => reject(signal?.aborted ? Object.assign(new Error("aborted"), { name: "AbortError" }) : new ApiError("internal", `piper: ${e.message}`)));
    p.on("close", (code) => {
      if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (code !== 0) return reject(new ApiError("internal", `piper exited with ${code}`, { stderr: err }));
      resolve(Buffer.concat(chunks));
    });
    p.stdin.end(text.replace(/\s+/g, " ").trim() + "\n");
  });
}
