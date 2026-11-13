import { describe, expect, it } from "vitest";
import { Router } from "../src/http";
import { ApiError } from "../src/errors";

describe("Router.match", () => {
  const r = new Router().post("/v1/models/:id/pause", () => null);

  it("decodes a parameter", () => {
    const m = r.match("POST", "/v1/models/whisper%20small/pause");
    expect(m && typeof m === "object" && m.params.id).toBe("whisper small");
  });

  it("answers a malformed %-escape with bad_request (400), not an internal error", () => {
    let err: unknown;
    try { r.match("POST", "/v1/models/%E0%A4%A/pause"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("bad_request");
    expect((err as ApiError).status).toBe(400);
  });
});
