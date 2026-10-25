// Smart Auto: offer Sinhala for a typed Latin word only when it is not an English word and reads as
// Singlish. It never replaces anything by itself: it only decides whether the candidate window opens.

import { Lexicon, candidates } from "./suggest";
import { transliterate } from "./translit";

/** Singlish spellings people use that the rules alone render differently, preferred over the rules. */
export const COLLOQUIAL: Record<string, string> = {
  oya: "ඔයා", oyata: "ඔයාට", oyage: "ඔයාගේ", oyala: "ඔයාලා", oyalata: "ඔයාලාට",
  mata: "මට", mage: "මගේ", mama: "මම", api: "අපි", apita: "අපිට", ape: "අපේ",
  eka: "එක", meka: "මේක", oka: "ඕක", eya: "එයා", eyata: "එයාට",
  kohomada: "කොහොමද", mokakda: "මොකක්ද", kawda: "කවුද", koheda: "කොහෙද", ai: "ඇයි",
  sri: "ශ්‍රී", lankawa: "ලංකාව", lanka: "ලංකා", hari: "හරි", nae: "නෑ", ow: "ඔව්",
  suba: "සුබ", istuti: "ස්තුතියි", sthuthi: "ස්තුතියි"
};

export type SmartReason = "english" | "colloquial" | "lexicon" | "singlish" | "not-singlish" | "too-short";
export interface SmartDecision { suggest: boolean; reason: SmartReason }

/** A set of lower-case English words (SCOWL, sizes 10 and 20 in the plugin). */
export class EnglishWords {
  private readonly words: Set<string>;
  private readonly sorted: string[];
  constructor(words: Iterable<string>) {
    this.words = new Set(Array.from(words, (w) => w.toLowerCase()));
    this.sorted = Array.from(this.words).sort();
  }
  has(word: string): boolean { return this.words.has(word.toLowerCase()); }
  /** Is `start` the start of a longer English word (so the word may still become English)? */
  hasLongerWord(start: string): boolean {
    const s = start.toLowerCase();
    let lo = 0, hi = this.sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.sorted[mid] <= s) lo = mid + 1; else hi = mid; }
    return lo < this.sorted.length && this.sorted[lo].startsWith(s);
  }
  get size(): number { return this.words.size; }
}

/**
 * Should Smart Auto offer Sinhala for `latin`? Never for an English word; yes for a colloquial spelling
 * or a word whose rendering is in the Sinhala word list; for others, yes when the rules read all of it
 * as Sinhala and it is at least 3 letters (so "I", "a", "ok" stay English).
 */
export function smartDecision(latin: string, english: EnglishWords | null, lexicon?: Lexicon | null): SmartDecision {
  if (!/^[A-Za-z]+$/.test(latin)) return { suggest: false, reason: "not-singlish" };
  if (english && english.has(latin)) return { suggest: false, reason: "english" };
  if (COLLOQUIAL[latin.toLowerCase()]) return { suggest: true, reason: "colloquial" };
  if (lexicon && candidates(latin, { lexicon, words: 3, completions: 0 }).some((c) => c.known)) return { suggest: true, reason: "lexicon" };
  if (latin.length < 3) return { suggest: false, reason: "too-short" };
  return /[A-Za-z]/.test(transliterate(latin)) ? { suggest: false, reason: "not-singlish" } : { suggest: true, reason: "singlish" };
}
