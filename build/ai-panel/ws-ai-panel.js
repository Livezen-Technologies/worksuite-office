/* WorkSuite: Hide for the AI agent panel. Copied next to the plugin's index.js by
   build/patch-ai-panel.py and loaded before it.

   The panel runs in the start page's iframe (#idx-plugin-frame). The start page already handles
   the plugin's "collapse" (close the side panel) and "minimize" (leave the full-page AI chat)
   events and remembers the panel as closed (its persisted aichat.open), so a hidden panel stays
   hidden after a restart until AI Chat or Settings > Show AI agent panel opens it again. */
(function () {
  "use strict";

  var STRINGS = {
    en: {
      HidePanel: "Hide AI agent panel",
      ProTitle: "WorkSuite Office Pro",
      ProText: "The AI assistant is a WorkSuite Office Pro feature. Upgrade to Pro, or enter your license key in Settings › WorkSuite Office Pro, to use it.",
      Upgrade: "Upgrade to Pro",
      Dismiss: "Not now",
    },
    si: {
      HidePanel: "AI නියෝජිත පුවරුව සඟවන්න",
      ProTitle: "WorkSuite Office Pro",
      ProText: "AI සහායක යනු WorkSuite Office Pro විශේෂාංගයකි. එය භාවිත කිරීමට Pro වෙත උත්ශ්‍රේණි කරන්න, නැතහොත් සැකසීම් › WorkSuite Office Pro හි ඔබේ බලපත්‍ර යතුර ඇතුළත් කරන්න.",
      Upgrade: "Pro වෙත උත්ශ්‍රේණි කරන්න",
      Dismiss: "දැන් නොවේ",
    },
    ta: {
      HidePanel: "AI முகவர் பலகத்தை மறை",
      ProTitle: "WorkSuite Office Pro",
      ProText: "AI உதவியாளர் என்பது WorkSuite Office Pro அம்சமாகும். அதைப் பயன்படுத்த Pro ஆக மேம்படுத்துங்கள், அல்லது அமைப்புகள் › WorkSuite Office Pro இல் உங்கள் உரிம விசையை உள்ளிடவும்.",
      Upgrade: "Pro ஆக மேம்படுத்து",
      Dismiss: "இப்போது வேண்டாம்",
    },
  };

  var UPGRADE_URL = "https://worksuitecloud.com/pro";

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

  function t(key) {
    var table = STRINGS[lang()] || STRINGS.en;
    return table[key] || STRINGS.en[key] || key;
  }

  window.WSAiPanel = {
    t: t,
    hide: function () {
      if (!hosted) return;
      if (mode === "expanded") post("minimize"); // back to the start page first
      post("collapse");
      mode = "minimized";
    },
  };

  // The AI assistant is a WorkSuite Office Pro feature: the local service answers chat with HTTP 402
  // (payment_required, ai-service/src/license.ts) when there is no Pro license. The panel is a
  // prebuilt OpenAI-compatible client, so instead of its generic error we catch the 402 on a call to
  // the local service's /v1/openai endpoint and show an Upgrade to Pro prompt over the panel.
  var upsell = null;
  function isLocalOpenAi(url) {
    try { return /\/v1\/openai\//.test(String(url)); } catch (e) { return false; }
  }
  function showUpsell() {
    if (upsell) { upsell.hidden = false; return; }
    upsell = document.createElement("div");
    upsell.className = "ws-ai-upsell";
    var card = document.createElement("div");
    card.className = "ws-ai-upsell__card";
    var title = document.createElement("div");
    title.className = "ws-ai-upsell__title";
    title.textContent = t("ProTitle");
    var text = document.createElement("p");
    text.className = "ws-ai-upsell__text";
    text.textContent = t("ProText");
    var actions = document.createElement("div");
    actions.className = "ws-ai-upsell__actions";
    var upgrade = document.createElement("a");
    upgrade.className = "ws-ai-upsell__btn ws-ai-upsell__btn--primary";
    upgrade.href = UPGRADE_URL;
    upgrade.target = "_blank";
    upgrade.rel = "noreferrer";
    upgrade.textContent = t("Upgrade");
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "ws-ai-upsell__btn";
    dismiss.textContent = t("Dismiss");
    dismiss.addEventListener("click", function () { upsell.hidden = true; });
    actions.appendChild(upgrade);
    actions.appendChild(dismiss);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(actions);
    upsell.appendChild(card);
    (document.body || document.documentElement).appendChild(upsell);
  }

  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function (input, init) {
      var url = (input && input.url) || input;
      return _fetch.apply(this, arguments).then(function (res) {
        if (res && res.status === 402 && isLocalOpenAi(url)) showUpsell();
        return res;
      });
    };
  }

  if (typeof XMLHttpRequest === "function" && XMLHttpRequest.prototype) {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__wsUrl = url;
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener("load", function () {
        if (xhr.status === 402 && isLocalOpenAi(xhr.__wsUrl)) showUpsell();
      });
      return _send.apply(this, arguments);
    };
  }
})();
