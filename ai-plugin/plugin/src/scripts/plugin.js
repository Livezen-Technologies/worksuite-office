/*
 * WorkSuite Local AI (asc.ws-ai): the editor side of the local worksuite-ai service.
 *
 *   AI tab        Voice typing, Transcribe file, Read aloud, the writing commands (W6), Suggestions
 *   Home          Voice typing        Sinhala Tools   Voice typing        Review   Read aloud
 *   Ctrl+Shift+V  (Cmd+Shift+V on a Mac) voice typing on and off
 *
 * This frame is a background plugin: it holds the toolbar, the keyboard shortcut, inline suggestions
 * (W5, the ghost text shown in this frame as the editor's input helper at the caret) and every change to
 * the document. Its windows are views that talk to it with sendToPlugin: dock.html (W3), transcribe.html
 * (W4), review.html (W6) and reader.html (W8). The document changes only through the plugin API: one
 * callCommand or PasteText per user action, so one undo step each.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var E = window.WsAiEdits;
  var EDITS_SOURCE = "(" + window.__wsAiEditsFactory.toString() + ")()";
  var P = window.WsAiPolicy;
  var T = window.WsAiText;
  var G = window.WsAiGhost;
  var SETTINGS_KEY = "worksuite-ai";
  var AI_TAB = "ai"; // the tab of the editors' AI plugin; created with the same id and caption when it is not there
  var SINHALA_TAB = "worksuite-sinhala-tools";
  var SHORTCUT = { keyCode: 86, shift: true }; // V with Ctrl (Cmd) and Shift
  var WHISPER_SMALL = "whisper-small-q5";

  var settings = { suggestions: true, voiceLang: "auto", voice: "", rate: 1, volume: 1, translateTo: "", tone: "friendly" };
  try {
    var saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && typeof saved === "object") for (var k in settings) if (typeof saved[k] === typeof settings[k]) settings[k] = saved[k];
  } catch (e) { /* defaults */ }
  function saveSettings() { try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function editorType() { return (plugin.info && plugin.info.editorType) || "word"; }
  function isDocument() { return editorType() === "word"; }

  // --- the service ----------------------------------------------------------------------------
  var host = null;
  try { host = window.parent && window.parent !== window ? window.parent : null; void (host && host.document); } catch (e) { host = null; }
  var discovery = window.WsAiDiscovery.createDiscovery({
    desktop: window.AscDesktopEditor || (host && host.AscDesktopEditor), host: host,
    storage: window.localStorage, fetch: window.fetch && window.fetch.bind(window)
  });
  var client = window.WsAiClient.createClient({ discovery: discovery, autoStart: true });
  var quiet = window.WsAiClient.createClient({ discovery: discovery, autoStart: false });
  var info = null, policy = null, privacy = null;

  function endpointState() {
    var ep = discovery.current();
    return ep ? { base: ep.base, token: ep.token, port: ep.port } : null;
  }

  function refresh(start) {
    var c = start ? client : quiet;
    return c.info().then(function (i) {
      info = i;
      return Promise.all([c.policy().catch(function () { return null; }), c.privacy().catch(function () { return null; })]);
    }).then(function (r) {
      policy = r[0]; privacy = r[1];
      ghost.setEnabled(suggestionsOn());
      addToolbar();
      syncProvider();
      broadcast("onService", serviceState());
    }, function () { /* not running: commands stay on and start it when used */ });
  }

  function serviceState() { return { endpoint: endpointState(), info: info, policy: policy, settings: settings }; }

  /* W9: the local service in the AI agent panel's providers */
  function syncProvider() {
    var ep = discovery.current();
    var allowed = P.featureAllowed(policy, "assistant") && !!info && (info.capabilities || []).indexOf("assistant") >= 0;
    var done = function (models) { window.WsAiProviders.sync(window.localStorage, ep, models, allowed); };
    if (!ep || !allowed) { done(null); return; }
    quiet.openaiModels().then(done, function () { /* left as it is */ });
  }

  // --- windows ----------------------------------------------------------------------------------
  var windows = {};

  function openWindow(name, options, state) {
    var w = windows[name];
    if (w) { w.send("onState", state); return w; }
    var pw = new window.Asc.PluginWindow();
    w = windows[name] = { win: pw, ready: false, queue: [] };
    w.send = function (event, data) {
      if (w.ready) pw.command(event, data); else w.queue.push([event, data]);
    };
    pw.attachEvent("onWindowReady", function () {
      w.ready = true;
      pw.command("onState", state);
      pw.command("onService", serviceState());
      while (w.queue.length) { var q = w.queue.shift(); pw.command(q[0], q[1]); }
    });
    Object.keys(HANDLERS[name] || {}).forEach(function (event) {
      pw.attachEvent(event, function (data) { HANDLERS[name][event](data || {}); });
    });
    pw.attachEvent("onWindowClose", function () { closeWindow(name); });
    pw.attachEvent("onEndpointStale", function () {
      discovery.invalidate();
      refresh(true).then(function () { if (windows[name]) windows[name].send("onService", serviceState()); });
    });
    pw.show(Object.assign({ isVisual: true, buttons: [], EditorsSupport: ["word", "cell", "slide"],
      icons: "resources/%theme-type%(light|dark)/icon%scale%(default).%extension%(png)" }, options));
    return w;
  }

  function closeWindow(name) {
    var w = windows[name];
    if (!w) return;
    delete windows[name];
    try { w.win.close(); } catch (e) { /* already closed */ }
    if (name === "dock") hideOverlay();
    if (name === "reader") restoreSelection();
  }

  function broadcast(event, data) { Object.keys(windows).forEach(function (n) { windows[n].send(event, data); }); }

  // --- the overlay at the caret (input helper): ghost text and voice typing's text -----------------
  var overlayMode = null; // "ghost" | "voice"

  function showOverlay(mode, finalText, partial) {
    overlayMode = mode;
    var o = document.getElementById("overlay");
    o.className = "ws-overlay ws-overlay-" + mode;
    o.textContent = "";
    var a = document.createElement("span"); a.className = "final"; a.textContent = finalText || "";
    var b = document.createElement("span"); b.className = "partial"; b.textContent = partial || "";
    o.appendChild(a); o.appendChild(b);
    var len = (finalText || "").length + (partial || "").length;
    var width = Math.min(420, Math.max(120, 16 + len * 7.2));
    var lines = Math.min(4, Math.ceil(len * 7.2 / (width - 16)) || 1);
    plugin.executeMethod("ShowInputHelper", [plugin.info.guid, Math.round(width), 8 + lines * 18, false]);
  }

  function hideOverlay() {
    if (!overlayMode) return;
    overlayMode = null;
    plugin.executeMethod("UnShowInputHelper", [plugin.info.guid, false]);
  }

  // --- W5 inline suggestions ----------------------------------------------------------------------
  var ghost = new G.GhostMachine({ enabled: settings.suggestions });
  var inflight = null;

  function suggestionsOn() { return settings.suggestions && isDocument() && P.commandState("suggestions", policy, info).enabled; }

  function ghostActions(actions) {
    actions.forEach(function (a) {
      switch (a.type) {
        case "schedule": setTimeout(function () { ghostActions(ghost.timer(a.token)); }, a.ms); break;
        case "cancel": if (inflight) { inflight.abort(); inflight = null; } break;
        case "hide": if (overlayMode === "ghost") hideOverlay(); break;
        case "show": if (!windows.dock) showOverlay("ghost", "", a.text); break;
        case "insert":
          plugin.executeMethod("InputText", [a.text]);
          if (privacy && privacy.learning) quiet.request("POST", "/dictionaries/personal/words", { words: a.text.trim().split(/\s+/) }).catch(function () {});
          break;
        case "request": requestGhost(a.token); break;
      }
    });
  }

  function requestGhost(token) {
    plugin.executeMethod("GetCurrentSentence", ["before"], function (before) {
      plugin.executeMethod("GetCurrentSentence", ["after"], function (after) {
        before = typeof before === "string" ? before : "";
        if (!G.shouldSuggest(before, typeof after === "string" ? after : "")) { ghostActions(ghost.failed(token)); return; }
        var text = before.slice(-T.LIMIT);
        var lang = G.langOf(text);
        inflight = quiet.complete({ text: text, caret: text.length, lang: lang, mode: "phrase", singlish: false, max: 5 });
        var mine = inflight;
        mine.promise.then(function (res) {
          if (inflight === mine) inflight = null;
          ghostActions(ghost.response(token, res && res.ghost));
        }, function () {
          if (inflight === mine) inflight = null;
          ghostActions(ghost.failed(token));
        });
      });
    });
  }

  // --- reading the document ----------------------------------------------------------------------
  /* -> {text, fingerprint, startPos, endPos, track, mode:"document"|"text"} */
  function readTarget(whole, callback) {
    if (!isDocument()) {
      plugin.executeMethod("GetSelectedText", [E.TEXT_OPTIONS], function (text) {
        text = typeof text === "string" ? text : "";
        callback({ text: text, fingerprint: E.fingerprint(text), mode: "text" });
      });
      return;
    }
    window.Asc.scope.editsLib = EDITS_SOURCE;
    window.Asc.scope.whole = !!whole;
    plugin.callCommand(function () {
      var L = eval(Asc.scope.editsLib); // eslint-disable-line no-eval
      return L.readTarget(Api, Asc.scope.whole);
    }, false, false, function (target) {
      if (target) target.mode = "document";
      callback(target || null);
    });
  }

  function readSelectionPos(callback) {
    if (!isDocument()) { callback(null); return; }
    plugin.callCommand(function () {
      var r = Api.GetDocument().GetRangeBySelect();
      return r && r.GetStartPos ? { start: r.GetStartPos(), end: r.GetEndPos() } : null;
    }, false, false, function (pos) { callback(pos || null); });
  }

  /* one undo step: the edits in the target, or nothing when it changed */
  function applyEdits(target, edits, callback) {
    if (target.mode === "text") {
      plugin.executeMethod("GetSelectedText", [E.TEXT_OPTIONS], function (now) {
        if (E.fingerprint(typeof now === "string" ? now : "") !== target.fingerprint) { callback({ ok: false, reason: "changed" }); return; }
        var next = E.apply(target.text, edits);
        plugin.executeMethod("ReplaceTextSmart", [next.split("\n"), "\t", "\n"], function () {
          callback({ ok: true, applied: edits.length, target: { text: next, fingerprint: E.fingerprint(next), mode: "text" } });
        });
      });
      return;
    }
    window.Asc.scope.editsLib = EDITS_SOURCE;
    window.Asc.scope.apply = { target: target, edits: edits };
    plugin.callCommand(function () {
      var L = eval(Asc.scope.editsLib); // eslint-disable-line no-eval
      return L.applyInDocument(Api, Asc.scope.apply);
    }, false, true, function (res) {
      if (res && res.ok) res.target.mode = "document";
      callback(res || { ok: false, reason: "unsupported" });
    });
  }

  // --- W6 review --------------------------------------------------------------------------------
  var TRANSFORMS = { improve: 1, rewrite: 1, simplify: 1, formal: 1, professional: 1, expand: 1, shorten: 1, tone: 1 };
  var CHECKS = { spelling: "spelling", grammar: "grammar", punctuation: "punctuation" };
  var RESULT_ONLY = { summarize: 1, explain: 1 };
  var review = null; // {cmd, target, original, edits, undo:[[edits]], options}

  function title(cmd) { var b = BUTTONS.filter(function (x) { return x[0] === cmd; })[0]; return b ? tr(b[1]) : cmd; }

  function reviewState(extra) {
    return Object.assign({ cmd: review.cmd, title: title(review.cmd), original: review.target ? review.target.text : "",
      edits: review.edits, canUndo: review.undo.length > 0, options: review.options, track: !!(review.target && review.target.track) }, extra || {});
  }

  function sendReview(extra) { if (windows.review) windows.review.send("onReview", reviewState(extra)); }

  function errorText(e) {
    var code = e && e.code;
    var map = {
      service_unavailable: "WorkSuite Local AI is not running", not_installed: "WorkSuite Local AI is not installed",
      model_not_installed: "No local model for this is installed", model_loading: "The model is loading, try again in a moment",
      forbidden_by_policy: "Managed by your organization", capability_unavailable: "Not available yet for this language",
      input_too_long: "The text is too long", busy: "Local AI is busy, try again", insufficient_memory: "Not enough memory for this model"
    };
    return tr(map[code] || "Something went wrong") + (map[code] ? "" : " (" + (code || (e && e.message) || "?") + ")");
  }

  async function serviceEdits(cmd, text, options) {
    var lang = G.langOf(text);
    if (CHECKS[cmd]) {
      var all = [];
      for (var c of T.chunks(text)) {
        var r = await client.check({ text: c.text, lang: lang, kinds: [CHECKS[cmd]] });
        E.fromIssues(c.text, r.issues).forEach(function (e) { all.push(Object.assign(e, { start: e.start + c.start, end: e.end + c.start })); });
      }
      return { edits: E.normalize(text, all) };
    }
    if (TRANSFORMS[cmd]) {
      var edits = [];
      for (var ch of T.chunks(text)) {
        var body = { text: ch.text, lang: lang, op: cmd };
        if (cmd === "tone") body.tone = options.tone;
        var res = await client.transform(body);
        var list = res.edits && res.edits.length ? E.normalize(ch.text, res.edits) : E.diff(ch.text, res.result || ch.text);
        list.forEach(function (e) { edits.push(Object.assign(e, { start: e.start + ch.start, end: e.end + ch.start })); });
      }
      return { edits: E.normalize(text, edits) };
    }
    if (RESULT_ONLY[cmd]) {
      var out = await client.transform({ text: text.slice(0, T.LIMIT), lang: lang, op: cmd });
      return { result: out.result || "", truncated: text.length > T.LIMIT };
    }
    if (cmd === "translate") {
      var to = options.to || (lang === "si" ? "en" : "si");
      var parts = [];
      for (var t of T.chunks(text)) parts.push((await client.translate({ text: t.text, from: "auto", to: to, preserveFormatting: true })).text);
      return { edits: E.normalize(text, [{ start: 0, end: text.length, replacement: parts.join(""), reason: tr("Translation") }]) };
    }
    if (cmd === "detect") {
      var d = await client.detectLanguage(text.slice(0, T.LIMIT));
      return { spans: (d.spans || []).map(function (s) { return Object.assign({ text: text.slice(s.start, s.end) }, s); }) };
    }
    throw new Error("unknown command " + cmd);
  }

  function runReview(cmd, options) {
    var st = P.commandState(cmd, policy, info);
    if (!st.enabled) { openReview(cmd); sendReview({ status: "error", message: tr(st.reason) }); return; }
    openReview(cmd, options);
    sendReview({ status: "loading" });
    readTarget(false, function (target) {
      if (!target || !target.text.trim()) { sendReview({ status: "error", message: tr("Select some text first") }); return; }
      review.target = target;
      review.edits = [];
      review.undo = [];
      sendReview({ status: "loading" });
      serviceEdits(cmd, target.text, review.options).then(function (res) {
        // W6: the selection changed while waiting -> discarded
        readTarget(false, function (now) {
          if (!review || review.cmd !== cmd) return;
          if (!now || now.fingerprint !== target.fingerprint) { sendReview({ status: "changed", message: tr("Text changed, run again") }); return; }
          review.edits = res.edits || [];
          sendReview({ status: "ready", result: res.result, spans: res.spans, truncated: res.truncated,
            message: res.edits && !res.edits.length ? tr("No changes suggested") : "" });
        });
      }, function (e) {
        if (e && e.code === "unauthorized") discovery.invalidate();
        sendReview({ status: "error", message: errorText(e) });
      });
    });
  }

  function openReview(cmd, options) {
    review = { cmd: cmd, target: null, edits: [], undo: [], options: Object.assign({ tone: settings.tone, to: settings.translateTo }, options || {}) };
    openWindow("review", { url: "review.html", description: tr("Local AI review"), isModal: false, isCanDocked: true,
      type: "panelRight", size: [380, 560] }, { cmd: cmd });
  }

  function accept(ids) {
    if (!review || !review.target) return;
    var chosen = review.edits.filter(function (e) { return ids === "all" || ids.indexOf(e.id) >= 0; });
    if (!chosen.length) return;
    applyEdits(review.target, chosen, function (res) {
      if (!res.ok) { sendReview({ status: "changed", message: res.reason === "unsupported" ? tr("This editor cannot apply the change here") : tr("Text changed, run again") }); return; }
      var inverse = invertAll(chosen);
      var rest = review.edits.filter(function (e) { return chosen.indexOf(e) < 0; });
      chosen.slice().sort(function (a, b) { return b.start - a.start; }).forEach(function (e) { rest = E.rebase(rest, e); });
      var desc = chosen.slice().sort(function (a, b) { return b.start - a.start; });
      review.undo = review.undo.map(function (list) { var l = list; desc.forEach(function (e) { l = E.rebase(l, e); }); return l; });
      review.undo.push(inverse);
      review.edits = rest;
      review.target = res.target;
      sendReview({ status: "ready" });
    });
  }

  /* the edits that undo `edits` (applied together), in the text after them */
  function invertAll(edits) {
    var shift = 0;
    return edits.slice().sort(function (a, b) { return a.start - b.start; }).map(function (e) {
      var inv = E.invert(Object.assign({}, e, { start: e.start + shift }));
      shift += e.replacement.length - (e.end - e.start);
      return inv;
    });
  }

  function undo() {
    if (!review || !review.undo.length) return;
    var inverse = review.undo.pop();
    applyEdits(review.target, inverse, function (res) {
      if (!res.ok) { sendReview({ status: "changed", message: tr("Text changed, run again") }); return; }
      var rest = review.edits;
      inverse.slice().sort(function (a, b) { return b.start - a.start; }).forEach(function (e) { rest = E.rebase(rest, e); });
      review.edits = rest;
      review.target = res.target;
      sendReview({ status: "ready" });
    });
  }

  // --- inserting ---------------------------------------------------------------------------------
  function insertText(text, callback) {
    plugin.executeMethod("PasteText", [text], function () { if (callback) callback(); });
  }

  function insertTable(rows, callback) {
    if (!isDocument()) { insertText(rows.map(function (r) { return r.join("\t"); }).join("\n"), callback); return; }
    window.Asc.scope.rows = rows;
    plugin.callCommand(function () {
      var rows = Asc.scope.rows;
      var doc = Api.GetDocument();
      var table = Api.CreateTable(2, rows.length);
      table.SetWidth("percent", 100);
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < 2; c++) {
          var p = table.GetCell(r, c).GetContent().GetElement(0);
          p.AddText(rows[r][c]);
        }
      }
      doc.InsertContent([table]);
    }, false, true, function () { if (callback) callback(); });
  }

  // --- W8 read aloud ----------------------------------------------------------------------------
  var reading = null; // {target, selection}

  function readAloud() {
    var st = P.commandState("readAloud", policy, info);
    readSelectionPos(function (selection) {
      readTarget(false, function (target) {
        var start = function (t) {
          reading = { target: t, selection: selection };
          openWindow("reader", { url: "reader.html", description: tr("Read aloud"), isModal: false, size: [520, 74] },
            { text: t ? t.text : "", sentences: t ? T.sentences(t.text) : [], locked: st.enabled ? "" : tr(st.reason) });
        };
        var hasSelection = selection && selection.end > selection.start;
        if (target && target.text.trim() && hasSelection) start(target);
        else readTarget(true, start);
      });
    });
  }

  function highlight(index) {
    if (!reading || !reading.target || reading.target.mode !== "document" || reading.target.startPos == null) return;
    var s = T.sentences(reading.target.text)[index];
    if (!s) return;
    window.Asc.scope.sel = { start: reading.target.startPos + s.start, end: reading.target.startPos + s.start + s.text.length };
    plugin.callCommand(function () {
      var r = Api.GetDocument().GetRange(Asc.scope.sel.start, Asc.scope.sel.end);
      if (r) r.Select();
    }, false, false);
  }

  function restoreSelection() {
    var sel = reading && reading.selection;
    reading = null;
    if (!sel || !isDocument()) return;
    window.Asc.scope.sel = sel;
    plugin.callCommand(function () {
      var r = Api.GetDocument().GetRange(Asc.scope.sel.start, Asc.scope.sel.end);
      if (r) r.Select();
    }, false, false);
  }

  // --- W3 voice typing --------------------------------------------------------------------------
  function voice() {
    if (windows.dock) { windows.dock.send("onStop", {}); return; }
    var st = P.commandState("voice", policy, info);
    ghostActions(ghost.blur());
    openWindow("dock", { url: "dock.html", description: tr("Voice typing"), isModal: false, size: [380, 124] },
      { lang: settings.voiceLang, locked: st.enabled ? "" : tr(st.reason), installModel: WHISPER_SMALL });
  }

  var HANDLERS = {
    dock: {
      onVoiceText: function (d) { showOverlay("voice", d.final || "", d.partial || ""); },
      onVoiceCommit: function (d) {
        hideOverlay();
        var text = d.text || "";
        closeWindow("dock");
        if (text) insertText(text);
      },
      onVoiceDiscard: function () { hideOverlay(); closeWindow("dock"); },
      onVoiceLang: function (d) { settings.voiceLang = d.lang || "auto"; saveSettings(); },
      onOpenUrl: function (d) { openExternal(d.url); }
    },
    transcribe: {
      onInsertTranscript: function (d) {
        if (d.mode === "table") insertTable(d.rows || []);
        else insertText(d.text || "");
      }
    },
    review: {
      onReviewAccept: function (d) { accept(d.all ? "all" : [d.id]); },
      onReviewReject: function (d) {
        if (!review) return;
        review.edits = review.edits.filter(function (e) { return e.id !== d.id; });
        sendReview({ status: "ready" });
      },
      onReviewUndo: undo,
      onReviewRerun: function (d) {
        if (!review) return;
        if (d.tone) { settings.tone = d.tone; }
        if (d.to) { settings.translateTo = d.to; }
        saveSettings();
        runReview(review.cmd, { tone: d.tone || settings.tone, to: d.to || settings.translateTo });
      },
      onReviewInsert: function (d) { if (d.text) insertText(d.text); }
    },
    reader: {
      onReadSentence: function (d) { highlight(d.index); },
      onReadStop: function () { restoreSelection(); },
      onReaderSettings: function (d) {
        ["voice", "rate", "volume"].forEach(function (k) { if (d[k] !== undefined) settings[k] = d[k]; });
        saveSettings();
      }
    }
  };

  function openExternal(url) {
    if (!/^(x-apple\.systempreferences:|ms-settings:|https:)/.test(url || "")) return;
    var d = window.AscDesktopEditor || (host && host.AscDesktopEditor);
    // TODO(desktop-apps): "worksuite:open-url" (open a system settings URL); window.open is the fallback
    if (d && d.execCommand) { try { d.execCommand("worksuite:open-url", JSON.stringify({ url: url })); return; } catch (e) { /* fall back */ } }
    window.open(url, "_blank");
  }

  // --- the toolbar ------------------------------------------------------------------------------
  // [id, label, tooltip]; AI tab order, with separators before the indexes in SEPARATORS
  var BUTTONS = [
    ["voice", "Voice typing", "Dictate at the cursor; audio stays on this computer (Ctrl+Shift+V)"],
    ["transcribe", "Transcribe file", "Turn an audio or video file (MP3, WAV, M4A, MP4) into text"],
    ["readAloud", "Read aloud", "Read the selection or the whole document aloud"],
    ["spelling", "Correct spelling", "Find spelling mistakes and review the corrections"],
    ["grammar", "Correct grammar", "Find grammar mistakes and review the corrections"],
    ["punctuation", "Correct punctuation", "Fix punctuation and review the changes"],
    ["improve", "Improve", "Make the text clearer and review each change"],
    ["rewrite", "Rewrite", "Say it another way"],
    ["simplify", "Simplify", "Use simpler words and shorter sentences"],
    ["formal", "Formal", "Make the text formal"],
    ["professional", "Professional", "Make the text sound professional"],
    ["tone", "Change tone", "Rewrite in another tone: friendly, confident, polite, neutral"],
    ["expand", "Expand", "Make the text longer, with more detail"],
    ["shorten", "Shorten", "Make the text shorter, keeping its meaning"],
    ["summarize", "Summarize", "A summary of the selection to insert or copy"],
    ["explain", "Explain", "Explain the selection in plain words"],
    ["translate", "Translate", "Translate between Sinhala, Tamil and English"],
    ["detect", "Detect language", "Which languages the selection is in"],
    ["suggestions", "Suggestions", "Suggest the next words as you type; Tab accepts, Esc dismisses"]
  ];
  var SEPARATORS = { 0: 1, 3: 1, 6: 1, 14: 1, 18: 1 };
  var DOCUMENT_ONLY = { suggestions: 1 };
  var toolbarAdded = false;
  var ICONS = function (name) { return "resources/%theme-type%(light|dark)/" + name + "%scale%(default).%extension%(png)"; };

  function item(cmd, idSuffix, separator) {
    var b = BUTTONS.filter(function (x) { return x[0] === cmd; })[0];
    var st = P.commandState(cmd, policy, info);
    var text = tr(b[1]);
    if (cmd === "suggestions") text = settings.suggestions ? tr("Suggestions: on") : tr("Suggestions: off");
    return {
      id: "ws-ai-" + cmd + (idSuffix || ""), type: "big-button", text: text,
      hint: tr(b[2]) + (st.reason ? " — " + tr(st.reason) : ""),
      icons: ICONS(cmd), lockInViewMode: cmd !== "readAloud" && cmd !== "detect" && cmd !== "explain" && cmd !== "summarize",
      disabled: !st.enabled || (!isDocument() && !!DOCUMENT_ONLY[cmd]), separator: !!separator
    };
  }

  function toolbar() {
    return {
      guid: plugin.info.guid,
      tabs: [
        { id: AI_TAB, text: tr("AI"), items: BUTTONS.map(function (b, i) { return item(b[0], "", SEPARATORS[i]); }) },
        { id: "home", items: [item("voice", "-home", true)] },
        { id: "review", items: [item("readAloud", "-review", true)] },
        { id: SINHALA_TAB, text: tr("Sinhala Tools"), items: [item("voice", "-sinhala", true)] }
      ]
    };
  }

  function addToolbar() {
    plugin.executeMethod(toolbarAdded ? "UpdateToolbarMenuItem" : "AddToolbarMenuItem", [toolbar()]);
    toolbarAdded = true;
  }

  var ACTIONS = {
    voice: voice,
    transcribe: function () {
      var st = P.commandState("transcribe", policy, info);
      openWindow("transcribe", { url: "transcribe.html", description: tr("Transcribe file"), isModal: false, isCanDocked: true,
        type: "panelRight", size: [380, 600] }, { locked: st.enabled ? "" : tr(st.reason) });
    },
    readAloud: readAloud,
    suggestions: function () {
      settings.suggestions = !settings.suggestions;
      saveSettings();
      ghostActions(ghost.setEnabled(suggestionsOn()));
      addToolbar();
    }
  };
  BUTTONS.forEach(function (b) { if (!ACTIONS[b[0]]) ACTIONS[b[0]] = function () { runReview(b[0]); }; });

  function run(cmd) {
    try { ACTIONS[cmd](); } catch (e) { if (window.console) window.console.error("ws-ai", cmd, e); }
  }

  BUTTONS.forEach(function (b) {
    ["", "-home", "-review", "-sinhala"].forEach(function (s) {
      plugin.attachToolbarMenuClickEvent("ws-ai-" + b[0] + s, function () { run(b[0]); });
    });
  });

  // --- the editor's events -------------------------------------------------------------------------
  plugin.event_onKeyDown = function (data) {
    if (!data) return;
    if ((data.ctrlKey || data.metaKey) && !!data.shiftKey === SHORTCUT.shift && !data.altKey && data.keyCode === SHORTCUT.keyCode) {
      voice();
      return;
    }
    if (windows.dock && data.keyCode === G.KEY.ESC) { windows.dock.send("onDiscard", {}); return; }
    if (windows.dock) return;
    if (suggestionsOn() || ghost.state !== "idle") ghostActions(ghost.key(data));
  };

  plugin.event_onClick = function () { ghostActions(ghost.blur()); };
  plugin.event_onInputHelperClear = function () { if (overlayMode === "ghost") { overlayMode = null; ghostActions(ghost.blur()); } };

  plugin.init = function () {
    addToolbar();
    refresh(false);
    setInterval(function () { refresh(false); }, 5 * 60 * 1000);
  };

  plugin.onTranslate = function () { if (toolbarAdded) addToolbar(); };
  plugin.onThemeChanged = function (theme) {
    if (plugin.onThemeChangedBase) plugin.onThemeChangedBase(theme);
    broadcast("onTheme", theme);
  };
  plugin.button = function () { /* a background plugin has no buttons */ };

  // for tests and for Sinhala Tools (through the service API only)
  window.WsAiPlugin = { run: run, toolbar: toolbar, settings: settings, invertAll: invertAll };
})(window, document);
