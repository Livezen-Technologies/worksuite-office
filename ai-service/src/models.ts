// Installed models: <models>/<id>/<version>/{manifest.json, files…}. Install = download (resumable) ->
// verify (sha256 per file, Ed25519 manifest signature) -> unpack (move into place) -> ready.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyObject } from "node:crypto";
import { ApiError } from "./errors";
import { Catalog, CatalogModel, compareVersions, Fetcher } from "./catalog";
import { download, requireDisk, sha256File } from "./download";
import { JobControl, JobManager, JobView } from "./jobs";
import { Manifest, manifestOf, ModelTask, requireSigned, validateManifest } from "./manifest";
import { devMode } from "./signing";
import type { Policy } from "./policy";
import { SettingsStore, Task, TASKS } from "./settings";
import { extractMember, listTar, memberPath, readMember, writeTar } from "./tar";
import type { EventBus } from "./events";
import type { EngineRegistry, EngineId } from "./engines/registry";
import { fits, Hardware } from "./hardware";
import type { Writable } from "node:stream";

export interface InstalledModel { manifest: Manifest; dir: string; installedAt: string; lastUsed: string | null; sizeBytes: number }

export interface Deps {
  modelsDir: () => string;
  cacheDir: string;
  catalog: Catalog;
  jobs: JobManager;
  events: EventBus;
  settings: SettingsStore;
  policy: () => Policy;
  keys: () => KeyObject[];
  engines: EngineRegistry;
  isLoaded: (id: string) => boolean;
  unload: (id: string) => void;
  hardware: () => Hardware | null;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
}

const ENGINE_OF: Record<string, EngineId> = { "whisper.cpp": "whisper.cpp", "llama.cpp": "llama.cpp", piper: "piper" };

export class ModelStore {
  private index = new Map<string, InstalledModel>();
  private failed = new Map<string, { version: string; error: string }>();
  constructor(private d: Deps) { this.scan(); }

  private get env() { return this.d.env || process.env; }

  scan(): void {
    this.index.clear();
    const root = this.d.modelsDir();
    if (!existsSync(root)) return;
    for (const id of readdirSync(root)) {
      if (id.startsWith(".")) continue;
      const versions = existsSync(join(root, id)) ? readdirSync(join(root, id)).filter((v) => existsSync(join(root, id, v, "manifest.json"))) : [];
      versions.sort((a, b) => compareVersions(b, a));
      for (const v of versions) {
        const dir = join(root, id, v);
        try {
          const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
          validateManifest(manifest);
          const meta = existsSync(join(dir, ".meta.json")) ? JSON.parse(readFileSync(join(dir, ".meta.json"), "utf8")) : {};
          const sizeBytes = manifest.files.reduce((s, f) => s + (existsSync(join(dir, f.path)) ? statSync(join(dir, f.path)).size : 0), 0);
          this.index.set(id, { manifest, dir, installedAt: meta.installedAt || new Date().toISOString(), lastUsed: meta.lastUsed || null, sizeBytes });
          break;
        } catch { /* a broken install is ignored; reinstall replaces it */ }
      }
    }
  }

  get(id: string): InstalledModel | undefined { return this.index.get(id); }
  all(): InstalledModel[] { return [...this.index.values()]; }
  withTask(task: ModelTask): InstalledModel[] { return this.all().filter((m) => m.manifest.tasks.includes(task)); }

  policyAllows(id: string): boolean {
    const p = this.d.policy();
    return !p.modelsRestricted || p.approvedModels.includes(id);
  }

  touch(id: string): void {
    const m = this.index.get(id);
    if (!m) return;
    m.lastUsed = new Date().toISOString();
    try { writeFileSync(join(m.dir, ".meta.json"), JSON.stringify({ installedAt: m.installedAt, lastUsed: m.lastUsed })); } catch { /* read-only */ }
  }

  /** GET /v1/models?task= */
  list(task?: string | null) {
    const defaults = this.d.settings.data.defaults;
    const rows: Record<string, unknown>[] = this.all().filter((m) => !task || m.manifest.tasks.includes(task as ModelTask)).map((m) => {
      const id = m.manifest.id;
      const updating = !!this.d.jobs.findActive("install", id);
      const latest = this.d.catalog.model(id);
      return {
        id, version: m.manifest.version, tasks: m.manifest.tasks,
        state: updating ? "updating" : this.d.isLoaded(id) ? "active" : "installed",
        sizeMB: Math.round(m.sizeBytes / 1048576), path: m.dir,
        isDefaultFor: TASKS.filter((t) => defaults[t] === id),
        lastUsed: m.lastUsed,
        // additive
        name: m.manifest.name || id, languages: m.manifest.languages, engine: m.manifest.engine,
        updateAvailable: !!latest && compareVersions(latest.version, m.manifest.version) > 0,
        approvedByOrganization: this.policyAllows(id),
        evaluation: m.manifest.evaluation || {},
      };
    });
    for (const [id, f] of this.failed) {
      if (this.index.has(id)) continue;
      const cm = this.d.catalog.model(id, f.version);
      if (task && !cm?.tasks.includes(task as ModelTask)) continue;
      rows.push({ id, version: f.version, tasks: cm?.tasks || [], state: "failed", sizeMB: 0, path: null, isDefaultFor: [], lastUsed: null, error: f.error });
    }
    return rows;
  }

  /** Which installed model serves a task: explicit id, else the default, else "auto" (best that fits). */
  resolve(task: ModelTask, explicit?: string | null): InstalledModel {
    const pick = (id: string) => {
      const m = this.index.get(id);
      if (!m) throw new ApiError("model_not_installed", `Model ${id} is not installed`, { id, task });
      if (!m.manifest.tasks.includes(task)) throw new ApiError("bad_request", `Model ${id} does not do ${task}`);
      if (!this.policyAllows(id)) throw new ApiError("forbidden_by_policy", `Model ${id} is not approved by your organization`, { id });
      return m;
    };
    if (explicit && explicit !== "auto") return pick(explicit);
    const dflt = (TASKS as readonly string[]).includes(task) ? this.d.settings.data.defaults[task as Task] : "auto";
    if (dflt && dflt !== "auto" && dflt !== "cloud" && this.index.has(dflt)) return pick(dflt);
    const candidates = this.withTask(task).filter((m) => this.policyAllows(m.manifest.id));
    if (!candidates.length) throw new ApiError("model_not_installed", `No model for ${task} is installed`, { task });
    const hw = this.d.hardware();
    const rank = (m: InstalledModel) => (hw ? { yes: 2, tight: 1, no: 0 }[fits(m.manifest.ramMB, hw)] : 1);
    // the largest model that fits comfortably, else the smallest
    candidates.sort((a, b) => rank(b) - rank(a) || (rank(a) === 2 ? b.manifest.ramMB - a.manifest.ramMB : a.manifest.ramMB - b.manifest.ramMB));
    return candidates[0];
  }

  tryResolve(task: ModelTask, explicit?: string | null): InstalledModel | null {
    try { return this.resolve(task, explicit); } catch { return null; }
  }

  /** POST /v1/models/{id}/install */
  install(id: string, version?: string): JobView {
    const entry = this.d.catalog.model(id, version);
    if (!entry) throw new ApiError("not_found", `Model ${id}${version ? " " + version : ""} is not in the catalog`);
    if (!this.policyAllows(id)) throw new ApiError("forbidden_by_policy", "Not approved by your organization", { id });
    const manifest = manifestOf(entry as unknown as Record<string, unknown>);
    validateManifest(manifest);
    if (!entry.approved && !devMode(this.env)) throw new ApiError("forbidden_by_policy", "This model is not approved for installation yet", { id, reason: "unapproved" });
    requireSigned(manifest, this.d.keys(), this.env);
    const running = this.d.jobs.findActive("install", id);
    if (running) return running;
    const have = this.index.get(id);
    if (have && have.manifest.version === manifest.version) throw new ApiError("bad_request", `Model ${id} ${manifest.version} is already installed`);
    const total = manifest.files.reduce((s, f) => s + f.size, 0);
    // disk precheck before anything is downloaded: the files (minus what is already partly downloaded) + staging
    requireDisk(this.d.modelsDir(), total - this.partialBytes(id, manifest.version));
    this.failed.delete(id);
    return this.d.jobs.start("install", (job) => this.runInstall(job, entry, manifest), { modelId: id, resumable: true });
  }

  private stagingDir(id: string, version: string): string { return join(this.d.modelsDir(), ".staging", `${id}-${version}`); }

  private partialBytes(id: string, version: string): number {
    const dir = this.stagingDir(id, version);
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const f of readdirSync(dir)) n += statSync(join(dir, f)).size;
    return n;
  }

  private async runInstall(job: JobControl, entry: CatalogModel, manifest: Manifest): Promise<unknown> {
    const stage = this.stagingDir(manifest.id, manifest.version);
    mkdirSync(stage, { recursive: true });
    const total = manifest.files.reduce((s, f) => s + f.size, 0) || 1;
    try {
      const engine = ENGINE_OF[manifest.engine];
      if (engine && !this.d.engines.resolve(engine)) {
        try {
          job.progress(0, "engine");
          await this.d.engines.ensure(engine, job.signal, (done, all) => job.progress(0, "engine", { bytes: done, totalBytes: all }));
        } catch (e) {
          // the model still installs; activation reports the missing engine
          if ((e as { name?: string }).name === "AbortError" || (e as { pause?: boolean }).pause) throw e;
          this.d.events.emit("engine", { engine, state: "unavailable", reason: (e as Error).message });
        }
      }
      let before = 0;
      for (const f of manifest.files) {
        const url = entry.download?.[f.path];
        if (!url) throw new ApiError("integrity_failed", `No download URL for ${f.path}`);
        const dest = join(stage, f.path.replace(/\//g, "__"));
        if (!existsSync(dest)) {
          await download({
            url, dest, size: f.sha256 === "TODO" ? undefined : f.size, signal: job.signal, fetcher: this.d.fetcher,
            onBytes: (done) => job.progress(((before + done) / total) * 0.9, "downloading", { bytes: before + done, totalBytes: total }),
          });
        }
        before += f.size;
      }
      job.progress(0.9, "verifying");
      for (const f of manifest.files) {
        const p = join(stage, f.path.replace(/\//g, "__"));
        const sha = await sha256File(p, job.signal);
        if (f.sha256 === "TODO" && devMode(this.env)) { f.sha256 = sha; f.size = statSync(p).size; continue; }
        if (sha !== f.sha256 || statSync(p).size !== f.size) {
          rmSync(p, { force: true });
          throw new ApiError("integrity_failed", `Integrity check failed for ${f.path}`, { file: f.path, expected: f.sha256, got: sha });
        }
      }
      requireSigned(manifest, this.d.keys(), this.env);
      job.progress(0.97, "unpacking");
      const finalDir = join(this.d.modelsDir(), manifest.id, manifest.version);
      rmSync(finalDir, { recursive: true, force: true });
      mkdirSync(finalDir, { recursive: true });
      for (const f of manifest.files) {
        const to = join(finalDir, f.path);
        mkdirSync(dirname(to), { recursive: true });
        renameSync(join(stage, f.path.replace(/\//g, "__")), to);
      }
      this.commit(manifest, finalDir);
      rmSync(stage, { recursive: true, force: true });
      return { id: manifest.id, version: manifest.version, path: finalDir };
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === "integrity_failed") rmSync(stage, { recursive: true, force: true });
      if (!(e as { pause?: boolean }).pause && (e as { name?: string }).name !== "AbortError") {
        this.failed.set(manifest.id, { version: manifest.version, error: err?.code || "internal" });
        this.d.events.emit("model", { id: manifest.id, state: "failed", error: err?.code || "internal" });
      }
      throw e;
    }
  }

  /** After files are in place: manifest.json, older versions removed, defaults for tasks that had none. */
  private commit(manifest: Manifest, dir: string): void {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const installedAt = new Date().toISOString();
    writeFileSync(join(dir, ".meta.json"), JSON.stringify({ installedAt }));
    const old = this.index.get(manifest.id);
    if (old && old.dir !== dir) { this.d.unload(manifest.id); rmSync(old.dir, { recursive: true, force: true }); }
    const hadTask = new Set(this.all().filter((m) => m.manifest.id !== manifest.id).flatMap((m) => m.manifest.tasks));
    this.index.set(manifest.id, { manifest, dir, installedAt, lastUsed: null, sizeBytes: manifest.files.reduce((s, f) => s + f.size, 0) });
    let changed = false;
    for (const t of manifest.tasks) {
      if ((TASKS as readonly string[]).includes(t) && !hadTask.has(t) && this.d.settings.data.defaults[t as Task] === "auto") {
        this.d.settings.data.defaults[t as Task] = manifest.id;
        changed = true;
      }
    }
    if (changed) this.d.settings.save();
    this.d.events.emit("model", { id: manifest.id, version: manifest.version, state: "installed" });
  }

  pauseInstall(id: string): JobView {
    const j = this.d.jobs.findActive("install", id);
    if (!j) throw new ApiError("not_found", `No install of ${id} is running`);
    return this.d.jobs.pause(j.id);
  }
  resumeInstall(id: string): JobView {
    const j = this.d.jobs.findActive("install", id);
    if (!j) {
      // nothing paused in this process (e.g. after a restart): start again; the .part files resume
      return this.install(id);
    }
    return this.d.jobs.resume(j.id);
  }
  cancelInstall(id: string): JobView {
    const j = this.d.jobs.findActive("install", id);
    if (!j) throw new ApiError("not_found", `No install of ${id} is running`);
    const v = this.d.jobs.cancel(j.id);
    const entry = this.d.catalog.model(id);
    if (entry) rmSync(this.stagingDir(id, entry.version), { recursive: true, force: true });
    return v;
  }

  /** DELETE /v1/models/{id}: frees its disk space. */
  uninstall(id: string): { id: string; freedMB: number } {
    const j = this.d.jobs.findActive("install", id);
    if (j) this.d.jobs.cancel(j.id);
    const m = this.index.get(id);
    rmSync(join(this.d.modelsDir(), ".staging"), { recursive: true, force: true });
    this.failed.delete(id);
    if (!m) throw new ApiError("model_not_installed", `Model ${id} is not installed`);
    this.d.unload(id);
    rmSync(join(this.d.modelsDir(), id), { recursive: true, force: true });
    this.index.delete(id);
    let changed = false;
    for (const t of TASKS) if (this.d.settings.data.defaults[t] === id) { this.d.settings.data.defaults[t] = "auto"; changed = true; }
    if (changed) this.d.settings.save();
    this.d.events.emit("model", { id, state: "uninstalled" });
    return { id, freedMB: Math.round(m.sizeBytes / 1048576) };
  }

  /** "Checked on every load": the manifest's signature and the files' sizes (full hashes at install/import). */
  verifyForLoad(m: InstalledModel): void {
    requireSigned(m.manifest, this.d.keys(), this.env);
    for (const f of m.manifest.files) {
      const p = join(m.dir, f.path);
      if (!existsSync(p) || statSync(p).size !== f.size) throw new ApiError("integrity_failed", `Model file ${f.path} is missing or changed; reinstall the model`, { id: m.manifest.id });
    }
  }

  /** PUT /v1/defaults */
  setDefaults(body: Record<string, unknown>): Record<Task, string> {
    const next = { ...this.d.settings.data.defaults };
    for (const [k, v] of Object.entries(body)) {
      if (!(TASKS as readonly string[]).includes(k)) throw new ApiError("bad_request", `Unknown task "${k}"`);
      if (typeof v !== "string" || !v) throw new ApiError("bad_request", `"${k}" must be a model id, "auto" or "cloud"`);
      if (v === "cloud" && !this.d.policy().cloudAllowed) throw new ApiError("forbidden_by_policy", "Cloud AI is turned off by your organization");
      if (v !== "auto" && v !== "cloud") {
        const m = this.index.get(v);
        if (!m) throw new ApiError("model_not_installed", `Model ${v} is not installed`, { id: v });
        if (!m.manifest.tasks.includes(k as ModelTask)) throw new ApiError("bad_request", `Model ${v} does not do ${k}`);
        if (!this.policyAllows(v)) throw new ApiError("forbidden_by_policy", `Model ${v} is not approved by your organization`);
      }
      next[k as Task] = v;
    }
    this.d.settings.data.defaults = next;
    this.d.settings.save();
    this.d.events.emit("defaults", next);
    return next;
  }

  /** GET /v1/models/{id}/export: a .wsmodel (tar: manifest.json first, then the files). */
  async exportTo(id: string, out: Writable, signal?: AbortSignal): Promise<void> {
    const m = this.index.get(id);
    if (!m) throw new ApiError("model_not_installed", `Model ${id} is not installed`);
    await writeTar(out, [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(m.manifest, null, 2)) },
      ...m.manifest.files.map((f) => ({ name: `files/${f.path}`, path: join(m.dir, f.path) })),
    ], signal);
  }

  /** POST /v1/models/import: the uploaded .wsmodel at `file` (removed afterwards). */
  importFile(file: string): JobView {
    let manifest: Manifest;
    try {
      const members = listTar(file);
      const mm = members.find((x) => x.name === "manifest.json");
      if (!mm) throw new Error("no manifest.json");
      manifest = JSON.parse(readMember(file, mm).toString("utf8")) as Manifest;
    } catch (e) {
      rmSync(file, { force: true });
      throw new ApiError("unsupported_media", `Not a .wsmodel package: ${(e as Error).message}`);
    }
    try {
      validateManifest(manifest);
      if (!this.policyAllows(manifest.id)) throw new ApiError("forbidden_by_policy", "Not approved by your organization", { id: manifest.id });
      requireSigned(manifest, this.d.keys(), this.env);
      requireDisk(this.d.modelsDir(), manifest.files.reduce((s, f) => s + f.size, 0));
    } catch (e) {
      rmSync(file, { force: true });
      throw e;
    }
    return this.d.jobs.start("import", async (job) => {
      const stage = join(this.d.modelsDir(), ".staging", `import-${manifest.id}-${job.id}`);
      try {
        const members = listTar(file);
        const total = manifest.files.reduce((s, f) => s + f.size, 0) || 1;
        let done = 0;
        for (const f of manifest.files) {
          const mem = members.find((x) => x.name === `files/${f.path}`);
          if (!mem) throw new ApiError("integrity_failed", `The package has no ${f.path}`);
          const dest = memberPath(stage, f.path);
          await extractMember(file, mem, dest, job.signal);
          job.progress((done += f.size) / total * 0.8, "unpacking");
          const sha = await sha256File(dest, job.signal);
          if (sha !== f.sha256 && !(f.sha256 === "TODO" && devMode(this.env))) throw new ApiError("integrity_failed", `Integrity check failed for ${f.path}`, { file: f.path });
        }
        job.progress(0.95, "verifying");
        const finalDir = join(this.d.modelsDir(), manifest.id, manifest.version);
        rmSync(finalDir, { recursive: true, force: true });
        mkdirSync(dirname(finalDir), { recursive: true });
        renameSync(stage, finalDir);
        this.commit(manifest, finalDir);
        return { id: manifest.id, version: manifest.version };
      } finally {
        rmSync(stage, { recursive: true, force: true });
        rmSync(file, { force: true });
      }
    }, { modelId: manifest.id });
  }

  /** POST /v1/storage/move {path}: copies <models> to <path>/models, switches, removes the old copy. */
  move(path: string): JobView {
    if (!path || typeof path !== "string") throw new ApiError("bad_request", '"path" is required');
    if (this.d.jobs.list().some((j) => (j.type === "install" || j.type === "import" || j.type === "storage.move") && ["queued", "running"].includes(j.state))) {
      throw new ApiError("busy", "Wait for installs to finish before moving storage");
    }
    const from = this.d.modelsDir();
    const to = join(path, "models");
    if (to === from) throw new ApiError("bad_request", "That is already the storage folder");
    const bytes = this.all().reduce((s, m) => s + m.sizeBytes, 0);
    requireDisk(path, bytes);
    return this.d.jobs.start("storage.move", async (job) => {
      mkdirSync(to, { recursive: true });
      const ids = this.all();
      let done = 0;
      for (const m of ids) {
        if (job.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        this.d.unload(m.manifest.id);
        cpSync(join(from, m.manifest.id), join(to, m.manifest.id), { recursive: true });
        done += m.sizeBytes;
        job.progress(bytes ? done / bytes : 1, "copying");
      }
      this.d.settings.data.storagePath = path;
      this.d.settings.save();
      this.scan();
      if (existsSync(from)) rmSync(from, { recursive: true, force: true });
      this.d.events.emit("storage", { path: to });
      return { path: to };
    });
  }
}
