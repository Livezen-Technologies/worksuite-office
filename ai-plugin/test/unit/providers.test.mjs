// W9: "WorkSuite Local AI" in the AI agent panel's providers (the same local storage keys as the start page uses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib, memoryStorage } from "./helpers.mjs";

const P = lib("providers");
const ep = { port: 47615, token: "tok" };
const models = { object: "list", data: [{ id: "qwen2.5-3b-instruct-q4" }, { id: "llama-3.2-3b-q4" }] };
const cloud = { type: "openaicompatible", name: "WorkSuite AI", baseUrl: "https://ws.example/api/ai/office/v1", key: "k" };
const get = (s, k) => JSON.parse(s.getItem(k));

test("added next to the other providers, OpenAI-compatible at /v1/openai with the token", () => {
  const s = memoryStorage({ providers: JSON.stringify([cloud]), "current-provider": JSON.stringify(cloud) });
  assert.equal(P.sync(s, ep, models, true), "added");
  assert.deepEqual(get(s, "providers"), [cloud, { type: "openaicompatible", name: "WorkSuite Local AI", baseUrl: "http://127.0.0.1:47615/v1/openai", key: "tok" }]);
  assert.deepEqual(get(s, "current-provider"), cloud); // the person's choice stays
});

test("current when there is none, with its first model", () => {
  const s = memoryStorage();
  P.sync(s, ep, models, true);
  assert.equal(get(s, "current-provider").name, "WorkSuite Local AI");
  assert.deepEqual(get(s, "current-model"), { id: "qwen2.5-3b-instruct-q4", name: "Local · qwen2.5-3b-instruct-q4", provider: "openaicompatible" });
});

test("a new port or token updates it in place; the same one changes nothing", () => {
  const s = memoryStorage();
  P.sync(s, ep, models, true);
  assert.equal(P.sync(s, ep, models, true), "unchanged");
  assert.equal(P.sync(s, { port: 50000, token: "new" }, models, true), "updated");
  const list = get(s, "providers");
  assert.equal(list.length, 1);
  assert.equal(list[0].baseUrl, "http://127.0.0.1:50000/v1/openai");
  assert.equal(get(s, "current-provider").key, "new");
});

test("taken out when policy forbids it or no assistant model is installed; current cleared only if it was ours", () => {
  const s = memoryStorage();
  P.sync(s, ep, models, true);
  assert.equal(P.sync(s, ep, models, false), "removed");
  assert.deepEqual(get(s, "providers"), []);
  assert.equal(s.getItem("current-provider"), null);
  const t = memoryStorage({ providers: JSON.stringify([cloud]), "current-provider": JSON.stringify(cloud) });
  P.sync(t, ep, models, true);
  assert.equal(P.sync(t, ep, { data: [] }, true), "removed");
  assert.deepEqual(get(t, "current-provider"), cloud);
});

test("service unreachable: left as it is", () => {
  const s = memoryStorage();
  P.sync(s, ep, models, true);
  assert.equal(P.sync(s, null, null, true), "unchanged");
  assert.equal(get(s, "providers").length, 1);
});

test("pure helpers", () => {
  assert.deepEqual(P.modelIds([{ id: "a" }, { name: "b" }, null]), ["a", "b"]);
  assert.deepEqual(P.remove([cloud, P.entry(ep)]), [cloud]);
  assert.equal(P.upsert([P.entry({ port: 1, token: "" }), cloud], ep).length, 2);
});
