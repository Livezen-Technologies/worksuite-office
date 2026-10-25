// Discovery through the desktop shell (worksuite:ai-endpoint), start on demand, and the dev-port fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib, memoryStorage } from "./helpers.mjs";

const { createDiscovery, COMMAND, DEV_PORT, DEV_TOKEN_KEY } = lib("discovery");

function shell(answers) {
  const host = { on_native_message: null, calls: [] };
  const editorHandled = [];
  host.on_native_message = (cmd, p) => editorHandled.push(cmd); // the editor's own handler keeps working
  const desktop = {
    execCommand(cmd, param) {
      host.calls.push([cmd, JSON.parse(param)]);
      const a = answers.shift();
      if (a !== undefined) setTimeout(() => host.on_native_message(COMMAND, JSON.stringify(a)), 1);
    }
  };
  return { host, desktop, editorHandled };
}

const noFetch = async () => { throw new TypeError("refused"); };

test("asks the shell and uses its endpoint", async () => {
  const s = shell([{ ok: true, port: 41000, token: "abc", apiVersion: "1.3", pid: 1 }]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch });
  const ep = await d.resolve({ start: true });
  assert.deepEqual(ep, { port: 41000, token: "abc", apiVersion: "1.3", base: "http://127.0.0.1:41000/v1", source: "shell" });
  assert.deepEqual(s.host.calls, [[COMMAND, { start: true }]]);
  assert.deepEqual(s.editorHandled, [COMMAND]);
  assert.equal(await d.resolve(), ep); // cached
  assert.equal(s.host.calls.length, 1);
});

test("while the shell starts the service it asks again", async () => {
  const s = shell([{ ok: false, error: "starting" }, { ok: false, error: "starting" }, { ok: true, port: 41001, token: "x", apiVersion: "1.0" }]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch, startDelayMs: 1 });
  const ep = await d.resolve({ start: true });
  assert.equal(ep.port, 41001);
  assert.deepEqual(s.host.calls.map((c) => c[1].start), [true, false, false]);
});

test("a v2 service is refused", async () => {
  const s = shell([{ ok: true, port: 41002, token: "x", apiVersion: "2.0" }]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch });
  await assert.rejects(d.resolve(), (e) => e.code === "api_version");
});

test("no shell hook: the dev port, with the dev token from storage", async () => {
  let asked = null;
  const fetch = async (url, init) => { asked = { url, init }; return { ok: true, json: async () => ({ apiVersion: "1.3" }) }; };
  const d = createDiscovery({ storage: memoryStorage({ [DEV_TOKEN_KEY]: "dev" }), fetch, timeoutMs: 10 });
  const ep = await d.resolve();
  assert.equal(asked.url, `http://127.0.0.1:${DEV_PORT}/v1/info`);
  assert.equal(asked.init.headers.Authorization, "Bearer dev");
  assert.equal(ep.source, "dev");
  assert.equal(ep.token, "dev");
});

test("a shell that never answers times out to the fallback", async () => {
  const s = shell([]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch, timeoutMs: 20 });
  await assert.rejects(d.resolve(), (e) => e.code === "service_unavailable");
});

test("not installed is reported as such", async () => {
  const s = shell([{ ok: false, error: "not_installed" }]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch });
  await assert.rejects(d.resolve({ start: true }), (e) => e.code === "not_installed");
});

test("invalidate forgets the endpoint", async () => {
  const s = shell([{ ok: true, port: 41003, token: "a" }, { ok: true, port: 41004, token: "b" }]);
  const d = createDiscovery({ desktop: s.desktop, host: s.host, fetch: noFetch });
  assert.equal((await d.resolve()).port, 41003);
  d.invalidate();
  assert.equal(d.current(), null);
  assert.equal((await d.resolve()).port, 41004);
});
