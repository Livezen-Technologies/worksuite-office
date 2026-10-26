// Per-token language detection for Smart Typing: is a token English, Singlish (romanised Sinhala) or
// Sinhala Unicode, given the input mode? docs/sinhala/smart-typing.md ("Mixed-language detection")
// states the rules R1-R12 that this file implements, in the same order; test/unit/lang.test.mjs has a
// test per rule.

import { EnglishLexicon } from "./english";
import { Personal } from "./bigrams";
import { COLLOQUIAL } from "./smart";
import { Lexicon } from "./suggest";
import { transliterate, variants } from "./translit";

export type TokenLang = "en" | "singlish" | "si" | "other";
/** english: Sinhala input off. unicode / legacy: Sinhala input on. smart: Smart Mixed. */
export type InputMode = "english" | "unicode" | "legacy" | "smart";
export type Rule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

export interface LangDecision {
  lang: TokenLang;
  rule: Rule;
  /** English and Singlish scores, 0..1 (R9). */
  e: number;
  s: number;
  /** Both readings are plausible (e >= 0.5 and s >= 0.5): the other language is offered second. */
  ambiguous: boolean;
}

export interface DetectContext {
  english?: EnglishLexicon | null;
  sinhala?: Lexicon | null;
  personal?: Personal | null;
  /** Latin code-switch markers (mixed.txt, kind "marker"). */
  markers?: ReadonlySet<string> | null;
  /** Languages of the previous tokens, nearest last (R10 reads the last 3). */
  previous?: readonly TokenLang[];
  /** The token starts a sentence (R3 does not apply there). */
  sentenceStart?: boolean;
}

/** The default code-switch markers when no data is given (mixed.txt has the full list). */
export const MARKERS = new Set(["eka", "ekak", "ekata", "eke", "ekka", "kiyala", "nam", "da", "ne", "wage", "gena", "hinda", "nisa", "thamai", "tikak", "godak"]);

export const THRESHOLD = 0.2;      // R9: |s - e| at or above this decides
export const CONTEXT_WINDOW = 3;   // R10
export const CONTEXT_WEIGHTS = [1, 0.6, 0.3];
export const CONTEXT_MIN = 0.3;    // R10: |weighted context| at or above this decides a tie

const SINHALA = /[඀-෿]/;
const URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE = /^[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}$/;
const LETTERS = /^[A-Za-z]+$/;

// R9 Singlish phonotactics: letter patterns that the romanisation scheme does not produce (English)
const NOT_SINGLISH = [/q/i, /x/, /ck/, /(?:tion|sion)$/, /ght/, /^(?:wh|wr|kn)/, /c(?!h)/, /y$/, /(?:ea|oa|ue|ei|io)/];
const SINGLISH_END = /(?:nna|nnam|nawa|wa|ta|da|ge|la|yi|ne|kka|mu|nne)$/;

/** R9: how much `t` reads as Singlish by its letters alone, 0..0.7. */
export function phonotactic(t: string): number {
  if (!LETTERS.test(t) || /[A-Za-z]/.test(transliterate(t))) return 0;
  const lower = t.toLowerCase();
  let p = 0.3;
  if (/[aeiou]$/.test(lower)) p += 0.2;
  if (SINGLISH_END.test(lower)) p += 0.15;
  if (/(?:aa|ee|ii|oo|uu|ae)/.test(lower)) p += 0.1;
  if (/(?:th|dh|kh)/.test(lower)) p += 0.05;
  // three consonants in a row once the aspirate digraphs count as one letter ("str", "ndl")
  if (/[bcdfgjklmnpqrstvwxz]{3}/.test(lower.replace(/([tdskgbpc])h/g, "$1"))) p -= 0.3;
  if (NOT_SINGLISH.some((re) => re.test(t))) p -= 0.3;
  return Math.max(0, Math.min(0.7, Math.round(p * 100) / 100));
}

/** R9: the English score of a Latin token, 0..1. */
export function englishScore(t: string, c: DetectContext): number {
  const en = c.english;
  const lower = t.toLowerCase();
  if (c.personal && c.personal.data.custom.some((w) => w.toLowerCase() === lower)) return 1;
  if (!en) return 0;
  if (en.isCommon(lower) || en.isBusiness(lower)) return 1;
  if (en.has(lower)) return 0.8;
  if (lower.length >= 3 && en.hasLonger(lower)) return 0.5;
  if (lower.length >= 5 && en.correct(lower, 1).some((x) => x.distance <= 1)) return 0.3;
  return 0;
}

/** R8/R9: the Singlish score of a Latin token, 0..1. */
export function singlishScore(t: string, c: DetectContext): number {
  const lower = t.toLowerCase();
  if ((c.markers || MARKERS).has(lower) || COLLOQUIAL[lower]) return 1;
  const p = phonotactic(t);
  if (c.sinhala && LETTERS.test(t) && variants(t, 3).some((v) => c.sinhala!.has(v.text))) return Math.max(0.75, p);
  return p;
}

function decision(lang: TokenLang, rule: Rule, e = 0, s = 0): LangDecision {
  return { lang, rule, e, s, ambiguous: e >= 0.5 && s >= 0.5 };
}

/** R10: the previous tokens' languages, nearest weighing most: > 0 Sinhala, < 0 English. */
export function contextLean(previous: readonly TokenLang[] = []): number {
  let sum = 0, weight = 0;
  const last = previous.slice(-CONTEXT_WINDOW).reverse();
  last.forEach((l, i) => {
    if (l !== "en" && l !== "singlish" && l !== "si") return;
    const w = CONTEXT_WEIGHTS[i];
    sum += (l === "en" ? -1 : 1) * w;
    weight += w;
  });
  return weight ? Math.round((sum / weight) * 100) / 100 : 0;
}

/** The language of one token typed in `mode`. */
export function detectToken(token: string, mode: InputMode, c: DetectContext = {}): LangDecision {
  // R1: Sinhala script anywhere in the token
  if (SINHALA.test(token)) return decision("si", "R1", 0, 1);
  // R2: URLs, e-mail addresses, numbers and file names stay as typed (English)
  if (URL.test(token) || EMAIL.test(token) || /\d/.test(token) || FILE.test(token)) return decision("en", "R2", 1, 0);
  // R4: anything else that is not letters (punctuation, symbols)
  if (!LETTERS.test(token)) return decision("other", "R4");
  // R5: the mode decides outright outside Smart Mixed
  if (mode === "english") return decision("en", "R5", 1, 0);
  if (mode !== "smart") return decision("singlish", "R5", 0, 1);
  // R12: one letter ("a", "I") is English
  if (token.length < 2) return decision("en", "R12", 1, 0);
  // R3: acronyms (2+ capitals) and capitalised words inside a sentence (names) stay English
  if (/^[A-Z]{2,}$/.test(token) || (!c.sentenceStart && /^[A-Z][a-z]+$/.test(token))) return decision("en", "R3", 1, 0);
  const e = englishScore(token, c);
  const s = singlishScore(token, c);
  // R6: what this user settled for this token wins
  const o = c.personal ? c.personal.override(token) : null;
  if (o) return decision(o === "si" ? "singlish" : "en", "R6", e, s);
  // R7: a code-switch marker (eka, kiyala, nam, da, ne ...) is Singlish, even after English
  if ((c.markers || MARKERS).has(token.toLowerCase())) return decision("singlish", "R7", e, 1);
  // R8: a colloquial Singlish spelling that is not a common English word
  if (COLLOQUIAL[token.toLowerCase()] && e < 1) return decision("singlish", "R8", e, 1);
  // R9: the scores, with a margin
  const d = Math.round((s - e) * 100) / 100;
  if (d >= THRESHOLD) return decision("singlish", "R9", e, s);
  if (d <= -THRESHOLD) return decision("en", "R9", e, s);
  // R10: a tie follows the previous tokens
  const lean = contextLean(c.previous);
  if (lean >= CONTEXT_MIN) return decision("singlish", "R10", e, s);
  if (lean <= -CONTEXT_MIN) return decision("en", "R10", e, s);
  // R11: still a tie: English first (typing English is never turned into Sinhala by a guess)
  return decision("en", "R11", e, s);
}
