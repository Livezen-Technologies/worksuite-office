// Response shapes of every route against docs/local-ai/spec.md ("Local service API contracts").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, start } from "./helpers/harness";
import { parseNvidiaSmi, parseSystemProfiler, parseWindowsVideo, recommend, fits } from "../src/hardware";

let h: Harness;
beforeAll(async () => {
  h = await start();
  for (const id of ["whisper-test", "llm-test", "voice-test"]) expect((await h.install(id)).state).toBe("done");
});
afterAll(async () => { await h.close(); });

const E = expect;
describe("contract", () => {
  it("GET /v1/info", async () => {
    const r = (await h.call("GET", "/v1/info")).json;
    E(r).toEqual({ apiVersion: "1.4", serviceVersion: E.any(String), capabilities: E.any(Array), profile: E.stringMatching(/^(lite|standard|advanced)$/) });
    E(r.capabilities).toEqual(E.arrayContaining(["speech.stt", "text.complete", "text.check", "text.transform", "translate", "tts", "assistant"]));
    E(r.capabilities).not.toContain("tts.si");
  });
  it("GET /v1/hardware", async () => {
    E((await h.call("GET", "/v1/hardware")).json).toEqual(E.objectContaining({ os: E.any(String), arch: E.any(String), cpu: { model: E.any(String), cores: E.any(Number) },
      ramMB: E.any(Number), freeRamMB: E.any(Number), gpus: E.any(Array), appleSilicon: E.any(Boolean), recommendedProfile: E.any(String) }));
  });
  it("GET /v1/health", async () => {
    E((await h.call("GET", "/v1/health")).json).toEqual({ ok: true, loadedModels: E.any(Array), queueDepth: 0 });
  });
  it("GET /v1/catalog?task=&lang=", async () => {
    const r = (await h.call("GET", "/v1/catalog?task=stt&lang=en")).json;
    E(r).toEqual([E.objectContaining({ id: "whisper-test", name: E.any(String), version: "1.0.0", tasks: ["stt"], languages: ["en"], sizeMB: E.any(Number), ramMB: 100,
      backends: ["cpu"], license: "MIT", fits: E.stringMatching(/^(yes|tight|no)$/), approved: true, evaluated: {} })]);
    E((await h.call("GET", "/v1/catalog?task=tts&lang=si")).json).toEqual([]);
  });
  it("GET /v1/models, defaults, activate/deactivate", async () => {
    const m = (await h.call("GET", "/v1/models?task=assistant")).json;
    E(m).toEqual([E.objectContaining({ id: "llm-test", version: "1.0.0", tasks: E.any(Array), state: "installed", sizeMB: E.any(Number), path: E.any(String), isDefaultFor: ["correction", "suggestions", "translation", "assistant"], lastUsed: null })]);
    E((await h.call("PUT", "/v1/defaults", { tts: "voice-test", assistant: "auto" })).json).toEqual({ stt: "whisper-test", correction: "llm-test", suggestions: "llm-test", translation: "llm-test", tts: "voice-test", assistant: "auto" });
    E((await h.call("PUT", "/v1/defaults", { stt: "llm-test" })).status).toBe(400);
    E((await h.call("PUT", "/v1/defaults", { stt: "nope" })).json.error.code).toBe("model_not_installed");
    E((await h.call("POST", "/v1/models/whisper-test/activate", {})).json).toEqual({ id: "whisper-test", state: "active", memMB: 100 });
    E((await h.call("GET", "/v1/models?task=stt")).json[0].state).toBe("active");
    E((await h.call("POST", "/v1/models/whisper-test/deactivate", {})).json).toEqual({ id: "whisper-test", state: "installed" });
    E((await h.call("POST", "/v1/models/nope/activate", {})).json.error.code).toBe("model_not_installed");
  });
  it("jobs, engines, storage, diagnostics", async () => {
    const jobs = (await h.call("GET", "/v1/jobs")).json;
    E(jobs[0]).toEqual(E.objectContaining({ id: E.any(String), type: "install", state: "done", progress: 1, createdAt: E.any(String) }));
    E((await h.call("GET", "/v1/jobs/none")).json.error.code).toBe("not_found");
    E((await h.call("GET", "/v1/engines")).json.engines.map((e: any) => e.engine)).toEqual(["whisper.cpp", "llama.cpp", "piper", "ffmpeg"]);
    E((await h.call("GET", "/v1/storage")).json).toEqual({ path: E.any(String), usedMB: E.any(Number), freeMB: E.any(Number) });
    await h.call("POST", "/v1/text/check", { text: "secret words here" });
    const d = (await h.call("GET", "/v1/diagnostics")).json;
    E(d).toEqual(E.objectContaining({ serviceVersion: E.any(String), apiVersion: "1.4", hardware: E.anything(), models: E.any(Array), errors: E.any(Array), timings: E.any(Array) }));
    E(JSON.stringify(d)).not.toContain("secret words");
    E(d.timings.length).toBeLessThanOrEqual(50);
  });
  it("errors use the envelope; unknown routes 404; bad bodies 400", async () => {
    const r = await h.call("GET", "/v1/nope");
    E(r.status).toBe(404);
    E(r.json).toEqual({ error: { code: "not_found", message: E.any(String), retryable: false } });
    const b = await h.call("POST", "/v1/text/check", "not json");
    E(b.status).toBe(400);
    E((await h.call("POST", "/v1/models/whisper-test/install", {})).status).toBe(400); // already installed
    E((await h.call("POST", "/v1/models/unknown/install", {})).status).toBe(404);
  });
  it("PUT /v1/defaults rejects unknown tasks", async () => {
    E((await h.call("PUT", "/v1/defaults", { cooking: "auto" })).status).toBe(400);
  });
});

describe("hardware detection parsers", () => {
  it("nvidia-smi, system_profiler, Windows CIM", () => {
    E(parseNvidiaSmi("NVIDIA GeForce RTX 4070, 12282\n")).toEqual([{ name: "NVIDIA GeForce RTX 4070", vramMB: 12282, backend: "cuda" }]);
    E(parseSystemProfiler(JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M2", spdisplays_mtlgpufamilysupport: "spdisplays_metal3" }] }), true, 16384))
      .toEqual([{ name: "Apple M2", vramMB: 10813, backend: "metal" }]);
    E(parseWindowsVideo('[{"Name":"Intel(R) UHD Graphics","AdapterRAM":1073741824},{"Name":"Microsoft Basic Display Adapter","AdapterRAM":0}]'))
      .toEqual([{ name: "Intel(R) UHD Graphics", vramMB: 1024, backend: "directml" }]);
    E(recommend(8192, [], false)).toBe("standard");
    E(recommend(4096, [], false)).toBe("lite");
    E(recommend(32768, [], true)).toBe("advanced");
    E(fits(600, { ramMB: 8192, gpus: [], appleSilicon: false })).toBe("yes");
    E(fits(6500, { ramMB: 8192, gpus: [], appleSilicon: false })).toBe("no");
  });
});
