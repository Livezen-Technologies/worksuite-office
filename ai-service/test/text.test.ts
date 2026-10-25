import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, start } from "./helpers/harness";
import { applyEdits } from "../src/text/diff";

let h: Harness;
beforeAll(async () => {
  h = await start();
  for (const id of ["llm-test", "voice-test"]) expect((await h.install(id)).state).toBe("done");
});
afterAll(async () => { await h.close(); });

describe("text", () => {
  it("completes English words from the dictionary, fast", async () => {
    const t0 = performance.now();
    const r = await h.call("POST", "/v1/text/complete", { text: "I want to underst", caret: 17, lang: "en", mode: "word", max: 3 });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.json.words[0]).toEqual({ text: "understand", source: "dictionary", score: expect.any(Number) });
    expect(r.json.words.length).toBeLessThanOrEqual(3);
    expect(r.json.ghost).toBeUndefined();
  });
  it("completes Singlish and Sinhala", async () => {
    const s = await h.call("POST", "/v1/text/complete", { text: "mage amma", caret: 9, lang: "si", singlish: true });
    expect(s.json.words[0].text).toBe("අම්මා");
    const p = await h.call("POST", "/v1/text/complete", { text: "ශ්‍රී ලං", caret: 8, lang: "auto" });
    expect(p.json.words.length).toBeGreaterThan(0);
    for (const w of p.json.words) expect(w.text.startsWith("ලං")).toBe(true);
  });
  it("adds model ghost text once the model is loaded", async () => {
    await h.call("POST", "/v1/models/llm-test/activate", {});
    const r = await h.call("POST", "/v1/text/complete", { text: "The meeting is ", caret: 15, lang: "en", mode: "phrase" });
    expect(r.json.ghost).toEqual({ text: "and more", score: expect.any(Number) });
    expect((await h.call("GET", "/v1/health")).json.loadedModels).toEqual([{ id: "llm-test", task: "correction", memMB: 100 }]);
  });
  it("cancels a request by X-Request-Id", async () => {
    const p = h.call("POST", "/v1/openai/chat/completions", { messages: [{ role: "user", content: "hi" }] }, { "x-request-id": "req-1" });
    const c = await h.call("DELETE", "/v1/requests/req-1");
    expect(c.json).toEqual({ id: "req-1", cancelled: expect.any(Boolean) });
    await p;
  });
  it("checks spelling from dictionaries and grammar from the model, validating its offsets", async () => {
    const text = "I dont recieve teh mail.";
    const r = await h.call("POST", "/v1/text/check", { text, lang: "en", kinds: ["spelling", "grammar", "punctuation"] });
    expect(r.json.lang).toBe("en");
    const byKind = (k: string) => r.json.issues.filter((i: any) => i.kind === k).map((i: any) => text.slice(i.start, i.end));
    expect(byKind("spelling")).toEqual(expect.arrayContaining(["recieve", "teh"]));
    expect(byKind("grammar")).toEqual(["dont"]);
    expect(r.json.issues.find((i: any) => text.slice(i.start, i.end) === "teh").replacements[0]).toBe("the");
    for (const i of r.json.issues) expect(i).toEqual({ start: expect.any(Number), end: expect.any(Number), kind: expect.any(String), message: expect.any(String), replacements: expect.any(Array), confidence: expect.any(Number) });
  });
  it("skips Sinhala grammar until a model passes the gate", async () => {
    const r = await h.call("POST", "/v1/text/check", { text: "මම ගෙදර යනවා", lang: "si", kinds: ["spelling", "grammar"] });
    expect(r.json.skipped).toEqual([{ kind: "grammar", reason: "capability_unavailable" }]);
    expect((await h.call("POST", "/v1/text/transform", { text: "මම ගෙදර යනවා", lang: "si", op: "improve" })).json.error.code).toBe("capability_unavailable");
  });
  it("transforms with word-level edits; summarize returns the result only", async () => {
    const text = "This is teh bad plan.";
    const r = await h.call("POST", "/v1/text/transform", { text, lang: "en", op: "improve" });
    expect(r.json).toEqual({ result: "This is the good plan.", edits: expect.any(Array), model: "llm-test", allowCloud: false });
    expect(applyEdits(text, r.json.edits)).toBe(r.json.result);
    expect(r.json.edits).toEqual([{ start: 8, end: 15, replacement: "the good", reason: "improve" }]);
    const s = await h.call("POST", "/v1/text/transform", { text, lang: "en", op: "summarize" });
    expect(s.json).toEqual({ result: "A summary.", model: "llm-test", allowCloud: false });
    expect((await h.call("POST", "/v1/text/transform", { text, op: "dance" })).status).toBe(400);
  });
  it("detects language spans by script", async () => {
    const text = "Hello there ශ්‍රී ලංකාව வணக்கம்";
    const r = await h.call("POST", "/v1/text/detect-language", { text });
    expect(r.json.spans.map((s: any) => s.lang)).toEqual(["en", "si", "ta"]);
    expect(r.json.spans[0].start).toBe(0);
    expect(r.json.spans[2].end).toBe(text.length);
  });
  it("translates with the local model", async () => {
    const r = await h.call("POST", "/v1/translate", { text: "Good morning", from: "auto", to: "si" });
    expect(r.json).toEqual({ text: "translated: Good morning", from: "en", model: "llm-test" });
  });
  it("rejects input over the limit", async () => {
    const r = await h.call("POST", "/v1/text/check", { text: "a".repeat(40000) });
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe("input_too_long");
  });
});

describe("assistant", () => {
  it("lists local models in OpenAI form", async () => {
    const r = await h.call("GET", "/v1/openai/models");
    expect(r.json).toEqual({ object: "list", data: [expect.objectContaining({ id: "llm-test", object: "model", owned_by: "worksuite-local" })] });
  });
  it("proxies chat completions, plain and streamed", async () => {
    const r = await h.call("POST", "/v1/openai/chat/completions", { model: "llm-test", messages: [{ role: "user", content: "hi" }], tools: [{}] });
    expect(r.json.choices[0].message.content).toBe("Hello from the local model.");
    expect(r.json.model).toBe("llm-test");
    const s = await h.call("POST", "/v1/openai/chat/completions", { messages: [{ role: "user", content: "hi" }], stream: true });
    expect(s.res.headers.get("content-type")).toContain("text/event-stream");
    const body = await s.res.text();
    const parts = body.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
    expect(parts.map((p) => p.choices[0].delta.content).join("")).toBe("Hello from the local model.");
    expect(parts[0].model).toBe("llm-test");
    expect(body).toContain("data: [DONE]");
  });
});

describe("tts", () => {
  it("lists voices", async () => {
    expect((await h.call("GET", "/v1/tts/voices")).json).toEqual([{ id: "voice-test", lang: "en", gender: "female", quality: "medium", modelId: "voice-test" }]);
  });
  it("streams wav, with timings as a trailing JSON part", async () => {
    const r = await h.call("POST", "/v1/tts/synthesize", { text: "Hello there. How are you?", voice: "voice-test", rate: 1, format: "wav", timings: "sentence" });
    const ct = r.res.headers.get("content-type")!;
    expect(ct).toMatch(/^multipart\/mixed; boundary=/);
    const body = Buffer.from(await r.res.arrayBuffer()).toString("latin1");
    expect(body).toContain("content-type: audio/wav");
    expect(body).toContain("RIFF");
    const json = JSON.parse(/content-type: application\/json\r\n\r\n(.*)\r\n--/s.exec(body)![1]);
    expect(json.timings).toEqual([
      { kind: "sentence", start: 0, end: expect.any(Number), textStart: 0, textEnd: 12 },
      { kind: "sentence", start: expect.any(Number), end: expect.any(Number), textStart: 13, textEnd: 25 },
    ]);
    const plain = await h.call("POST", "/v1/tts/synthesize", { text: "Hi.", format: "wav" });
    expect(plain.res.headers.get("content-type")).toBe("audio/wav");
  });
  it("exports audio as a job", async () => {
    const r = await h.call("POST", "/v1/tts/synthesize", { text: "Export me.", export: true, timings: "word" });
    expect(r.status).toBe(202);
    const job = await h.svc.jobs.wait(r.json.jobId);
    expect(job.state).toBe("done");
    expect((job.result as any).timings.length).toBe(2);
    const f = await h.call("GET", `/v1/jobs/${r.json.jobId}/file`);
    expect(f.res.headers.get("content-type")).toBe("audio/wav");
  });
});
