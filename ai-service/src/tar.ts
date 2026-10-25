// A minimal ustar writer and reader for .wsmodel packages (manifest.json + model files) and engine
// packages. Regular files and directories only; names up to 255 bytes (prefix/name split).
import { createReadStream, createWriteStream, mkdirSync, openSync, readSync, closeSync, statSync, chmodSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import type { Writable } from "node:stream";

function octal(n: number, len: number): string { return n.toString(8).padStart(len - 1, "0") + "\0"; }

export function header(name: string, size: number, mode = 0o644, type: "0" | "5" = "0"): Buffer {
  const b = Buffer.alloc(512);
  let prefix = "";
  let nm = name;
  if (Buffer.byteLength(nm) > 100) {
    const cut = nm.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(nm.slice(cut + 1)) > 100) throw new Error(`tar: name too long: ${name}`);
    prefix = nm.slice(0, cut);
    nm = nm.slice(cut + 1);
  }
  b.write(nm, 0, 100, "utf8");
  b.write(octal(mode, 8), 100);
  b.write(octal(0, 8), 108);
  b.write(octal(0, 8), 116);
  b.write(octal(size, 12), 124);
  b.write(octal(Math.floor(Date.now() / 1000), 12), 136);
  b.write("        ", 148);
  b.write(type, 156);
  b.write("ustar\0", 257);
  b.write("00", 263);
  b.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const x of b) sum += x;
  b.write(octal(sum, 7) + " ", 148);
  return b;
}

export interface TarEntry { name: string; path?: string; data?: Buffer; mode?: number }

/** Writes entries (from disk paths or buffers) to `out` and ends it. */
export async function writeTar(out: Writable, entries: TarEntry[], signal?: AbortSignal): Promise<void> {
  const write = (chunk: Buffer) => new Promise<void>((resolve, reject) => {
    if (out.write(chunk)) resolve(); else out.once("drain", resolve);
    out.once("error", reject);
  });
  for (const e of entries) {
    const size = e.data ? e.data.length : statSync(e.path!).size;
    await write(header(e.name, size, e.mode));
    if (e.data) await write(e.data);
    else for await (const c of createReadStream(e.path!, { signal })) await write(c as Buffer);
    const pad = (512 - (size % 512)) % 512;
    if (pad) await write(Buffer.alloc(pad));
  }
  await write(Buffer.alloc(1024));
  await new Promise<void>((r) => out.end(r));
}

export async function writeTarFile(file: string, entries: TarEntry[], signal?: AbortSignal): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await writeTar(createWriteStream(file), entries, signal);
}

export interface TarMember { name: string; size: number; offset: number; mode: number; type: string }

function parseOctal(b: Buffer, off: number, len: number): number {
  const s = b.toString("ascii", off, off + len).replace(/\0.*$/, "").trim();
  return s ? parseInt(s, 8) : 0;
}

/** Lists a tar file's members (offset = where the data starts). Rejects bad checksums. */
export function listTar(file: string): TarMember[] {
  const fd = openSync(file, "r");
  const out: TarMember[] = [];
  try {
    const h = Buffer.alloc(512);
    let pos = 0;
    const total = statSync(file).size;
    while (pos + 512 <= total) {
      readSync(fd, h, 0, 512, pos);
      if (h.every((x) => x === 0)) break;
      const stored = parseOctal(h, 148, 8);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (sum !== stored) throw new Error("tar: bad header checksum");
      const name = h.toString("utf8", 0, 100).replace(/\0.*$/s, "");
      const prefix = h.toString("utf8", 345, 500).replace(/\0.*$/s, "");
      const size = parseOctal(h, 124, 12);
      const type = String.fromCharCode(h[156] || 48);
      out.push({ name: prefix ? `${prefix}/${name}` : name, size, offset: pos + 512, mode: parseOctal(h, 100, 8), type });
      pos += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    closeSync(fd);
  }
  return out;
}

export function readMember(file: string, m: TarMember): Buffer {
  const fd = openSync(file, "r");
  try {
    const b = Buffer.alloc(m.size);
    readSync(fd, b, 0, m.size, m.offset);
    return b;
  } finally {
    closeSync(fd);
  }
}

/** Safe destination for a member: never outside `dir`. */
export function memberPath(dir: string, name: string): string {
  const p = normalize(join(dir, name));
  if (!(p + sep).startsWith(normalize(dir) + sep) && p !== normalize(dir)) throw new Error(`tar: unsafe path ${name}`);
  if (name.split("/").includes("..")) throw new Error(`tar: unsafe path ${name}`);
  return p;
}

export async function extractMember(file: string, m: TarMember, dest: string, signal?: AbortSignal): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  if (m.size === 0) { createWriteStream(dest).end(); await new Promise((r) => setTimeout(r, 5)); return; }
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(file, { start: m.offset, end: m.offset + m.size - 1, signal });
    const ws = createWriteStream(dest);
    rs.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", () => resolve());
    rs.pipe(ws);
  });
  if (m.mode & 0o111) chmodSync(dest, 0o755);
}

/** Extracts every regular file to `dir` (engine packages). */
export async function extractAll(file: string, dir: string, signal?: AbortSignal): Promise<string[]> {
  const names: string[] = [];
  for (const m of listTar(file)) {
    if (m.type === "5") { mkdirSync(memberPath(dir, m.name), { recursive: true }); continue; }
    if (m.type !== "0") continue;
    await extractMember(file, m, memberPath(dir, m.name), signal);
    names.push(m.name);
  }
  return names;
}
