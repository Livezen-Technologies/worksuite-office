// Audio in: 16 kHz mono s16le for whisper. WAV is read here; mp3/m4a/mp4 go through ffmpeg (an engine
// package, or WS_AI_FFMPEG / ffmpeg on PATH).
import { spawn } from "node:child_process";
import { ApiError } from "./errors";
import type { Command } from "./engines/process";

export const RATE = 16000;

export function wavHeader(dataBytes: number, sampleRate = RATE, channels = 1, bits = 16): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(dataBytes >= 0xffffffff - 36 ? 0xffffffff : 36 + dataBytes, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE((sampleRate * channels * bits) / 8, 28); h.writeUInt16LE((channels * bits) / 8, 32);
  h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(Math.min(dataBytes, 0xffffffff), 40);
  return h;
}

export function pcmToWav(pcm: Buffer, sampleRate = RATE): Buffer { return Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]); }

/** Parses PCM WAV (8/16/24/32-bit int, 32-bit float; any channels/rate) to 16 kHz mono s16le. */
export function wavTo16k(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new ApiError("unsupported_media", "Not a WAV file");
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    if (pos + 8 + size > buf.length) size = buf.length - pos - 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(pos + 8);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(pos + 8 + 24);
      fmt = { format, channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === "data") data = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new ApiError("unsupported_media", "WAV file without fmt or data");
  if (!((fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (fmt.format === 3 && fmt.bits === 32))) throw new ApiError("unsupported_media", "Unsupported WAV encoding");
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      let v: number;
      if (fmt.format === 3) v = data.readFloatLE(o);
      else if (bytes === 1) v = (data[o] - 128) / 128;
      else if (bytes === 2) v = data.readInt16LE(o) / 32768;
      else if (bytes === 3) v = data.readIntLE(o, 3) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      sum += v;
    }
    mono[i] = sum / fmt.channels;
  }
  return floatToS16(resample(mono, fmt.rate, RATE));
}

export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const n = Math.floor((input.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = x - i0;
    // average over the source window when downsampling (cheap anti-aliasing)
    if (ratio > 1.5) {
      let s = 0; let c = 0;
      for (let k = i0; k < Math.min(input.length, Math.floor(x + ratio)); k++) { s += input[k]; c++; }
      out[i] = c ? s / c : input[i0];
    } else out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export function floatToS16(f: Float32Array): Buffer {
  const b = Buffer.alloc(f.length * 2);
  for (let i = 0; i < f.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))), i * 2);
  return b;
}

/** Root mean square of s16le samples (0..32768). */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); s += v * v; }
  return Math.sqrt(s / n);
}

export type Media = "wav" | "mp3" | "m4a" | "mp4";
export function mediaOf(filename: string, mime = "", head?: Buffer): Media | null {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (head && head.toString("ascii", 0, 4) === "RIFF") return "wav";
  if (["wav", "mp3", "m4a", "mp4"].includes(ext)) return ext as Media;
  if (/wav/.test(mime)) return "wav";
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/mp4|m4a|aac/.test(mime)) return mime.includes("video") ? "mp4" : "m4a";
  return null;
}

/** Any supported file -> 16 kHz mono s16le, via ffmpeg (the audio track of an mp4). */
export function ffmpegDecode(cmd: Command, file: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd.cmd, [...cmd.args, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, signal });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-800); });
    p.on("error", (e) => reject(signal?.aborted ? Object.assign(new Error("aborted"), { name: "AbortError" }) : new ApiError("internal", `ffmpeg: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new ApiError("unsupported_media", "The file could not be decoded", { stderr: err }))));
  });
}

/** s16le PCM -> mp3/opus via ffmpeg (for TTS export formats other than wav). */
export function ffmpegEncode(cmd: Command, pcm: Buffer, rate: number, format: "mp3" | "opus", signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "-"];
    args.push(...(format === "mp3" ? ["-f", "mp3", "-b:a", "96k"] : ["-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]), "-");
    const p = spawn(cmd.cmd, [...cmd.args, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", (e) => reject(new ApiError("internal", `ffmpeg: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new ApiError("unsupported_media", `Could not encode ${format}`))));
    p.stdin.end(pcm);
  });
}
