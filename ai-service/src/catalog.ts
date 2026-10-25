// The model catalog: the signed document the Update Center serves at /api/v1/ai/catalog, cached for
// offline use, with the seed in catalog/catalog.json built in as the last fallback.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import { checkSignature, devMode, SignatureCheck } from "./signing";
import { Manifest, manifestOf } from "./manifest";
import { fits, Hardware } from "./hardware";
import type { Policy } from "./policy";
import builtinCatalog from "../catalog/catalog.json";

export const DEFAULT_CATALOG_URL = "https://download.worksuitecloud.com/api/v1/ai/catalog";

export interface CatalogModel extends Manifest {
  /** download URL per file path (outside the signed manifest, so organisations can mirror) */
  download: Record<string, string>;
  /** listed as approved by WorkSuite (a seed entry without real hashes is not) */
  approved: boolean;
  sizeMB?: number;
  /** a newer catalog version replaces an installed older one */
  description?: string;
}

export interface EnginePackage {
  /** whisper.cpp | llama.cpp | piper | ffmpeg */
  engine: string;
  version: string;
  /** darwin-arm64 | darwin-x64 | win-x64 | linux-x64 */
  platform: string;
  /** cpu | metal | cuda | vulkan */
  backend: string;
  /** the executable inside the package, relative */
  exec: string;
  files: { path: string; size: number; sha256: string; mode?: number }[];
  download: Record<string, string>;
  license: string;
  source?: string;
  approved: boolean;
  signature?: string;
}

export interface CatalogDoc {
  schema: number;
  version: string;
  generatedAt?: string;
  models: CatalogModel[];
  engines: EnginePackage[];
  signature?: string;
}

export interface CatalogState { doc: CatalogDoc; origin: "remote" | "cache" | "builtin"; signature: SignatureCheck; fetchedAt?: string }

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class Catalog {
  state: CatalogState;
  constructor(private cacheDir: string, private keys: () => KeyObject[], private url = process.env.WS_AI_CATALOG_URL || DEFAULT_CATALOG_URL,
    private fetcher: Fetcher = fetch, private env = process.env) {
    this.state = this.fromCache() || this.builtin();
  }

  private builtin(): CatalogState {
    const doc = builtinCatalog as unknown as CatalogDoc;
    return { doc, origin: "builtin", signature: checkSignature(doc as unknown as Record<string, unknown>, this.keys()) };
  }

  private get cacheFile(): string { return join(this.cacheDir, "catalog.json"); }

  private fromCache(): CatalogState | null {
    try {
      if (!existsSync(this.cacheFile)) return null;
      const { doc, fetchedAt } = JSON.parse(readFileSync(this.cacheFile, "utf8")) as { doc: CatalogDoc; fetchedAt: string };
      const sig = checkSignature(doc as unknown as Record<string, unknown>, this.keys());
      if (sig !== "valid" && !devMode(this.env)) return null;
      return { doc, origin: "cache", signature: sig, fetchedAt };
    } catch {
      return null;
    }
  }

  /** Fetches the remote catalog; keeps the cached or built-in one when offline or when it does not verify. */
  async refresh(url = this.url, timeoutMs = 10000): Promise<CatalogState> {
    try {
      const res = await this.fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
      const doc = (await res.json()) as CatalogDoc;
      if (!doc || !Array.isArray(doc.models)) throw new Error("catalog: not a catalog");
      doc.engines = Array.isArray(doc.engines) ? doc.engines : [];
      const sig = checkSignature(doc as unknown as Record<string, unknown>, this.keys());
      if (sig !== "valid" && !devMode(this.env)) throw new Error(`catalog: signature ${sig}`);
      const fetchedAt = new Date().toISOString();
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(this.cacheFile + ".tmp", JSON.stringify({ doc, fetchedAt }));
      renameSync(this.cacheFile + ".tmp", this.cacheFile);
      this.state = { doc, origin: "remote", signature: sig, fetchedAt };
    } catch {
      this.state = this.fromCache() || this.state || this.builtin();
    }
    return this.state;
  }

  setUrl(url: string): void { this.url = url; }

  model(id: string, version?: string): CatalogModel | undefined {
    const all = this.state.doc.models.filter((m) => m.id === id && (!version || m.version === version));
    return all.sort((a, b) => compareVersions(b.version, a.version))[0];
  }

  engine(engine: string, platform: string, backend: string): EnginePackage | undefined {
    return this.state.doc.engines.filter((e) => e.engine === engine && e.platform === platform && e.backend === backend)
      .sort((a, b) => compareVersions(b.version, a.version))[0];
  }

  /** GET /v1/catalog?task=&lang= */
  list(hw: Hardware | null, policy: Policy, task?: string | null, lang?: string | null) {
    return this.state.doc.models
      .filter((m) => (!task || m.tasks.includes(task as never)) && (!lang || m.languages.includes(lang)))
      .map((m) => {
        const sizeMB = m.sizeMB ?? Math.round(m.files.reduce((s, f) => s + f.size, 0) / 1048576);
        const policyOk = !policy.modelsRestricted || policy.approvedModels.includes(m.id);
        const signed = checkSignature(manifestOf(m as unknown as Record<string, unknown>) as unknown as Record<string, unknown>, this.keys()) === "valid";
        return {
          id: m.id, name: m.name || m.id, version: m.version, tasks: m.tasks, languages: m.languages,
          sizeMB, ramMB: m.ramMB, backends: m.backends, license: m.license,
          fits: hw ? fits(m.ramMB, hw) : "yes",
          approved: m.approved && policyOk,
          evaluated: m.evaluation || {},
          // additive
          engine: m.engine, source: m.source, description: m.description,
          approvedByOrganization: policyOk, signed,
          ...(m.voice ? { voice: m.voice } : {}),
        };
      });
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^[^0-9]*/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^[^0-9]*/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function platformId(platform = process.platform, arch = process.arch): string {
  const os = platform === "win32" ? "win" : platform;
  return `${os}-${arch}`;
}
