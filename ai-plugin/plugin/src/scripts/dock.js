/*
 * W3 voice typing dock. Mic (getUserMedia, in this frame) -> AudioWorklet (scripts/pcm-worklet.js:
 * 16 kHz s16le, 40 ms frames) -> WS /v1/speech/stream. Partial text shows greyed (here and, through
 * plugin.js, at the caret); finals replace it per segment. Stop sends {type:"end"}, waits for the tail
 * and hands all the text to plugin.js, which inserts it as one undo step. Esc discards it all.
 *
 * States: consent · starting · listening · paused · tail · done · error. When the service cannot keep up
 * (finals lag the audio and the lag grows, real-time factor > 1) it switches to "record then
 * transcribe": the audio is kept here and sent to POST /v1/speech/transcribe on Stop.
 */
(function (window, document) {
  "use strict";

  var U = window.WsAiUi, A = window.WsAiAudio, P = window.WsAiPolicy;
  var $ = U.$, tr = U.tr;
  var CONSENT_KEY = "worksuite-ai-voice-consent";
  var TAIL_MS = 6000;

  var st = { state: "starting", lang: "auto", locked: "", installModel: "whisper-small-q5" };
  var segments = {}, order = [], partial = "";
  var ws = null, stream = null, ctx = null, node = null, src = null;
  var recordMode = false, recorded = [], lag = null, tailTimer = null, finished = false;

  function setState(s, message) {
    st.state = s;
    $("dock").setAttribute("data-state", s);
    var labels = { consent: "Microphone", starting: "Starting", loading: "Loading the model", listening: "Listening",
      paused: "Paused", tail: "Processing", done: "Done", error: "Error", recording: "Recording" };
    $("status").textContent = tr(labels[s] || s);
    $("pause").disabled = !(s === "listening" || s === "paused" || s === "recording");
    $("stop").disabled = s === "tail" || s === "done";
    $("pause").firstChild.className = "ws-i " + (s === "paused" ? "ws-i-play" : "ws-i-pause");
    $("pause").setAttribute("title", s === "paused" ? tr("Resume") : tr("Pause"));
    notice(message || "");
  }

  function notice(text, link) {
    var n = $("notice");
    n.textContent = text || "";
    if (link) {
      var a = U.el("a", tr(link.text), "ws-link", { href: "#" });
      a.addEventListener("click", function (e) { e.preventDefault(); U.send("onOpenUrl", { url: link.url }); });
      n.appendChild(document.createTextNode(" "));
      n.appendChild(a);
    }
    n.hidden = !text;
  }

  function finalText() {
    return order.map(function (id) { return segments[id]; }).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function render() {
    var f = finalText();
    $("final").textContent = f ? f + " " : "";
    $("partial").textContent = partial;
    U.send("onVoiceText", { final: f ? f + " " : "", partial: partial });
  }

  function settingsUrl() {
    var ua = window.navigator.userAgent || "";
    if (/Mac/.test(ua)) return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
    if (/Windows/.test(ua)) return "ms-settings:privacy-microphone";
    return "";
  }

  // --- audio ----------------------------------------------------------------------------------
  async function startAudio() {
    stream = await window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    await ctx.audioWorklet.addModule("scripts/pcm-worklet.js");
    src = ctx.createMediaStreamSource(stream);
    node = new window.AudioWorkletNode(ctx, "ws-ai-pcm", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    node.port.onmessage = function (e) { onFrame(e.data); };
    src.connect(node);
  }

  function stopAudio() {
    try { if (src) src.disconnect(); } catch (e) { /* gone */ }
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* gone */ }
    try { if (ctx) ctx.close(); } catch (e) { /* gone */ }
    src = stream = ctx = node = null;
  }

  function onFrame(d) {
    var meter = $("meter");
    meter.style.width = Math.round(A.meterLevel(d.level) * 100) + "%";
    if (!d.pcm) return;
    if (st.state === "paused") return;
    if (recordMode) { recorded.push(new Int16Array(d.pcm)); return; }
    if (ws && ws.readyState === 1) {
      ws.send(d.pcm);
      lag.audio(d.pcm.byteLength / 2, 16000);
      if (lag.tooSlow()) switchToRecording();
    }
  }

  function switchToRecording() {
    recordMode = true;
    try { ws.send(JSON.stringify({ type: "end" })); } catch (e) { /* closed */ }
    setState("recording", tr("This computer is too slow for live dictation: recording now, the text comes when you stop."));
  }

  // --- the stream -----------------------------------------------------------------------------
  async function openStream() {
    var c = U.client();
    ws = await c.speechStream({ lang: st.lang, punctuate: true });
    lag = new A.LagWatch(8);
    ws.onmessage = function (e) {
      if (typeof e.data !== "string") return;
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.type === "partial") { partial = m.text || ""; if (st.state === "loading" || st.state === "starting") setState("listening"); render(); }
      else if (m.type === "final") {
        if (!(m.segmentId in segments)) order.push(m.segmentId);
        segments[m.segmentId] = (m.text || "").trim();
        partial = "";
        lag.final(m.end || 0);
        render();
      } else if (m.type === "ready" || m.type === "listening") { setState("listening"); }
      else if (m.type === "error") onError({ code: m.code, message: m.message });
      else if (m.type === "closed") { if (st.state === "tail") commit(); }
    };
    ws.onopen = function () { if (st.state === "starting") setState("listening"); };
    ws.onclose = function () { if (st.state === "tail") commit(); else if (!recordMode && (st.state === "listening" || st.state === "paused")) onError({ code: "service_unavailable" }); };
    ws.onerror = function () { /* onclose follows */ };
  }

  function onError(e) {
    if (e.code === "model_loading") { setState("loading"); return; }
    stopAudio();
    if (ws) { try { ws.close(); } catch (x) { /* closed */ } }
    if (e.code === "model_not_installed") { setState("error", ""); $("install").hidden = false; return; }
    if (e.code === "capability_unavailable") {
      setState("error", tr("Sinhala voice typing is not available yet. Choose English or Auto."));
      return;
    }
    if ((e.name === "NotAllowedError" || e.name === "SecurityError") && /Windows/.test(window.navigator.userAgent || "")) {
      // Windows: the app cannot turn on CEF's media stream yet (it needs a desktop-sdk change)
      setState("error", tr("Voice typing is not available on this Windows build yet."));
      return;
    }
    if (e.name === "NotAllowedError" || e.name === "SecurityError" || e.code === "mic_denied") {
      setState("error", tr("WorkSuite Office may not use the microphone."));
      var url = settingsUrl();
      if (url) notice(tr("WorkSuite Office may not use the microphone."), { text: "Open microphone settings", url: url });
      return;
    }
    if (e.name === "NotFoundError") { setState("error", tr("No microphone was found.")); return; }
    if (window.console) window.console.error("ws-ai voice", e && e.name, e && e.message);
    // a browser error (DOMException) has a number for a code: not one of the service's
    setState("error", U.errorText(typeof e.code === "string" ? e : { code: e.name || "internal", message: e.message }));
  }

  async function start() {
    if (st.locked) { setState("error", st.locked); return; }
    finished = false;
    segments = {}; order = []; partial = ""; recorded = []; recordMode = false;
    render();
    setState("starting");
    try {
      await startAudio();
      await openStream();
    } catch (e) {
      onError(e);
    }
  }

  function pause() {
    if (st.state === "listening" || st.state === "recording") {
      st.prev = st.state;
      setState("paused");
      if (node) node.port.postMessage("pause");
      if (ws && ws.readyState === 1 && !recordMode) ws.send(JSON.stringify({ type: "pause" }));
    } else if (st.state === "paused") {
      if (node) node.port.postMessage("resume");
      if (ws && ws.readyState === 1 && !recordMode) ws.send(JSON.stringify({ type: "resume" }));
      setState(st.prev || "listening");
    }
  }

  async function stop() {
    if (st.state === "error" || st.state === "consent") { discard(); return; }
    if (st.state === "tail" || st.state === "done") return;
    setState("tail");
    if (node) node.port.postMessage("flush");
    stopAudio();
    if (recordMode) {
      try {
        var file = new window.File([A.encodeWav(recorded, 16000)], "dictation.wav", { type: "audio/wav" });
        var c = U.client();
        var job = await c.transcribe(file, { lang: st.lang, punctuate: true, timestamps: false, diarize: false });
        var result = await c.waitJob(job.jobId);
        order = ["rec"]; segments = { rec: (result.segments || []).map(function (s) { return s.text.trim(); }).join(" ") };
        partial = "";
        commit();
      } catch (e) { onError(e); }
      return;
    }
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "end" }));
      tailTimer = setTimeout(commit, TAIL_MS);
    } else commit();
  }

  function commit() {
    if (finished) return;
    finished = true;
    clearTimeout(tailTimer);
    // what is still partial at the end is the tail the service did not finish: kept, it is what was said
    var text = (finalText() + " " + partial).replace(/\s+/g, " ").trim();
    setState("done");
    if (ws) { try { ws.close(); } catch (e) { /* closed */ } }
    U.send("onVoiceCommit", { text: text ? text + " " : "" });
  }

  function discard() {
    finished = true;
    stopAudio();
    if (ws) { try { ws.close(); } catch (e) { /* closed */ } }
    U.send("onVoiceDiscard");
  }

  async function install() {
    $("installBtn").disabled = true;
    var bar = $("installProgress");
    bar.hidden = false;
    try {
      var c = U.client();
      var job = await c.install(st.installModel);
      await c.waitJob(job.jobId, function (j) {
        bar.firstChild.style.width = Math.round((j.progress || 0) * (j.progress > 1 ? 1 : 100)) + "%";
        $("status").textContent = j.data && j.data.stage === "verifying" ? tr("Verifying") : tr("Downloading");
      });
      $("install").hidden = true;
      start();
    } catch (e) {
      $("installBtn").disabled = false;
      bar.hidden = true;
      setState("error", U.errorText(e));
    }
  }

  function applyLanguages() {
    var info = U.service().info;
    var opt = $("lang").querySelector('option[value="si"]');
    var si = P.sinhalaAvailable(info, "stt");
    opt.disabled = !!info && !si;
    opt.textContent = tr("Sinhala") + (info && !si ? " — " + tr("Not available yet") : "");
    if (opt.disabled && $("lang").value === "si") $("lang").value = "auto";
  }

  // --- wiring ---------------------------------------------------------------------------------
  U.on("onState", function (d) {
    st.lang = d.lang || "auto";
    st.locked = d.locked || "";
    st.installModel = d.installModel || st.installModel;
    $("lang").value = st.lang;
  });
  // start once the person has agreed and plugin.js has passed the service's endpoint
  var gate = { consent: false, service: false, started: false };
  function maybeStart() {
    if (gate.consent && gate.service && !gate.started) { gate.started = true; start(); }
  }
  U.on("onService", function () { applyLanguages(); gate.service = true; maybeStart(); });
  U.on("onStop", stop);
  U.on("onDiscard", discard);
  U.on("init", function () {
    $("pause").addEventListener("click", pause);
    $("stop").addEventListener("click", stop);
    $("installBtn").addEventListener("click", install);
    $("lang").addEventListener("change", function () {
      st.lang = $("lang").value;
      U.send("onVoiceLang", { lang: st.lang });
      if (st.state === "listening" || st.state === "paused") { if (ws) ws.onclose = null; try { ws.close(); } catch (e) { /* closed */ } openStream().catch(onError); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); discard(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "V" || e.key === "v")) { e.preventDefault(); stop(); }
    });
    var consented = false;
    try { consented = window.localStorage.getItem(CONSENT_KEY) === "1"; } catch (e) { /* ask */ }
    if (consented) { gate.consent = true; maybeStart(); return; }
    setState("consent");
    $("consent").hidden = false;
    $("consentOk").addEventListener("click", function () {
      try { window.localStorage.setItem(CONSENT_KEY, "1"); } catch (e) { /* ask again next time */ }
      $("consent").hidden = true;
      gate.consent = true;
      maybeStart();
    });
  });

  window.WsAiDock = { setState: setState, render: render, state: function () { return st; },
    _test: { segments: function (s, o, p) { segments = s; order = o; partial = p; render(); } } };
})(window, document);
