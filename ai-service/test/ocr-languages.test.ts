// /v1/ocr/languages: list, install from the (fake) network with the sha256 check, serve, remove.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { fakeNet, FakeNet, Harness, start } from "./helpers/harness";
import { OCR_LANGUAGES, OCR_SOURCE } from "../src/ocr/languages";

let h: Harness;
let net: FakeNet;
const hindi = OCR_LANGUAGES.find((l) => l.code === "hin")!;

beforeAll(async () => {
  net = fakeNet();
  h = await start({ net });
});
afterAll(async () => { await h.close(); });

describe("ocr languages", () => {
  it("lists the languages that can be added, none installed", async () => {
    const r = (await h.call("GET", "/v1/ocr/languages")).json.languages;
    expect(r.length).toBe(OCR_LANGUAGES.length);
    expect(r.find((l: { code: string }) => l.code === "hin")).toEqual(expect.objectContaining({ name: "Hindi", installed: false }));
    expect(OCR_LANGUAGES.every((l) => /^[0-9a-f]{64}$/.test(l.sha256) && l.size > 100000)).toBe(true);
  });

  it("refuses a download that does not match its checksum", async () => {
    net.files.set(OCR_SOURCE + "hin.traineddata", Buffer.alloc(hindi.size, 1));
    const r = await h.call("POST", "/v1/ocr/languages/hin/install", {});
    const j = await h.svc.jobs.wait(r.json.jobId);
    expect(j.error?.code).toBe("integrity_failed");
    expect((await h.call("GET", "/v1/ocr/languages/hin/data")).status).toBe(404);
  });

  it("installs, serves and removes a language", async () => {
    // a stand-in model with the pinned size, its checksum swapped in for the test
    const data = Buffer.alloc(hindi.size, 7);
    const real = hindi.sha256;
    hindi.sha256 = createHash("sha256").update(data).digest("hex");
    try {
      net.files.set(OCR_SOURCE + "hin.traineddata", data);
      const j = await h.svc.jobs.wait((await h.call("POST", "/v1/ocr/languages/hin/install", {})).json.jobId);
      expect(j.state, JSON.stringify(j.error)).toBe("done");
      const res = await fetch(`http://127.0.0.1:${h.port}/v1/ocr/languages/hin/data`, { headers: { authorization: `Bearer ${h.token}` } });
      expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
      expect((await h.call("DELETE", "/v1/ocr/languages/hin")).json).toEqual({ code: "hin", removed: true });
      expect((await h.call("GET", "/v1/ocr/languages/xyz/data")).status).toBe(404);
    } finally { hindi.sha256 = real; }
  });
});
