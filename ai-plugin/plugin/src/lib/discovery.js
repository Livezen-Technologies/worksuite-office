/*
 * Finding the local worksuite-ai service through the desktop shell (desktop-apps docs/local-ai-bridge.md).
 *
 * A plugin frame cannot read ~/.worksuite/ai/endpoint.json, so it asks the shell:
 *
 *   AscDesktopEditor.execCommand("ws-ai:endpoint", '{"req":"<unique id>","start":true|false}')
 *
 * The answer comes back as on_native_message("ws-ai:endpoint", json) in the editor's frame
 * (frameEditor, this frame's parent), whose handler the editor owns: we chain onto it, and match our
 * answers by `req` (every listener sees every answer).
 *   {req, ok:true, port, token, pid, apiVersion, base:"http://127.0.0.1:<port>/v1", launched, policy}
 *   {req, ok:false, reason:"disabled-by-policy"|"not-running"|"not-installed"|"start-failed"|"timeout", policy}
 * With start:true the shell starts the service when it is not running and answers once it is up
 * (at most 20 s). The policy in the answer lets the plugin lock features when no service runs.
 * There is no fallback port: without the shell there is no service to talk to.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiDiscovery = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COMMAND = "ws-ai:endpoint";
  var API_MAJOR = "1";
  var REASONS = { "disabled-by-policy": "forbidden_by_policy", "not-running": "service_unavailable", "not-installed": "not_installed",
    "start-failed": "service_unavailable", "timeout": "service_unavailable" };

  function DiscoveryError(code, message, reason) {
    var e = new Error(message || code);
    e.code = code;
    e.reason = reason;
    return e;
  }

  function parse(answer) {
    if (typeof answer === "string") {
      try { answer = JSON.parse(answer); } catch (e) { return null; }
    }
    return answer && typeof answer === "object" ? answer : null;
  }

  var seq = 0;
  function newReq() { return "ws-ai-" + Date.now().toString(36) + "-" + (++seq) + "-" + Math.random().toString(36).slice(2, 8); }

  function endpointFrom(data) {
    var port = Number(data.port);
    if (!(port > 0 && port < 65536)) return null;
    var api = String(data.apiVersion || "1");
    if (api.split(".")[0] !== API_MAJOR) throw DiscoveryError("api_version", "worksuite-ai API " + api + " is not v1");
    var base = typeof data.base === "string" && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(data.base) ? data.base : "http://127.0.0.1:" + port + "/v1";
    return { port: port, token: typeof data.token === "string" ? data.token : "", apiVersion: api, base: base,
      launched: !!data.launched, policy: data.policy || null, source: "shell" };
  }

  /*
   * opts: desktop (AscDesktopEditor), host (the editor frame, for on_native_message),
   * timeoutMs (start:false, default 4 s), startTimeoutMs (start:true, default 25 s), onPolicy(policy)
   */
  function createDiscovery(opts) {
    opts = opts || {};
    var cached = null;
    var lastPolicy = null;

    function ask(start) {
      var d = opts.desktop, host = opts.host;
      if (!d || typeof d.execCommand !== "function" || !host) return Promise.resolve(null);
      var req = newReq();
      return new Promise(function (resolve) {
        var previous, listener, timer;
        function done(answer) {
          clearTimeout(timer);
          try { if (host.on_native_message === listener) host.on_native_message = previous; } catch (e) { /* gone */ }
          resolve(answer);
        }
        listener = function (cmd, param) {
          if (cmd === COMMAND) {
            var a = parse(param);
            if (a && a.req === req) { done(a); return; }
          }
          if (typeof previous === "function") return previous.apply(this, arguments);
        };
        try {
          previous = host.on_native_message;
          host.on_native_message = listener;
        } catch (e) { resolve(null); return; } // another origin: no answer can reach us
        timer = setTimeout(function () { done({ req: req, ok: false, reason: "timeout" }); },
          start ? (opts.startTimeoutMs || 25000) : (opts.timeoutMs || 4000));
        try { d.execCommand(COMMAND, JSON.stringify({ req: req, start: !!start })); } catch (e) { done(null); }
      });
    }

    async function resolve(options) {
      var start = !!(options && options.start);
      if (cached && !(options && options.refresh)) return cached;
      var answer = await ask(start);
      if (answer && answer.policy) {
        lastPolicy = answer.policy;
        if (opts.onPolicy) opts.onPolicy(answer.policy);
      }
      if (answer && answer.ok) {
        var ep = endpointFrom(answer);
        if (ep) { cached = ep; if (opts.onEndpoint) opts.onEndpoint(ep); return ep; }
      }
      if (!answer) throw DiscoveryError("service_unavailable", "No desktop shell to find WorkSuite Local AI", "no-shell");
      var reason = answer.reason || "start-failed";
      throw DiscoveryError(REASONS[reason] || "service_unavailable", reason, reason);
    }

    return {
      resolve: resolve,
      invalidate: function () { cached = null; },
      current: function () { return cached; },
      policy: function () { return lastPolicy; },
      set: function (ep) { cached = ep; }
    };
  }

  return { createDiscovery: createDiscovery, COMMAND: COMMAND, REASONS: REASONS };
});
