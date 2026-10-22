/* WorkSuite: Hide for the AI agent panel. Copied next to the plugin's index.js by
   build/patch-ai-panel.py and loaded before it.

   The panel runs in the start page's iframe (#idx-plugin-frame). The start page already handles
   the plugin's "collapse" (close the side panel) and "minimize" (leave the full-page AI chat)
   events and remembers the panel as closed (its persisted aichat.open), so a hidden panel stays
   hidden after a restart until AI Chat or Settings > Show AI agent panel opens it again. */
(function () {
  "use strict";

  var STRINGS = {
    en: { HidePanel: "Hide AI agent panel" },
    si: { HidePanel: "AI නියෝජිත පුවරුව සඟවන්න" },
    ta: { HidePanel: "AI முகவர் பலகத்தை மறை" },
  };

  var hosted = false;
  try {
    hosted = window.parent && window.parent !== window;
  } catch (e) {
    hosted = false;
  }
  if (hosted) document.documentElement.classList.add("ws-ai-hosted");

  // The start page tells the plugin whether it is the side panel or the full page
  var mode = "minimized";
  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch (x) {
        return;
      }
    }
    var type = msg && msg.event === "onPluginEvent" && msg.data && msg.data.type;
    if (type === "minimized" || type === "expanded") mode = type;
  });

  function lang() {
    var rpv = window.RendererProcessVariable;
    var l = (rpv && rpv.lang) || navigator.language || "en";
    return String(l).slice(0, 2).toLowerCase();
  }

  function post(type) {
    window.parent.postMessage(JSON.stringify({ event: "onPluginEvent", data: { type: type } }), "*");
  }

  window.WSAiPanel = {
    t: function (key) {
      var table = STRINGS[lang()] || STRINGS.en;
      return table[key] || STRINGS.en[key] || key;
    },
    hide: function () {
      if (!hosted) return;
      if (mode === "expanded") post("minimize"); // back to the start page first
      post("collapse");
      mode = "minimized";
    },
  };
})();
