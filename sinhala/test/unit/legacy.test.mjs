// Convert to legacy / legacy to Unicode on a selection: the text and the font change together in one
// editor command (one undo step), keeping the runs' other formatting; the dialog's flow; the checks; and
// every map round-tripping Sinhala structures (conjuncts, rakaransaya, yansaya, repaya, vowel signs).
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
const tmp = mkdtempSync(join(tmpdir(), "ws-sinhala-legacy-"));
const out = join(tmp, "dist");
execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", out], { stdio: "pipe" });
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const STRUCTURES = {
  conjuncts: "ශ්‍රී ලංකාව විද්‍යාලය",
  rakaransaya: "ප්‍රශ්නය ක්‍රමය",
  yansaya: "ක්‍යාලය සත්‍ය",
  repaya: "කාර්යය ධර්මය",
  "vowel signs": "කා කැ කෑ කි කී කු කූ කෘ කෙ කේ කෛ කො කෝ කෞ කං කඃ",
  "al-lakuna": "ක් ග් ණ්",
  "independent vowels": "අ ආ ඇ ඈ ඉ ඊ උ ඌ එ ඒ ඔ ඕ ඖ",
  sentence: "අම්මා ගෙදර ගියා. ශ්‍රී ලංකා ප්‍රජාතාන්ත්‍රික සමාජවාදී ජනරජය"
};

// What each map does not cover yet (the profiles are provisional, see their notes): the conversion reports
// these as unmapped, so the dialog lists them before anything changes. A map gaining one fails here first.
const ZWJ = "\u200D";
const GAPS = {
  "fm-abhaya": { "vowel signs": ["ඃ"], sentence: ["."] },
  "dl-manel": { conjuncts: [ZWJ], rakaransaya: [ZWJ], "vowel signs": ["ඃ"], sentence: [".", ZWJ] },
  "kaputa": { conjuncts: [ZWJ], rakaransaya: [ZWJ], "vowel signs": ["ඃ"], sentence: [".", ZWJ] }
};

for (const profile of S.builtinProfiles) {
  for (const [name, text] of Object.entries(STRUCTURES)) {
    const gaps = (GAPS[profile.id] || {})[name] || [];
    test(`${profile.id}: ${name} ${gaps.length ? "reports " + JSON.stringify(gaps) + " unmapped" : "round-trips Unicode -> legacy -> Unicode"}`, () => {
      const legacy = S.toLegacy(text, profile);
      assert.deepEqual([...new Set(legacy.unmapped.map((u) => u.text))].sort(), gaps.slice().sort());
      if (gaps.length) return;
      assert.doesNotMatch(legacy.text, /[\u0D80-\u0DFF]/, "no Sinhala left in the legacy text");
      const back = S.toUnicode(legacy.text, profile);
      assert.deepEqual(back.unmapped, []);
      assert.equal(back.text, text.normalize("NFC"));
    });
  }
}

// --- a stand-in editor: runs with formatting; a selection over some of them -------------------------
function editor(runs, selected) {
  const doc = { runs: runs.map((r) => ({ ...r })), selected: selected.slice(), history: [] };
  const sel = () => doc.selected.map((i) => doc.runs[i]);
  doc.Api = {
    GetDocument: () => ({
      GetRangeBySelect: () => doc.selected.length ? {
        GetTextPr: () => ({ GetFontFamily: () => { const f = new Set(sel().map((r) => r.font)); return f.size === 1 ? [...f][0] : null; } }),
        SetFontFamily: (f) => { doc.history.push("font"); sel().forEach((r) => { r.font = f; }); return true; }
      } : null
    }),
    // as v10: the text goes into the selected runs, keeping each run's properties; then the selection is removed
    ReplaceTextSmart: (lines) => {
      doc.history.push("text");
      const s = sel();
      s.forEach((r, i) => { r.text = i === 0 ? lines.join("") : ""; });
      doc.selected = [];
    }
  };
  return doc;
}

function harness(doc, opts = {}) {
  const calls = [];
  const commands = [];
  const windows = [];
  const clicks = {};
  const storage = new Map(opts.storage || []);
  const plugin = {
    info: { guid: "asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}", editorType: "word" },
    executeMethod(name, args, cb) {
      calls.push(name);
      if (name === "GetSelectedText") cb(doc.selected.map((i) => doc.runs[i].text).join(""));
      else if (name === "GetFontList") cb((opts.fonts || []).map((n) => ({ m_wsFontName: n })));
      else if (cb) cb();
    },
    callCommand(fn, isClose, isCalc, cb) {
      commands.push({ isCalc });
      const ctx = vm.createContext({ Api: doc.Api, Asc: { scope: JSON.parse(JSON.stringify(window.Asc.scope)) } });
      cb(vm.runInContext("(" + fn.toString() + ")()", ctx));
    },
    attachToolbarMenuClickEvent(id, f) { clicks[id] = f; }, tr: (t) => t
  };
  function PluginWindow() {
    const events = {};
    const w = { events, commands: [], attachEvent: (n, f) => { events[n] = f; }, command: (n, d) => w.commands.push([n, d]),
      show: (o) => { w.options = o; }, close: () => { w.closed = true; } };
    windows.push(w);
    return w;
  }
  const window = { Asc: { plugin, scope: {}, PluginWindow },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
  window.window = window;
  const ctx = vm.createContext({ window, JSON, Object, Math, String, Number, Array });
  for (const f of ["scripts/sinhala-core.js", "scripts/toolbar.js"]) {
    vm.runInContext(readFileSync(join(out, f), "utf8") + "\nwindow.WorkSuiteSinhala = WorkSuiteSinhala; window.__worksuiteSinhalaFactory = __worksuiteSinhalaFactory; if (typeof WorkSuiteSinhalaToolbar !== 'undefined') window.WorkSuiteSinhalaToolbar = WorkSuiteSinhalaToolbar;", ctx);
  }
  vm.runInContext(readFileSync(join(out, "scripts", "plugin.js"), "utf8"), ctx);
  return { plugin, calls, commands, windows, storage, click: (id) => clicks["ws-sinhala-" + id]() };
}

const FM = S.getProfile("fm-abhaya");
const DL = S.getProfile("dl-manel");

test("Convert to legacy from the dialog: the legacy text in the legacy font, in one editor command, formatting kept", () => {
  const doc = editor([{ text: "Hello ", font: "Arial" }, { text: "ශ්‍රී ලංකා", font: "Noto Sans Sinhala", bold: true, size: 14, color: "red" }], [1]);
  const h = harness(doc, { fonts: ["Arial", "DL-Manel", "FMAbhaya"] });
  h.click("toLegacy");
  const dlg = h.windows.at(-1);
  assert.equal(dlg.options.url, "legacy.html");
  assert.equal(dlg.options.isModal, true);
  assert.equal(h.commands.length, 1, "only the selection's font was read so far");
  dlg.events.onLegacyReady();
  const [name, init] = dlg.commands[0];
  assert.equal(name, "onLegacyInit");
  assert.equal(init.direction, "toLegacy");
  assert.equal(init.text, "ශ්‍රී ලංකා");
  assert.ok(init.installed.includes("DL-Manel"));
  dlg.events.onLegacyApply({ direction: "toLegacy", profile: "dl-manel" });
  assert.ok(dlg.closed);
  const writes = h.commands.filter((c) => c.isCalc);
  assert.equal(writes.length, 1, "one editor command, so one undo step");
  assert.deepEqual(doc.history, ["font", "text"], "the font is set on the selection before its text is replaced");
  assert.deepEqual(doc.runs[1], { text: S.toLegacy("ශ්‍රී ලංකා", DL).text, font: "DL-Manel", bold: true, size: 14, color: "red" });
  assert.deepEqual(doc.runs[0], { text: "Hello ", font: "Arial" }, "text outside the selection is untouched");
  assert.equal(JSON.parse(h.storage.get("worksuite-sinhala-tools")).legacyProfile, "dl-manel", "the choice is kept");
});

test("the old order (replace, then set the font on the selection) loses the font: v10 removes the selection", () => {
  const doc = editor([{ text: "ශ්‍රී", font: "Noto Sans Sinhala" }], [0]);
  doc.Api.ReplaceTextSmart([S.toLegacy("ශ්‍රී", FM).text]);
  assert.equal(doc.Api.GetDocument().GetRangeBySelect(), null);
  assert.equal(doc.runs[0].font, "Noto Sans Sinhala");
});

test("Legacy -> Unicode: the profile from the runs' font, Unicode text in Noto Sans Sinhala, one command", () => {
  const legacy = S.toLegacy("ප්‍රශ්නය කාර්යය", FM).text;
  const doc = editor([{ text: legacy, font: "FMAbhaya", italic: true }], [0]);
  const h = harness(doc);
  h.click("toUnicode");
  assert.equal(h.commands.filter((c) => c.isCalc).length, 1);
  assert.deepEqual(doc.runs[0], { text: "ප්‍රශ්නය කාර්යය".normalize("NFC"), font: "Noto Sans Sinhala", italic: true });
});

test("Legacy -> Unicode from the dialog with the font chosen there", () => {
  const legacy = S.toLegacy("අම්මා", DL).text;
  const doc = editor([{ text: legacy, font: "Some Font" }], [0]);
  const h = harness(doc);
  h.click("convertSelection");
  const dlg = h.windows.at(-1);
  dlg.events.onLegacyReady();
  assert.equal(dlg.commands[0][1].direction, "toUnicode", "Latin text opens the dialog the other way");
  dlg.events.onLegacyApply({ direction: "toUnicode", profile: "dl-manel" });
  assert.deepEqual(doc.runs[0], { text: "අම්මා", font: "Noto Sans Sinhala" });
});

test("the checks: no selection, nothing Sinhala, unknown font, mixed fonts", () => {
  const results = [];
  const check = (runs, selected, action, fromPanel) => {
    const doc = editor(runs, selected);
    const h = harness(doc);
    const w0 = h.windows.length;
    if (fromPanel) {
      h.click("panel");
      const panel = h.windows.at(-1);
      panel.events.onPanelReady();
      panel.events.onPanelAction({ action });
      const r = panel.commands.filter((c) => c[0] === "onResult").at(-1);
      results.push(r && r[1].error);
    } else {
      h.click(action);
      const panel = h.windows.slice(w0).find((w) => w.options && w.options.url === "panel.html");
      panel.events.onPanelReady();
      results.push(panel.commands.filter((c) => c[0] === "onResult").at(-1)[1].error);
    }
    assert.equal(doc.history.length, 0, "the document is not changed");
  };
  check([{ text: "abc", font: "Arial" }], [], "toLegacy");
  check([{ text: "Hello", font: "Arial" }], [0], "convertToLegacy", true);
  check([{ text: "xyzzy qwrt", font: "Wingdings" }], [0], "toUnicode");
  check([{ text: "xyzzy ", font: "Arial" }, { text: "qwrt", font: "Courier" }], [0, 1], "toUnicode");
  check([{ text: "ශ්‍රී", font: "Iskoola Pota" }], [0], "toUnicode");
  assert.deepEqual(results, [
    "Select the text to convert first.",
    "There is no Sinhala Unicode text in the selection.",
    "Wingdings is not a legacy Sinhala font Sinhala Tools knows. Choose its font.",
    "The selection mixes fonts. Select text in one legacy font, or choose its font.",
    "The selection is already Sinhala Unicode."
  ]);
});

test("unsupported characters are reported with their code points", () => {
  const doc = editor([{ text: "ශ්‍රී ලංකාව. ₹", font: "Noto Sans Sinhala" }], [0]);
  const h = harness(doc);
  h.click("panel");
  const panel = h.windows.at(-1);
  panel.events.onPanelReady();
  panel.events.onPanelAction({ action: "convertToLegacy" });
  const r = panel.commands.filter((c) => c[0] === "onResult").at(-1)[1];
  assert.equal(r.fontApplied, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.unmapped.map((u) => [u.codePoint, u.text]))), [["U+002E", "."], ["U+20B9", "₹"]]);
});
