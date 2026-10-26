// POST /v1/text/detect-language: spans by script (Sinhala, Tamil, Latin); Latin text that is not English
// by the dictionary may be Singlish or another language, and is asked of the model when one is installed.
import type { Dictionaries } from "./dictionaries";

export interface Span { start: number; end: number; lang: string; confidence: number }

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

function scriptOf(ch: string): "si" | "ta" | "latin" | null {
  if (SI.test(ch)) return "si";
  if (TA.test(ch)) return "ta";
  if (LATIN.test(ch)) return "latin";
  return null;
}

export function scriptSpans(text: string): { start: number; end: number; script: "si" | "ta" | "latin" }[] {
  const spans: { start: number; end: number; script: "si" | "ta" | "latin" }[] = [];
  for (let i = 0; i < text.length; i++) {
    const s = scriptOf(text[i]);
    const last = spans[spans.length - 1];
    if (!s) { if (last) last.end = i + 1; continue; }
    if (last && last.script === s) last.end = i + 1;
    else spans.push({ start: last ? last.end : i, end: i + 1, script: s });
  }
  // trailing neutral characters (spaces, punctuation) belong to the span before
  if (spans.length) spans[spans.length - 1].end = text.length;
  if (spans.length && spans[0].start > 0) spans[0].start = 0;
  return spans;
}

export function englishRatio(text: string, dict: Dictionaries): number {
  const words = text.match(/[A-Za-z']+/g) || [];
  if (!words.length) return 0;
  return words.filter((w) => dict.en.has(w) || dict.known(w)).length / words.length;
}

export function detectSpans(text: string, dict: Dictionaries): Span[] {
  return scriptSpans(text).map((s) => {
    if (s.script !== "latin") return { start: s.start, end: s.end, lang: s.script, confidence: 0.99 };
    const r = englishRatio(text.slice(s.start, s.end), dict);
    return { start: s.start, end: s.end, lang: r >= 0.5 ? "en" : "und", confidence: Math.round((r >= 0.5 ? r : 1 - r) * 100) / 100 };
  });
}

/** The one language a text is mostly in: by characters per detected span. */
export function dominant(spans: Span[]): string {
  const by = new Map<string, number>();
  for (const s of spans) by.set(s.lang, (by.get(s.lang) || 0) + (s.end - s.start));
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "und";
}
