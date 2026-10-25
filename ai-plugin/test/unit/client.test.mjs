// The /v1 client against a mock worksuite-ai service (the real one is built elsewhere; this follows the spec's contract).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { lib } from "./helpers.mjs";

const { createClient, ServiceError, qs } = lib("client");
let server, port, token = "t1";
const seen = [];
const jobs = {};

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, rid: req.headers["x-request-id"], type: req.headers["content-type"], body });
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== "Bearer " + token) return send(401, { error: { code: "unauthorized", message: "bad token", retryable: false } });
    if (req.url === "/v1/info") return send(200, { apiVersion: "1.3", capabilities: ["text.check"] });
    if (req.url === "/v1/text/check") return send(200, { lang: "en", issues: [{ start: 0, end: 3, kind: "spelling", message: "Spelling", replacements: ["The"], confidence: 0.9 }] });
    if (req.url === "/v1/text/transform") return send(503, { error: { code: "busy", message: "busy", retryable: true } });
    if (req.url === "/v1/text/complete") { setTimeout(() => send(200, { words: [], ghost: { text: " world", score: 0.8 } }), 300); return; }
    if (req.url.startsWith("/v1/requests/")) { res.writeHead(204); return res.end(); }
    if (req.url === "/v1/speech/transcribe") { jobs.j1 = 0; return send(202, { jobId: "j1" }); }
    if (req.url === "/v1/jobs/j1") {
      jobs.j1++;
      return send(200, jobs.j1 < 3 ? { state: "running", progress: jobs.j1 / 3 } : { state: "done", result: { lang: "en", durationSec: 2, segments: [{ start: 0, end: 2, text: "hi" }] } });
    }
    if (req.url === "/v1/jobs/bad") return send(200, { state: "failed", error: { code: "unsupported_media", message: "nope" } });
    if (req.url === "/v1/tts/synthesize") { res.writeHead(200, { "content-type": "audio/wav" }); return res.end(Buffer.from("RIFF")); }
    if (req.url === "/v1/models?task=diarize") return send(200, []);
    send(404, { error: { code: "internal", message: "no route " + req.url } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => server.close());

function discovery() {
  let current = null, resolves = 0;
  return {
    resolve: async () => (current ||= (resolves++, { base: `http://127.0.0.1:${port}/v1`, token, port })),
    invalidate: () => { current = null; },
    current: () => current,
    count: () => resolves
  };
}

test("sends the bearer token and parses JSON", async () => {
  const c = createClient({ discovery: discovery() });
  const info = await c.info();
  assert.equal(info.apiVersion, "1.3");
  assert.equal(seen.at(-1).auth, "Bearer " + token);
});

test("POST bodies are JSON", async () => {
  const c = createClient({ discovery: discovery() });
  const r = await c.check({ text: "teh cat", lang: "en", kinds: ["spelling"] });
  assert.equal(r.issues[0].replacements[0], "The");
  assert.equal(seen.at(-1).type, "application/json");
  assert.deepEqual(JSON.parse(seen.at(-1).body), { text: "teh cat", lang: "en", kinds: ["spelling"] });
});

test("errors become ServiceError with the service's code and retryable flag", async () => {
  const c = createClient({ discovery: discovery() });
  await assert.rejects(c.transform({ text: "x", op: "improve" }), (e) => e.code === "busy" && e.retryable === true && e.status === 503);
});

test("a 401 (the service restarted with a new token) re-discovers once and retries", async () => {
  const d = discovery();
  const c = createClient({ discovery: d });
  await c.info();
  token = "t2"; // rotated; the old endpoint is stale, the next discovery returns t2
  const info = await c.info();
  assert.equal(info.apiVersion, "1.3");
  assert.equal(d.count(), 2);
});

test("a refused connection is service_unavailable", async () => {
  const c = createClient({ endpoint: { base: "http://127.0.0.1:9/v1", token: "x" } });
  await assert.rejects(c.info(), (e) => e.code === "service_unavailable");
});

test("discovery failures surface their code", async () => {
  const c = createClient({ discovery: { resolve: async () => { throw Object.assign(new Error("x"), { code: "not_installed" }); }, invalidate() {}, current: () => null } });
  await assert.rejects(c.info(), (e) => e.code === "not_installed");
});

test("cancellable: X-Request-Id, abort cancels the fetch and DELETEs /v1/requests/{id}", async () => {
  const c = createClient({ discovery: discovery() });
  const req = c.complete({ text: "hello", caret: 5, lang: "en", mode: "phrase", max: 5 });
  assert.match(req.id, /^wsai-/);
  await new Promise((r) => setTimeout(r, 50));
  req.abort();
  await assert.rejects(req.promise, (e) => e.code === "cancelled");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((s) => s.url === "/v1/text/complete" && s.rid === req.id));
  assert.ok(seen.some((s) => s.method === "DELETE" && s.url === "/v1/requests/" + req.id));
});

test("a finished cancellable request is not cancelled", async () => {
  const c = createClient({ discovery: discovery() });
  const req = c.complete({ text: "hello", caret: 5 });
  const r = await req.promise;
  assert.equal(r.ghost.text, " world");
  const n = seen.length;
  req.abort();
  assert.equal(seen.length, n);
});

test("transcribe posts multipart and waitJob follows the job to its result", async () => {
  const c = createClient({ discovery: discovery() });
  const job = await c.transcribe(new Blob(["RIFF"], { type: "audio/wav" }), { lang: "en", punctuate: true, timestamps: true, diarize: false });
  assert.equal(job.jobId, "j1");
  assert.match(seen.at(-1).type, /^multipart\/form-data/);
  assert.match(seen.at(-1).body, /name="options"[\s\S]*"timestamps":true/);
  const progress = [];
  const result = await c.waitJob("j1", (j) => progress.push(j.state), { intervalMs: 5 });
  assert.deepEqual(progress, ["running", "running", "done"]);
  assert.equal(result.segments[0].text, "hi");
  await assert.rejects(c.waitJob("bad", null, { intervalMs: 5 }), (e) => e.code === "unsupported_media");
});

test("synthesize returns the audio bytes", async () => {
  const c = createClient({ discovery: discovery() });
  const buf = await c.synthesize({ text: "hi", voice: "v", format: "wav" });
  assert.equal(Buffer.from(buf).toString(), "RIFF");
});

test("the speech stream: ws:// URL with the query, token as a subprotocol", async () => {
  let made = null;
  class FakeWS { constructor(url, protocols) { made = { url, protocols }; } }
  const c = createClient({ discovery: discovery(), WebSocket: FakeWS });
  const ws = await c.speechStream({ lang: "en", punctuate: true, model: "" });
  assert.equal(made.url, `ws://127.0.0.1:${port}/v1/speech/stream?lang=en&punctuate=true`);
  assert.deepEqual(made.protocols, ["ws-ai.v1", "bearer." + token]);
  assert.equal(ws.binaryType, "arraybuffer");
});

test("qs leaves out empty values", () => {
  assert.equal(qs({ task: "stt", lang: "", x: null }), "?task=stt");
  assert.equal(qs({}), "");
  assert.ok(ServiceError("x").name === "ServiceError");
});
