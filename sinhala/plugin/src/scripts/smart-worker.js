/*
 * The Smart Typing worker: the dictionary engine (SmartEngine in @worksuite/sinhala-core) off the editor's
 * main thread. ime.js posts { type: "init", settings, personal, learned }, then { type: "query", seq, query }
 * per keystroke and gets { type: "result", seq, result } back; "configure", "learn", "personal" and
 * "learned" keep it in step with the frame. Answers to old queries are still sent: ime.js drops them by seq.
 */
/* global importScripts, WorkSuiteSinhala, WorkSuiteSinhalaWords, WorkSuiteEnglishWords, WorkSuiteSmartData */
importScripts("sinhala-core.js", "sinhala-words.js", "english-words.js", "smart-data.js");
(function (self) {
  "use strict";
  var S = WorkSuiteSinhala;
  var engine = null;
  function build(msg) {
    var data = {};
    for (var k in WorkSuiteSmartData) data[k] = WorkSuiteSmartData[k];
    data.englishWords = WorkSuiteEnglishWords;
    data.sinhalaWords = WorkSuiteSinhalaWords;
    engine = new S.SmartEngine(data, new S.Personal(msg.personal), new S.Learner(msg.learned));
    engine.configure(msg.settings || {});
  }
  self.onmessage = function (e) {
    var m = e.data || {};
    try {
      if (m.type === "init") build(m);
      if (!engine) return;
      if (m.type === "configure") engine.configure(m.settings || {});
      else if (m.type === "personal") { engine.personal = new S.Personal(m.personal); engine.learner = new S.Learner(m.learned); engine.invalidate(); }
      else if (m.type === "learn") engine.learn(m.item, m.token, m.prev);
      else if (m.type === "finished") { engine.personal.word(m.word, m.prev); engine.invalidate(); }
      else if (m.type === "kept") { engine.personal.confirm(m.token, "en"); engine.invalidate(); }
      else if (m.type === "query") self.postMessage({ type: "result", seq: m.seq, result: engine.suggest(m.query) });
    } catch (err) {
      self.postMessage({ type: "error", seq: m.seq, message: String(err && err.message || err) });
    }
  };
})(self);
