import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Harness, publishCatalog, fakeNet, start, ModelSpec, STD_MODELS } from "./helpers/harness";
import { requireDisk } from "../src/download";
import WebSocket from "ws";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

const big: ModelSpec = { id: "big-whisper", tasks: ["stt"], engine: "whisper.cpp", files: { "ggml-big.bin": Buffer.alloc(200000, 9) } };

describe("model install", () => {
  it("installs a signed model: job states, events, defaults, files on disk; survives a restart; uninstall frees it", async () => {
    h = await start();
    const events: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/v1/events`, { headers: { authorization: `Bearer ${h.token}` } });
    await new Promise((r) => ws.on("open", r));
    ws.on("message", (d) => events.push(JSON.parse(String(d))));
    const r = await h.call("POST", "/v1/models/whisper-test/install", {});
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ jobId: expect.any(String) });
    const job = await h.svc.jobs.wait(r.json.jobId);
    expect(job).toMatchObject({ state: "done", progress: 1, type: "install", modelId: "whisper-test" });
    const j = await h.call("GET", `/v1/jobs/${r.json.jobId}`);
    expect(j.json).toMatchObject({ id: r.json.jobId, state: "done" });
    await new Promise((x) => setTimeout(x, 50));
    const stages = events.filter((e) => e.type === "job").map((e) => e.data.stage).filter(Boolean);
    expect(stages).toContain("downloading");
    expect(stages).toContain("verifying");
    expect(events.some((e) => e.type === "model" && e.data.state === "installed")).toBe(true);
    expect(events.some((e) => e.type === "model.state" && e.data.state === "installed")).toBe(true);
    expect(events.some((e) => e.type === "job.progress")).toBe(true);
    expect(events.some((e) => e.type === "job.done" && e.jobId === r.json.jobId)).toBe(true);
    ws.close();

    const list = await h.call("GET", "/v1/models");
    expect(list.json).toEqual([expect.objectContaining({ id: "whisper-test", version: "1.0.0", tasks: ["stt"], state: "installed", sizeMB: 0, path: expect.any(String), isDefaultFor: ["stt"], lastUsed: null })]);
    expect(existsSync(join(list.json[0].path, "ggml.bin"))).toBe(true);

    h = await h.restart();
    expect((await h.call("GET", "/v1/models?task=stt")).json.map((m: any) => m.id)).toEqual(["whisper-test"]);
    expect((await h.call("GET", "/v1/models?task=tts")).json).toEqual([]);
    const del = await h.call("DELETE", "/v1/models/whisper-test");
    expect(del.status).toBe(200);
    expect(existsSync(list.json[0].path)).toBe(false);
    expect((await h.call("GET", "/v1/defaults")).json.stt).toBe("auto");
  });

  it("fails an integrity check, deletes the file and can be retried", async () => {
    h = await start({ models: [{ ...STD_MODELS[0], badSha: true }] });
    const job = await h.install("whisper-test");
    expect(job.state).toBe("failed");
    expect(job.error.code).toBe("integrity_failed");
    expect(readdirSync(join(h.dir, "models", ".staging"))).toEqual([]);
    expect((await h.call("GET", "/v1/models")).json[0]).toMatchObject({ id: "whisper-test", state: "failed" });
  });

  it("pauses when the network drops and resumes from the last byte", async () => {
    const net = fakeNet();
    publishCatalog(net, [big]);
    net.dropOnce.add("https://models.test/big-whisper/ggml-big.bin");
    h = await start({ net });
    const job = await h.install("big-whisper");
    expect(job.state).toBe("paused");
    const r = await h.call("POST", "/v1/models/big-whisper/resume", {});
    expect(r.status).toBe(202);
    const done = await h.svc.jobs.wait(r.json.jobId);
    expect(done.state).toBe("done");
    expect(net.rangeRequests).toEqual(["https://models.test/big-whisper/ggml-big.bin bytes=100000-"]);
  });

  it("pause and cancel by the user", async () => {
    const net = fakeNet();
    publishCatalog(net, [big]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const orig = net.fetch;
    net.fetch = async (u, i) => { if (String(u).includes("ggml-big")) await gate; return orig(u, i); };
    h = await start({ net });
    const r = await h.call("POST", "/v1/models/big-whisper/install", {});
    await new Promise((x) => setTimeout(x, 30));
    const p = await h.call("POST", "/v1/models/big-whisper/pause", {});
    expect(p.status).toBe(200);
    release();
    expect((await h.svc.jobs.wait(r.json.jobId)).state).toBe("paused");
    const c = await h.call("DELETE", `/v1/jobs/${r.json.jobId}`);
    expect(c.json.state).toBe("cancelled");
    expect(existsSync(join(h.dir, "models", ".staging", "big-whisper-1.0.0"))).toBe(false);
  });

  it("refuses unsigned or unapproved models unless WS_AI_DEV=1", async () => {
    h = await start({ models: [{ ...STD_MODELS[0], sign: false }, { ...STD_MODELS[1], approved: false }] });
    const r = await h.call("POST", "/v1/models/whisper-test/install", {});
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("integrity_failed");
    const u = await h.call("POST", "/v1/models/llm-test/install", {});
    expect(u.json.error.code).toBe("forbidden_by_policy");
    await h.close();
    h = await start({ models: [{ ...STD_MODELS[0], sign: false }], env: { WS_AI_DEV: "1" } });
    expect((await h.install("whisper-test")).state).toBe("done");
  });

  it("checks disk space before downloading", () => {
    expect(() => requireDisk("/", 10 * 1048576, 50 * 1048576)).toThrow(/Not enough disk space/);
    try { requireDisk("/", 10 * 1048576, 50 * 1048576); } catch (e: any) { expect(e.code).toBe("insufficient_disk"); expect(e.detail.neededMB).toBe(111); }
    expect(() => requireDisk("/", 10 * 1048576, 500 * 1048576)).not.toThrow();
  });

  it("exports and imports a .wsmodel, and moves storage", async () => {
    h = await start();
    await h.install("voice-test");
    const ex = await h.call("GET", "/v1/models/voice-test/export");
    expect(ex.status).toBe(200);
    const pkg = Buffer.from(await ex.res.arrayBuffer());
    expect(pkg.length % 512).toBe(0);
    await h.call("DELETE", "/v1/models/voice-test");
    const fd = new FormData();
    fd.append("file", new Blob([pkg]), "voice-test.wsmodel");
    const im = await h.call("POST", "/v1/models/import", fd);
    expect(im.status).toBe(202);
    expect((await h.svc.jobs.wait(im.json.jobId)).state).toBe("done");
    expect((await h.call("GET", "/v1/models")).json.map((m: any) => m.id)).toEqual(["voice-test"]);
    // a tampered package is refused
    const bad = Buffer.from(pkg); bad[bad.indexOf(Buffer.from("voice-test")) + 1] ^= 1;
    const fd2 = new FormData(); fd2.append("file", new Blob([bad]), "x.wsmodel");
    const im2 = await h.call("POST", "/v1/models/import", fd2);
    expect([415, 422]).toContain(im2.status);

    const target = mkdtempSync(join(tmpdir(), "wsai-move-"));
    const mv = await h.call("POST", "/v1/storage/move", { path: target });
    expect(mv.status).toBe(202);
    expect((await h.svc.jobs.wait(mv.json.jobId)).state).toBe("done");
    const st = await h.call("GET", "/v1/storage");
    expect(st.json.path).toBe(join(target, "models"));
    expect(existsSync(join(target, "models", "voice-test", "1.0.0", "v.onnx"))).toBe(true);
    void writeFileSync;
  });
});
