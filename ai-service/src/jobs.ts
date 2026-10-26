// Long work returns 202 {jobId}; GET /v1/jobs/{id} -> {id, type, state, progress, stage?, result?, error?}.
// States: queued | running | paused | done | failed | cancelled.
import { randomUUID } from "node:crypto";
import { ApiError, isAbort, toApiError } from "./errors";
import type { EventBus } from "./events";

export type JobState = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

export interface JobView {
  id: string;
  type: string;
  state: JobState;
  /** 0..1 */
  progress: number;
  /** e.g. downloading | verifying | unpacking | ready | transcribing */
  stage?: string;
  modelId?: string;
  result?: unknown;
  error?: ReturnType<ApiError["toJSON"]>["error"];
  createdAt: string;
  updatedAt: string;
}

export interface JobControl {
  readonly id: string;
  readonly signal: AbortSignal;
  progress(progress: number, stage?: string, extra?: Record<string, unknown>): void;
  /** partial results (transcription segments) */
  partial(data: unknown): void;
}

type Runner = (job: JobControl) => Promise<unknown>;

interface Job {
  view: JobView;
  run: Runner;
  abort: AbortController;
  pauseRequested: boolean;
  resumable: boolean;
}

export class JobManager {
  private jobs = new Map<string, Job>();
  constructor(private events: EventBus, private keep = 200) {}

  start(type: string, run: Runner, opts: { modelId?: string; resumable?: boolean } = {}): JobView {
    const now = new Date().toISOString();
    const job: Job = {
      view: { id: randomUUID(), type, state: "queued", progress: 0, createdAt: now, updatedAt: now, ...(opts.modelId ? { modelId: opts.modelId } : {}) },
      run, abort: new AbortController(), pauseRequested: false, resumable: !!opts.resumable,
    };
    this.jobs.set(job.view.id, job);
    this.trim();
    this.emit(job);
    setImmediate(() => void this.execute(job));
    return { ...job.view };
  }

  private async execute(job: Job): Promise<void> {
    if (job.view.state === "cancelled" || job.view.state === "paused") return;
    job.view.state = "running";
    this.touch(job);
    const ctl: JobControl = {
      id: job.view.id,
      signal: job.abort.signal,
      progress: (p, stage, extra) => {
        job.view.progress = Math.max(0, Math.min(1, p));
        if (stage) job.view.stage = stage;
        this.touch(job, extra);
      },
      partial: (data) => this.events.emit("job.partial", data, job.view.id),
    };
    try {
      const result = await job.run(ctl);
      job.view.state = "done";
      job.view.progress = 1;
      job.view.stage = "ready";
      if (result !== undefined) job.view.result = result;
    } catch (e) {
      if ((e as { pause?: boolean })?.pause) {
        // network lost: paused, resumes from the last byte
        job.view.state = "paused";
        job.view.error = { code: "busy", message: (e as Error).message, retryable: true };
      } else if (isAbort(e) && job.pauseRequested) job.view.state = "paused";
      else if (isAbort(e)) job.view.state = "cancelled";
      else { job.view.state = "failed"; job.view.error = toApiError(e).toJSON().error; }
    }
    this.touch(job);
  }

  get(id: string): JobView {
    const j = this.jobs.get(id);
    if (!j) throw new ApiError("not_found", "No such job");
    return { ...j.view };
  }
  list(): JobView[] { return [...this.jobs.values()].map((j) => ({ ...j.view })); }
  /** The newest job of a type for a model that is still going (install pause/resume address the model). */
  findActive(type: string, modelId: string): JobView | undefined {
    const all = [...this.jobs.values()].filter((j) => j.view.type === type && j.view.modelId === modelId && ["queued", "running", "paused"].includes(j.view.state));
    return all.length ? { ...all[all.length - 1].view } : undefined;
  }

  cancel(id: string): JobView {
    const j = this.jobs.get(id);
    if (!j) throw new ApiError("not_found", "No such job");
    if (j.view.state === "paused" || j.view.state === "queued") { j.view.state = "cancelled"; this.touch(j); }
    j.pauseRequested = false;
    j.abort.abort();
    return { ...j.view };
  }

  pause(id: string): JobView {
    const j = this.jobs.get(id);
    if (!j) throw new ApiError("not_found", "No such job");
    if (!j.resumable) throw new ApiError("bad_request", "This job cannot be paused");
    if (j.view.state === "running" || j.view.state === "queued") {
      j.pauseRequested = true;
      if (j.view.state === "queued") { j.view.state = "paused"; this.touch(j); }
      j.abort.abort();
    }
    return { ...j.view };
  }

  resume(id: string): JobView {
    const j = this.jobs.get(id);
    if (!j) throw new ApiError("not_found", "No such job");
    if (j.view.state !== "paused" && j.view.state !== "failed") return { ...j.view };
    j.pauseRequested = false;
    j.abort = new AbortController();
    delete j.view.error;
    j.view.state = "queued";
    this.touch(j);
    setImmediate(() => void this.execute(j));
    return { ...j.view };
  }

  /** waits for a terminal (or paused) state; for tests and internal chaining */
  wait(id: string, timeoutMs = 30000): Promise<JobView> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const j = this.jobs.get(id);
        if (!j) return reject(new Error("no job"));
        if (["done", "failed", "cancelled", "paused"].includes(j.view.state)) return resolve({ ...j.view });
        if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout waiting for job " + j.view.state));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  get runningCount(): number { return [...this.jobs.values()].filter((j) => j.view.state === "running" || j.view.state === "queued").length; }

  private touch(job: Job, extra?: Record<string, unknown>): void {
    job.view.updatedAt = new Date().toISOString();
    this.emit(job, extra);
  }
  private emit(job: Job, extra?: Record<string, unknown>): void {
    this.events.emit("job", { ...job.view, ...(extra || {}) }, job.view.id);
  }
  private trim(): void {
    if (this.jobs.size <= this.keep) return;
    for (const [id, j] of this.jobs) {
      if (this.jobs.size <= this.keep) break;
      if (["done", "failed", "cancelled"].includes(j.view.state)) this.jobs.delete(id);
    }
  }
}
