import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { originAllowed } from "../src/auth";
import { Harness, start } from "./helpers/harness";

let h: Harness;
beforeAll(async () => { h = await start(); });
afterAll(async () => { await h.close(); });

describe("auth and origin", () => {
  it("refuses requests without the token", async () => {
    const r = await fetch(`http://127.0.0.1:${h.port}/v1/info`);
    expect(r.status).toBe(401);
    expect(((await r.json()) as any).error).toEqual({ code: "unauthorized", message: expect.any(String), retryable: false });
  });
  it("refuses a wrong token", async () => {
    const r = await fetch(`http://127.0.0.1:${h.port}/v1/info`, { headers: { authorization: "Bearer nope" } });
    expect(r.status).toBe(401);
  });
  it("refuses browser web origins even with the token", async () => {
    const r = await h.call("GET", "/v1/info", undefined, { origin: "https://example.com" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("unauthorized");
  });
  it("accepts WorkSuite app origins and answers CORS preflight", async () => {
    expect((await h.call("GET", "/v1/info", undefined, { origin: "asc://editor" })).status).toBe(200);
    const pre = await fetch(`http://127.0.0.1:${h.port}/v1/text/complete`, { method: "OPTIONS", headers: { origin: "worksuite://app", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("worksuite://app");
    expect(originAllowed("file://")).toBe(true);
    expect(originAllowed("null")).toBe(true);
    expect(originAllowed("http://localhost:3000")).toBe(false);
  });
  it("binds to 127.0.0.1 only", () => {
    expect((h.svc.server!.address() as { address: string }).address).toBe("127.0.0.1");
  });
  it("refuses WebSockets without the token or from web origins, accepts a bearer subprotocol", async () => {
    const code = (url: string, o: WebSocket.ClientOptions = {}, protocols?: string[]) => new Promise<number | "open">((resolve) => {
      const ws = new WebSocket(url, protocols, o);
      ws.on("open", () => { ws.close(); resolve("open"); });
      ws.on("unexpected-response", (_q, res) => resolve(res.statusCode!));
      ws.on("error", () => undefined);
    });
    const base = `ws://127.0.0.1:${h.port}/v1/events`;
    expect(await code(base)).toBe(401);
    expect(await code(base, { headers: { authorization: `Bearer ${h.token}`, origin: "https://evil.example" } })).toBe(403);
    expect(await code(base, { headers: { authorization: `Bearer ${h.token}` } })).toBe("open");
    expect(await code(base, {}, [`bearer.${h.token}`])).toBe("open");
  });
});
