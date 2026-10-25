/*
 * Which ribbon commands are on, from GET /v1/policy (W10) and the service's capabilities (GET /v1/info).
 * Policy off -> locked with "Managed by your organization". A missing capability disables a command with
 * its reason, except voice typing and read aloud, which open and offer to install a model (W3).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // command -> [policy feature, capability]
  var COMMANDS = {
    voice: ["stt", "speech.stt"], transcribe: ["stt", "speech.stt"], readAloud: ["tts", "tts"],
    spelling: ["correction", "text.check"], grammar: ["correction", "text.check"], punctuation: ["correction", "text.check"],
    improve: ["correction", "text.transform"], rewrite: ["correction", "text.transform"], simplify: ["correction", "text.transform"],
    formal: ["correction", "text.transform"], professional: ["correction", "text.transform"], expand: ["correction", "text.transform"],
    shorten: ["correction", "text.transform"], summarize: ["correction", "text.transform"], explain: ["correction", "text.transform"],
    tone: ["correction", "text.transform"], translate: ["translate", "translate"], detect: ["correction", null],
    suggestions: ["suggestions", "text.complete"], assistant: ["assistant", "assistant"]
  };
  var OPENS_ANYWAY = { voice: 1, transcribe: 1, readAloud: 1, spelling: 1 }; // spelling falls back to the dictionary

  function featureAllowed(policy, feature) {
    return !(policy && policy.features && policy.features[feature] === false);
  }

  /* -> {enabled, locked, reason} ; info null = service not reached yet (commands stay on) */
  function commandState(cmd, policy, info) {
    var c = COMMANDS[cmd];
    if (!c) return { enabled: true, locked: false, reason: "" };
    if (!featureAllowed(policy, c[0])) return { enabled: false, locked: true, reason: "Managed by your organization" };
    if (info && c[1] && (info.capabilities || []).indexOf(c[1]) < 0 && !OPENS_ANYWAY[cmd]) {
      return { enabled: false, locked: false, reason: "No local model for this is installed" };
    }
    return { enabled: true, locked: false, reason: "" };
  }

  function sinhalaAvailable(info, task) {
    var cap = task === "tts" ? "tts.si" : "speech.stt.si";
    return !!(info && (info.capabilities || []).indexOf(cap) >= 0);
  }

  return { COMMANDS: COMMANDS, commandState: commandState, featureAllowed: featureAllowed, sinhalaAvailable: sinhalaAvailable };
});
