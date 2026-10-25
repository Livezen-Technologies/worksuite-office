// Discovery through the desktop shell's "ws-ai:endpoint" (desktop-apps docs/local-ai-bridge.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { createDiscovery, COMMAND } = lib("discovery");

// the editor frame: its own on_native_message, and a shell that answers each request by its req
function shell(answer, opts = {}) {
  const editorHandled = [];
  const host = { calls: [], on_native_message(cmd) { editorHandled.push(cmd); } };
  host.AscDesktopEditor = {
    execCommand(cmd, param) {
      const p = JSON.parse(param);
      host.calls.push([cmd, p]);
      if (opts.silent) return;
      setTimeout(() => {
        if (opts.otherFirst) host.on_native_message(COMMAND, JSON.stringify({ req: "someone-else", ok: false, reason: "not-running" }));
        host.on_native_message(COMMAND, JSON.stringify(Object.assign({ req: p.req }, answer(p))));
      }, 1);
    }
  };
  return { host, desktop: host.AscDesktopEditor, editorHandled };
}

const OK = { ok: true, port: 47613, token: "abc", pid: 1, apiVersion: "1", base: "http://127.0.0.1:47613/v1", launched: true, policy: { managed: false } };

test("asks with a unique req and start, uses the answer, and gives on_native_message back", async () => {
  const s = shell(() => OK, { otherFirst: true });
  const original = s.host.on_native_message;
  const seen = [];
  const d = createDiscovery({ desktop: s.desktop, host: s.host, onEndpoint: (e) => seen.push(e.port), onPolicy: (p) => seen.push(p) });
  const ep = await d.resolve({ start: true });
  assert.equal(ep.base, "http://127.0.0.1:47613/v1");
  assert.equal(ep.token, "abc");
  assert.equal(ep.launched, true);
  assert.equal(s.host.calls[0][0], "ws-ai:endpoint");
  assert.equal(s.host.calls[0][1].start, true);
  assert.match(s.host.calls[0][1].req, /^ws-ai-/);
  assert.equal(s.host.on_native_message, original);           // unchained after the answer
  assert.deepEqual(s.editorHandled, [COMMAND]);                // someone else's answer still reached the editor
  assert.deepEqual(seen, [{ managed: false }, 47613]);
  assert.equal(await d.resolve(), ep);                         // cached
  assert.equal(s.host.calls.length, 1);
});

test("the reasons become the plugin's error codes, with the policy kept", async () => {
  for (const [reason, code] of [["disabled-by-policy", "forbidden_by_policy"], ["not-installed", "not_installed"], ["not-running", "service_unavailable"], ["start-failed", "service_unavailable"]]) {
    const s = shell(() => ({ ok: false, reason, policy: { features: { stt: false } } }));
    const d = createDiscovery({ desktop: s.desktop, host: s.host });
    await assert.rejects(d.resolve({ start: true }), (e) => e.code === code && e.reason === reason);
    assert.deepEqual(d.policy(), { features: { stt: false } });
  }
});

test("no answer in time is a timeout; no shell at all is service_unavailable", async () => {
  const s = shell(null, { silent: true });
  const d = createDiscovery({ desktop: s.desktop, host: s.host, timeoutMs: 20 });
  await assert.rejects(d.resolve(), (e) => e.reason === "timeout");
  assert.equal(typeof s.host.on_native_message, "function");
  await assert.rejects(createDiscovery({}).resolve(), (e) => e.code === "service_unavailable" && e.reason === "no-shell");
});

test("a v2 service is refused; invalidate asks again", async () => {
  let n = 0;
  const s = shell(() => (++n === 1 ? Object.assign({}, OK, { apiVersion: "2.0" }) : OK));
  const d = createDiscovery({ desktop: s.desktop, host: s.host });
  await assert.rejects(d.resolve(), (e) => e.code === "api_version");
  assert.equal((await d.resolve()).port, 47613);
  d.invalidate();
  assert.equal(d.current(), null);
});
