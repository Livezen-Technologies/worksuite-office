// The Smart Typing engine: one call per keystroke, `suggest({ before, mode })`, answers the ranked list
// for the token before the caret in English, Singlish or Sinhala Unicode (lang.ts decides which), or the
// next-word predictions after a space. Everything is local and bounded: the word lists are indexed once,
// answers are cached (LRU), and nothing here waits for anything. The optional AI words are merged by the
// caller with merge() when they arrive.

import { Bigrams, Personal } from "./bigrams";
import { EnglishLexicon, applyCase, distance } from "./english";
import { InputMode, LangDecision, MARKERS, TokenLang, detectToken } from "./lang";
import { normalize } from "./normalize";
import { COLLOQUIAL } from "./smart";
import { Candidate, Learner, Lexicon, candidates } from "./suggest";

export type ItemKind = "word" | "completion" | "correction" | "case" | "grammar" | "next" | "loan" | "ai";

export interface SmartItem {
  text: string;
  kind: ItemKind;
  /** The language of `text`: "en" is written as it is, "si" in the Sinhala font (or encoded for a legacy one). */
  lang: "en" | "si";
  score: number;
  /** The characters before the caret this replaces (the token, or more for a grammar fix). */
  replace: string;
  /** A word list, the user, or the local AI. */
  source: "dictionary" | "rules" | "personal" | "model";
}

export interface SmartSettings {
  english: boolean;
  sinhala: boolean;
  autocomplete: boolean;
  nextWord: boolean;
  spelling: boolean;
  grammar: boolean;
  personal: boolean;
  mixed: boolean;
  /** 5..7 */
  maxItems: number;
}

export const DEFAULT_SETTINGS: SmartSettings = {
  english: true, sinhala: true, autocomplete: true, nextWord: true, spelling: true, grammar: true,
  personal: true, mixed: true, maxItems: 7
};

export interface SmartData {
  englishFrequent?: readonly string[];
  englishBusiness?: readonly string[];
  englishWords?: readonly string[];
  misspellings?: readonly (readonly [string, string])[];
  englishBigrams?: readonly (readonly [string, string])[];
  sinhalaBigrams?: readonly (readonly [string, string])[];
  /** [latin, sinhala, "marker" | "loan"] */
  mixed?: readonly (readonly [string, string, string])[];
  sinhalaWords?: readonly string[];
}

export interface SmartQuery {
  /** The text before the caret (the editor's input context, or the sentence before it). */
  before: string;
  mode: InputMode;
  /** Opened by Ctrl/Cmd+Space: next-word predictions even right after a space. */
  manual?: boolean;
}

export interface SmartResult {
  token: string;
  decision: LangDecision | null;
  items: SmartItem[];
  /** The rest of the best English completion, for ghost text ("docu" -> "ment"). */
  ghost: string;
  /** "next" when predicting the word after a space. */
  phase: "word" | "next" | "none";
  ms: number;
}

const SI_TOKEN = /^[඀-෿‌‍]+$/;

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

/** Splits the text before the caret into words (whitespace separated, outer punctuation stripped). */
export function words(text: string): string[] {
  return text.split(/\s+/).map((w) => w.replace(/^[("'`[{]+|[)"'`!?.,;:\]}]+$/g, "")).filter(Boolean);
}

export class SmartEngine {
  readonly english: EnglishLexicon;
  readonly sinhala: Lexicon;
  readonly enBigrams: Bigrams;
  readonly siBigrams: Bigrams;
  readonly markers: Set<string>;
  readonly preferred: Record<string, string>;
  readonly loans = new Map<string, string>();
  private readonly siByFirst = new Map<string, string[]>();
  private readonly cache = new Lru<SmartResult>(400);
  settings: SmartSettings = { ...DEFAULT_SETTINGS };

  constructor(data: SmartData, public personal: Personal = new Personal(), public learner: Learner | null = null) {
    this.english = new EnglishLexicon({ frequent: data.englishFrequent, business: data.englishBusiness, words: data.englishWords, misspellings: data.misspellings });
    this.sinhala = new Lexicon(data.sinhalaWords || []);
    this.enBigrams = new Bigrams(data.englishBigrams || []);
    this.siBigrams = new Bigrams(data.sinhalaBigrams || []);
    this.markers = new Set(MARKERS);
    this.preferred = { ...COLLOQUIAL };
    for (const [latin, si, kind] of data.mixed || []) {
      if (kind === "marker") { this.markers.add(latin); this.preferred[latin] = this.preferred[latin] || si; }
      else this.loans.set(latin, si);
    }
    for (const w of data.sinhalaWords || []) {
      if (!this.sinhala.has(w.normalize("NFC"))) continue;
      const k = w[0];
      const list = this.siByFirst.get(k) || [];
      list.push(w);
      this.siByFirst.set(k, list);
    }
  }

  /** New settings (or learned data): cached answers are dropped. */
  configure(settings: Partial<SmartSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.settings.maxItems = Math.max(5, Math.min(7, Math.round(this.settings.maxItems || 7)));
    this.cache.clear();
  }
  invalidate(): void { this.cache.clear(); }
  get cacheSize(): number { return this.cache.size; }

  /** The token's language, with the previous tokens as context. */
  detect(token: string, mode: InputMode, prevTokens: string[], sentenceStart: boolean): LangDecision {
    const previous: TokenLang[] = [];
    prevTokens.slice(-3).forEach((t, i, all) => {
      previous.push(detectToken(t, mode, { english: this.english, sinhala: this.sinhala, personal: this.settings.personal ? this.personal : null,
        markers: this.markers, previous: previous.slice(), sentenceStart: i === 0 && all.length < 3 }).lang);
    });
    return detectToken(token, mode, { english: this.english, sinhala: this.sinhala, personal: this.settings.personal ? this.personal : null,
      markers: this.markers, previous, sentenceStart });
  }

  suggest(q: SmartQuery): SmartResult {
    const t0 = now();
    const before = (q.before || "").slice(-200);
    const key = q.mode + "|" + (q.manual ? 1 : 0) + "|" + before.slice(-60);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, ms: now() - t0 };
    const r = this.compute(before, q);
    r.ms = now() - t0;
    this.cache.set(key, r);
    return r;
  }

  private compute(before: string, q: SmartQuery): SmartResult {
    const none: SmartResult = { token: "", decision: null, items: [], ghost: "", phase: "none", ms: 0 };
    const atBoundary = !before || /\s$/.test(before);
    if (atBoundary) {
      if (!this.settings.nextWord || !q.manual) return none;
      const prev = words(before);
      return { ...none, phase: "next", items: this.predict(prev, q.mode) };
    }
    const m = /(\S+)$/.exec(before);
    if (!m) return none;
    const token = m[1].replace(/^[("'`[{]+/, "");
    if (!token) return none;
    const head = before.slice(0, before.length - token.length);
    const prevTokens = words(head);
    // the start of the input context may be a sentence start (R3 does not apply), but only a full stop,
    // question or exclamation mark before it makes the word take a capital
    const sentenceStart = /[.!?]\s+$/.test(head);
    const d = this.detect(token, q.mode, prevTokens, sentenceStart || /^\s*$/.test(head));
    const prev = prevTokens.length ? prevTokens[prevTokens.length - 1] : null;
    let items: SmartItem[] = [];
    let ghost = "";
    if (d.lang === "en" && this.settings.english && d.rule !== "R2") {
      items = this.englishItems(token, prev, head, sentenceStart);
      const top = items.find((i) => i.kind === "completion");
      if (top && top.text.toLowerCase().startsWith(token.toLowerCase())) ghost = top.text.slice(token.length);
      if (q.mode === "smart" && this.settings.mixed && this.settings.sinhala) {
        const alt: SmartItem[] = [];
        const loan = this.loans.get(token.toLowerCase());
        if (loan) alt.push({ text: loan, kind: "loan", lang: "si", score: 0, replace: token, source: "dictionary" });
        if (d.ambiguous) alt.push(...this.singlishItems(token, prev).slice(0, 2));
        // an English word with nothing to complete keeps its own spelling first, so Space never turns it into Sinhala
        if (alt.length && !items.length) items = [{ text: token, kind: "word", lang: "en", score: 0, replace: token, source: "rules" }];
        items = interleave(items, alt);
      }
    } else if (d.lang === "singlish" && this.settings.sinhala) {
      items = this.singlishItems(token, prev);
      if (q.mode === "smart" && this.settings.mixed && this.settings.english && d.ambiguous) {
        items = interleave(items, this.englishItems(token, prev, head, sentenceStart).slice(0, 2));
      }
    } else if (d.lang === "si" && this.settings.sinhala) {
      items = this.unicodeItems(token, prev);
    }
    const seen = new Set<string>();
    items = items.filter((i) => i.text && !(i.text === i.replace && i.kind !== "word") && !seen.has(i.text) && (seen.add(i.text), true));
    return { token, decision: d, items: items.slice(0, this.settings.maxItems), ghost, phase: items.length ? "word" : "none", ms: 0 };
  }

  private enBase(word: string): number {
    const r = this.english.rankOf(word);
    let s = r === undefined ? 0 : 10 - Math.min(8, Math.log10(r + 1) * 2);
    if (this.english.isBusiness(word)) s += 0.3;
    return s;
  }

  private boost(prev: string | null, word: string, bigrams: Bigrams): number {
    let b = 0;
    if (this.settings.personal) b += Math.min(this.personal.wordCount(word), 10) * 0.6;
    if (prev && this.settings.nextWord) {
      b += bigrams.strength(prev, word) * 1.5;
      if (this.settings.personal) b += Math.min(this.personal.pairCount(prev, word), 5) * 1.2;
    }
    return b;
  }

  englishItems(token: string, prev: string | null, head: string, sentenceStart: boolean): SmartItem[] {
    const lower = token.toLowerCase();
    const out: SmartItem[] = [];
    const caps = this.settings.grammar;
    const cased = (w: string): string => applyCase(w, token, caps && sentenceStart);
    const known = lower === "i" || this.english.has(lower) || (this.settings.personal && this.personal.data.custom.some((w) => w.toLowerCase() === lower));
    // capitalisation: "i" -> "I", "monday" -> "Monday", the first word of a sentence
    if (caps && known) {
      const fixed = cased(lower);
      if (fixed !== token) out.push({ text: fixed, kind: "case", lang: "en", score: 16, replace: token, source: "rules" });
    }
    if (this.settings.autocomplete && lower.length >= 2) {
      const pool = new Set(this.english.complete(lower, 40));
      if (this.settings.personal) {
        for (const w of this.personal.data.custom) if (w.toLowerCase().startsWith(lower) && w.length > lower.length) pool.add(w);
        for (const w of Object.keys(this.personal.data.words)) if (/^[A-Za-z]/.test(w) && w.toLowerCase().startsWith(lower) && w.length > lower.length) pool.add(w.toLowerCase());
      }
      for (const w of pool) {
        const custom = this.personal.data.custom.includes(w);
        out.push({ text: cased(w), kind: "completion", lang: "en", replace: token,
          score: (custom ? 9 : this.enBase(w)) + this.boost(prev, w, this.enBigrams), source: custom || this.personal.wordCount(w) ? "personal" : "dictionary" });
      }
    }
    // spelling: only for a word that is not known and is not the start of a known word
    if (this.settings.spelling && !known && lower.length >= 3 && !this.english.hasLonger(lower)) {
      for (const c of this.english.correct(lower, 3)) {
        out.push({ text: cased(c.text), kind: "correction", lang: "en", replace: token, source: "dictionary",
          score: c.distance === 0 ? 14 : 12 - c.distance * 2 + this.enBase(c.text) / 10 + this.boost(prev, c.text, this.enBigrams) });
      }
    }
    if (this.settings.grammar) out.push(...this.grammar(token, prev, head, out));
    return out.sort((a, b) => b.score - a.score);
  }

  /** Light grammar: "a" before a vowel sound, a repeated word, "could of". Only within `head` + token. */
  private grammar(token: string, prev: string | null, head: string, items: SmartItem[]): SmartItem[] {
    const out: SmartItem[] = [];
    if (!prev) return out;
    const lp = prev.toLowerCase();
    const tail = head.match(/(\S+)(\s+)$/);
    if (!tail) return out;
    const span = tail[1] + tail[2] + token;
    const best = items.find((i) => i.kind === "completion" || i.kind === "correction");
    const word = this.english.has(token) ? token : best ? best.text : "";
    if (word && /^an?$/i.test(prev)) {
      const vowel = /^[aeio]|^u(?!s|n[aeiou]|ni)|^hour|^honest/i.test(word) && !/^(?:one|once|eu|uni|use)/i.test(word);
      const want = vowel ? "an" : "a";
      if (lp !== want) out.push({ text: (prev[0] === prev[0].toUpperCase() ? want[0].toUpperCase() + want.slice(1) : want) + " " + word,
        kind: "grammar", lang: "en", score: 13, replace: span, source: "rules" });
    }
    if (lp === token.toLowerCase() && this.english.has(token) && token.length > 1) {
      out.push({ text: tail[1], kind: "grammar", lang: "en", score: 13, replace: span, source: "rules" });
    }
    if (token.toLowerCase() === "of" && /^(?:could|should|would|must|might)$/.test(lp)) {
      out.push({ text: tail[1] + " have", kind: "grammar", lang: "en", score: 13, replace: span, source: "rules" });
    }
    return out;
  }

  singlishItems(latin: string, prev: string | null): SmartItem[] {
    if (!/^[A-Za-z]+$/.test(latin)) return [];
    const list = candidates(latin, { lexicon: this.sinhala, learner: this.settings.personal ? this.learner : null, preferred: this.preferred,
      words: 5, completions: this.settings.autocomplete ? 6 : 0 });
    if (!list.length) return [];
    const [first, ...rest] = list;
    const score = (c: Candidate): number => c.score + (c.known ? 0 : -4) + this.boost(prev, c.text, this.siBigrams);
    rest.sort((a, b) => score(b) - score(a));
    const items = [first, ...rest].map((c, i): SmartItem => ({ text: c.text, kind: c.kind === "completion" ? "completion" : "word", lang: "si",
      score: i === 0 ? 30 + c.score : score(c), replace: latin, source: c.learned ? "personal" : c.known ? "dictionary" : "rules" }));
    // a word the previous word predicts strongly (bigram) moves just below the first
    items.sort((a, b) => b.score - a.score);
    return items;
  }

  unicodeItems(token: string, prev: string | null): SmartItem[] {
    if (!SI_TOKEN.test(token)) return [];
    const out: SmartItem[] = [];
    const norm = normalize(token).text;
    if (norm !== token) out.push({ text: norm, kind: "correction", lang: "si", score: 20, replace: token, source: "rules" });
    if (this.settings.autocomplete) {
      const pool = new Set(this.sinhala.complete(norm, 20));
      if (this.settings.personal) for (const w of Object.keys(this.personal.data.words)) if (w.startsWith(norm) && w !== norm && SI_TOKEN.test(w)) pool.add(w);
      for (const w of pool) {
        const r = this.sinhala.rankOf(w);
        out.push({ text: w, kind: "completion", lang: "si", replace: token, source: r === undefined ? "personal" : "dictionary",
          score: (r === undefined ? 5 : 8 - Math.min(6.5, Math.log10(r + 1) * 1.25)) + this.boost(prev, w, this.siBigrams) });
      }
    }
    // spelling and alternative spellings: list words one edit away (ණ/න, ළ/ල, ශ/ෂ/ස ...)
    if (this.settings.spelling && !this.sinhala.has(norm) && !out.some((i) => i.kind === "completion") && Array.from(norm).length >= 3) {
      const near: [string, number][] = [];
      for (const w of this.siByFirst.get(norm[0]) || []) {
        if (Math.abs(w.length - norm.length) > 1) continue;
        if (distance(norm, w, 1) <= 1) near.push([w, this.sinhala.rankOf(w) ?? 1e6]);
      }
      near.sort((a, b) => a[1] - b[1]).slice(0, 3).forEach(([w], i) =>
        out.push({ text: w, kind: "correction", lang: "si", score: 10 - i, replace: token, source: "dictionary" }));
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Next-word predictions after `prev` words (the bundled pairs and the user's own). */
  predict(prevWords: string[], mode: InputMode): SmartItem[] {
    const prev = prevWords[prevWords.length - 1];
    if (!prev) return [];
    const out: SmartItem[] = [];
    const add = (w: string, score: number, source: SmartItem["source"]): void => {
      const lang = /[඀-෿]/.test(w) ? "si" : "en";
      if (lang === "si" ? !this.settings.sinhala : !this.settings.english) return;
      if (lang === "si" && mode === "english" && !/[඀-෿]/.test(prev)) return; // Sinhala off: English after English
      const at = out.findIndex((i) => i.text === w);
      if (at >= 0) { out[at].score += score; return; }
      out.push({ text: w, kind: "next", lang, score, replace: "", source });
    };
    this.enBigrams.after(prev).forEach((w, i) => add(w, 6 - i * 0.3, "dictionary"));
    this.siBigrams.after(prev).forEach((w, i) => add(w, 6 - i * 0.3, "dictionary"));
    if (this.settings.personal) {
      const mine = this.personal.data.pairs[prev.toLowerCase()] || {};
      Object.keys(mine).forEach((w) => add(w, 2 + Math.min(mine[w], 10), "personal"));
    }
    return out.sort((a, b) => b.score - a.score).slice(0, this.settings.maxItems);
  }

  /** Words from the local AI service merged into a result: after the first two, never above a fix. */
  merge(result: SmartResult, ai: { text: string; score?: number }[]): SmartResult {
    if (!result.items.length || !ai.length) return result;
    const lang = result.items[0].lang;
    const replace = result.phase === "next" ? "" : result.token;
    const extra = ai.filter((a) => a && typeof a.text === "string" && a.text && (lang === "si") === /[඀-෿]/.test(a.text) && !result.items.some((i) => i.text === a.text))
      .slice(0, 3).map((a): SmartItem => ({ text: a.text, kind: "ai", lang, score: 0, replace, source: "model" }));
    const items = result.items.slice(0, 2).concat(extra, result.items.slice(2)).slice(0, this.settings.maxItems);
    return { ...result, items };
  }

  /** The user wrote `item` (accepted it, or finished typing it): learn the word, the pair and the language. */
  learn(item: { text: string; lang: "en" | "si" }, token: string, prev: string | null): void {
    if (!this.settings.personal) return;
    this.personal.word(item.lang === "en" ? item.text.toLowerCase() : item.text, prev);
    if (/^[A-Za-z]+$/.test(token)) {
      this.personal.confirm(token, item.lang);
      if (item.lang === "si" && this.learner) this.learner.record(token, item.text);
    }
    this.cache.clear();
  }
}

/** Primary items with the other language's best at second place and the rest after the primary's top 4. */
function interleave(primary: SmartItem[], other: SmartItem[]): SmartItem[] {
  if (!other.length) return primary;
  return primary.slice(0, 1).concat(other.slice(0, 1), primary.slice(1, 4), other.slice(1), primary.slice(4));
}
