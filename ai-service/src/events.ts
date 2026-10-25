// WS /v1/events pushes {type, jobId?, data}: job progress, model state, policy change.
import { EventEmitter } from "node:events";

export interface ServiceEvent { type: string; jobId?: string; data: unknown }

export class EventBus {
  private em = new EventEmitter();
  constructor() { this.em.setMaxListeners(0); }
  emit(type: string, data: unknown, jobId?: string): void {
    const ev: ServiceEvent = jobId ? { type, jobId, data } : { type, data };
    this.em.emit("event", ev);
  }
  on(fn: (e: ServiceEvent) => void): () => void {
    this.em.on("event", fn);
    return () => this.em.off("event", fn);
  }
}
