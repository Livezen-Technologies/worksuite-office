// Singlish typing in the plugin frame: the input modes, the font typed words get (Unicode, or a legacy
// font with the word encoded by its map, in one editor command), Smart Mixed, the candidate window's keys,
// the optional local AI service, the ribbon's menus, and what is remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import S from "../../core/dist/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "ws-sinhala-typing-"));
const out = join(tmp, "dist");
execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", out], { stdio: "pipe" });
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const englishList = readFileSync(join(root, "wordlist", "english", "scowl-20.txt"), "utf8").split("\n").filter(Boolean);

// A document as characters with a font each, a cursor and a selection; the editor's Api over it.
function documentModel(font = "Calibri") {
  const d = { chars: [], cursor: 0, sel: null, commands: 0, defaultFont: font };
  d.text = () => d.chars.map((c) => c.ch).join("");
  d.fonts = () => d.chars.map((c) => c.font);
  d.Api = {
    GetDocument: () => ({
      MoveCursorLeft(n, select) { const to = Math.max(0, d.cursor - n); d.sel = select ? [to, d.cursor] : null; if (!select) d.cursor = to; return true; },
      GetRangeBySelect: () => d.sel ? { SetFontFamily: (f) => { for (let i = d.sel[0]; i < d.sel[1]; i++) d.chars[i].font = f; return true; } } : null,
      InsertParagraphBreak() { d.key("\n"); return true; },
      EnterText(t) {
        let at = d.cursor;
        let f = at > 0 ? d.chars[at - 1].font : d.defaultFont;
        if (d.sel) { f = d.chars[d.sel[0]].font; d.chars.splice(d.sel[0], d.sel[1] - d.sel[0]); at = d.sel[0]; d.sel = null; }
        // typing over a selection takes its formatting; else the formatting before the cursor
        d.chars.splice(at, 0, ...Array.from(t).map((ch) => ({ ch, font: f })));
        d.cursor = at + Array.from(t).length;
        return true;
      }
    })
  };
  // the user typing a character: it takes the font before the cursor
  d.key = (ch) => {
    const f = d.cursor > 0 ? d.chars[d.cursor - 1].font : d.defaultFont;
    d.chars.splice(d.cursor, 0, { ch, font: f });
    d.cursor++;
  };
  return d;
}

function harness({ storage = new Map(), editorType = "word", fetch, endpoint, fonts = ["Arial", "Noto Sans Sinhala", "FMAbhaya"] } = {}) {
  const doc = documentModel();
  const calls = [];
  const clicks = {};
  const windows = [];
  const plugin = {
    info: { guid: "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}", editorType },
    executeMethod(name, args, cb) {
      calls.push([name, JSON.parse(JSON.stringify(args || []))]);
      if (name === "GetFontList" && cb) cb(fonts.map((n) => ({ m_wsFontName: n })));
      else if (name === "GetCurrentWord" && cb) cb("");
      else if (cb) cb();
    },
    callCommand(fn, isClose, isCalc, cb) {
      calls.push(["callCommand", isCalc]);
      doc.commands++;
      const ctx = vm.createContext({ Api: doc.Api, Asc: { scope: JSON.parse(JSON.stringify(window.Asc.scope)) } });
      const r = vm.runInContext("(" + fn.toString() + ")()", ctx);
      if (cb) cb(r);
    },
    attachToolbarMenuClickEvent(id, f) { clicks[id] = f; }, tr: (t) => t
  };
  function PluginWindow() {
    const w = { events: {}, commands: [], attachEvent: (n, f) => { w.events[n] = f; }, command: (n, x) => w.commands.push([n, x]),
      show: (o) => { w.options = o; }, close: () => { w.closed = true; } };
    windows.push(w);
    return w;
  }
  const el = () => {
    let text = "";
    return { children: [], className: "", appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener() {},
      get textContent() { return text; }, set textContent(v) { text = v; this.children = []; } };
  };
  const nodes = { "ime-latin": el(), "ime-items": el() };
  const window = {
    Asc: { plugin, scope: {}, PluginWindow },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    setTimeout, clearTimeout, fetch, AbortController, WSAiEndpoint: endpoint
  };
  window.window = window;
  const document = { getElementById: (id) => nodes[id], createElement: el, documentElement: { style: { setProperty() {} } } };
  const ctx = vm.createContext({ window, document, JSON, Object, Math, String, Number, Array, Promise });
  for (const [f, names] of [["scripts/sinhala-core.js", ["WorkSuiteSinhala", "__worksuiteSinhalaFactory"]], ["scripts/sinhala-words.js", ["WorkSuiteSinhalaWords"]],
    ["scripts/english-words.js", ["WorkSuiteEnglishWords"]], ["scripts/smart-data.js", ["WorkSuiteSmartData"]], ["scripts/toolbar.js", ["WorkSuiteSinhalaToolbar"]]]) {
    vm.runInContext(readFileSync(join(out, f), "utf8") + "\n" + names.map((n) => `window.${n} = ${n};`).join(" "), ctx);
  }
  vm.runInContext(readFileSync(join(out, "scripts", "plugin.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(join(out, "scripts", "ime.js"), "utf8"), ctx);
  plugin.init();
  let context = "";
  const h = {
    doc, calls, clicks, windows, storage, plugin, nodes, ime: window.WorkSuiteSinhalaIme,
    // type `text` as a user would: each character goes into the document and the editor reports the context
    type(text) {
      for (const ch of text) {
        doc.key(ch);
        context += ch;
        const before = doc.commands;
        plugin.event_onInputHelperInput({ text: context });
        if (doc.commands !== before) context = ""; // our own input clears the editor's input context
      }
    },
    key(keyCode, mods = {}) {
      const before = doc.commands;
      plugin.event_onKeyDown({ keyCode, ...mods });
      if (doc.commands !== before) context = "";
    },
    shown: () => calls.filter((c) => c[0] === "ShowInputHelper").length,
    lastToolbar: () => calls.filter((c) => /ToolbarMenuItem$/.test(c[0])).at(-1)[1][0]
  };
  return h;
}

const TABLE = [
  ["mama ", "මම "],
  ["oyata ", "ඔයාට "],
  ["kohomada ", "කොහොමද "],
  ["suba udhaeesanak ", "සුබ උදෑසනක් "],
  ["sri lankawa ", "ශ්‍රී ලංකාව "]
];

for (const [latin, sinhala] of TABLE) {
  test(`Sinhala Unicode: "${latin.trim()}" types ${sinhala.trim()} in Noto Sans Sinhala`, () => {
    const h = harness();
    h.ime.setMode("unicode");
    h.type(latin);
    assert.equal(h.doc.text(), sinhala);
    assert.ok(h.doc.fonts().every((f) => f === "Noto Sans Sinhala"), h.doc.fonts().join());
    assert.equal(h.calls.filter((c) => c[0] === "InputText").length, 0, "documents write through an editor command");
  });
}

test("each word is one editor command, and the font stays for what is typed next", () => {
  const h = harness();
  h.ime.setMode("unicode");
  h.type("mama ");
  assert.deepEqual(h.calls.filter((c) => c[0] === "callCommand"), [["callCommand", true]]);
  h.doc.key("x");
  assert.equal(h.doc.chars.at(-1).font, "Noto Sans Sinhala");
});

test("Sinhala legacy font: the word encoded with the font's map, in that font, in one command", () => {
  const h = harness();
  h.ime.set({ legacyProfile: "fm-abhaya", legacyFont: "FMAbhaya" });
  h.ime.setMode("legacy");
  h.type("sri lankawa ");
  const fm = S.getProfile("fm-abhaya");
  assert.equal(h.doc.text(), S.toLegacy("ශ්‍රී ", fm).text + S.toLegacy("ලංකාව ", fm).text);
  assert.ok(h.doc.fonts().every((f) => f === "FMAbhaya"));
  assert.equal(h.calls.filter((c) => c[0] === "callCommand").length, 2);
});

test("legacy mode: a character the map lacks (the full stop) is warned about once", () => {
  const h = harness();
  h.ime.setMode("legacy");
  h.type("mama.");
  h.type("oya.");
  const panel = h.windows.find((w) => w.options && w.options.url === "panel.html");
  assert.equal(panel, undefined, "typing never opens the panel");
  h.clicks["ws-sinhala-panel"]();
  const p = h.windows.at(-1);
  p.events.onPanelReady();
  const warnings = p.commands.filter((c) => c[0] === "onResult" && c[1].action === "typing");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1].warning, /FM Abhaya has no mapping for U\+002E \./);
});

test("spreadsheets and presentations: InputText (the font cannot be set there)", () => {
  const h = harness({ editorType: "slide" });
  h.ime.setMode("unicode");
  h.type("mama ");
  assert.deepEqual(h.calls.filter((c) => c[0] === "InputText").at(-1)[1], ["මම ", "mama "]);
});

test("Smart Mixed: English words stay English (with English suggestions), Singlish words are offered as Sinhala", () => {
  const english = new S.EnglishWords(englishList);
  for (const w of ["the", "hello", "man", "bath", "pan", "to", "me"]) assert.deepEqual(S.smartDecision(w, english).suggest, false, w);
  for (const w of ["mama", "oyata", "kohomada", "suba", "sri", "lankawa", "amma", "gedara"]) assert.equal(S.smartDecision(w, english).suggest, true, w);
  assert.equal(S.smartDecision("ok", english).suggest, false);
  const h = harness();
  h.ime.setMode("smart");
  h.type("hello the ");
  assert.equal(h.doc.text(), "hello the ", "Space after an English word keeps it as typed");
  assert.ok(h.calls.filter((c) => c[0] === "ShowInputHelper").length > 0, "English words get English suggestions");
  h.type("kohomada ");
  assert.equal(h.doc.text(), "hello the කොහොමද ");
});

test("the window: arrows and 1-9 choose, Enter writes, Esc keeps the Latin", () => {
  let h = harness();
  h.ime.setMode("unicode");
  h.type("oyata");
  const items = h.nodes["ime-items"].children.map((li) => li.children[1].textContent);
  assert.equal(items[0], "ඔයාට");
  h.key(40); h.key(13);
  assert.equal(h.doc.text(), items[1]);
  h = harness();
  h.ime.setMode("unicode");
  h.type("mama3");
  const third = S.candidates("mama", { preferred: S.COLLOQUIAL, lexicon: new S.Lexicon([]) });
  assert.equal(Array.from(h.doc.text()).length > 0, true);
  assert.doesNotMatch(h.doc.text(), /[a-z0-9]/, "the digit picks a candidate and is not typed");
  void third;
  h = harness();
  h.ime.setMode("unicode");
  h.type("mama");
  h.key(27);
  assert.equal(h.doc.text(), "mama");
  assert.deepEqual(h.calls.filter((c) => c[0] === "UnShowInputHelper").at(-1)[1].slice(1), [true]);
});

test("Tab writes the word when set; Space keeps the Latin when set", () => {
  let h = harness();
  h.ime.setMode("unicode");
  h.ime.set({ acceptTab: true });
  h.type("mama");
  h.key(9);
  assert.equal(h.doc.text(), "මම");
  h = harness();
  h.ime.setMode("unicode");
  h.ime.set({ acceptSpace: false });
  h.type("mama ");
  assert.equal(h.doc.text(), "mama ");
});

test("suggestions off: no window, Space writes the best match", () => {
  const h = harness();
  h.ime.setMode("unicode");
  h.clicks["ws-sinhala-suggestions"]();
  h.type("kohomada ");
  assert.equal(h.shown(), 0);
  assert.equal(h.doc.text(), "කොහොමද ");
});

test("the mode, fonts and settings are remembered; the old on/off setting moves to Sinhala Unicode", () => {
  const storage = new Map();
  let h = harness({ storage });
  h.ime.set({ legacyProfile: "dl-manel", unicodeFont: "Iskoola Pota", suggestions: false });
  h.ime.setMode("legacy");
  h = harness({ storage });
  assert.equal(h.ime.mode(), "legacy");
  assert.equal(h.ime.settings().legacyProfile, "dl-manel");
  assert.equal(h.ime.settings().unicodeFont, "Iskoola Pota");
  assert.equal(h.ime.settings().suggestions, false);
  h.key(89, { ctrlKey: true, shiftKey: true });
  assert.equal(h.ime.mode(), "english");
  h.key(89, { ctrlKey: true, shiftKey: true });
  assert.equal(h.ime.mode(), "legacy", "the toggle comes back to the last Sinhala mode");
  h.key(89, { ctrlKey: true, shiftKey: true, altKey: true });
  assert.equal(h.ime.mode(), "smart", "Ctrl+Alt+Shift+Y: the next mode");
  const old = harness({ storage: new Map([["worksuite-sinhala-input", "true"]]) });
  assert.equal(old.ime.mode(), "unicode");
});

test("the ribbon: eleven buttons in four groups, mode and font menus with the choice marked", () => {
  const h = harness();
  const items = h.lastToolbar().tabs[0].items;
  assert.deepEqual(items.map((i) => i.id.replace("ws-sinhala-", "")),
    ["inputMode", "sinhalaFont", "ime", "suggestions", "convertSelection", "convertDocument", "toLegacy", "toUnicode", "detect", "validate", "panel"]);
  assert.deepEqual(items.map((i) => !!i.separator), [false, false, false, false, true, false, false, false, true, false, true]);
  assert.equal(new Set(items.map((i) => i.icons)).size, items.length);
  assert.equal(items[0].text, "English");
  assert.deepEqual(items[0].items.map((m) => m.text), ["✓ English", "  Sinhala Unicode", "  Sinhala legacy font", "  Smart Mixed"]);
  h.clicks["ws-sinhala-mode-smart"]();
  let t = h.lastToolbar().tabs[0].items;
  assert.equal(t[0].text, "Smart Mixed");
  assert.equal(t[2].text, "Singlish: on");
  assert.equal(t[2].pressed, true);
  const font = t[1];
  assert.equal(font.split, true);
  assert.deepEqual(font.items.map((m) => m.text), ["Unicode fonts", "Legacy fonts", "All fonts…"]);
  assert.ok(font.items[0].items.some((m) => m.text === "✓ Noto Sans Sinhala"));
  assert.ok(font.items[1].items.some((m) => m.text === "  DL Manel (not installed)"));
  h.clicks["ws-sinhala-font-l-fm-abhaya"]();
  t = h.lastToolbar().tabs[0].items;
  assert.equal(h.ime.mode(), "legacy");
  assert.equal(t[1].text, "FMAbhaya");
});

test("the font picker: Unicode and mapped legacy fonts, others listed without a map", () => {
  const h = harness({ fonts: ["Iskoola Pota", "FMAbhaya", "FM Bindumathi", "Sinhala Sangam MN"] });
  h.clicks["ws-sinhala-sinhalaFont"]();
  const w = h.windows.at(-1);
  assert.equal(w.options.url, "fonts.html");
  w.events.onFontsReady();
  const { catalog } = JSON.parse(JSON.stringify(w.commands[0][1]));
  assert.deepEqual(catalog.unicode.map((f) => [f.name, f.installed]),
    [["Noto Sans Sinhala", false], ["Noto Serif Sinhala", false], ["Iskoola Pota", true], ["Sinhala Sangam MN", true], ["Malithi Web", false]]);
  assert.deepEqual([...new Set(catalog.legacy.filter((f) => f.mapped).map((f) => f.profile))], ["fm-abhaya", "dl-manel", "kaputa", "lastech", "kandy"]);
  assert.deepEqual(catalog.legacy.filter((f) => f.profile === "dl-manel").map((f) => f.label),
    ["DL Manel", "DL-Sarala", "Dl-Nisansala", "FS-Kapila", "FS-Dilrukshi", "Sinhala - Kumudu", "Ranaviru- PC", "Hemawathy", "Anuradha"]);
  assert.equal(catalog.legacy.find((f) => f.label === "Kandy").mapped, true, "Kandy now has a map");
  const bindu = catalog.legacy.find((f) => f.label === "FM Bindumathi");
  assert.deepEqual([bindu.mapped, bindu.installed], [false, true]);
  w.events.onFontsChoose({ unicode: "Iskoola Pota" });
  assert.equal(h.ime.settings().unicodeFont, "Iskoola Pota");
  assert.equal(h.ime.mode(), "unicode");
});

test("the local AI service: spec contract, off without the bridge's endpoint, debounced, cancelled by the next key", async () => {
  const seen = [];
  const fast = async (url, opts) => { seen.push({ url, opts }); return { json: async () => ({ words: [{ text: "මමත්", source: "model", score: 0.9 }, { text: "not sinhala" }], ghost: { text: "x", score: 0.1 } }) }; };
  let h = harness({ fetch: fast });
  h.ime.setMode("unicode");
  h.ime.set({ ai: true });
  h.type("mama");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, 0, "no WSAiEndpoint: off");
  h = harness({ fetch: fast, endpoint: { baseUrl: "http://127.0.0.1:5123/", token: "t0k" } });
  h.ime.setMode("unicode");
  h.type("mama");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, 0, "the setting is off by default");
  h.ime.set({ ai: true });
  h.type("a");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, 0, "never per keystroke: it waits for a pause");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, 1, "one request after the pause");
  const last = seen.at(-1);
  assert.equal(last.url, "http://127.0.0.1:5123/v1/text/complete");
  assert.equal(last.opts.method, "POST");
  assert.equal(last.opts.headers.Authorization, "Bearer t0k");
  assert.match(last.opts.headers["X-Request-Id"], /^ws-si-/);
  assert.deepEqual(JSON.parse(last.opts.body), { text: "mamaa", caret: 5, lang: "si", mode: "word", singlish: true, max: 5 });
  const items = h.nodes["ime-items"].children.map((li) => li.children[1].textContent);
  assert.ok(items.includes("මමත්"), items.join());
  assert.ok(!items.includes("not sinhala"));
  const aborted = [];
  const slow = (url, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ json: async () => ({ words: [{ text: "මමයි" }] }) }), 200);
    opts.signal.addEventListener("abort", () => { aborted.push(opts.headers["X-Request-Id"]); clearTimeout(t); reject(new Error("aborted")); });
  });
  h = harness({ fetch: slow, endpoint: { baseUrl: "http://127.0.0.1:5123", token: "t" } });
  h.ime.setMode("unicode");
  h.ime.set({ ai: true });
  h.type("ma");
  await new Promise((r) => setTimeout(r, 300));
  h.type("m");
  assert.equal(aborted.length, 1, "the next key cancels the request in flight");
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!h.nodes["ime-items"].children.some((li) => li.children[1].textContent === "මමයි"));
});

// --- Smart Typing in the plugin frame ----------------------------------------------------------------
const items = (h) => h.nodes["ime-items"].children.map((li) => li.children[1].textContent);

test("Sinhala input off: English suggestions still show; Tab writes the word in one command, formatting kept", () => {
  const h = harness();
  assert.equal(h.ime.mode(), "english");
  h.type("docu");
  assert.deepEqual(items(h).slice(0, 3).sort(), ["document", "documentation", "documents"]);
  assert.equal(h.nodes["ime-latin"].children.map((c) => c.textContent).join(""), "document", "header: the typed word and its ghost");
  const before = h.doc.commands;
  h.key(9);
  assert.equal(h.doc.text(), "document");
  assert.equal(h.doc.commands - before, 1, "one editor command: one undo step");
  assert.ok(h.doc.fonts().every((f) => f === "Calibri"), "an English word keeps the formatting");
});

test("Enter with nothing selected is a normal Enter (a paragraph break), with a selection it accepts", () => {
  let h = harness();
  h.type("docu");
  h.key(13);
  assert.equal(h.doc.text(), "docu\n");
  assert.deepEqual(h.calls.filter((c) => c[0] === "UnShowInputHelper").at(-1)[1].slice(1), [false]);
  h = harness();
  h.type("docu");
  h.key(40); h.key(40); h.key(13);
  assert.match(h.doc.text(), /^document/);
  assert.notEqual(h.doc.text(), "docu\n");
});

test("Space never replaces an English word; spelling fixes are offered, not forced", () => {
  const h = harness();
  h.type("recieve");
  assert.equal(items(h)[0], "receive");
  h.type(" ");
  assert.equal(h.doc.text(), "recieve ");
});

test("switching modes updates the suggestions at once", () => {
  const h = harness();
  h.type("kanna");
  assert.ok(!items(h).some((t) => /[\u0D80-\u0DFF]/.test(t)));
  h.ime.setMode("unicode");
  assert.deepEqual(items(h).slice(0, 3), ["කන්න", "කන්නට", "කන්නේ"], "the same letters, now Singlish");
  h.ime.setMode("smart");
  assert.equal(items(h)[0], "කන්න");
});

test("Sinhala Unicode typed with Sinhala input off gets Sinhala completions in the Sinhala font", () => {
  const h = harness();
  h.type("ලිය");
  assert.deepEqual(items(h).slice(0, 3), ["ලියන්න", "ලියනවා", "ලියවිල්ල"]);
  h.key(9);
  assert.equal(h.doc.text(), "ලියන්න");
  assert.ok(h.doc.fonts().every((f) => f === "Noto Sans Sinhala"));
});

test("Smart Mixed: meeting eka writes එක after the English word; legacy output encodes only the Sinhala", () => {
  let h = harness();
  h.ime.setMode("smart");
  h.type("meeting eka ");
  assert.equal(h.doc.text(), "meeting එක ");
  h = harness();
  h.ime.setMode("legacy");
  h.type("kanna ");
  const fm = S.getProfile("fm-abhaya");
  assert.equal(h.doc.text(), S.toLegacy("කන්න ", fm).text);
});

test("spreadsheets: no suggestions while a formula is typed", () => {
  const h = harness({ editorType: "cell" });
  h.type("=SUM");
  assert.equal(h.shown(), 0);
  const g = harness({ editorType: "cell" });
  g.type("docu");
  assert.ok(g.shown() > 0);
});

test("Ctrl/Cmd+Space opens the suggestions by hand, next words included; a click in the document closes them", () => {
  const h = harness({ editorType: "slide" });
  h.type("thank ");
  const n = h.shown();
  h.key(32, { ctrlKey: true });
  assert.equal(h.shown(), n + 1);
  assert.equal(items(h)[0], "you");
  h.key(9);
  assert.deepEqual(h.calls.filter((c) => c[0] === "InputText").at(-1)[1], ["you", ""]);
  h.type("docu");
  h.key(32, { metaKey: true });
  assert.equal(h.calls.at(-1)[0], "ShowInputHelper");
  h.plugin.event_onClick();
  assert.equal(h.calls.at(-1)[0], "UnShowInputHelper");
});

test("Suggestions › Settings: the window shows the settings, Save keeps them across sessions", () => {
  const storage = new Map();
  let h = harness({ storage });
  const menu = h.lastToolbar().tabs[0].items.find((i) => i.id === "ws-sinhala-suggestions");
  assert.deepEqual(menu.items.map((m) => m.text), ["✓ English suggestions", "✓ Sinhala suggestions", "Settings…"]);
  assert.equal(menu.split, true);
  h.clicks["ws-sinhala-suggest-settings"]();
  const w = h.windows.at(-1);
  assert.equal(w.options.url, "suggest.html");
  w.events.onSuggestReady();
  const init = w.commands.at(-1)[1];
  for (const k of ["english", "sinhala", "autocomplete", "nextWord", "spelling", "grammar", "ghost", "personal", "mixed", "maxItems", "delay", "acceptKey", "output"]) assert.ok(k in init.settings, k);
  w.events.onSuggestWord({ word: "Livezen" });
  assert.deepEqual(JSON.parse(JSON.stringify(w.commands.at(-1)[1].custom)), ["Livezen"]);
  w.events.onSuggestApply({ values: { english: true, maxItems: 5, acceptKey: "both", output: "legacy", spelling: false, bogus: 1 } });
  assert.ok(w.closed);
  h = harness({ storage });
  const st = h.ime.settings();
  assert.deepEqual([st.maxItems, st.acceptKey, st.output, st.spelling, st.lastSinhala], [5, "both", "legacy", false, "legacy"]);
  assert.equal("bogus" in st, false);
  h.type("Live");
  assert.equal(items(h)[0], "Livezen", "the custom dictionary was kept too");
  assert.equal(items(h).length <= 5, true);
  h.key(89, { ctrlKey: true, shiftKey: true });
  assert.equal(h.ime.mode(), "legacy", "Sinhala input turns on to the preferred output");
  h.clicks["ws-sinhala-suggest-english"]();
  assert.equal(h.ime.settings().english, false);
});

test("what is written is learned (this frame only) and ranks first next time", () => {
  const storage = new Map();
  let h = harness({ storage });
  for (let i = 0; i < 4; i++) { h.type("complian"); h.key(9); h.type(" "); }
  const chosen = "compliance";
  assert.equal(h.doc.text(), "compliance ".repeat(4));
  h = harness({ storage });
  h.type("comp");
  assert.equal(items(h)[0], chosen);
  assert.ok(JSON.parse(storage.get("worksuite-sinhala-personal")).words[chosen] >= 4);
});
