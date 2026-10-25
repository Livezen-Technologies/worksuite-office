/* Text helpers: sentences for read aloud, transcript formatting, chunking to the 8,000-character limit. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiText = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LIMIT = 8000;

  /* [{start, end, text}] ; ends after . ! ? । (danda) … or a line break, keeping the spaces after */
  function sentences(text) {
    var out = [], re = /[^.!?।…\n]*(?:[.!?।…]+["'”’)]*|\n|$)\s*/g, m;
    while ((m = re.exec(text)) && m[0].length) {
      if (/\S/.test(m[0])) out.push({ start: m.index, end: m.index + m[0].length, text: m[0].trim() });
      if (re.lastIndex >= text.length) break;
    }
    return out;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    return (h ? h + ":" + two(m) : two(m)) + ":" + two(s);
  }

  /* rows for the time · text table */
  function transcriptRows(segments, opts) {
    opts = opts || {};
    return (segments || []).map(function (s) {
      var label = (opts.speakers && s.speaker ? s.speaker + ": " : "") + (s.text || "").trim();
      return [formatTime(s.start), label];
    });
  }

  function transcriptText(segments, opts) {
    opts = opts || {};
    return (segments || []).map(function (s) {
      var t = (s.text || "").trim();
      if (opts.speakers && s.speaker) t = s.speaker + ": " + t;
      if (opts.timestamps) t = "[" + formatTime(s.start) + "] " + t;
      return t;
    }).filter(Boolean).join(opts.timestamps || opts.speakers ? "\n" : " ");
  }

  /* paragraph-aligned chunks of at most `limit` characters: [{start, text}] */
  function chunks(text, limit) {
    limit = limit || LIMIT;
    if (text.length <= limit) return [{ start: 0, text: text }];
    var out = [], start = 0;
    while (start < text.length) {
      var end = Math.min(text.length, start + limit);
      if (end < text.length) {
        var nl = text.lastIndexOf("\n", end - 1);
        if (nl > start) end = nl + 1;
      }
      out.push({ start: start, text: text.slice(start, end) });
      start = end;
    }
    return out;
  }

  return { LIMIT: LIMIT, sentences: sentences, formatTime: formatTime, transcriptRows: transcriptRows, transcriptText: transcriptText, chunks: chunks };
});
