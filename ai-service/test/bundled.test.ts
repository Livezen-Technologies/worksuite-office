// Sinhala voice typing shipped with the app (src/bundled.ts): the model and whisper-server in a "speech"
// folder next to worksuite-ai, checked against the manifest compiled into the service. No catalog,
// approval or download: on a fresh data folder the Sinhala capability is there at once.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const { shipped, MODEL, SHA } = vi.hoisted(() => {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const MODEL = Buffer.alloc(4096, 7);
  return { shipped: mkdtempSync(join(tmpdir(), "ws-bundled-")), MODEL, SHA: createHash("sha256").update(MODEL).digest("hex") };
});

// The service's compiled-in manifest, for a small test file (vi.mock: the real one names the 190 MB model).
vi.mock("../src/bundled", async (orig) => {
  const real = (await orig()) as typeof import("../src/bundled");
  const BUNDLED_STT = { ...real.BUNDLED_STT, files: [{ path: "ggml-small-si-q5_1.bin", size: 4096, sha256: SHA }], evaluation: { si: { wer: 0.2, cer: 0.04, set: "test" } } };
  return { ...real, BUNDLED_STT, checkBundledStt: (cache: string, env = process.env) => real.checkBundledStt(cache, env, BUNDLED_STT) };
});

import { checkBundledStt, BUNDLED_STT } from "../src/bundled";
import { Harness, start, tone, silence } from "./helpers/harness";

function shipModel(bytes: Buffer = MODEL) {
  mkdirSync(shipped, { recursive: true });
  writeFileSync(join(shipped, "ggml-small-si-q5_1.bin"), bytes);
}

describe("checkBundledStt", () => {
  it("absent when the app ships no model", () => {
    const empty = mkdtempSync(join(tmpdir(), "ws-none-"));
    expect(checkBundledStt(join(empty, "cache"), { WS_AI_BUNDLED_DIR: empty })).toEqual({ ok: false, reason: "absent" });
    rmSync(empty, { recursive: true, force: true });
  });
  it("accepts the file with the compiled-in size and SHA-256, and remembers it", () => {
    shipModel();
    const cache = mkdtempSync(join(tmpdir(), "ws-cache-"));
    const c = checkBundledStt(cache, { WS_AI_BUNDLED_DIR: shipped });
    expect(c.ok).toBe(true);
    expect(checkBundledStt(cache, { WS_AI_BUNDLED_DIR: shipped }).ok).toBe(true);
    rmSync(cache, { recursive: true, force: true });
  });
  it("refuses a file of the right size with other bytes, even after a good check was cached", () => {
    shipModel();
    const cache = mkdtempSync(join(tmpdir(), "ws-cache-"));
    expect(checkBundledStt(cache, { WS_AI_BUNDLED_DIR: shipped }).ok).toBe(true);
    const evil = Buffer.from(MODEL); evil[100] ^= 1;
    shipModel(evil);
    utimesSync(join(shipped, "ggml-small-si-q5_1.bin"), new Date(), new Date(Date.now() + 5000)); // a new modification time
    const c = checkBundledStt(cache, { WS_AI_BUNDLED_DIR: shipped });
    expect(c).toMatchObject({ ok: false, reason: "integrity_failed" });
    shipModel();
    rmSync(cache, { recursive: true, force: true });
  });
  it("refuses a file of another size without reading it", () => {
    shipModel(Buffer.alloc(10));
    expect(checkBundledStt(mkdtempSync(join(tmpdir(), "ws-c-")), { WS_AI_BUNDLED_DIR: shipped })).toMatchObject({ ok: false, reason: "integrity_failed" });
    shipModel();
  });
});

describe("the service with the shipped Sinhala model", () => {
  let h: Harness;
  beforeAll(async () => {
    shipModel();
    // a fresh data folder, the catalog's models not installed: only what the app ships
    h = await start({ models: [], env: { WS_AI_BUNDLED_DIR: shipped } });
  });
  afterAll(async () => { await h.close(); rmSync(shipped, { recursive: true, force: true }); });

  it("reports Sinhala speech to text with nothing installed", async () => {
    const info = (await h.call("GET", "/v1/info")).json;
    expect(info.capabilities).toContain("speech.stt");
    expect(info.capabilities).toContain("speech.stt.si");
  });

  it("lists the model as part of the app, and refuses to uninstall it", async () => {
    const list = (await h.call("GET", "/v1/models?task=stt")).json;
    const rows = Array.isArray(list) ? list : list.models;
    expect(rows.find((m: any) => m.id === BUNDLED_STT.id)).toBeTruthy();
    const r = await h.call("DELETE", `/v1/models/${BUNDLED_STT.id}`);
    expect(r.status).toBe(400);
  });

  it("dictates in Sinhala over /v1/speech/stream with the shipped model", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/v1/speech/stream?lang=si&punctuate=true`, { headers: { authorization: `Bearer ${h.token}` } });
    const msgs: any[] = [];
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
    const until = async (fn: () => boolean, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout " + JSON.stringify(msgs)); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => msgs.some((m) => m.type === "state" && m.state === "listening"));
    const send = async (pcm: Buffer) => { for (let o = 0; o < pcm.length; o += 1600) { ws.send(pcm.subarray(o, o + 1600)); await new Promise((r) => setTimeout(r, 2)); } };
    await send(tone(2000)); await send(silence(900));
    await until(() => msgs.some((m) => m.type === "final"));
    ws.send(JSON.stringify({ type: "end" }));
    await closed;
    expect(msgs.find((m) => m.type === "error")).toBeUndefined();
    expect(msgs.find((m) => m.type === "final")).toMatchObject({ lang: "si" });
  });
});
