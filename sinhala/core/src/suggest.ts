// Candidates for Sinhala input: the renderings of what has been typed, ranked by a word list and by
// what this user picked before, plus completions of the word being typed (Google Input Tools style).
//
// The word list is data handed in (most frequent first); the learned picks are a plain object the
// caller stores where it likes (the plugin: its own localStorage, never sent anywhere).

import { AL_LAKUNA } from "./script";
import { variants } from "./translit";

export interface Candidate {
  text: string;
  /** "word": a rendering of the whole input; "completion": a longer word that starts with one. */
  kind: "word" | "completion";
  /** Higher is better. */
  score: number;
  known: boolean;
  learned: number;
}

/** A word list: rank by word, and prefix search over the sorted words. */
export class Lexicon {
  private readonly rank = new Map<string, number>();
  private readonly sorted: string[];

  /** `words`: most frequent first; duplicates and non-Sinhala entries are dropped. */
  constructor(words: readonly string[]) {
    for (const raw of words) {
      const w = raw.normalize("NFC").trim();
      if (!w || !/^[඀-෿‍]+$/.test(w) || this.rank.has(w)) continue;
      this.rank.set(w, this.rank.size);
    }
    this.sorted = Array.from(this.rank.keys()).sort();
  }

  get size(): number { return this.rank.size; }
  has(word: string): boolean { return this.rank.has(word); }
  /** 0 is the most frequent; undefined when the word is not in the list. */
  rankOf(word: string): number | undefined { return this.rank.get(word); }

  /** Words that start with `prefix` and are longer than it, most frequent first, at most `limit`. */
  complete(prefix: string, limit = 10): string[] {
    if (!prefix) return [];
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    const found: string[] = [];
    for (let i = lo; i < this.sorted.length && this.sorted[i].startsWith(prefix); i++) {
      if (this.sorted[i] !== prefix) found.push(this.sorted[i]);
      if (found.length > 2000) break;
    }
    return found.sort((a, b) => this.rank.get(a)! - this.rank.get(b)!).slice(0, limit);
  }
}

/** The user's own picks: romanised input -> Sinhala word -> times picked. JSON-safe. */
export interface LearnedData { version: 1; picks: Record<string, Record<string, number>>; words: Record<string, number> }

export class Learner {
  data: LearnedData;
  constructor(data?: unknown, readonly maxEntries = 5000) {
    this.data = Learner.valid(data) ? data : { version: 1, picks: {}, words: {} };
  }

  static valid(data: unknown): data is LearnedData {
    const d = data as LearnedData;
    return !!d && typeof d === "object" && d.version === 1 && !!d.picks && typeof d.picks === "object" && !!d.words && typeof d.words === "object";
  }

  /** Remembers that `latin` was written as `word`. */
  record(latin: string, word: string): void {
    if (!latin || !word) return;
    const key = latin; // case matters in the scheme (t ට, T ඨ)
    const picks = (this.data.picks[key] = this.data.picks[key] || {});
    picks[word] = (picks[word] || 0) + 1;
    this.data.words[word] = (this.data.words[word] || 0) + 1;
    const keys = Object.keys(this.data.picks);
    if (keys.length > this.maxEntries) delete this.data.picks[keys[0]]; // oldest first (insertion order)
    const words = Object.keys(this.data.words);
    if (words.length > this.maxEntries) delete this.data.words[words[0]];
  }

  picks(latin: string): number { return Object.keys(this.data.picks[latin] || {}).length; }
  count(latin: string, word: string): number { return (this.data.picks[latin] || {})[word] || 0; }
  wordCount(word: string): number { return this.data.words[word] || 0; }
  forget(): void { this.data = { version: 1, picks: {}, words: {} }; }
}

export interface CandidateOptions {
  lexicon?: Lexicon | null;
  learner?: Learner | null;
  /** How many renderings of the whole input (default 5). */
  words?: number;
  /** How many completions (default 4). */
  completions?: number;
}

// Scores: a word picked before for this very input wins, then words in the list (by rank), then the
// rules' own order. Completions are scored on the same scale, below an exact word of similar rank.
function lexScore(lexicon: Lexicon | null | undefined, word: string): number {
  const r = lexicon ? lexicon.rankOf(word) : undefined;
  return r === undefined ? 0 : 8 - Math.min(6.5, Math.log10(r + 1) * 1.25);
}

/**
 * Ranked candidates for romanised `latin`: candidates("amma", { lexicon }) puts අම්මා (a word) above
 * අම්ම (the plain rule). The rules' preferred rendering is always among the words.
 */
export function candidates(latin: string, options: CandidateOptions = {}): Candidate[] {
  if (!/^[A-Za-z]+$/.test(latin)) return [];
  const { lexicon, learner } = options;
  const nWords = options.words ?? 5;
  const nCompletions = options.completions ?? 4;
  const all = variants(latin, 64);
  const words: Candidate[] = all.map((v, i) => {
    const learned = learner ? learner.count(latin, v.text) : 0;
    const known = !!lexicon && lexicon.has(v.text);
    const score = (learned ? 20 + Math.min(learned, 10) : 0) + lexScore(lexicon, v.text) + (learner ? Math.min(learner.wordCount(v.text), 5) * 0.3 : 0) - v.penalty * 1.2 - i * 0.01;
    return { text: v.text, kind: "word" as const, score, known, learned };
  });
  words.sort((a, b) => b.score - a.score);
  const top = words.slice(0, nWords);
  // the rules' own rendering is always offered
  if (!top.some((c) => c.text === all[0].text)) top[top.length - 1] = words.find((c) => c.text === all[0].text)!;

  const out = top.slice();
  if (lexicon && nCompletions > 0) {
    const seen = new Set(out.map((c) => c.text));
    const completions: Candidate[] = [];
    // prefixes: the best open renderings (a final consonant still waiting for its vowel)
    const prefixes = variants(latin, 12, true).slice(0, 6);
    prefixes.forEach((p, i) => {
      let prefix = p.text;
      if (prefix.endsWith(AL_LAKUNA)) prefix = prefix.slice(0, -1);
      for (const w of lexicon.complete(prefix, nCompletions * 2)) {
        if (seen.has(w)) continue;
        seen.add(w);
        const learnedWord = learner ? learner.wordCount(w) : 0;
        completions.push({ text: w, kind: "completion", known: true, learned: learnedWord,
          score: lexScore(lexicon, w) + Math.min(learnedWord, 5) * 0.5 - p.penalty * 1.2 - i * 0.05 - 1 });
      }
    });
    completions.sort((a, b) => b.score - a.score);
    out.push(...completions.slice(0, nCompletions));
  }
  return out;
}
