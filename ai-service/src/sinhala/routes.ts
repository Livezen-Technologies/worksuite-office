// /v1/sinhala/*: @worksuite/sinhala-core behind the service (the same engine the plugin bundles).
import { builtinProfiles, getProfile, normalize, profileForFont, Profile, toLegacy, toUnicode, transliterate, validate } from "@worksuite/sinhala-core";
import { ApiError } from "../errors";
import { myers } from "../text/diff";
import { toSinglish } from "./romanize";

const ISSUE_MESSAGE: Record<string, string> = {
  "not-nfc": "The text is not in Unicode normal form C",
  "sign-without-base": "A vowel sign with no letter to sit on",
  "kombuva-before-consonant": "Kombuva typed before the consonant (legacy order)",
  "double-vowel-sign": "Two vowel signs on one letter",
  "zwj-order": "Joiner before al-lakuna (yansaya/rakaransaya in the wrong order)",
  "stray-zwj": "A zero-width joiner that joins nothing",
  "stray-zwnj": "A zero-width non-joiner that separates nothing",
};

export function sinhalaTransliterate(text: string, from: string, to: string): { text: string } {
  if (from === "singlish" && to === "si") return { text: transliterate(text) };
  if (from === "si" && to === "singlish") return { text: toSinglish(text) };
  if (from === to) return { text };
  throw new ApiError("bad_request", '"from"/"to" must be singlish->si or si->singlish');
}

/** normalize() with the changes it made, as spans of the input. */
export function sinhalaNormalize(text: string) {
  const out = normalize(text).text;
  const issues = validate(text);
  const a = [...text]; const b = [...out];
  const ops = myers(a, b);
  // code-point index -> UTF-16 offset of the input
  const offs: number[] = []; let o = 0;
  for (const ch of a) { offs.push(o); o += ch.length; }
  offs.push(o);
  const changes: { start: number; end: number; before: string; after: string; rule: string }[] = [];
  let cur: { s: number; e: number; after: string } | null = null;
  let ai = 0;
  const flush = () => {
    if (!cur) return;
    const start = offs[cur.s]; const end = offs[cur.e];
    const hit = issues.find((i) => i.offset < Math.max(end, start + 1) && i.offset + i.length > start && i.code !== "not-nfc");
    changes.push({ start, end, before: text.slice(start, end), after: cur.after, rule: hit ? hit.code : text.slice(start, end).normalize("NFC") === cur.after ? "nfc" : "vowel-sign-order" });
    cur = null;
  };
  for (const op of ops) {
    if (op.kind === "eq") { flush(); ai = op.a! + 1; continue; }
    if (!cur) cur = { s: op.kind === "del" ? op.a! : ai, e: op.kind === "del" ? op.a! : ai, after: "" };
    if (op.kind === "del") { cur.e = op.a! + 1; ai = cur.e; } else cur.after += b[op.b!];
  }
  flush();
  return { text: out, changes };
}

export function sinhalaValidate(text: string) {
  const issues = validate(text).map((i) => ({ start: i.offset, end: i.offset + i.length, code: i.code, message: ISSUE_MESSAGE[i.code] || i.code, fixable: i.fixable }));
  return { valid: issues.length === 0, issues };
}

function profileFor(font: string): Profile {
  const p = profileForFont(font) || builtinProfiles.find((x) => x.id === font);
  if (!p) throw new ApiError("bad_request", `Unknown legacy font "${font}"`, { fonts: builtinProfiles.map((x) => x.name) });
  return p;
}

export function legacyEncode(text: string, font: string) {
  const p = profileFor(font);
  const r = toLegacy(text, p);
  return { text: r.text, font: p.fontNames[0], unmapped: r.unmapped.map((u) => ({ start: u.offset, end: u.offset + u.text.length, char: u.text })), profile: p.id, profileVersion: p.version };
}

export function legacyDecode(text: string, font: string) {
  const p = profileFor(font);
  const r = toUnicode(text, p);
  return { text: r.text, suggestedFont: "Noto Sans Sinhala", unmapped: r.unmapped.map((u) => ({ start: u.offset, end: u.offset + u.text.length, char: u.text })), profile: p.id };
}

export function legacyFonts() {
  return builtinProfiles.map((p) => ({ id: p.id, family: p.name, encoding: p.id.split("-")[0], fontNames: p.fontNames, status: p.status, version: p.version }));
}

export function segmentWords(text: string): { words: { start: number; end: number }[] } {
  const words: { start: number; end: number }[] = [];
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Seg) {
    for (const s of new Seg("si", { granularity: "word" }).segment(text)) if (s.isWordLike) words.push({ start: s.index, end: s.index + s.segment.length });
    // ICU splits at ZWJ inside conjuncts in some versions: join pieces that touch across a joiner
    for (let i = words.length - 1; i > 0; i--) {
      const gap = text.slice(words[i - 1].end, words[i].start);
      if (/^[‌‍]*$/.test(gap) && (gap || /[්‍]$/.test(text.slice(words[i - 1].start, words[i - 1].end)))) {
        words[i - 1].end = words[i].end;
        words.splice(i, 1);
      }
    }
    return { words };
  }
  for (const m of text.matchAll(/[\p{L}\p{M}\p{N}‌‍]+/gu)) words.push({ start: m.index!, end: m.index! + m[0].length });
  return { words };
}

export { getProfile };
