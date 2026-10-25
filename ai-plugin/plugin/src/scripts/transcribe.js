/*
 * W4 transcribe a file: pick MP3/WAV/M4A/MP4, options, POST /v1/speech/transcribe (a job; progress and
 * partial segments while it runs), then a review list to edit before Insert as text or as a two-column
 * time · text table (plugin.js inserts it, one undo step). Speaker labels only with a diarization model.
 */
(function (window, document) {
  "use strict";

  var U = window.WsAiUi, T = window.WsAiText;
  var $ = U.$, tr = U.tr;
  var EXT = /\.(mp3|wav|m4a|mp4)$/i;
  var file = null, segments = [], ctl = null, locked = "";

  function status(text, error) {
    $("status").textContent = text || "";
    $("status").classList.toggle("ws-error", !!error);
  }

  function progress(p) {
    var bar = $("progress");
    bar.hidden = p === null;
    if (p !== null) bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + "%";
  }

  function renderSegments() {
    var list = $("segments");
    list.textContent = "";
    var speakers = $("speakers").checked;
    segments.forEach(function (s, i) {
      var li = U.el("li", null, "ws-seg");
      var meta = U.el("div", T.formatTime(s.start) + (speakers && s.speaker ? " · " + s.speaker : ""), "ws-seg-meta");
      var ta = U.el("textarea", null, "form-control ws-seg-text", { rows: "2", "aria-label": tr("Segment") + " " + (i + 1) });
      ta.value = s.text || "";
      if (s.confidence !== undefined && s.confidence < 0.5) ta.classList.add("ws-low");
      ta.addEventListener("input", function () { segments[i].text = ta.value; });
      li.appendChild(meta);
      li.appendChild(ta);
      list.appendChild(li);
    });
    $("review").hidden = !segments.length;
  }

  function pick() {
    var f = $("file").files && $("file").files[0];
    file = f && EXT.test(f.name) ? f : null;
    $("fileName").textContent = f ? f.name : tr("MP3, WAV, M4A or MP4");
    if (f && !file) status(tr("This file type is not supported"), true); else status("");
    $("go").disabled = !file || !!locked;
  }

  async function go() {
    if (!file) return;
    $("go").disabled = true;
    $("cancel").hidden = false;
    segments = [];
    renderSegments();
    progress(0);
    status(tr("Uploading"));
    ctl = new window.AbortController();
    try {
      var c = U.client();
      var job = await c.transcribe(file, { lang: $("lang").value, punctuate: $("punctuate").checked,
        timestamps: $("timestamps").checked, diarize: $("speakers").checked }, { signal: ctl.signal });
      var result = await c.waitJob(job.jobId, function (j) {
        progress(typeof j.progress === "number" ? (j.progress > 1 ? j.progress / 100 : j.progress) : 0);
        status(tr("Transcribing") + (typeof j.progress === "number" ? " " + Math.round(j.progress > 1 ? j.progress : j.progress * 100) + "%" : ""));
        var partial = j.partial || (j.data && j.data.segments);
        if (partial && partial.length) { segments = partial.slice(); renderSegments(); }
      }, { signal: ctl.signal, intervalMs: 700 });
      segments = (result.segments || []).slice();
      renderSegments();
      progress(null);
      status(U.fmt("%1 segments, %2", segments.length, T.formatTime(result.durationSec || 0)));
    } catch (e) {
      progress(null);
      status(e.code === "cancelled" ? tr("Cancelled") : U.errorText(e), e.code !== "cancelled");
    } finally {
      $("cancel").hidden = true;
      $("go").disabled = !file;
      ctl = null;
    }
  }

  function insert(mode) {
    var speakers = $("speakers").checked;
    if (mode === "table") U.send("onInsertTranscript", { mode: "table", rows: T.transcriptRows(segments, { speakers: speakers }) });
    else U.send("onInsertTranscript", { mode: "text", text: T.transcriptText(segments, { timestamps: $("timestamps").checked, speakers: speakers }) });
  }

  async function diarization() {
    try {
      var models = await U.client().models("diarize");
      $("speakersRow").hidden = !(models && models.length);
    } catch (e) { $("speakersRow").hidden = true; }
  }

  U.on("onState", function (d) { locked = d.locked || ""; if (locked) status(locked, true); pick(); });
  U.on("onService", diarization);
  U.on("init", function () {
    $("file").addEventListener("change", pick);
    $("go").addEventListener("click", go);
    $("cancel").addEventListener("click", function () { if (ctl) ctl.abort(); });
    $("insertText").addEventListener("click", function () { insert("text"); });
    $("insertTable").addEventListener("click", function () { insert("table"); });
    $("speakers").addEventListener("change", renderSegments);
  });

  window.WsAiTranscribe = { _test: { show: function (segs) { segments = segs; renderSegments(); } } };
})(window, document);
