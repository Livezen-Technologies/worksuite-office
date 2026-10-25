/*
 * The worksuite-ai /v1 client (spec: Local service API contracts). Every request carries
 * Authorization: Bearer <token>; errors come back as {error:{code, message, detail?, retryable}} and are
 * thrown as ServiceError. A 401 or a refused connection re-discovers the endpoint once (the service may
 * have restarted with a new port and token) and, when the caller allows, asks the shell to start it.
 *
 * WebSockets: a browser cannot set Authorization on a WebSocket, so the token goes as the subprotocol
 * "bearer.<token>" next to "ws-ai.v1" (the service must accept and echo "ws-ai.v1").
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiClient = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function ServiceError(code, message, opts) {
    var e = new Error(message || code);
    e.name = "ServiceError";
    e.code = code;
    e.status = opts && opts.status;
    e.retryable = !!(opts && opts.retryable);
    e.detail = opts && opts.detail;
    return e;
  }

  var seq = 0;
  function requestId() { return "wsai-" + Date.now().toString(36) + "-" + (++seq).toString(36); }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /*
   * opts: discovery (from discovery.js) or endpoint ({base, token}), fetch, WebSocket, FormData,
   * autoStart (ask the shell to start the service when it is not running; true for user actions)
   */
  function createClient(opts) {
    var f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(null) : null);
    var discovery = opts.discovery || {
      resolve: function () { return Promise.resolve(opts.endpoint); },
      invalidate: function () {}, current: function () { return opts.endpoint; }
    };

    async function endpoint(start) {
      try {
        return await discovery.resolve({ start: start });
      } catch (e) {
        throw ServiceError(e.code || "service_unavailable", e.message);
      }
    }

    async function once(ep, method, path, body, o) {
      var headers = { Authorization: "Bearer " + ep.token };
      if (o.requestId) headers["X-Request-Id"] = o.requestId;
      var init = { method: method, headers: headers, signal: o.signal };
      if (body !== undefined && body !== null) {
        if (o.form) init.body = body;
        else { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
      }
      var res = await f(ep.base + path, init);
      if (!res.ok) {
        var err = null;
        try { err = (await res.json()).error; } catch (e) { /* not JSON */ }
        throw ServiceError((err && err.code) || (res.status === 401 ? "unauthorized" : "internal"),
          (err && err.message) || ("HTTP " + res.status), { status: res.status, retryable: !!(err && err.retryable), detail: err && err.detail });
      }
      if (o.raw) return res;
      if (res.status === 204) return null;
      var type = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
      return type.indexOf("json") >= 0 || !type ? res.json() : res.text();
    }

    async function request(method, path, body, o) {
      o = o || {};
      var start = o.start !== undefined ? o.start : !!opts.autoStart;
      var ep = await endpoint(start);
      try {
        return await once(ep, method, path, body, o);
      } catch (e) {
        if (o.signal && o.signal.aborted) throw ServiceError("cancelled", "cancelled");
        var stale = e.code === "unauthorized" || e.name === "TypeError";
        if (!stale || o.noRetry) {
          if (e.name === "TypeError") throw ServiceError("service_unavailable", "WorkSuite Local AI is not running");
          throw e;
        }
        discovery.invalidate();
        var again = await endpoint(start);
        try {
          return await once(again, method, path, body, o);
        } catch (e2) {
          if (e2.name === "TypeError") throw ServiceError("service_unavailable", "WorkSuite Local AI is not running");
          throw e2;
        }
      }
    }

    /* A request that the next keystroke cancels: abort() stops the fetch and DELETE /v1/requests/{id}. */
    function cancellable(method, path, body) {
      var id = requestId();
      var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var finished = false;
      var promise = request(method, path, body, { requestId: id, signal: ctl && ctl.signal, noRetry: true, start: false })
        .then(function (v) { finished = true; return v; }, function (e) { finished = true; throw e; });
      return {
        id: id,
        promise: promise,
        abort: function () {
          if (finished) return;
          if (ctl) ctl.abort();
          request("DELETE", "/requests/" + encodeURIComponent(id), null, { noRetry: true, start: false }).catch(function () {});
        }
      };
    }

    async function waitJob(jobId, onProgress, o) {
      o = o || {};
      var interval = o.intervalMs || 500;
      for (;;) {
        if (o.signal && o.signal.aborted) throw ServiceError("cancelled", "cancelled");
        var job = await request("GET", "/jobs/" + encodeURIComponent(jobId), null, { signal: o.signal });
        if (onProgress) onProgress(job);
        if (job.state === "done" || job.state === "succeeded") return job.result;
        if (job.state === "failed" || job.state === "cancelled") {
          var err = job.error || {};
          throw ServiceError(err.code || job.state, err.message || job.state, { retryable: !!err.retryable });
        }
        await wait(interval);
      }
    }

    function streamUrl(ep, path, params) {
      return ep.base.replace(/^http/, "ws") + path + qs(params);
    }

    return {
      request: request,
      cancellable: cancellable,
      waitJob: waitJob,
      endpoint: endpoint,
      info: function () { return request("GET", "/info"); },
      health: function () { return request("GET", "/health"); },
      policy: function () { return request("GET", "/policy"); },
      privacy: function () { return request("GET", "/privacy"); },
      models: function (task) { return request("GET", "/models" + qs({ task: task })); },
      catalog: function (task, lang) { return request("GET", "/catalog" + qs({ task: task, lang: lang })); },
      install: function (id, version) { return request("POST", "/models/" + encodeURIComponent(id) + "/install", version ? { version: version } : {}); },
      complete: function (body) { return cancellable("POST", "/text/complete", body); },
      check: function (body, o) { return request("POST", "/text/check", body, o); },
      transform: function (body, o) { return request("POST", "/text/transform", body, o); },
      detectLanguage: function (text, o) { return request("POST", "/text/detect-language", { text: text }, o); },
      translate: function (body, o) { return request("POST", "/translate", body, o); },
      voices: function () { return request("GET", "/tts/voices"); },
      synthesize: async function (body, o) {
        var res = await request("POST", "/tts/synthesize", body, Object.assign({ raw: true }, o || {}));
        return res.arrayBuffer();
      },
      transcribe: function (file, options, o) {
        var FD = opts.FormData || (typeof FormData !== "undefined" ? FormData : null);
        var form = new FD();
        form.append("file", file, file && file.name);
        form.append("options", JSON.stringify(options || {}));
        return request("POST", "/speech/transcribe", form, Object.assign({ form: true }, o || {}));
      },
      openaiModels: function () { return request("GET", "/openai/models"); },
      /* WS /v1/speech/stream; resolves to an open-ready WebSocket */
      speechStream: async function (params) {
        var WS = opts.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
        var ep = await endpoint(true);
        var ws = new WS(streamUrl(ep, "/speech/stream", params), ["ws-ai.v1", "bearer." + ep.token]);
        ws.binaryType = "arraybuffer";
        return ws;
      },
      streamUrl: streamUrl
    };
  }

  return { createClient: createClient, ServiceError: ServiceError, qs: qs };
});
