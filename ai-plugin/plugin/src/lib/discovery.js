/*
 * Finding the local worksuite-ai service (spec: Local service architecture, Discovery).
 *
 * The service writes ~/.worksuite/ai/endpoint.json ({port, token, pid, apiVersion}, user-only). A plugin
 * frame cannot read files, so it asks the desktop shell:
 *
 *   window.AscDesktopEditor.execCommand("worksuite:ai-endpoint", '{"start":true|false}')
 *
 * and the shell answers the editor that asked with sendCommandTo(<that view>, "worksuite:ai-endpoint",
 * <json>), which the editor page receives in window.on_native_message (web-apps' Desktop controller).
 * The plugin frame chains onto that function of the editor page (same file:// origin). The answer is
 *   {"ok":true, "port":47615, "token":"…", "apiVersion":"1.3", "pid":123, "started":false}
 *   {"ok":false, "error":"not_installed" | "starting" | "failed", "message"?}
 * With "start":true the shell launches the service when the file is missing or its pid is gone
 * ("starting" while it comes up; asked again until it is up).
 *
 * TODO(desktop-apps): the shell does not have "worksuite:ai-endpoint" yet (cascapplicationmanagerwrapper.cpp
 * and ASCCommonViewController.mm, next to "worksuite:policy", but answering the sender view, not only the
 * start page). Until it does, this falls back to a development service on 127.0.0.1:DEV_PORT whose token
 * is in localStorage "ws-ai:dev-token" (or none).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiDiscovery = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COMMAND = "worksuite:ai-endpoint";
  var DEV_PORT = 47615;
  var DEV_TOKEN_KEY = "ws-ai:dev-token";
  var API_MAJOR = "1";

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function DiscoveryError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function parse(answer) {
    if (typeof answer === "string") {
      try { answer = JSON.parse(answer); } catch (e) { return null; }
    }
    return answer && typeof answer === "object" ? answer : null;
  }

  function endpointFrom(data, source) {
    var port = Number(data.port);
    if (!(port > 0 && port < 65536)) return null;
    var api = String(data.apiVersion || "1");
    if (api.split(".")[0] !== API_MAJOR) throw DiscoveryError("api_version", "worksuite-ai API " + api + " is not v1");
    return { port: port, token: typeof data.token === "string" ? data.token : "", apiVersion: api,
      base: "http://127.0.0.1:" + port + "/v1", source: source };
  }

  /*
   * opts: desktop (window.AscDesktopEditor), host (the editor page window, for on_native_message),
   * storage (localStorage), fetch, devPort, timeoutMs, startRetries, startDelayMs
   */
  function createDiscovery(opts) {
    opts = opts || {};
    var cached = null;
    var pending = [];
    var listening = false;
    var timeoutMs = opts.timeoutMs || 3000;

    function listen() {
      if (listening || !opts.host) return listening;
      try {
        var host = opts.host;
        var previous = host.on_native_message;
        host.on_native_message = function (cmd, param) {
          if (cmd === COMMAND) {
            var waiting = pending;
            pending = [];
            waiting.forEach(function (w) { w(param); });
          }
          if (typeof previous === "function") return previous.apply(this, arguments);
        };
        listening = true;
      } catch (e) { listening = false; } // another origin: no answers can reach us
      return listening;
    }

    function askShell(start) {
      var d = opts.desktop;
      if (!d || typeof d.execCommand !== "function" || !listen()) return Promise.resolve(null);
      return new Promise(function (resolve) {
        var done = false;
        function finish(v) { if (!done) { done = true; resolve(v); } }
        pending.push(function (param) { finish(parse(param) || { ok: false, error: "failed" }); });
        setTimeout(function () { finish(null); }, timeoutMs);
        try { d.execCommand(COMMAND, JSON.stringify({ start: !!start })); } catch (e) { finish(null); }
      });
    }

    function probeDev() {
      var f = opts.fetch;
      if (typeof f !== "function") return Promise.resolve(null);
      var token = "";
      try { token = (opts.storage && opts.storage.getItem(DEV_TOKEN_KEY)) || ""; } catch (e) { /* none */ }
      var port = opts.devPort || DEV_PORT;
      var headers = token ? { Authorization: "Bearer " + token } : {};
      return f("http://127.0.0.1:" + port + "/v1/info", { headers: headers }).then(function (res) {
        if (!res.ok) return null;
        return res.json().then(function (info) {
          return endpointFrom({ port: port, token: token, apiVersion: info && info.apiVersion }, "dev");
        });
      }, function () { return null; });
    }

    async function resolve(options) {
      var start = !!(options && options.start);
      if (cached && !(options && options.refresh)) return cached;
      var retries = opts.startRetries === undefined ? 20 : opts.startRetries;
      var answer = await askShell(start);
      while (answer && !answer.ok && answer.error === "starting" && retries-- > 0) {
        await wait(opts.startDelayMs || 500);
        answer = await askShell(false);
      }
      if (answer && answer.ok) {
        var ep = endpointFrom(answer, "shell");
        if (ep) return (cached = ep);
      }
      var dev = await probeDev();
      if (dev) return (cached = dev);
      if (answer && answer.error === "not_installed") throw DiscoveryError("not_installed", "WorkSuite Local AI is not installed");
      throw DiscoveryError("service_unavailable", "WorkSuite Local AI is not running");
    }

    return {
      resolve: resolve,
      invalidate: function () { cached = null; },
      current: function () { return cached; },
      set: function (ep) { cached = ep; }
    };
  }

  return { createDiscovery: createDiscovery, COMMAND: COMMAND, DEV_PORT: DEV_PORT, DEV_TOKEN_KEY: DEV_TOKEN_KEY };
});
