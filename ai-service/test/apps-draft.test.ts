// POST /v1/apps/draft (#88): a plan outline or a diagram table from a description, cleaned for the editors.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, start } from "./helpers/harness";
import { cleanDraft } from "../src/apps/draft";

let h: Harness;
beforeAll(async () => {
  h = await start();
  expect((await h.install("llm-test")).state).toBe("done");
});
afterAll(async () => { await h.close(); });

describe("apps draft", () => {
  it("drafts a plan outline: fences, chatter, bullets and markdown removed, indents kept", async () => {
    const r = await h.call("POST", "/v1/apps/draft", { kind: "plan", prompt: "plan an office move" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ kind: "plan", model: "llm-test", text: "Planning\n  Choose site 3d @Nimal\n  Sign lease 2d\n  Lease signed milestone\nMove\n  Moving day 1w\n" });
  });
  it("drafts an org chart table from a markdown table", async () => {
    const r = await h.call("POST", "/v1/apps/draft", { kind: "org", prompt: "a small company" });
    expect(r.json.text).toBe("Name\tRole\tReports to\nDirector\tDirector\t\nFinance\tFinance lead\tDirector\n");
  });
  it("drafts a flowchart table from comma rows, adding the header and dropping prose", async () => {
    const r = await h.call("POST", "/v1/apps/draft", { kind: "flow", prompt: "approval" });
    expect(r.json.text).toBe("From\tTo\tLabel\nStart\tApproved?\t\nApproved?\tDone\tYes\n");
  });
  it("checks its input", async () => {
    expect((await h.call("POST", "/v1/apps/draft", { kind: "poem", prompt: "x" })).status).toBe(400);
    expect((await h.call("POST", "/v1/apps/draft", { kind: "plan", prompt: "   " })).status).toBe(400);
    expect((await h.call("GET", "/v1/info")).json.capabilities).toContain("apps.draft");
  });
  it("refuses a reply with nothing usable in it", () => {
    expect(() => cleanDraft("flow", "I cannot help with that.")).toThrow(/usable draft/);
    expect(() => cleanDraft("plan", "Sure!")).toThrow(/usable draft/);
  });
});
