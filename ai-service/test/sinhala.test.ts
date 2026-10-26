import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, start } from "./helpers/harness";
import { transliterate } from "@worksuite/sinhala-core";
import { toSinglish } from "../src/sinhala/romanize";

let h: Harness;
beforeAll(async () => { h = await start(); });
afterAll(async () => { await h.close(); });

describe("/v1/sinhala", () => {
  it("transliterates both ways", async () => {
    expect((await h.call("POST", "/v1/sinhala/transliterate", { text: "amma", from: "singlish", to: "si" })).json).toEqual({ text: "අම්ම" });
    expect((await h.call("POST", "/v1/sinhala/transliterate", { text: "ශ්‍රී ලංකාව", from: "si", to: "singlish" })).json).toEqual({ text: "shrii lankaawa" });
    for (const w of ["amma", "lankaawa", "kohomadha", "shrii"]) expect(transliterate(toSinglish(transliterate(w)))).toBe(transliterate(w));
  });
  it("normalizes with changes and validates", async () => {
    const bad = "කේා"; // ේ + ා: should be ෝ
    const n = (await h.call("POST", "/v1/sinhala/normalize", { text: bad })).json;
    expect(n.text).toBe("කෝ");
    expect(n.changes).toEqual([expect.objectContaining({ before: expect.any(String), after: expect.any(String), rule: expect.any(String), start: expect.any(Number), end: expect.any(Number) })]);
    const v = (await h.call("POST", "/v1/sinhala/validate", { text: "ා" })).json;
    expect(v).toEqual({ valid: false, issues: [{ start: 0, end: 1, code: "sign-without-base", message: expect.any(String), fixable: false }] });
    expect((await h.call("POST", "/v1/sinhala/validate", { text: "අම්මා" })).json).toEqual({ valid: true, issues: [] });
  });
  it("converts legacy fonts both ways and lists them", async () => {
    const fonts = (await h.call("GET", "/v1/sinhala/legacy/fonts")).json;
    expect(fonts.map((f: any) => f.encoding).sort()).toEqual(["dl", "fm", "kandy", "kaputa", "lastech"]);
    expect(fonts[0]).toEqual(expect.objectContaining({ id: expect.any(String), family: expect.any(String), encoding: expect.any(String) }));
    const enc = (await h.call("POST", "/v1/sinhala/legacy/encode", { text: "අම්මා", font: "FMAbhaya" })).json;
    expect(enc).toMatchObject({ font: "FMAbhaya", unmapped: [] });
    const dec = (await h.call("POST", "/v1/sinhala/legacy/decode", { text: enc.text, font: "FMAbhaya" })).json;
    expect(dec).toMatchObject({ text: "අම්මා", suggestedFont: "Noto Sans Sinhala" });
    expect((await h.call("POST", "/v1/sinhala/legacy/encode", { text: "x", font: "Arial" })).status).toBe(400);
  });
  it("segments words, keeping conjuncts whole", async () => {
    const text = "ශ්‍රී ලංකාව, ලස්සනයි.";
    const { words } = (await h.call("POST", "/v1/sinhala/segment", { text })).json;
    expect(words.map((w: any) => text.slice(w.start, w.end))).toEqual(["ශ්‍රී", "ලංකාව", "ලස්සනයි"]);
  });
});

describe("dictionaries", () => {
  it("adds, lists and removes personal words; learned words only while learning is on", async () => {
    expect((await h.call("POST", "/v1/dictionaries/personal/words", { words: ["Livezen", "වර්ක්සුයිට්"] })).json.added).toEqual(["Livezen", "වර්ක්සුයිට්"]);
    expect((await h.call("POST", "/v1/dictionaries/personal/words", { word: "Hasarinda", learned: true })).json.added).toEqual([]);
    expect((await h.call("GET", "/v1/dictionaries/personal/words")).json.words).toEqual(["Livezen", "වර්ක්සුයිට්"]);
    const c = (await h.call("POST", "/v1/text/complete", { text: "Live", caret: 4, lang: "en" })).json;
    expect(c.words[0]).toMatchObject({ text: "Livezen", source: "personal" });
    expect((await h.call("DELETE", "/v1/dictionaries/personal/words?word=Livezen")).json.removed).toEqual(["Livezen"]);
    const all = (await h.call("GET", "/v1/dictionaries")).json;
    expect(all.map((d: any) => d.id)).toEqual(["personal", "organization", "builtin-si", "builtin-en"]);
    expect(all[2].words).toBeGreaterThan(20000);
  });
  it("pulls the organisation dictionary from policy.orgDictionaryUrl", async () => {
    h.net.files.set("https://admin.test/dict.txt", Buffer.from("# org words\nWorkSuiteCloud\nලිව්සෙන්\n"));
    h.policy.raw = { orgDictionaryUrl: "https://admin.test/dict.txt" };
    await h.svc.reloadPolicy();
    await new Promise((r) => setTimeout(r, 50));
    const c = (await h.call("POST", "/v1/text/complete", { text: "WorkSuiteC", caret: 10, lang: "en" })).json;
    expect(c.words[0]).toMatchObject({ text: "WorkSuiteCloud", source: "org" });
    const chk = (await h.call("POST", "/v1/text/check", { text: "WorkSuiteCloud", lang: "en", kinds: ["spelling"] })).json;
    expect(chk.issues).toEqual([]);
    h.policy.raw = null;
    await h.svc.reloadPolicy();
  });
  it("privacy: get/put and clear learned data", async () => {
    expect((await h.call("GET", "/v1/privacy")).json).toEqual({ learning: false, keepRecordings: false });
    expect((await h.call("PUT", "/v1/privacy", { learning: true })).json).toEqual({ learning: true, keepRecordings: false });
    expect((await h.call("POST", "/v1/dictionaries/personal/learn", { latin: "amma", word: "අම්ම" })).json).toEqual({ learned: true });
    expect((await h.call("POST", "/v1/privacy/clear", { what: ["learned", "cache", "recordings"] })).json).toEqual({ cleared: ["learned", "cache", "recordings"] });
    expect((await h.call("GET", "/v1/dictionaries/personal/words")).json.words).toEqual([]);
    expect((await h.call("POST", "/v1/privacy/clear", { what: ["everything"] })).status).toBe(400);
  });
});
