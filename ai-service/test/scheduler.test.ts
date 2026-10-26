import { describe, expect, it } from "vitest";
import { ModelPool, Priority, Scheduler } from "../src/scheduler";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scheduler", () => {
  it("runs one heavy job per device, highest priority first", async () => {
    const s = new Scheduler();
    const order: string[] = [];
    let running = 0; let max = 0;
    const job = (name: string) => async () => { running++; max = Math.max(max, running); order.push(name); await sleep(20); running--; };
    const first = s.run("gpu0", Priority.Batch, job("batch-1"));
    await sleep(1);
    const all = [first, s.run("gpu0", Priority.Batch, job("batch-2")), s.run("gpu0", Priority.Interactive, job("text")), s.run("gpu0", Priority.Speech, job("speech"))];
    const other = s.run("cpu", Priority.Batch, job("cpu"));
    await Promise.all([...all, other]);
    expect(order.filter((n) => n !== "cpu")).toEqual(["batch-1", "speech", "text", "batch-2"]);
    expect(max).toBe(2); // gpu0 and cpu in parallel, never two on one device
  });
  it("answers busy when the queue is full and cancels waiting work", async () => {
    const s = new Scheduler(1);
    const hold = s.run("d", Priority.Batch, () => sleep(30));
    const ac = new AbortController();
    const waiting = s.run("d", Priority.Batch, async () => "ran", ac.signal);
    await expect(s.run("d", Priority.Batch, async () => 1)).rejects.toMatchObject({ code: "busy" });
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ code: "cancelled" });
    await hold;
  });
});

describe("model pool", () => {
  const loader = (stops: string[]) => async (id: string) => ({ id, task: "t", memMB: 400, device: "cpu", baseUrl: "", exited: false, stop: () => stops.push(id) });
  it("unloads least recently used models when the cap is reached", async () => {
    let now = 0;
    const stops: string[] = [];
    const pool = new ModelPool(loader(stops), () => 1000, undefined, 600000, () => now);
    const a = await pool.acquire("a", 400); pool.release(a); now = 10;
    const b = await pool.acquire("b", 400); pool.release(b); now = 20;
    const a2 = await pool.acquire("a", 400); pool.release(a2); now = 30; // a is now more recent than b
    await pool.acquire("c", 400);
    expect(stops).toEqual(["b"]);
    expect(pool.list().map((l) => l.id).sort()).toEqual(["a", "c"]);
  });
  it("refuses a model larger than the cap, and models in use are never evicted", async () => {
    const stops: string[] = [];
    const pool = new ModelPool(loader(stops), () => 500);
    await expect(pool.acquire("huge", 900)).rejects.toMatchObject({ code: "insufficient_memory" });
    await pool.acquire("a", 400); // held
    await expect(pool.acquire("b", 400)).rejects.toMatchObject({ code: "insufficient_memory" });
    expect(stops).toEqual([]);
  });
  it("unloads after 10 minutes unused", async () => {
    let now = 0;
    const stops: string[] = [];
    const pool = new ModelPool(loader(stops), () => 9999, undefined, 600000, () => now);
    pool.release(await pool.acquire("a", 100));
    now = 599000; pool.sweep(); expect(stops).toEqual([]);
    now = 600001; pool.sweep(); expect(stops).toEqual(["a"]);
  });
  it("loads a model once for concurrent callers", async () => {
    let loads = 0;
    const pool = new ModelPool(async (id) => { loads++; await sleep(10); return { id, task: "t", memMB: 1, device: "cpu", baseUrl: "", exited: false, stop() {} }; }, () => 100);
    await Promise.all([pool.acquire("a", 1), pool.acquire("a", 1), pool.acquire("a", 1)]);
    expect(loads).toBe(1);
    expect(pool.list()[0].inUse).toBe(3);
  });
});
