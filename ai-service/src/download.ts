// Resumable HTTP download into <dest>.part: a Range request continues from the bytes already on disk;
// a server that answers 200 instead of 206 starts the file over. Network errors pause (JobPaused) so the
// job resumes from the last byte.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { ApiError } from "./errors";
import type { Fetcher } from "./catalog";

export class NetworkPaused extends Error {
  readonly pause = true;
  constructor(message: string) { super(message); this.name = "NetworkPaused"; }
}

export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20, signal })) h.update(chunk as Buffer);
  return h.digest("hex");
}

export function freeBytes(dir: string): number {
  let d = dir;
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  try {
    const s = statfsSync(d);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Throws insufficient_disk with the space needed when `bytes` (+5% and 100 MB headroom) do not fit. */
export function requireDisk(dir: string, bytes: number, free = freeBytes(dir)): void {
  const need = Math.ceil(bytes * 1.05) + 100 * 1048576;
  if (free < need) {
    throw new ApiError("insufficient_disk", `Not enough disk space: ${Math.ceil(need / 1048576)} MB needed, ${Math.floor(free / 1048576)} MB free`,
      { neededMB: Math.ceil(need / 1048576), freeMB: Math.floor(free / 1048576) });
  }
}

export interface DownloadOptions {
  url: string;
  dest: string;
  size?: number;
  signal: AbortSignal;
  fetcher?: Fetcher;
  onBytes?: (done: number, total: number) => void;
}

/** Downloads to `dest` (via dest.part). Returns the final size. */
export async function download(o: DownloadOptions): Promise<number> {
  const part = o.dest + ".part";
  mkdirSync(dirname(o.dest), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  if (o.size && have > o.size) { unlinkSync(part); have = 0; }
  if (o.size && have === o.size) { renameSync(part, o.dest); return have; }
  const f = o.fetcher || fetch;
  let res: Response;
  try {
    res = await f(o.url, { signal: o.signal, headers: have ? { range: `bytes=${have}-` } : {} });
  } catch (e) {
    if (o.signal.aborted) throw e;
    throw new NetworkPaused(`Network: ${(e as Error).message}`);
  }
  if (res.status === 416 && have) { renameSync(part, o.dest); return have; }
  if (!res.ok || !res.body) throw new ApiError("internal", `Download failed: HTTP ${res.status}`, { status: res.status });
  const append = res.status === 206 && have > 0;
  if (!append) have = 0;
  const lenHeader = Number(res.headers.get("content-length")) || 0;
  const total = o.size || (lenHeader ? lenHeader + have : 0);
  const out = createWriteStream(part, { flags: append ? "a" : "w" });
  let done = have;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      o.onBytes?.(done, total);
    }
  } catch (e) {
    await new Promise<void>((r) => out.end(() => r()));
    if (o.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    throw new NetworkPaused(`Network: ${(e as Error).message}`);
  }
  await new Promise<void>((r, j) => out.end((err?: Error | null) => (err ? j(err) : r())));
  if (o.size && done !== o.size) {
    if (done < o.size) throw new NetworkPaused(`Download stopped at ${done} of ${o.size} bytes`);
    unlinkSync(part);
    throw new ApiError("integrity_failed", "Downloaded file is larger than the manifest says", { expected: o.size, got: done });
  }
  renameSync(part, o.dest);
  return done;
}
