// The Smart Typing key-handling state machine (SmartTyping), the AI request rules (AiScheduler), and the
// lookup latency benchmark.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";
import { engine, shared } from "./smart-data.mjs";

const K = S.KEY;
// a machine wired to the engine at once (as the plugin does without a worker)
function rig(mode = "english", options = {}, e = shared) {
  const m = new S.SmartTyping({ mode, ...options });
  const log = [];
  const run = (actions) => {
    for (const a of actions) {
      log.push(a);
      if (a.type === "query") run(m.deliver(a.seq, e.suggest({ before: a.before, mode: a.mode, manual: a.manual })));
    }
    return actions;
  };
  return { m, log, input: (t) => run(m.input(t)), key: (k) => run(m.key(k)), open: (t) => run(m.open(t)), last: (type) => log.filter((a) => a.type === type).at(-1) };
}

test("English: the popup opens with nothing selected; Tab writes the first item", () => {
  const r = rig();
  r.input("docu");
  assert.equal(r.m.state, "open");
  const show = r.last("show");
  assert.equal(show.selected, -1);
  assert.equal(show.composing, false);
  assert.equal(show.ghost, "ment", "ghost text: the rest of the best completion");
  r.key(K.tab);
  const w = r.last("input");
  assert.deepEqual([w.text, w.replace], ["document", "docu"]);
  assert.equal(r.m.state, "idle");
});

test("English: Enter with nothing selected is handed back; after Down it accepts", () => {
  let r = rig();
  r.input("docu");
  r.key(K.enter);
  assert.deepEqual(r.log.slice(-2).map((a) => a.type), ["hide", "pass"]);
  assert.equal(r.last("pass").key, "enter");
  assert.equal(r.last("input"), undefined);
  r = rig();
  r.input("docu");
  r.key(K.down);
  assert.equal(r.last("show").selected, 0);
  r.key(K.down);
  r.key(K.enter);
  assert.equal(r.last("input").text, "documents");
});

test("Up/Down wrap, Home/End/PageUp/PageDown move, Esc closes and keeps the letters", () => {
  const r = rig();
  r.input("comp");
  r.key(K.up);
  assert.equal(r.last("show").selected, 6);
  r.key(K.down);
  assert.equal(r.last("show").selected, 0);
  r.key(K.end);
  assert.equal(r.last("show").selected, 6);
  r.key(K.home);
  r.key(K.pageDown);
  assert.equal(r.last("show").selected, 5);
  r.key(K.pageUp);
  assert.equal(r.last("show").selected, 0);
  r.key(K.esc);
  assert.deepEqual(r.log.at(-1), { type: "hide", clear: true });
  assert.equal(r.last("input"), undefined);
  assert.deepEqual(r.m.key(K.down), [], "closed: keys are not ours");
});

test("English: Space closes and the word stays as typed (learned as finished); never a replacement", () => {
  const r = rig();
  r.input("comp");
  r.input("comp ");
  assert.equal(r.last("input"), undefined);
  assert.equal(r.m.isVisible, false);
  assert.deepEqual(r.last("finished"), { type: "finished", word: "comp", prev: null });
  r.input("comp lan");
  r.input("comp lan ");
  assert.deepEqual(r.last("finished"), { type: "finished", word: "lan", prev: "comp" });
});

test("Singlish: the first word is selected; Space writes it, a digit writes that one, Enter the selected", () => {
  let r = rig("unicode");
  r.input("kanna");
  const show = r.last("show");
  assert.equal(show.composing, true);
  assert.equal(show.selected, 0);
  r.input("kanna ");
  assert.deepEqual([r.last("input").text, r.last("input").replace], ["කන්න ", "kanna "]);
  r = rig("unicode");
  r.input("kanna");
  r.input("kanna2");
  assert.deepEqual([r.last("input").text, r.last("input").replace], ["කන්නට", "kanna2"]);
  r = rig("unicode");
  r.input("kanna");
  r.key(K.enter);
  assert.equal(r.last("input").text, "කන්න", "Enter writes the composition (it is selected)");
  r = rig("unicode", { acceptSpace: false });
  r.input("kanna");
  r.input("kanna ");
  assert.equal(r.last("input"), undefined);
  assert.equal(r.last("kept").token, "kanna");
});

test("acceptance key: Enter accepts the first item when set; Tab is handed back when only Enter accepts", () => {
  let r = rig("english", { acceptKey: "both" });
  r.input("docu");
  r.key(K.enter);
  assert.equal(r.last("input").text, "document");
  r = rig("english", { acceptKey: "enter" });
  r.input("docu");
  r.key(K.tab);
  assert.equal(r.last("pass").key, "tab");
});

test("a stale answer is dropped: only the latest lookup shows", () => {
  const m = new S.SmartTyping({ mode: "english" });
  const q1 = m.input("doc")[0];
  const q2 = m.input("docu")[0];
  assert.deepEqual(m.deliver(q1.seq, shared.suggest({ before: "doc", mode: "english" })), []);
  const shown = m.deliver(q2.seq, shared.suggest({ before: "docu", mode: "english" }));
  assert.equal(shown[0].token, "docu");
  assert.equal(m.state, "open");
});

test("later AI words do not move the highlight off its word", () => {
  const r = rig();
  r.input("docu");
  r.key(K.down);
  r.key(K.down);
  const before = r.m.items[r.m.selected].text;
  const merged = shared.merge(shared.suggest({ before: "docu", mode: "english" }), [{ text: "docusign" }]);
  const a = r.m.update(merged);
  assert.equal(a[0].items[a[0].selected].text, before);
  assert.ok(a[0].items.some((i) => i.kind === "ai"));
});

test("mode switching: the machine closes, and the same text asks again in the new mode", () => {
  const r = rig("unicode");
  r.input("kanna");
  assert.equal(r.last("show").items[0].lang, "si");
  assert.deepEqual(r.m.setMode("english"), [{ type: "hide", clear: true }]);
  r.input("comp");
  assert.equal(r.last("show").items.every((i) => i.lang === "en"), true);
  r.m.setMode("smart");
  r.input("meeting eka");
  assert.equal(r.last("show").items[0].text, "එක");
});

test("Ctrl/Cmd+Space opens at once, next words included; a click (pick) writes that item", () => {
  const r = rig();
  r.open("thank ");
  assert.equal(r.last("show").items[0].text, "you");
  const m = new S.SmartTyping({ mode: "english" });
  const q = m.open("please find ")[0];
  m.deliver(q.seq, shared.suggest({ before: q.before, mode: "english", manual: true }));
  const w = m.pick(0).find((a) => a.type === "input");
  assert.deepEqual([w.text, w.replace], ["attached", ""]);
});

test("Backspace in a document: the composition goes on from the shorter word (resync)", () => {
  const r = rig("unicode", { canResync: true });
  r.input("kanna");
  assert.deepEqual(r.m.cleared(), [{ type: "resync" }]);
  const q = r.m.resync("kann");
  assert.equal(q[0].type, "query");
  assert.equal(q[0].before, "kann");
  r.m.deliver(q[0].seq, shared.suggest({ before: "kann", mode: "unicode" }));
  r.m.cleared();
  assert.deepEqual(r.m.resync("other"), [{ type: "hide", clear: undefined }], "anything but a shorter start ends it");
});

test("suggestions hidden (showWindow off): nothing shows, Singlish Space still writes the best match", () => {
  const r = rig("unicode", { showWindow: false });
  r.input("kanna");
  assert.equal(r.last("show"), undefined);
  r.input("kanna ");
  assert.equal(r.last("input").text, "කන්න ");
});

test("AiScheduler: one request per pause, cancelled by the next keystroke, stale answers dropped", () => {
  const timers = [];
  const runs = [];
  const used = [];
  let cancelled = 0;
  const s = new S.AiScheduler({
    delay: 250,
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
    run: (key, done) => { runs.push({ key, done }); return () => { cancelled++; }; },
    use: (key, words) => used.push([key, words])
  });
  s.schedule("a"); s.schedule("ab"); s.schedule("abc");
  assert.equal(timers.filter((t) => t.live).length, 1, "keystrokes only move the timer");
  assert.equal(timers.at(-1).ms, 250);
  timers.at(-1).fn();
  assert.equal(runs.length, 1);
  s.cancel(); // the next keystroke
  assert.equal(cancelled, 1);
  runs[0].done([{ text: "late" }]);
  assert.deepEqual(used, [], "an answer after the cancel is dropped");
  s.schedule("abcd");
  timers.at(-1).fn();
  runs[1].done([{ text: "ok" }]);
  assert.deepEqual(used, [["abcd", [{ text: "ok" }]]]);
});

test("benchmark: p95 lookup under 50 ms (no cache), English, Singlish, Sinhala and mixed", () => {
  const e = engine();
  const inputs = [];
  const en = ["d", "do", "doc", "docu", "docum", "p", "pr", "pre", "pres", "presen", "m", "ma", "man", "manag", "c", "co", "com", "comp", "recieve", "I am goin", "this is a appl", "teh"];
  const si = ["k", "ka", "kan", "kann", "kanna", "o", "oy", "oya", "kohomada", "lankawa", "suba", "udhaeesanak"];
  const uni = ["ල", "ලි", "ලිය", "ක", "කන්", "කණ්න", "ශ්‍රී"];
  const mixed = ["meeting e", "meeting ek", "meeting eka", "game", "mama oya api", "docu"];
  for (let i = 0; i < 4; i++) {
    for (const t of en) inputs.push([t, "english"]);
    for (const t of si) inputs.push([t, "unicode"]);
    for (const t of uni) inputs.push([t, "english"]);
    for (const t of mixed) inputs.push([t, "smart"]);
  }
  const times = [];
  for (const [before, mode] of inputs) {
    e.invalidate();
    const t0 = performance.now();
    e.suggest({ before, mode });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
  const p50 = p(0.5), p95 = p(0.95), max = times.at(-1);
  console.log(`smart lookup: ${times.length} lookups, p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
  assert.ok(p95 < 50, `p95 ${p95} ms`);
  // with the cache, a repeated lookup is near free
  e.suggest({ before: "docu", mode: "english" });
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) e.suggest({ before: "docu", mode: "english" });
  assert.ok((performance.now() - t0) / 1000 < 1);
});

test("building the engine is bounded: under 1.5 s and the index sizes are as expected", () => {
  const t0 = performance.now();
  const e = engine();
  const ms = performance.now() - t0;
  console.log(`smart engine build: ${ms.toFixed(0)} ms, ${e.english.size} English words, ${e.sinhala.size} Sinhala words`);
  assert.ok(ms < 1500);
  assert.ok(e.english.size > 10000 && e.sinhala.size > 24000);
});
