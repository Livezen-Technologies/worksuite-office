// WS /v1/events pushes {type, jobId?, data}: job progress, model state, policy change.
import { EventEmitter } from "node:events";

export interface ServiceEvent { type: string; jobId?: string; data: unknown }

export class EventBus {
  private em = new EventEmitter();
  constructor() { this.em.setMaxListeners(0); }
  emit(type: string, data: unknown, jobId?: string): void {
    for (const t of [type, ...aliases(type, data)]) this.em.emit("event", jobId ? { type: t, jobId, data } : { type: t, data });
  }
  on(fn: (e: ServiceEvent) => void): () => void {
    this.em.on("event", fn);
    return () => this.em.off("event", fn);
  }
}

/**
 * Finer-grained names sent after each base event, for clients that filter by type:
 * job -> job.progress | job.done | job.failed (| job.paused | job.cancelled), model -> model.state, policy -> policy.changed.
 */
export function aliases(type: string, data: unknown): string[] {
  if (type === "job") {
    const st = (data as { state?: string })?.state;
    if (st === "done") return ["job.done"];
    if (st === "failed") return ["job.failed"];
    if (st === "paused") return ["job.paused"];
    if (st === "cancelled") return ["job.cancelled"];
    return ["job.progress"];
  }
  if (type === "model") return ["model.state"];
  if (type === "policy") return ["policy.changed"];
  return [];
}
