// Local version history of files on this computer: copies kept under <data>/versions/<hash of the path>/, newest
// first, at most `keep` per file. Identical content is not kept twice. Restoring never overwrites: the old version
// is written next to the file as "<name> (version <date>).<ext>".
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { ApiError } from "../errors";

export interface Version { id: string; savedAt: string; size: number; sha256: string; note?: string }

interface Index { path: string; versions: Version[] }

export class VersionStore {
  constructor(private dir: string, private keep = 20) {}

  private folder(path: string): string {
    return join(this.dir, createHash("sha256").update(path).digest("hex").slice(0, 32));
  }

  private index(path: string): Index {
    const f = join(this.folder(path), "index.json");
    if (!existsSync(f)) return { path, versions: [] };
    try { return JSON.parse(readFileSync(f, "utf8")) as Index; } catch { return { path, versions: [] }; }
  }

  private save(path: string, idx: Index): void {
    mkdirSync(this.folder(path), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.folder(path), "index.json"), JSON.stringify(idx, null, 1), { mode: 0o600 });
  }

  list(path: string): Version[] {
    return this.index(path).versions;
  }

  /** Keeps the file as it is now; the existing version when its content is already kept. */
  snapshot(path: string, note?: string, now = new Date()): { version: Version; created: boolean } {
    if (!existsSync(path) || !statSync(path).isFile()) throw new ApiError("not_found", "No such file", { path });
    const data = readFileSync(path);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const idx = this.index(path);
    const same = idx.versions.find((v) => v.sha256 === sha256);
    if (same) return { version: same, created: false };
    let id = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    while (idx.versions.some((v) => v.id === id)) id += "x";
    mkdirSync(this.folder(path), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.folder(path), id + extname(path)), data, { mode: 0o600 });
    const version: Version = { id, savedAt: now.toISOString(), size: data.length, sha256, ...(note ? { note: note.slice(0, 200) } : {}) };
    idx.versions.unshift(version);
    for (const old of idx.versions.splice(this.keep)) rmSync(join(this.folder(path), old.id + extname(path)), { force: true });
    this.save(path, idx);
    return { version, created: true };
  }

  /** Writes a kept version next to the file under a new name; returns that name. */
  restore(path: string, id: string): string {
    const v = this.index(path).versions.find((x) => x.id === id);
    if (!v) throw new ApiError("not_found", "No such version", { id });
    const src = join(this.folder(path), v.id + extname(path));
    if (!existsSync(src)) throw new ApiError("not_found", "The version's copy is missing", { id });
    const stamp = v.savedAt.slice(0, 16).replace("T", " ").replace(":", "-");
    const stem = basename(path, extname(path));
    for (let i = 1; ; i++) {
      const out = join(dirname(path), `${stem} (version ${stamp})${i > 1 ? ` (${i})` : ""}${extname(path)}`);
      if (!existsSync(out)) { copyFileSync(src, out); return out; }
    }
  }

  /** Drops every version of a file. */
  clear(path: string): number {
    const n = this.index(path).versions.length;
    rmSync(this.folder(path), { recursive: true, force: true });
    return n;
  }

  /** How many files have versions (for diagnostics). */
  count(): number {
    return existsSync(this.dir) ? readdirSync(this.dir).length : 0;
  }
}
