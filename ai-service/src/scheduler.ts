// Scheduling (spec, Local service architecture): speech before interactive text before batch; one heavy
// job per device (each GPU, and the CPU) at a time; models unload after 10 minutes unused or, least
// recently used first, when loading another would pass the memory cap.
import { ApiError } from "./errors";

export enum Priority { Speech = 0, Interactive = 1, Batch = 2 }

interface Waiter { priority: number; seq: number; start: () => void; reject: (e: unknown) => void; signal?: AbortSignal }

export class Scheduler {
  private busy = new Map<string, boolean>();
  private queues = new Map<string, Waiter[]>();
  private seq = 0;
  constructor(readonly maxQueue = 64) {}

  get depth(): number { let n = 0; for (const q of this.queues.values()) n += q.length; return n; }

  /** Runs `fn` as the device's one heavy job, after anything of higher priority already waiting. */
  async run<T>(device: string, priority: Priority, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(device, priority, signal);
    try {
      return await fn();
    } finally {
      this.release(device);
    }
  }

  private acquire(device: string, priority: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new ApiError("cancelled", "The request was cancelled"));
    if (!this.busy.get(device)) { this.busy.set(device, true); return Promise.resolve(); }
    if (this.depth >= this.maxQueue) return Promise.reject(new ApiError("busy", "The AI service is busy; try again shortly"));
    return new Promise((resolve, reject) => {
      const q = this.queues.get(device) || [];
      const w: Waiter = { priority, seq: this.seq++, start: resolve, reject, signal };
      q.push(w);
      q.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.queues.set(device, q);
      signal?.addEventListener("abort", () => {
        const i = q.indexOf(w);
        if (i >= 0) { q.splice(i, 1); reject(new ApiError("cancelled", "The request was cancelled")); }
      }, { once: true });
    });
  }

  private release(device: string): void {
    const q = this.queues.get(device) || [];
    const next = q.shift();
    if (next) next.start(); else this.busy.set(device, false);
  }
}

export interface Loaded {
  id: string;
  task: string;
  memMB: number;
  lastUsed: number;
  inUse: number;
  device: string;
  baseUrl: string;
  stop(): void;
  readonly exited: boolean;
}

export type Loader = (id: string) => Promise<Omit<Loaded, "lastUsed" | "inUse">>;

export class ModelPool {
  private loaded = new Map<string, Loaded>();
  private loading = new Map<string, Promise<Loaded>>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private loader: Loader, private capMB: () => number, private onChange: (id: string, state: "active" | "unloaded") => void = () => undefined,
    readonly idleMs = 10 * 60 * 1000, private now = () => Date.now()) {}

  list(): Loaded[] { return [...this.loaded.values()]; }
  isLoaded(id: string): boolean { const l = this.loaded.get(id); return !!l && !l.exited; }

  startSweeper(intervalMs = 60000): void {
    this.timer = setInterval(() => this.sweep(), intervalMs);
    this.timer.unref();
  }
  stopSweeper(): void { if (this.timer) clearInterval(this.timer); }

  /** Unloads models unused for idleMs. */
  sweep(): void {
    for (const l of [...this.loaded.values()]) if (l.inUse === 0 && this.now() - l.lastUsed >= this.idleMs) this.unload(l.id);
  }

  unload(id: string): boolean {
    const l = this.loaded.get(id);
    if (!l) return false;
    l.stop();
    this.loaded.delete(id);
    this.onChange(id, "unloaded");
    return true;
  }

  unloadAll(): void { for (const id of [...this.loaded.keys()]) this.unload(id); }

  /** Makes room for `needMB` by unloading idle models, least recently used first. */
  private makeRoom(needMB: number): void {
    const cap = this.capMB();
    const used = () => [...this.loaded.values()].reduce((s, l) => s + l.memMB, 0);
    if (needMB > cap) throw new ApiError("insufficient_memory", `The model needs ${needMB} MB; the limit is ${cap} MB`, { neededMB: needMB, capMB: cap });
    const lru = [...this.loaded.values()].filter((l) => l.inUse === 0).sort((a, b) => a.lastUsed - b.lastUsed);
    while (used() + needMB > cap && lru.length) this.unload(lru.shift()!.id);
    if (used() + needMB > cap) throw new ApiError("insufficient_memory", "Other models in use leave too little memory; try again when they finish", { neededMB: needMB, capMB: cap }, 507);
  }

  /** Loads (once) and marks in use; call release() after. */
  async acquire(id: string, needMB: number): Promise<Loaded> {
    const have = this.loaded.get(id);
    if (have && !have.exited) { have.inUse++; have.lastUsed = this.now(); return have; }
    if (have) this.loaded.delete(id);
    let p = this.loading.get(id);
    if (!p) {
      this.makeRoom(needMB);
      p = this.loader(id).then((l) => {
        const full: Loaded = Object.assign(l, { lastUsed: this.now(), inUse: 0 });
        this.loaded.set(id, full);
        this.onChange(id, "active");
        return full;
      }).finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    const l = await p;
    l.inUse++;
    l.lastUsed = this.now();
    return l;
  }

  release(l: Loaded): void {
    l.inUse = Math.max(0, l.inUse - 1);
    l.lastUsed = this.now();
  }
}
