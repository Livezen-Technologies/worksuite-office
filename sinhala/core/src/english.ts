// The English side of Smart Typing: a ranked word list with prefix completion, spelling correction
// (a misspelling table, then edit distance), and case handling. Pure data and functions: the plugin
// runs it in a worker or in its frame, tests run it in Node.
//
// Rank: en-frequent.txt words first (in their order), then en-business.txt, then SCOWL (alphabetical,
// so shorter words first). A lower rank is a more common word.

/** Words that are written with a capital wherever they stand. */
export const PROPER = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "english", "sinhala", "tamil", "sri", "lanka", "colombo", "kandy", "galle", "worksuite", "i"]);
// "may" and "march" are also common verbs: only capitalised at the start of a sentence like any word
const PROPER_ALWAYS = new Set(Array.from(PROPER).filter((w) => w !== "may" && w !== "march"));

export interface EnglishSources {
  /** Most frequent first. */
  frequent?: readonly string[];
  /** Business and technical vocabulary, ranked after `frequent`. */
  business?: readonly string[];
  /** Every other known word (SCOWL): ranked after both, shorter first. */
  words?: readonly string[];
  /** wrong -> right. */
  misspellings?: readonly (readonly [string, string])[];
}

export interface Correction { text: string; distance: number; rank: number }

const WORD = /^[a-z][a-z'-]*$/;

export class EnglishLexicon {
  private readonly rank = new Map<string, number>();
  private readonly sorted: string[];
  private readonly business = new Set<string>();
  private readonly byFirst = new Map<string, string[]>();
  readonly misspellings = new Map<string, string>();
  /** Where the frequent list ends: words below it are "common". */
  readonly commonUntil: number;

  constructor(src: EnglishSources) {
    const add = (w: string): void => {
      const x = w.trim().toLowerCase();
      if (x && WORD.test(x) && !this.rank.has(x)) this.rank.set(x, this.rank.size);
    };
    (src.frequent || []).forEach(add);
    this.commonUntil = this.rank.size;
    for (const w of src.business || []) { add(w); this.business.add(w.trim().toLowerCase()); }
    const rest = Array.from(src.words || []).map((w) => w.trim().toLowerCase()).filter((w) => w && !this.rank.has(w));
    rest.map((w, i) => [w, i] as const).sort((a, b) => a[0].length - b[0].length || a[1] - b[1]).forEach(([w]) => add(w));
    this.sorted = Array.from(this.rank.keys()).sort();
    for (const w of this.sorted) {
      const k = w[0];
      let list = this.byFirst.get(k);
      if (!list) this.byFirst.set(k, (list = []));
      list.push(w);
    }
    for (const [wrong, right] of src.misspellings || []) {
      if (wrong && right) this.misspellings.set(wrong.toLowerCase(), right.toLowerCase());
    }
  }

  get size(): number { return this.rank.size; }
  has(word: string): boolean { return this.rank.has(word.toLowerCase()); }
  rankOf(word: string): number | undefined { return this.rank.get(word.toLowerCase()); }
  isBusiness(word: string): boolean { return this.business.has(word.toLowerCase()); }
  isCommon(word: string): boolean { const r = this.rankOf(word); return r !== undefined && r < this.commonUntil; }

  /** Is `start` the start of a longer word? */
  hasLonger(start: string): boolean {
    const s = start.toLowerCase();
    const i = this.lowerBound(s);
    for (let j = i; j < this.sorted.length && this.sorted[j].startsWith(s); j++) if (this.sorted[j] !== s) return true;
    return false;
  }

  private lowerBound(s: string): number {
    let lo = 0, hi = this.sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.sorted[mid] < s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Words longer than `prefix` that start with it, most common first. */
  complete(prefix: string, limit = 10): string[] {
    const p = prefix.toLowerCase();
    if (!p) return [];
    const found: string[] = [];
    for (let i = this.lowerBound(p); i < this.sorted.length && this.sorted[i].startsWith(p); i++) {
      if (this.sorted[i] !== p) found.push(this.sorted[i]);
      if (found.length > 3000) break;
    }
    return found.sort((a, b) => this.rank.get(a)! - this.rank.get(b)!).slice(0, limit);
  }

  /**
   * Corrections for a word that is not in the list: the misspelling table first, then words at edit
   * distance 1 (or 2 for words of 6+ letters), same first letter or the first two swapped, nearest and
   * most common first.
   */
  correct(word: string, limit = 3): Correction[] {
    const w = word.toLowerCase();
    if (w.length < 3 || this.rank.has(w)) return [];
    const out: Correction[] = [];
    const fixed = this.misspellings.get(w);
    if (fixed) out.push({ text: fixed, distance: 0, rank: this.rankOf(fixed.split(" ")[0]) ?? 0 });
    const max = w.length >= 6 ? 2 : 1;
    const pool = new Set<string>([w[0], w.length > 1 ? w[1] : w[0]]);
    const found: Correction[] = [];
    for (const first of pool) {
      for (const cand of this.byFirst.get(first) || []) {
        if (Math.abs(cand.length - w.length) > max || cand === fixed) continue;
        if (first !== w[0] && !(cand[0] === w[1] && cand[1] === w[0])) continue;
        const d = distance(w, cand, max);
        if (d <= max) found.push({ text: cand, distance: d, rank: this.rank.get(cand)! });
      }
    }
    found.sort((a, b) => a.distance - b.distance || a.rank - b.rank);
    for (const f of found) { if (out.length >= limit) break; if (!out.some((o) => o.text === f.text)) out.push(f); }
    return out.slice(0, limit);
  }
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps), cut off above `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2: number[] = new Array(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/**
 * The word as it should be written after `typed`: ALL CAPS stays all caps, a capital first letter stays,
 * names and "I" take their capital, and the first word of a sentence takes one when `sentenceStart`.
 */
export function applyCase(word: string, typed: string, sentenceStart = false): string {
  if (typed.length >= 2 && typed === typed.toUpperCase() && /[A-Z]/.test(typed)) return word.toUpperCase();
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  if (/^[A-Z]/.test(typed) || sentenceStart || PROPER_ALWAYS.has(word.toLowerCase())) return cap(word);
  return word;
}
