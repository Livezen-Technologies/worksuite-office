// Engine binaries: an override in the environment (development, tests), or an engine package from the
// catalog (per platform + backend, sha256-pinned, signed), installed under <data>/engines/<engine>/<version>-<backend>/.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { KeyObject } from "node:crypto";
import { ApiError } from "../errors";
import { Catalog, compareVersions, EnginePackage, Fetcher, platformId } from "../catalog";
import { download, requireDisk, sha256File } from "../download";
import { extractAll } from "../tar";
import { checkSignature, devMode } from "../signing";
import type { Hardware } from "../hardware";
import type { Policy } from "../policy";
import type { Command } from "./process";

export type EngineId = "whisper.cpp" | "llama.cpp" | "piper" | "ffmpeg";

const ENV: Record<EngineId, string> = {
  "whisper.cpp": "WS_AI_WHISPER_SERVER",
  "llama.cpp": "WS_AI_LLAMA_SERVER",
  piper: "WS_AI_PIPER",
  ffmpeg: "WS_AI_FFMPEG",
};

interface Installed { engine: string; version: string; backend: string; exec: string; dir: string }

export function preferredBackends(hw: Hardware | null, policy: Policy | null, engine: EngineId): string[] {
  if (engine === "piper" || engine === "ffmpeg") return ["cpu"];
  if (policy && !policy.gpuAllowed) return ["cpu"];
  const out: string[] = [];
  if (hw?.appleSilicon) out.push("metal");
  if (hw?.gpus.some((g) => g.backend === "cuda")) out.push("cuda");
  if (hw?.vulkan || hw?.gpus.some((g) => g.backend === "vulkan")) out.push("vulkan");
  out.push("cpu");
  return out;
}

function commandFor(path: string): { cmd: string; args: string[] } {
  return /\.(c|m)?js$/.test(path) ? { cmd: process.execPath, args: [path] } : { cmd: path, args: [] };
}

export class EngineRegistry {
  constructor(private dir: string, private catalog: Catalog, private keys: () => KeyObject[],
    private hw: () => Hardware | null, private policy: () => Policy, private env = process.env, private fetcher?: Fetcher) {}

  installed(engine?: string): Installed[] {
    const out: Installed[] = [];
    if (!existsSync(this.dir)) return out;
    for (const e of readdirSync(this.dir)) {
      if (engine && e !== engine) continue;
      const base = join(this.dir, e);
      for (const v of readdirSync(base)) {
        const f = join(base, v, "installed.json");
        if (!existsSync(f)) continue;
        try { out.push({ ...(JSON.parse(readFileSync(f, "utf8")) as Installed), dir: join(base, v) }); } catch { /* skip */ }
      }
    }
    return out.sort((a, b) => compareVersions(b.version, a.version));
  }

  /** The command to run an engine with, or null when none is available. */
  resolve(engine: EngineId): Command | null {
    const override = this.env[ENV[engine]];
    if (override) return { ...commandFor(override), backend: this.env.WS_AI_BACKEND || "cpu", version: "override" };
    const prefs = preferredBackends(this.hw(), this.policy(), engine);
    const all = this.installed(engine);
    for (const b of prefs) {
      const hit = all.find((i) => i.backend === b && existsSync(join(i.dir, i.exec)));
      if (hit) return { ...commandFor(join(hit.dir, hit.exec)), backend: b, version: hit.version };
    }
    if (engine === "ffmpeg") {
      for (const p of (this.env.PATH || "").split(delimiter)) {
        for (const n of process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"]) if (p && existsSync(join(p, n))) return { cmd: join(p, n), args: [], backend: "cpu", version: "system" };
      }
    }
    return null;
  }

  /** The catalog package to install for this computer, best backend first. */
  pick(engine: EngineId): EnginePackage | undefined {
    for (const b of preferredBackends(this.hw(), this.policy(), engine)) {
      const p = this.catalog.engine(engine, platformId(), b);
      if (p) return p;
    }
    return undefined;
  }

  /** Installs the engine package if the engine is not available yet. */
  async ensure(engine: EngineId, signal: AbortSignal, onBytes?: (done: number, total: number) => void): Promise<Command> {
    const have = this.resolve(engine);
    if (have) return have;
    const pkg = this.pick(engine);
    if (!pkg) throw new ApiError("capability_unavailable", `No ${engine} engine package for ${platformId()}`, { engine, platform: platformId() });
    const sig = checkSignature(pkg as unknown as Record<string, unknown>, this.keys());
    if (sig !== "valid" && !devMode(this.env)) throw new ApiError("integrity_failed", `The ${engine} engine package is not signed by WorkSuite`, { engine, signature: sig });
    if (!pkg.approved && !devMode(this.env)) throw new ApiError("forbidden_by_policy", `The ${engine} engine package is not approved`, { engine });
    const dest = join(this.dir, engine, `${pkg.version}-${pkg.backend}`);
    const dl = join(this.dir, ".downloads");
    requireDisk(this.dir, pkg.files.reduce((s, f) => s + f.size, 0) * 2.5);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const f of pkg.files) {
      const url = pkg.download[f.path];
      if (!url) throw new ApiError("integrity_failed", `No download for ${f.path}`);
      const file = join(dl, f.path);
      await download({ url, dest: file, size: f.size || undefined, signal, fetcher: this.fetcher, onBytes });
      const sha = await sha256File(file, signal);
      if (f.sha256 !== sha && !(f.sha256 === "TODO" && devMode(this.env))) {
        rmSync(file, { force: true });
        throw new ApiError("integrity_failed", `Checksum mismatch for ${f.path}`, { expected: f.sha256, got: sha });
      }
      if (/\.tar$/.test(f.path)) await extractAll(file, dest, signal);
      else writeFileSync(join(dest, f.path), readFileSync(file), { mode: f.mode ?? 0o755 });
      rmSync(file, { force: true });
    }
    writeFileSync(join(dest, "installed.json"), JSON.stringify({ engine, version: pkg.version, backend: pkg.backend, exec: pkg.exec }));
    const cmd = this.resolve(engine);
    if (!cmd) throw new ApiError("integrity_failed", `The ${engine} package has no ${pkg.exec}`);
    return cmd;
  }

  summary(): { engine: string; available: boolean; version?: string; backend?: string }[] {
    return (["whisper.cpp", "llama.cpp", "piper", "ffmpeg"] as EngineId[]).map((e) => {
      const c = this.resolve(e);
      return c ? { engine: e, available: true, version: c.version, backend: c.backend } : { engine: e, available: false };
    });
  }
}
