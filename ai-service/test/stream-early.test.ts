// Voice typing: what is said while the speech model is still loading is recognised, not dropped
// (10.1.x: the stream listened for audio only after the model loaded, and the dock already showed
// "listening", so the first words of a dictation went missing).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Harness, start, tone, silence, STD_MODELS } from "./helpers/harness";

let h: Harness;
beforeAll(async () => {
  h = await start({ models: STD_MODELS });
  expect((await h.install("whisper-test")).state).toBe("done");
});
afterAll(async () => { await h.close(); });

describe("WS /v1/speech/stream while the model loads", () => {
  it("keeps audio sent before 'listening' and recognises it", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/v1/speech/stream?lang=en`, { headers: { authorization: `Bearer ${h.token}` } });
    const msgs: any[] = [];
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
    // straight away, before the service says it is listening (the model is still starting)
    const pcm = Buffer.concat([tone(2000), silence(900)]);
    for (let o = 0; o < pcm.length; o += 1280) ws.send(pcm.subarray(o, o + 1280));
    expect(msgs.some((m) => m.type === "state" && m.state === "listening")).toBe(false);
    ws.send(JSON.stringify({ type: "end" }));
    await closed;
    const finals = msgs.filter((m) => m.type === "final");
    expect(finals.length).toBeGreaterThanOrEqual(1);
    expect(finals[0].text).toBe("Hello, world.");
  });
});
