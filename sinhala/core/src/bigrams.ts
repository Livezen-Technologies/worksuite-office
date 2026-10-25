// Next-word prediction and the personal dictionary.
//
// Bigrams: bundled pairs (wordlist/smart/*-bigrams.txt, most common first) plus the pairs this user
// writes, learned in PersonalData. PersonalData is a plain JSON-safe object the plugin keeps in its own
// storage (never sent anywhere): words with counts, pairs with counts, the language each Latin token
// was confirmed in (detector overrides) and the user's custom dictionary.

export interface PersonalData {
  version: 1;
  words: Record<string, number>;
  pairs: Record<string, Record<string, number>>;
  /** Latin token -> times confirmed as Sinhala ("si") or English ("en"). */
  lang: Record<string, { si: number; en: number }>;
  /** Words the user added by hand: always known, ranked like common words. */
  custom: string[];
}

export class Personal {
  data: PersonalData;
  constructor(data?: unknown, readonly maxEntries = 5000) {
    this.data = Personal.valid(data) ? data : Personal.empty();
  }
  static empty(): PersonalData { return { version: 1, words: {}, pairs: {}, lang: {}, custom: [] }; }
  static valid(d: unknown): d is PersonalData {
    const x = d as PersonalData;
    return !!x && typeof x === "object" && x.version === 1 && !!x.words && !!x.pairs && !!x.lang && Array.isArray(x.custom);
  }
  private trim(o: Record<string, unknown>): void {
    const keys = Object.keys(o);
    if (keys.length > this.maxEntries) delete o[keys[0]];
  }
  /** A word was written (accepted or typed and finished). */
  word(word: string, prev?: string | null): void {
    if (!word) return;
    this.data.words[word] = (this.data.words[word] || 0) + 1;
    this.trim(this.data.words);
    if (prev) {
      const p = (this.data.pairs[prev.toLowerCase()] = this.data.pairs[prev.toLowerCase()] || {});
      p[word] = (p[word] || 0) + 1;
      this.trim(this.data.pairs);
    }
  }
  wordCount(word: string): number { return this.data.words[word] || 0; }
  pairCount(prev: string, word: string): number { return (this.data.pairs[prev.toLowerCase()] || {})[word] || 0; }
  /** The user confirmed `latin` as Sinhala or English (an accepted candidate, or Esc on a Sinhala list). */
  confirm(latin: string, lang: "si" | "en"): void {
    const k = latin.toLowerCase();
    const e = (this.data.lang[k] = this.data.lang[k] || { si: 0, en: 0 });
    e[lang]++;
    this.trim(this.data.lang);
  }
  /** "si" / "en" when the user has settled this token, else null (equal counts: not settled). */
  override(latin: string): "si" | "en" | null {
    const e = this.data.lang[latin.toLowerCase()];
    if (!e || e.si === e.en) return null;
    return e.si > e.en ? "si" : "en";
  }
  addCustom(word: string): void { const w = word.trim(); if (w && !this.data.custom.includes(w)) this.data.custom.push(w); }
  removeCustom(word: string): void { this.data.custom = this.data.custom.filter((w) => w !== word); }
  forget(): void { this.data = Personal.empty(); }
}

export class Bigrams {
  private readonly next = new Map<string, string[]>();
  constructor(pairs: readonly (readonly [string, string])[] = []) {
    for (const [a, b] of pairs) {
      if (!a || !b) continue;
      const k = a.toLowerCase();
      const list = this.next.get(k) || [];
      if (!list.includes(b)) list.push(b);
      this.next.set(k, list);
    }
  }
  /** Bundled next words after `prev`, most common first. */
  after(prev: string): string[] { return this.next.get(prev.toLowerCase()) || []; }
  /** 0 when not a bundled pair; else higher for the more common pairs (3 for the first). */
  strength(prev: string, word: string): number {
    const i = this.after(prev).indexOf(word.toLowerCase() === word ? word : word.toLowerCase());
    const j = i >= 0 ? i : this.after(prev).indexOf(word);
    return j < 0 ? 0 : Math.max(1, 3 - j * 0.25);
  }
}
