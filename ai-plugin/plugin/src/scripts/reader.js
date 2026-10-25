/*
 * W8 read aloud player bar: play/pause, stop, speed 0.5-2×, voice, volume, Export audio. Text is read a
 * sentence at a time (POST /v1/tts/synthesize, WAV, the next one fetched while this one plays), so the
 * editor can highlight the sentence being read (plugin.js selects it and restores the selection on
 * stop) whether or not the voice gives timings. Speed is the player's (pitch kept), so changing it does
 * not synthesize again. Sinhala voices are listed only with a validated Sinhala voice (capability tts.si).
 */
(function (window, document) {
  "use strict";

  var U = window.WsAiUi, A = window.WsAiAudio;
  var $ = U.$, tr = U.tr;
  var sentences = [], index = 0, playing = false, audio = new window.Audio(), cache = {}, url = null, locked = "";

  function status(t, err) { $("status").textContent = t || ""; $("status").classList.toggle("ws-error", !!err); }

  function setPlaying(on) {
    playing = on;
    $("reader").setAttribute("data-state", on ? "playing" : "idle");
    $("play").firstChild.className = "ws-i " + (on ? "ws-i-pause" : "ws-i-play");
    $("play").setAttribute("title", on ? tr("Pause") : tr("Play"));
  }

  function wav(i) {
    var key = $("voice").value + "|" + i;
    if (!cache[key]) {
      cache[key] = U.client().synthesize({ text: sentences[i].text, voice: $("voice").value, rate: 1, format: "wav", timings: "none" });
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }

  function show(i) {
    $("sentence").textContent = sentences[i] ? sentences[i].text : "";
    $("progress").style.width = (sentences.length ? Math.round(i / sentences.length * 100) : 0) + "%";
  }

  async function playFrom(i) {
    if (locked) { status(locked, true); return; }
    if (i >= sentences.length) { stop(); return; }
    index = i;
    show(i);
    setPlaying(true);
    try {
      var buf = await wav(i);
      if (!playing || index !== i) return;
      if (i + 1 < sentences.length) wav(i + 1);
      if (url) window.URL.revokeObjectURL(url);
      url = window.URL.createObjectURL(new window.Blob([buf], { type: "audio/wav" }));
      audio.src = url;
      audio.playbackRate = Number($("rate").value);
      audio.preservesPitch = true;
      audio.volume = Number($("volume").value);
      U.send("onReadSentence", { index: i });
      status("");
      await audio.play();
    } catch (e) {
      setPlaying(false);
      status(U.errorText(e), true);
    }
  }

  function toggle() {
    if (playing) { audio.pause(); setPlaying(false); return; }
    if (audio.src && audio.currentTime > 0 && !audio.ended) { setPlaying(true); audio.play(); return; }
    playFrom(index);
  }

  function stop() {
    audio.pause();
    try { audio.currentTime = 0; } catch (e) { /* not loaded */ }
    setPlaying(false);
    index = 0;
    show(0);
    U.send("onReadStop");
  }

  async function exportAudio() {
    $("export").disabled = true;
    try {
      var parts = [];
      for (var i = 0; i < sentences.length; i++) {
        status(U.fmt("Preparing audio: %1 of %2", i + 1, sentences.length));
        parts.push(await wav(i));
      }
      var joined = A.concatWav(parts);
      var a = U.el("a", null, null, { download: tr("Read aloud") + ".wav", href: window.URL.createObjectURL(new window.Blob([joined], { type: "audio/wav" })) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      status(tr("Audio exported"));
    } catch (e) {
      status(U.errorText(e), true);
    } finally {
      $("export").disabled = false;
    }
  }

  async function voices() {
    var select = $("voice");
    try {
      var info = U.service().info;
      var list = await U.client().voices();
      var siOk = !!(info && (info.capabilities || []).indexOf("tts.si") >= 0);
      list = (list || []).filter(function (v) { return v.lang !== "si" || siOk; });
      select.textContent = "";
      list.forEach(function (v) {
        var o = U.el("option", v.id.replace(/[-_](low|medium|high|x_low)$/, ""), null, { title: v.id + " (" + v.lang + (v.quality ? ", " + v.quality : "") + ")" });
        o.value = v.id;
        select.appendChild(o);
      });
      var want = (U.service().settings || {}).voice;
      if (want && list.some(function (v) { return v.id === want; })) select.value = want;
      if (!list.length) status(tr("No voice is installed. Install one in Settings › AI Models."), true);
    } catch (e) { status(U.errorText(e), true); }
  }

  function saveSettings() {
    U.send("onReaderSettings", { voice: $("voice").value, rate: Number($("rate").value), volume: Number($("volume").value) });
  }

  audio.addEventListener("ended", function () { if (playing) playFrom(index + 1); });

  U.on("onState", function (d) {
    sentences = d.sentences || [];
    locked = d.locked || "";
    index = 0;
    show(0);
    if (locked) status(locked, true);
  });
  U.on("onService", function (s) {
    var set = s.settings || {};
    if (set.rate) $("rate").value = String(set.rate);
    if (set.volume !== undefined) $("volume").value = String(set.volume);
    voices();
  });
  U.on("init", function () {
    $("play").addEventListener("click", toggle);
    $("stop").addEventListener("click", stop);
    $("export").addEventListener("click", exportAudio);
    $("rate").addEventListener("change", function () { audio.playbackRate = Number($("rate").value); saveSettings(); });
    $("volume").addEventListener("input", function () { audio.volume = Number($("volume").value); saveSettings(); });
    $("voice").addEventListener("change", function () { cache = {}; saveSettings(); if (playing) playFrom(index); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") stop(); });
  });

  window.WsAiReader = { _test: { show: show, setPlaying: setPlaying } };
})(window, document);
