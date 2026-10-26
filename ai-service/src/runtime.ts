// Ties installed models to running engines: load on first use (verify, start the engine process),
// schedule the work on the model's device, unload by the pool's rules.
import { ApiError } from "./errors";
import type { InstalledModel, ModelStore } from "./models";
import type { EngineRegistry, EngineId } from "./engines/registry";
import { Loaded, ModelPool, Priority, Scheduler } from "./scheduler";
import { startLlama, startWhisper } from "./engines/clients";
import type { ModelTask } from "./manifest";
import type { JobManager } from "./jobs";
import type { EventBus } from "./events";
import type { Policy } from "./policy";
import { totalmem } from "node:os";

const ENGINE: Record<string, EngineId> = { "whisper.cpp": "whisper.cpp", "llama.cpp": "llama.cpp", piper: "piper" };

export class Runtime {
  readonly pool: ModelPool;
  readonly scheduler = new Scheduler();
  private engineJobs = new Map<string, string>();

  constructor(private models: ModelStore, private engines: EngineRegistry, private jobs: JobManager, private events: EventBus, private policy: () => Policy) {
    this.pool = new ModelPool((id) => this.load(id), () => this.capMB(), (id, state) => this.events.emit("model", { id, state: state === "active" ? "active" : "installed" }));
  }

  capMB(): number {
    const own = Math.round((totalmem() / 1048576) * 0.7);
    const p = this.policy().maxMemMB;
    return p > 0 ? Math.min(p, own) : own;
  }

  private ensureEngineInBackground(engine: EngineId): void {
    const running = this.engineJobs.get(engine);
    if (running) {
      try {
        const j = this.jobs.get(running);
        if (["queued", "running"].includes(j.state)) return;
      } catch { /* trimmed */ }
    }
    const j = this.jobs.start("engine.install", async (job) => {
      await this.engines.ensure(engine, job.signal, (d, t) => job.progress(t ? d / t : 0, "downloading"));
      return { engine };
    });
    this.engineJobs.set(engine, j.id);
  }

  private async load(id: string): Promise<Omit<Loaded, "lastUsed" | "inUse">> {
    const m = this.models.get(id);
    if (!m) throw new ApiError("model_not_installed", `Model ${id} is not installed`, { id });
    this.models.verifyForLoad(m);
    const engine = ENGINE[m.manifest.engine];
    const cmd = this.engines.resolve(engine);
    if (!cmd) {
      if (this.engines.pick(engine)) {
        this.ensureEngineInBackground(engine);
        throw new ApiError("model_loading", `Installing the ${engine} engine; try again shortly`, { engine });
      }
      throw new ApiError("capability_unavailable", `The ${engine} engine is not available on this computer`, { engine });
    }
    const device = cmd.backend === "cpu" ? "cpu" : "gpu0";
    const task = m.manifest.tasks[0];
    if (engine === "piper") {
      return { id, task, memMB: m.manifest.ramMB, device, baseUrl: "", stop: () => undefined, exited: false };
    }
    const proc = engine === "whisper.cpp"
      ? await startWhisper(cmd, m.manifest, m.dir, { tdrz: m.manifest.tasks.includes("diarization") })
      : await startLlama(cmd, m.manifest, m.dir);
    return {
      id, task, memMB: m.manifest.ramMB, device, baseUrl: proc.baseUrl,
      stop: () => proc.stop(),
      get exited() { return proc.exited; },
    };
  }

  /** Runs fn with the model for a task loaded, as its device's heavy job at `priority`. */
  async withModel<T>(task: ModelTask, explicit: string | null | undefined, priority: Priority, fn: (l: Loaded, m: InstalledModel) => Promise<T>, signal?: AbortSignal, model?: InstalledModel): Promise<T> {
    const m = model || this.models.resolve(task, explicit);
    const l = await this.pool.acquire(m.manifest.id, m.manifest.ramMB);
    try {
      this.models.touch(m.manifest.id);
      return await this.scheduler.run(l.device, priority, () => fn(l, m), signal);
    } finally {
      this.pool.release(l);
    }
  }

  async activate(id: string): Promise<Loaded> {
    const m = this.models.get(id);
    if (!m) throw new ApiError("model_not_installed", `Model ${id} is not installed`, { id });
    if (!this.models.policyAllows(id)) throw new ApiError("forbidden_by_policy", "Not approved by your organization", { id });
    const l = await this.pool.acquire(id, m.manifest.ramMB);
    this.pool.release(l);
    return l;
  }

  deactivate(id: string): boolean { return this.pool.unload(id); }
}
