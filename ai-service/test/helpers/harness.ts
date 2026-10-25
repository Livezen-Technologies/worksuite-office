import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Service } from "../../src/server";
import { newKeyPair, signDoc } from "../../src/signing";
import { manifestOf } from "../../src/manifest";
import { normalizePolicy, Policy, RawPolicy } from "../../src/policy";

export const FIX = resolve(__dirname, "../fixtures");
export const keys = newKeyPair();
export const CATALOG_URL = "https://uc.test/api/v1/ai/catalog";
export const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export interface FakeNet {
  files: Map<string, Buffer>;
  /** urls whose first transfer breaks halfway */
  dropOnce: Set<string>;
  rangeRequests: string[];
  fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export function fakeNet(): FakeNet {
  const net: FakeNet = {
    files: new Map(), dropOnce: new Set(), rangeRequests: [],
    fetch: async (u, init) => {
      const url = String(u);
      const data = net.files.get(url);
      if (!data) return new Response("not found", { status: 404 });
      const range = new Headers(init?.headers).get("range");
      let start = 0;
      if (range) { start = Number(/bytes=(\d+)-/.exec(range)![1]); net.rangeRequests.push(`${url} ${range}`); }
      const body = data.subarray(start);
      const drop = net.dropOnce.has(url);
      if (drop) net.dropOnce.delete(url);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(drop ? body.subarray(0, Math.floor(body.length / 2)) : body));
          if (!drop) c.close();
        },
        pull(c) { if (drop) setTimeout(() => c.error(new Error("connection reset")), 5); },
      });
      return new Response(stream, { status: range ? 206 : 200, headers: { "content-length": String(body.length) } });
    },
  };
  return net;
}

export interface ModelSpec { id: string; tasks: string[]; engine: string; files: Record<string, Buffer>; languages?: string[]; ramMB?: number; evaluation?: unknown; voice?: unknown; approved?: boolean; sign?: boolean; badSha?: boolean; version?: string }

export function catalogEntry(m: ModelSpec, net: FakeNet) {
  const files = Object.entries(m.files).map(([path, data]) => {
    const url = `https://models.test/${m.id}/${path}`;
    net.files.set(url, data);
    return { path, size: data.length, sha256: m.badSha ? "0".repeat(64) : sha(data), url };
  });
  const entry: Record<string, unknown> = {
    id: m.id, name: m.id, version: m.version || "1.0.0", tasks: m.tasks, languages: m.languages || ["en"], engine: m.engine,
    files: files.map(({ url: _u, ...f }) => f), ramMB: m.ramMB ?? 100, backends: ["cpu"], license: "MIT",
    ...(m.evaluation ? { evaluation: m.evaluation } : {}), ...(m.voice ? { voice: m.voice } : {}),
  };
  const signed = m.sign === false ? entry : signDoc(manifestOf(entry) as unknown as Record<string, unknown>, keys.privateKey);
  return { ...entry, signature: (signed as { signature?: string }).signature, download: Object.fromEntries(files.map((f) => [f.path, f.url])), approved: m.approved ?? true };
}

export function publishCatalog(net: FakeNet, models: ModelSpec[]): void {
  const doc = { schema: 1, version: "test", models: models.map((m) => catalogEntry(m, net)), engines: [] };
  net.files.set(CATALOG_URL, Buffer.from(JSON.stringify(signDoc(doc, keys.privateKey))));
}

export const STD_MODELS: ModelSpec[] = [
  { id: "whisper-test", tasks: ["stt"], engine: "whisper.cpp", files: { "ggml.bin": Buffer.alloc(3000, 7) } },
  { id: "llm-test", tasks: ["correction", "suggestions", "translation", "assistant"], engine: "llama.cpp", files: { "m.gguf": Buffer.alloc(5000, 3) } },
  { id: "voice-test", tasks: ["tts"], engine: "piper", files: { "v.onnx": Buffer.alloc(100, 1), "v.onnx.json": Buffer.from("{}") }, voice: { lang: "en", gender: "female", quality: "medium", sampleRate: 22050 } },
];

export interface Harness {
  svc: Service; port: number; token: string; net: FakeNet; dir: string; policy: { raw: RawPolicy | null };
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any; res: Response }>;
  install(id: string): Promise<any>;
  restart(): Promise<Harness>;
  close(): Promise<void>;
}

export async function start(opts: { models?: ModelSpec[]; env?: Record<string, string>; dir?: string; net?: FakeNet; policy?: { raw: RawPolicy | null } } = {}): Promise<Harness> {
  const dir = opts.dir || mkdtempSync(join(tmpdir(), "wsai-"));
  const net = opts.net || fakeNet();
  if (!opts.net) publishCatalog(net, opts.models || STD_MODELS);
  const policy = opts.policy || { raw: null as RawPolicy | null };
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, WS_AI_TRUSTED_KEYS: keys.publicKey, WS_AI_CATALOG_URL: CATALOG_URL,
    WS_AI_WHISPER_SERVER: join(FIX, "fake-whisper.mjs"), WS_AI_LLAMA_SERVER: join(FIX, "fake-llama.mjs"), WS_AI_PIPER: join(FIX, "fake-piper.mjs"),
    WS_AI_GHOST_TIMEOUT_MS: "3000",
    ...opts.env,
  };
  const svc = new Service({
    dataDir: dir, env, fetcher: net.fetch as never, idleExitMs: 0,
    hardwareRunner: async () => null,
    policyReader: async (): Promise<Policy> => normalizePolicy(policy.raw),
  });
  await svc.init();
  const port = await svc.listen(0);
  await svc.catalog.refresh();
  const h: Harness = {
    svc, port, token: svc.token, net, dir, policy,
    async call(method, path, body, headers = {}) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method, headers: { authorization: `Bearer ${svc.token}`, ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === "string" || body instanceof FormData ? (body as never) : JSON.stringify(body),
      });
      const ct = res.headers.get("content-type") || "";
      const json = ct.includes("json") ? await res.json() : null;
      return { status: res.status, json, res };
    },
    async install(id) {
      const r = await h.call("POST", `/v1/models/${id}/install`, {});
      if (r.status !== 202) throw new Error(`install ${id}: ${r.status} ${JSON.stringify(r.json)}`);
      return svc.jobs.wait(r.json.jobId);
    },
    async restart() { await svc.close(); return start({ ...opts, dir, net, policy }); },
    async close() { await svc.close(); if (!opts.dir) rmSync(dir, { recursive: true, force: true }); },
  };
  return h;
}

/** 16 kHz s16le: `ms` of a loud tone or of silence */
export function tone(ms: number, amp = 8000): Buffer {
  const n = Math.round((16000 * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * amp), i * 2);
  return b;
}
export const silence = (ms: number) => Buffer.alloc(Math.round((16000 * ms) / 1000) * 2);
