/*
 * Sinhala Tools › Suggestions › Settings (suggest.html). plugin.js sends onSuggestInit
 * { settings, defaults, custom, learned } and gets onSuggestApply { values }, onSuggestWord { word, remove? },
 * onSuggestForget or onSuggestCancel. ime.js saves the values with the other typing settings.
 */
(function (window, document) {
  "use strict";

  var plugin = window.Asc.plugin;
  var BOOLS = ["english", "sinhala", "autocomplete", "nextWord", "spelling", "grammar", "ghost", "personal", "mixed", "ai"];
  var NUMS = ["maxItems", "delay"];
  var CHOICES = ["acceptKey", "output"];
  var data = null;

  function tr(text) { return plugin.tr ? plugin.tr(text) : text; }
  function fmt(text) {
    var args = Array.prototype.slice.call(arguments, 1);
    return tr(text).replace(/%(\d)/g, function (m, n) { return String(args[Number(n) - 1]); });
  }
  function $(id) { return document.getElementById(id); }
  function field(name) { return document.querySelector("[name=\"" + name + "\"]"); }

  function translate() {
    var nodes = document.querySelectorAll("[data-tr]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tr(nodes[i].getAttribute("data-tr"));
    $("word").setAttribute("placeholder", tr("Add a word"));
  }

  function fill(values) {
    BOOLS.forEach(function (k) { if (field(k)) field(k).checked = !!values[k]; });
    NUMS.concat(CHOICES).forEach(function (k) { if (field(k)) field(k).value = String(values[k]); });
  }

  function words() {
    var box = $("words");
    box.textContent = "";
    (data.custom || []).forEach(function (w) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = w + " ×";
      b.title = tr("Remove");
      b.addEventListener("click", function () { plugin.sendToPlugin("onSuggestWord", { word: w, remove: true }); });
      box.appendChild(b);
    });
    $("learned").textContent = fmt("%1 words learned", data.learned || 0);
  }

  function values() {
    var v = {};
    BOOLS.forEach(function (k) { if (field(k)) v[k] = field(k).checked; });
    NUMS.forEach(function (k) { if (field(k)) v[k] = Number(field(k).value); });
    CHOICES.forEach(function (k) { if (field(k)) v[k] = field(k).value; });
    return v;
  }

  function init() {
    translate();
    $("form").addEventListener("submit", function (e) { e.preventDefault(); plugin.sendToPlugin("onSuggestApply", { values: values() }); });
    $("cancel").addEventListener("click", function () { plugin.sendToPlugin("onSuggestCancel", {}); });
    $("reset").addEventListener("click", function () { if (data) fill(data.defaults); });
    $("add").addEventListener("click", function () {
      var w = $("word").value.trim();
      if (w) plugin.sendToPlugin("onSuggestWord", { word: w });
      $("word").value = "";
    });
    $("forget").addEventListener("click", function () { plugin.sendToPlugin("onSuggestForget", {}); });
    document.addEventListener("keydown", function (e) { if (e.keyCode === 27) plugin.sendToPlugin("onSuggestCancel", {}); });
    plugin.sendToPlugin("onSuggestReady", {});
  }

  plugin.init = init;
  plugin.attachEvent("onSuggestInit", function (d) {
    var first = !data;
    data = d;
    if (first) fill(d.settings);
    words();
  });
  plugin.onTranslate = translate;
  plugin.button = function () { plugin.sendToPlugin("onSuggestCancel", {}); };
})(window, document);
