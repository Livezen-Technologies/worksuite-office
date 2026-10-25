/*
 * W9: the local service as a provider of the AI agent panel and the editors' AI plugin. They read
 * "providers", "current-provider" and "current-model" from the desktop app's local storage (the same
 * keys the start page's WorkSuite AI code uses, desktop-apps common/loginpage/src/worksuite/ai.js). This
 * puts "WorkSuite Local AI" there, an OpenAI-compatible provider at http://127.0.0.1:{port}/v1/openai
 * with the service's token, while the service has assistant models (GET /v1/openai/models) and policy
 * allows it; otherwise it takes it out. It never changes the provider the person chose, and makes
 * itself current only when there is none.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiProviders = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NAME = "WorkSuite Local AI";
  var LS = { providers: "providers", current: "current-provider", model: "current-model" };

  function read(storage, key, fallback) {
    try { var v = storage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(storage, key, value) {
    try {
      if (value === undefined || value === null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage blocked: nothing registered */ }
  }

  function entry(endpoint) {
    return { type: "openaicompatible", name: NAME, baseUrl: "http://127.0.0.1:" + endpoint.port + "/v1/openai", key: endpoint.token || "" };
  }

  function isOurs(p) { return !!p && p.name === NAME; }

  /* pure: the provider list with ours in it (replacing an old port/token), at the end */
  function upsert(list, endpoint) {
    var ours = entry(endpoint);
    var rest = (list || []).filter(function (p) { return !isOurs(p); });
    return rest.concat([ours]);
  }

  function remove(list) { return (list || []).filter(function (p) { return !isOurs(p); }); }

  /* models: the data of GET /v1/openai/models ({data:[{id}]}) */
  function modelIds(models) {
    var data = models && (models.data || models);
    return Array.isArray(data) ? data.map(function (m) { return m && (m.id || m.name); }).filter(Boolean) : [];
  }

  /*
   * storage: localStorage. endpoint: {port, token} or null (service unreachable: left as it is, so a
   * restart with a new port fixes itself next time). allowed: policy.features.assistant !== false.
   * Returns what it did: "added" | "updated" | "removed" | "unchanged".
   */
  function sync(storage, endpoint, models, allowed) {
    var list = read(storage, LS.providers, []);
    if (!Array.isArray(list)) list = [];
    var had = list.filter(isOurs)[0];
    var ids = modelIds(models);
    if (!allowed || (endpoint && !ids.length)) {
      if (!had) return "unchanged";
      write(storage, LS.providers, remove(list));
      if (isOurs(read(storage, LS.current, null))) { write(storage, LS.current, undefined); write(storage, LS.model, undefined); }
      return "removed";
    }
    if (!endpoint) return "unchanged";
    var next = upsert(list, endpoint);
    var ours = next[next.length - 1];
    if (had && had.baseUrl === ours.baseUrl && had.key === ours.key) return "unchanged";
    write(storage, LS.providers, next);
    var current = read(storage, LS.current, null);
    if (!current || isOurs(current)) {
      write(storage, LS.current, ours);
      var model = read(storage, LS.model, null);
      if (!model || !isOurs(current)) write(storage, LS.model, { id: ids[0], name: "Local · " + ids[0], provider: "openaicompatible" });
    }
    return had ? "updated" : "added";
  }

  return { NAME: NAME, KEYS: LS, entry: entry, upsert: upsert, remove: remove, modelIds: modelIds, sync: sync };
});
