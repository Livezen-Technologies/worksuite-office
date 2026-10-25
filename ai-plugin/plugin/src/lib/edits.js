/*
 * Proposed edits and how they reach the document (spec W6 and Editor integration contracts).
 *
 * Offsets are UTF-16 code units in the text read from the editor (paragraphs joined by "\n"), as the
 * service uses. An edit is {id, start, end, replacement, original, reason}.
 *
 * __wsAiEditsFactory is self-contained (no closures over this file) because plugin.js hands its source to
 * an editor command (callCommand), which runs in the editor, not in the plugin frame. applyInDocument is
 * the body of that command: it re-reads the target range, checks the selection fingerprint, then
 * replaces each span through ApiRange (AddText "before" keeps the run's properties; then the old span
 * is deleted), last edit first, all in the one command = one undo step. With Track Changes on, the same
 * calls are tracked; the command never turns it on or off.
 */
function __wsAiEditsFactory() {
  "use strict";

  /* FNV-1a, 32 bits, over UTF-16 code units */
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 0x01000193) : (h * 0x01000193) | 0;
    }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }

  /* text hash + start/end paragraph ids */
  function fingerprint(text, startId, endId) {
    return text.length + ":" + hash(text) + ":" + (startId || "") + ":" + (endId || "");
  }

  var nextId = 1;

  /* sorted, inside the text, without overlaps or no-ops; each gets `original` and an id */
  function normalize(text, edits) {
    var list = (edits || []).map(function (e) {
      var s = Math.max(0, Math.min(text.length, e.start | 0));
      var en = Math.max(s, Math.min(text.length, e.end | 0));
      return { id: e.id || "e" + (nextId++), start: s, end: en, replacement: String(e.replacement == null ? "" : e.replacement),
        original: text.slice(s, en), reason: e.reason || e.message || "", kind: e.kind || "" };
    }).filter(function (e) { return e.replacement !== e.original; });
    list.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var out = [], last = -1;
    list.forEach(function (e) {
      if (e.start < last || (e.start === last && e.start === e.end && out.length && out[out.length - 1].end === e.start && out[out.length - 1].start === e.start)) return;
      out.push(e);
      last = e.end;
    });
    return out;
  }

  /* /v1/text/check issues -> edits (the first replacement; issues without one are notes only) */
  function fromIssues(text, issues) {
    return normalize(text, (issues || []).filter(function (i) { return i.replacements && i.replacements.length; })
      .map(function (i) { return { start: i.start, end: i.end, replacement: i.replacements[0], reason: i.message, kind: i.kind }; }));
  }

  /* a word-level diff, for a result that came without edits */
  function diff(a, b) {
    var tok = function (s) { return s.match(/\s+|[^\s]+/g) || []; };
    var x = tok(a), y = tok(b);
    var n = x.length, m = y.length;
    if (n * m > 4000000) return normalize(a, [{ start: 0, end: a.length, replacement: b }]);
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Uint32Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var edits = [], pa = 0, cur = null;
    i = 0; j = 0;
    function open() { if (!cur) cur = { start: pa, end: pa, replacement: "" }; }
    function close() { if (cur) { edits.push(cur); cur = null; } }
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { close(); pa += x[i].length; i++; j++; }
      else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { open(); cur.replacement += y[j]; j++; }
      else { open(); pa += x[i].length; cur.end = pa; i++; }
    }
    close();
    return normalize(a, edits);
  }

  function apply(text, edits) {
    var out = text;
    edits.slice().sort(function (p, q) { return q.start - p.start; }).forEach(function (e) {
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    });
    return out;
  }

  /* the other edits, moved for `applied` having been made */
  function rebase(edits, applied) {
    var delta = applied.replacement.length - (applied.end - applied.start);
    return edits.filter(function (e) { return e.id !== applied.id; }).map(function (e) {
      if (e.start >= applied.end && !(e.start === applied.end && applied.start === applied.end && e.start === e.end)) {
        return Object.assign({}, e, { start: e.start + delta, end: e.end + delta });
      }
      return e;
    }).filter(function (e) { return e.end <= applied.start || e.start >= applied.start + applied.replacement.length; });
  }

  /* what undoes an applied edit, in the text after it */
  function invert(e) {
    return { id: e.id + "~", start: e.start, end: e.start + e.replacement.length, replacement: e.original, original: e.replacement, reason: e.reason };
  }

  /*
   * An empty range cannot be addressed in a document: an insertion takes the character before it (or
   * after it, at the very start) into the span it replaces.
   */
  function widen(text, e) {
    if (e.start !== e.end || !text.length) return e;
    if (e.start > 0) return Object.assign({}, e, { start: e.start - 1, original: text.charAt(e.start - 1) + e.original, replacement: text.charAt(e.start - 1) + e.replacement });
    return Object.assign({}, e, { end: 1, original: text.charAt(0), replacement: e.replacement + text.charAt(0) });
  }

  /* original and suggested, side by side: [{kind:"same"|"change", before, after, edit}] */
  function sideBySide(text, edits) {
    var parts = [], at = 0;
    edits.slice().sort(function (p, q) { return p.start - q.start; }).forEach(function (e) {
      if (e.start > at) parts.push({ kind: "same", before: text.slice(at, e.start), after: text.slice(at, e.start) });
      parts.push({ kind: "change", before: text.slice(e.start, e.end), after: e.replacement, edit: e });
      at = e.end;
    });
    if (at < text.length) parts.push({ kind: "same", before: text.slice(at), after: text.slice(at) });
    return parts;
  }

  var TEXT_OPTIONS = { Numbering: false, Math: false, ParaSeparator: "\n", TableCellSeparator: "\t", TableRowSeparator: "\n", TabSymbol: "\t", NewLineSeparator: "\n" };

  function paraId(p) {
    if (!p) return "";
    try {
      if (p.GetInternalId) return String(p.GetInternalId());
      if (p.Paragraph && p.Paragraph.Get_Id) return String(p.Paragraph.Get_Id());
    } catch (e) { /* no id */ }
    return "";
  }

  /* in the editor (callCommand): the selection, or the current paragraph when nothing is selected */
  function readTarget(Api, wholeDocument) {
    var doc = Api.GetDocument();
    var range = null;
    if (wholeDocument) range = doc.GetRange ? doc.GetRange() : null;
    else {
      range = doc.GetRangeBySelect ? doc.GetRangeBySelect() : null;
      var t = range ? range.GetText(TEXT_OPTIONS) : "";
      if (!range || !t) {
        var p = doc.GetCurrentParagraph ? doc.GetCurrentParagraph() : null;
        range = p && p.GetRange ? p.GetRange() : null;
      }
    }
    if (!range) return null;
    var text = range.GetText(TEXT_OPTIONS) || "";
    var paras = range.GetAllParagraphs ? range.GetAllParagraphs() : [];
    var startId = paraId(paras[0]), endId = paraId(paras[paras.length - 1]);
    var startPos = range.GetStartPos ? range.GetStartPos() : null;
    var endPos = range.GetEndPos ? range.GetEndPos() : null;
    return { text: text, fingerprint: fingerprint(text, startId, endId), startPos: startPos, endPos: endPos,
      track: !!(doc.IsTrackRevisions && doc.IsTrackRevisions()) };
  }

  /* doc.GetRange(s, e) by character position; whether the end is inclusive is found from the text */
  function spanRange(doc, s, e, expected) {
    var tries = [[s, e], [s, e - 1]];
    for (var i = 0; i < tries.length; i++) {
      if (tries[i][1] < tries[i][0]) continue;
      var r = doc.GetRange(tries[i][0], tries[i][1]);
      if (r && (r.GetText(TEXT_OPTIONS) || "") === expected) return r;
    }
    return null;
  }

  /*
   * scope: {target: {fingerprint, startPos, endPos}, edits: [...]} (edits in the target's text)
   * -> {ok:true, target:<re-read>, applied:n} or {ok:false, reason:"changed"|"unsupported"}
   */
  function applyInDocument(Api, scope) {
    var doc = Api.GetDocument();
    var t = scope.target;
    if (t.startPos == null || t.endPos == null || !doc.GetRange) return { ok: false, reason: "unsupported" };
    var range = doc.GetRange(t.startPos, t.endPos);
    var text = range ? range.GetText(TEXT_OPTIONS) || "" : "";
    var paras = range && range.GetAllParagraphs ? range.GetAllParagraphs() : [];
    if (fingerprint(text, paraId(paras[0]), paraId(paras[paras.length - 1])) !== t.fingerprint) return { ok: false, reason: "changed" };
    var edits = scope.edits.map(function (e) { return widen(text, e); }).sort(function (a, b) { return b.start - a.start; });
    // check every span before changing anything: all of them apply, or none
    for (var i = 0; i < edits.length; i++) {
      if (text.slice(edits[i].start, edits[i].end) !== edits[i].original) return { ok: false, reason: "changed" };
      if (!spanRange(doc, t.startPos + edits[i].start, t.startPos + edits[i].end, edits[i].original)) return { ok: false, reason: "changed" };
    }
    edits.forEach(function (e) {
      var s = t.startPos + e.start, en = t.startPos + e.end;
      var r = spanRange(doc, s, en, e.original);
      if (!e.replacement) { r.Delete(); return; }
      r.AddText(e.replacement, "before");
      var old = spanRange(doc, s + e.replacement.length, en + e.replacement.length, e.original);
      if (old) old.Delete();
    });
    var delta = 0;
    edits.forEach(function (e) { delta += e.replacement.length - (e.end - e.start); });
    var after = doc.GetRange(t.startPos, t.endPos + delta);
    var newText = after ? after.GetText(TEXT_OPTIONS) || "" : "";
    var ap = after && after.GetAllParagraphs ? after.GetAllParagraphs() : [];
    return { ok: true, applied: edits.length,
      target: { text: newText, fingerprint: fingerprint(newText, paraId(ap[0]), paraId(ap[ap.length - 1])), startPos: t.startPos, endPos: t.endPos + delta } };
  }

  return { hash: hash, fingerprint: fingerprint, normalize: normalize, fromIssues: fromIssues, diff: diff, apply: apply,
    rebase: rebase, invert: invert, widen: widen, sideBySide: sideBySide, readTarget: readTarget,
    applyInDocument: applyInDocument, TEXT_OPTIONS: TEXT_OPTIONS };
}

(function (root) {
  var api = __wsAiEditsFactory();
  if (typeof module === "object" && module.exports) { module.exports = api; module.exports.factory = __wsAiEditsFactory; }
  else { root.WsAiEdits = api; root.__wsAiEditsFactory = __wsAiEditsFactory; }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
