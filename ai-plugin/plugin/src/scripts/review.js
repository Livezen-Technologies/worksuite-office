/*
 * W6 review panel: original and suggested side by side with each change marked, and the list of
 * changes with their reasons: Accept / Reject each, Accept all, Undo. plugin.js holds the edits and
 * applies them (one undo step per Accept / Accept all); this frame only shows them. Summarize and
 * Explain show a result to insert or copy; Detect language shows the language of each span.
 */
(function (window, document) {
  "use strict";

  var U = window.WsAiUi, E = window.WsAiEdits;
  var $ = U.$, tr = U.tr;
  var LANGS = { si: "Sinhala", en: "English", ta: "Tamil", mixed: "Mixed" };
  var last = null;

  function mark(container, parts, side) {
    container.textContent = "";
    parts.forEach(function (p) {
      if (p.kind === "same") { container.appendChild(document.createTextNode(p.before)); return; }
      var text = side === "before" ? p.before : p.after;
      var span = U.el(side === "before" ? "del" : "ins", text || " ", "ws-change", { "data-edit": p.edit.id });
      span.addEventListener("mouseenter", function () { highlight(p.edit.id, true); });
      span.addEventListener("mouseleave", function () { highlight(p.edit.id, false); });
      container.appendChild(span);
    });
  }

  function highlight(id, on) {
    var nodes = document.querySelectorAll('[data-edit="' + id + '"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle("ws-hot", on);
  }

  function render(r) {
    last = r;
    $("title").textContent = r.title || "";
    $("tone").hidden = r.cmd !== "tone";
    $("to").hidden = r.cmd !== "translate";
    if (r.options) { if (r.options.tone) $("tone").value = r.options.tone; $("to").value = r.options.to || ""; }
    var loading = r.status === "loading";
    var st = $("status");
    st.className = "ws-status-line" + (r.status === "error" || r.status === "changed" ? " ws-error" : "") + (loading ? " ws-loading" : "");
    st.textContent = loading ? tr("Working on it…") : (r.message || "");
    $("track").hidden = !r.track || !(r.edits && r.edits.length);

    var resultOnly = r.result !== undefined && r.result !== null && !(r.edits && r.edits.length);
    var spans = r.spans || null;
    var edits = r.edits || [];
    var showCompare = !loading && !resultOnly && !spans && (edits.length > 0 || r.canUndo) && r.status !== "error";
    $("compare").hidden = !showCompare;
    if (showCompare) {
      var parts = E.sideBySide(r.original || "", edits);
      mark($("before"), parts, "before");
      mark($("after"), parts, "after");
    }

    var list = $("edits");
    list.textContent = "";
    if (!loading && !resultOnly && !spans) edits.forEach(function (e) {
      var li = U.el("li", null, "ws-edit", { "data-edit": e.id });
      var what = U.el("div", null, "ws-edit-what");
      what.appendChild(U.el("del", e.original || " ", "ws-change"));
      what.appendChild(document.createTextNode(" → "));
      what.appendChild(U.el("ins", e.replacement || tr("(remove)"), "ws-change"));
      li.appendChild(what);
      if (e.reason) li.appendChild(U.el("div", e.reason, "ws-note"));
      var b = U.el("div", null, "ws-edit-buttons");
      var ok = U.el("button", tr("Accept"), "btn-text-default ws-primary");
      ok.addEventListener("click", function () { U.send("onReviewAccept", { id: e.id }); });
      var no = U.el("button", tr("Reject"), "btn-text-default");
      no.addEventListener("click", function () { U.send("onReviewReject", { id: e.id }); });
      b.appendChild(ok); b.appendChild(no);
      li.appendChild(b);
      li.addEventListener("mouseenter", function () { highlight(e.id, true); });
      li.addEventListener("mouseleave", function () { highlight(e.id, false); });
      list.appendChild(li);
    });

    var res = $("result");
    res.textContent = "";
    if (resultOnly && !loading) {
      res.appendChild(U.el("div", r.result, "ws-text"));
      if (r.truncated) res.appendChild(U.el("div", tr("Only the first 8,000 characters were used."), "ws-note"));
    }
    if (spans && !loading) {
      var ul = U.el("ul", null, "ws-spans");
      spans.forEach(function (s) {
        var li = U.el("li");
        li.appendChild(U.el("b", tr(LANGS[s.lang] || s.lang) + " " + Math.round((s.confidence || 0) * 100) + "%"));
        li.appendChild(U.el("span", " " + (s.text || "").slice(0, 80)));
        ul.appendChild(li);
      });
      res.appendChild(ul);
    }
    res.hidden = !(resultOnly || spans) || loading;

    $("acceptAll").hidden = resultOnly || !!spans;
    $("acceptAll").disabled = loading || edits.length === 0;
    $("undo").hidden = resultOnly || !!spans;
    $("undo").disabled = loading || !r.canUndo;
    $("insert").hidden = $("copy").hidden = !resultOnly || loading;
    $("rerun").hidden = !(r.status === "changed" || r.status === "error" || r.cmd === "tone" || r.cmd === "translate") || loading;
  }

  U.on("onReview", render);
  U.on("init", function () {
    $("acceptAll").addEventListener("click", function () { U.send("onReviewAccept", { all: true }); });
    $("undo").addEventListener("click", function () { U.send("onReviewUndo"); });
    $("rerun").addEventListener("click", function () { U.send("onReviewRerun", { tone: $("tone").value, to: $("to").value }); });
    $("tone").addEventListener("change", function () { U.send("onReviewRerun", { tone: $("tone").value }); });
    $("to").addEventListener("change", function () { if ($("to").value) U.send("onReviewRerun", { to: $("to").value }); });
    $("insert").addEventListener("click", function () { if (last && last.result) U.send("onReviewInsert", { text: last.result }); });
    $("copy").addEventListener("click", function () {
      if (!last || !last.result) return;
      try { window.navigator.clipboard.writeText(last.result); } catch (e) { /* no clipboard */ }
    });
  });

  window.WsAiReview = { render: render };
})(window, document);
