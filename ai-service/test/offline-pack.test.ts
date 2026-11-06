import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { catalogEntry, CATALOG_URL, fakeNet, Harness, keys, sha, start, STD_MODELS } from "./helpers/harness";
import { signDoc } from "../src/signing";
import { platformId } from "../src/catalog";

let hs: Harness[] = [];
afterEach(async () => { for (const h of hs) await h.close(); hs = []; });

const voice = STD_MODELS[2];
const piperBin = Buffer.from("#!/bin/sh\necho piper\n");

function netWithEngine() {
  const net = fakeNet();
  const url = "https://engines.test/piper/piper";
  net.files.set(url, piperBin);
  const pkg = {
    engine: "piper", version: "1.2.0", platform: platformId(), backend: "cpu", exec: "piper",
    files: [{ path: "piper", size: piperBin.length, sha256: sha(piperBin) }], license: "MIT", approved: true, download: { piper: url },
  };
  const signedPkg = signDoc(pkg as Record<string, unknown>, keys.privateKey);
  const doc = { schema: 1, version: "test", models: [catalogEntry(voice, net)], engines: [signedPkg] };
  net.files.set(CATALOG_URL, Buffer.from(JSON.stringify(signDoc(doc, keys.privateKey))));
  return { net, url };
}

describe("offline .wsmodel", () => {
  it("carries the engine, and installs model and engine with no internet", async () => {
    const online = netWithEngine();
    const a = await start({ net: online.net, env: { WS_AI_PIPER: "" } });
    hs.push(a);
    expect((await a.install("voice-test")).state).toBe("done");
    expect(a.svc.engines.resolve("piper")).not.toBeNull();
    const pkg = Buffer.from(await (await a.call("GET", "/v1/models/voice-test/export")).res.arrayBuffer());
    expect(pkg.includes(Buffer.from("engine/files/piper"))).toBe(true);

    // another computer, catalog cached but no downloads reachable
    const offline = netWithEngine();
    const b = await start({ net: offline.net, env: { WS_AI_PIPER: "" } });
    hs.push(b);
    offline.net.files.clear();
    expect(b.svc.engines.resolve("piper")).toBeNull();
    const fd = new FormData();
    fd.append("file", new Blob([pkg]), "voice-test.wsmodel");
    const im = await b.call("POST", "/v1/models/import", fd);
    expect((await b.svc.jobs.wait(im.json.jobId)).state).toBe("done");
    const cmd = b.svc.engines.resolve("piper");
    expect(cmd).toMatchObject({ backend: "cpu", version: "1.2.0" });
    expect(existsSync(join(b.dir, "models", "voice-test", "1.0.0", "v.onnx"))).toBe(true);
  });

  it("does not install an engine whose files differ from the catalog", async () => {
    const online = netWithEngine();
    const a = await start({ net: online.net, env: { WS_AI_PIPER: "" } });
    hs.push(a);
    await a.install("voice-test");
    const pkg = Buffer.from(await (await a.call("GET", "/v1/models/voice-test/export")).res.arrayBuffer());
    const at = pkg.indexOf(Buffer.from("echo piper"));
    pkg[at] = "E".charCodeAt(0);

    const b = await start({ net: netWithEngine().net, env: { WS_AI_PIPER: "" } });
    hs.push(b);
    b.net.files.clear();
    const fd = new FormData();
    fd.append("file", new Blob([pkg]), "voice-test.wsmodel");
    const im = await b.call("POST", "/v1/models/import", fd);
    expect((await b.svc.jobs.wait(im.json.jobId)).state).toBe("done");
    expect(b.svc.engines.resolve("piper")).toBeNull();
  });
});
