/*
 * Shared by the plugin's windows (dock, transcribe, review, reader): translation, the editor theme, the
 * messages to and from scripts/plugin.js, and a service client for the endpoint plugin.js passes.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var handlers = {};
  var service = { endpoint: null, info: null, policy: null, settings: {} };
  var client = null;

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls, attrs) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function translate() {
    var nodes = document.querySelectorAll("[data-tr]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tr(nodes[i].getAttribute("data-tr"));
    nodes = document.querySelectorAll("[data-tr-title]");
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("title", tr(nodes[i].getAttribute("data-tr-title")));
      nodes[i].setAttribute("aria-label", tr(nodes[i].getAttribute("data-tr-title")));
    }
  }

  function theme(t) {
    if (plugin.onThemeChangedBase && t) plugin.onThemeChangedBase(t);
    var dark = t && (t.type === "dark" || /dark/.test(t.name || ""));
    document.documentElement.classList.toggle("ws-dark", !!dark);
  }

  function on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); }
  function emit(event, data) { (handlers[event] || []).forEach(function (fn) { fn(data || {}); }); }
  function send(event, data) { plugin.sendToPlugin(event, data || {}); }

  ["onState", "onService", "onReview", "onStop", "onDiscard"].forEach(function (event) {
    plugin.attachEvent(event, function (data) {
      if (event === "onService") {
        service = Object.assign(service, data || {});
        client = service.endpoint ? window.WsAiClient.createClient({ endpoint: service.endpoint }) : null;
      }
      emit(event, data);
    });
  });
  plugin.attachEvent("onTheme", theme);

  function getClient() {
    if (!client) throw Object.assign(new Error("WorkSuite Local AI is not running"), { code: "service_unavailable" });
    return client;
  }

  function errorText(e) {
    var map = {
      service_unavailable: "WorkSuite Local AI is not running", not_installed: "WorkSuite Local AI is not installed",
      model_not_installed: "No local model for this is installed", model_loading: "The model is loading, try again in a moment",
      forbidden_by_policy: "Managed by your organization", capability_unavailable: "Not available yet for this language",
      unsupported_media: "This file type is not supported", input_too_long: "The text is too long", busy: "Local AI is busy, try again",
      insufficient_memory: "Not enough memory for this model", insufficient_disk: "Not enough disk space", integrity_failed: "Failed: integrity check"
    };
    var code = e && e.code;
    if (code === "unauthorized") send("onEndpointStale");
    return map[code] ? tr(map[code]) : tr("Something went wrong") + " (" + (code || (e && e.message) || "?") + ")";
  }

  plugin.init = function () {
    translate();
    if (plugin.info && plugin.info.theme) theme(plugin.info.theme);
    send("onWindowReady");
    emit("init");
  };
  plugin.onTranslate = translate;
  plugin.onThemeChanged = theme;
  plugin.button = function () { send("onWindowClose"); };

  window.WsAiUi = { tr: tr, fmt: fmt, $: $, el: el, on: on, send: send, client: getClient, service: function () { return service; },
    errorText: errorText, translate: translate };
})(window, document);
