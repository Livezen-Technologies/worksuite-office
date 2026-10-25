import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizePolicy, parseRegQuery, systemPolicyReader } from "../src/policy";
import { Harness, start } from "./helpers/harness";

describe("policy parsing", () => {
  it("defaults to unmanaged with everything on", () => {
    expect(normalizePolicy(null)).toMatchObject({ managed: false, cloudAllowed: true, approvedModels: [], maxMemMB: 0, gpuAllowed: true, orgDictionaryUrl: null,
      features: { stt: true, suggestions: true, correction: true, translate: true, tts: true, assistant: true } });
  });
  it("reads registry values", () => {
    const out = "\r\nHKEY_LOCAL_MACHINE\\Software\\Policies\\WorkSuite\\Office\\AI\r\n    stt    REG_DWORD    0x0\r\n    cloudAllowed    REG_DWORD    0x0\r\n    approvedModels    REG_MULTI_SZ    whisper-small-q5\\0qwen2.5-3b-instruct-q4km\r\n    maxMemMB    REG_DWORD    0x1000\r\n    orgDictionaryUrl    REG_SZ    https://admin.example/dict.txt\r\n";
    const p = normalizePolicy(parseRegQuery(out));
    expect(p).toMatchObject({ managed: true, cloudAllowed: false, approvedModels: ["whisper-small-q5", "qwen2.5-3b-instruct-q4km"], maxMemMB: 4096, orgDictionaryUrl: "https://admin.example/dict.txt", modelsRestricted: true });
    expect(p.features.stt).toBe(false);
    expect(p.features.tts).toBe(true);
  });
  it("aiFunctions=off on the app policy turns everything off", () => {
    const p = normalizePolicy(null, { aiFunctions: "off", organization: "Livezen" });
    expect(p.managed).toBe(true);
    expect(Object.values(p.features).every((v) => v === false)).toBe(true);
    expect(p.cloudAllowed).toBe(false);
    expect(p.organization).toBe("Livezen");
  });
  it("reads the Office app's ai* managed keys (Settings › AI Models mapping)", () => {
    const p = normalizePolicy(null, { organization: "Livezen", aiSpeechToText: 0, aiReadAloud: "false", aiTranslation: true, aiCloudAllowed: 0, aiApprovedModels: "a,b",
      aiMaxMemoryMB: "2048", aiGpuAllowed: 0, aiDictionaryUrl: "https://x/d.txt", aiCatalogUrl: "https://mirror/catalog", aiStoragePath: "D:\\AI" });
    expect(p).toMatchObject({ managed: true, cloudAllowed: false, approvedModels: ["a", "b"], maxMemMB: 2048, gpuAllowed: false, orgDictionaryUrl: "https://x/d.txt",
      catalogUrl: "https://mirror/catalog", storagePath: "D:\\AI", organization: "Livezen" });
    expect(p.features).toMatchObject({ stt: false, tts: false, translate: true, suggestions: true });
  });
  it("reads a policy file in the Linux form, nested features too", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "pol-")), "policy.json");
    writeFileSync(f, JSON.stringify({ features: { assistant: false }, gpuAllowed: "false", orgDictionaryUrl: "http://insecure/x" }));
    const p = await systemPolicyReader({ WS_AI_POLICY_FILE: f })();
    expect(p).toMatchObject({ managed: true, gpuAllowed: false, orgDictionaryUrl: null, source: f });
    expect(p.features.assistant).toBe(false);
  });
});

describe("policy enforcement", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start();
    await h.install("llm-test");
    await h.install("whisper-test");
  });
  afterAll(async () => { await h.close(); });
  const setPolicy = async (raw: any) => { h.policy.raw = raw; await h.svc.reloadPolicy(); };

  it("GET /v1/policy shows the policy", async () => {
    await setPolicy({ cloudAllowed: false });
    expect((await h.call("GET", "/v1/policy")).json).toMatchObject({ managed: true, cloudAllowed: false });
  });
  it("feature switches answer forbidden_by_policy", async () => {
    await setPolicy({ suggestions: false, correction: false, translate: false, assistant: false, tts: false, stt: false });
    for (const [path, body] of [["/v1/text/complete", { text: "hel", caret: 3 }], ["/v1/text/check", { text: "x" }], ["/v1/text/transform", { text: "x", op: "improve" }],
      ["/v1/translate", { text: "x", to: "si" }], ["/v1/openai/chat/completions", { messages: [{ role: "user", content: "hi" }] }], ["/v1/tts/synthesize", { text: "x" }]] as const) {
      const r = await h.call("POST", path, body);
      expect(r.status, path).toBe(403);
      expect(r.json.error.code, path).toBe("forbidden_by_policy");
    }
    expect((await h.call("GET", "/v1/info")).json.capabilities).toEqual(["sinhala"]);
  });
  it("cloud requests are refused when the organisation turned cloud off", async () => {
    await setPolicy({ cloudAllowed: false });
    const r = await h.call("POST", "/v1/text/transform", { text: "x", op: "improve", allowCloud: true });
    expect(r.json.error.code).toBe("forbidden_by_policy");
    expect((await h.call("PUT", "/v1/defaults", { assistant: "cloud" })).json.error.code).toBe("forbidden_by_policy");
  });
  it("only approved models install and run", async () => {
    await setPolicy({ approvedModels: ["whisper-test"] });
    expect((await h.call("POST", "/v1/models/voice-test/install", {})).json.error.code).toBe("forbidden_by_policy");
    const t = await h.call("POST", "/v1/text/transform", { text: "teh bad", op: "improve" });
    expect(t.json.error.code).toBe("forbidden_by_policy"); // the default LLM is no longer approved
    expect((await h.call("GET", "/v1/catalog")).json.find((m: any) => m.id === "voice-test")).toMatchObject({ approved: false, approvedByOrganization: false });
    await setPolicy(null);
  });
  it("pushes policy changes over /v1/events", async () => {
    const got: any[] = [];
    const off = h.svc.events.on((e) => got.push(e));
    await setPolicy({ tts: false });
    off();
    expect(got.some((e) => e.type === "policy" && e.data.features.tts === false)).toBe(true);
    await setPolicy(null);
  });
});
