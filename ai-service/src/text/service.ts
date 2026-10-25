// /v1/text/* and /v1/translate: deterministic first (dictionaries, sinhala-core), the local LLM second.
import { candidates, validate as siValidate, normalize as siNormalize } from "@worksuite/sinhala-core";
import { ApiError, isAbort } from "../errors";
import type { Dictionaries } from "./dictionaries";
import type { ModelStore } from "../models";
import type { Runtime } from "../runtime";
import { Priority } from "../scheduler";
import { llamaChat } from "../engines/clients";
import { passesSiGrammar } from "../manifest";
import { detectSpans, dominant, Span } from "./detect";
import { wordDiff, Edit } from "./diff";
import { cleanRewrite, extractJson, LANG_NAME } from "./llm";
import type { Policy } from "../policy";
import type { Diagnostics } from "../diagnostics";

export interface Word { text: string; source: "dictionary" | "personal" | "org" | "model"; score: number }
export interface Issue { start: number; end: number; kind: "spelling" | "grammar" | "punctuation"; message: string; replacements: string[]; confidence: number }

const SI_LETTERS: string[] = [];
for (let c = 0x0d82; c <= 0x0df4; c++) if (!(c >= 0x0d97 && c <= 0x0d99) && c !== 0x0db2 && c !== 0x0dbc && !(c >= 0x0dbe && c <= 0x0dbf) && !(c >= 0x0dc7 && c <= 0x0dc9) && !(c >= 0x0dcb && c <= 0x0dce) && c !== 0x0dd5 && c !== 0x0dd7 && !(c >= 0x0de0 && c <= 0x0de5) && !(c >= 0x0df0 && c <= 0x0df1)) SI_LETTERS.push(String.fromCharCode(c));
const EN_LETTERS = "abcdefghijklmnopqrstuvwxyz'".split("");

function edits1(w: string, letters: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i); const b = w.slice(i);
    if (b) out.add(a + b.slice(1));
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
    for (const c of letters) { if (b) out.add(a + c + b.slice(1)); out.add(a + c + b); }
  }
  out.delete(w);
  return out;
}

const OPS = ["improve", "rewrite", "simplify", "formal", "professional", "expand", "shorten", "summarize", "explain", "tone"] as const;
export type Op = (typeof OPS)[number];
export const TRANSFORM_OPS = OPS;

const OP_PROMPT: Record<Op, string> = {
  improve: "Improve the text: fix grammar, spelling and punctuation, and make it clearer and more fluent. Keep its meaning, facts, names and numbers.",
  rewrite: "Rewrite the text in different words with the same meaning, facts, names and numbers.",
  simplify: "Rewrite the text in plain, simple language that is easy to read. Keep its meaning.",
  formal: "Rewrite the text in a formal register. Keep its meaning, facts, names and numbers.",
  professional: "Rewrite the text in a professional, business-appropriate tone. Keep its meaning, facts, names and numbers.",
  expand: "Expand the text with more detail and explanation, in the same style. Do not invent facts, names or numbers.",
  shorten: "Shorten the text, keeping its key points, facts, names and numbers.",
  summarize: "Summarize the text in a few sentences.",
  explain: "Explain what the text means in simple terms.",
  tone: "Rewrite the text in the requested tone. Keep its meaning, facts, names and numbers.",
};

export class TextService {
  constructor(private dict: Dictionaries, private models: ModelStore, private runtime: Runtime, private policy: () => Policy, private diag: Diagnostics,
    private env = process.env) {}

  private feature(f: "suggestions" | "correction" | "translate"): void {
    if (!this.policy().features[f]) throw new ApiError("forbidden_by_policy", `${f} is turned off by your organization`, { feature: f });
  }

  private cloud(allowCloud: unknown): void {
    if (allowCloud === true && !this.policy().cloudAllowed) throw new ApiError("forbidden_by_policy", "Cloud AI is turned off by your organization", { feature: "cloud" });
  }

  /** Sinhala grammar/rewrite capability (evaluation gate): the correction model passes it. */
  siGrammarAvailable(): boolean {
    const m = this.models.tryResolve("correction");
    return !!m && passesSiGrammar(m.manifest);
  }

  resolveLang(lang: string, text: string): string {
    if (lang && lang !== "auto" && lang !== "mixed") return lang;
    return dominant(detectSpans(text, this.dict));
  }

  // ---- complete ----------------------------------------------------------------------------------
  async complete(b: { text: string; caret: number; lang: string; mode: "word" | "phrase"; singlish?: boolean; max: number }, signal: AbortSignal) {
    this.feature("suggestions");
    const caret = Math.max(0, Math.min(b.caret, b.text.length));
    const before = b.text.slice(0, caret);
    const token = (/[\p{L}\p{M}‌‍']+$/u.exec(before) || [""])[0];
    const words: Word[] = [];
    const isLatin = /^[A-Za-z']+$/.test(token);
    const isSi = /[඀-෿]/.test(token);
    const lang = b.lang === "auto" || b.lang === "mixed" ? (isSi ? "si" : isLatin ? (b.singlish ? "si" : "en") : "und") : b.lang;
    if (token && isLatin && (b.singlish === true || (lang === "si" && b.singlish !== false))) {
      for (const c of candidates(token, { lexicon: this.dict.si, learner: this.dict.learner, words: b.max, completions: b.max })) {
        words.push({ text: c.text, source: this.dict.sourceOf(c.text), score: Math.round(c.score * 100) / 100 });
      }
    } else if (token && isSi) {
      const done = this.dict.si.complete(token, b.max);
      done.forEach((w, i) => words.push({ text: w, source: this.dict.sourceOf(w), score: Math.round((1 - i / (done.length + 1)) * 100) / 100 }));
    } else if (token && isLatin) {
      const extra = this.dict.extraLatin(token).slice(0, b.max);
      const upper = token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase();
      const base = this.dict.en.complete(token, b.max);
      const all = [...extra, ...base.filter((w) => !extra.includes(w))].slice(0, b.max);
      all.forEach((w, i) => {
        const text = upper ? w[0].toUpperCase() + w.slice(1) : w;
        const rank = this.dict.en.rank.get(w.toLowerCase());
        words.push({ text, source: this.dict.sourceOf(w), score: Math.round((rank === undefined ? 0.9 : 1 - rank / this.dict.en.rank.size) * 1000) / 1000 - i * 0.001 });
      });
    }
    const out: { words: Word[]; ghost?: { text: string; score: number } } = { words: words.slice(0, b.max) };
    if (b.mode === "phrase" && before.trim().length >= 3) {
      const ghost = await this.ghost(before, signal);
      if (ghost) out.ghost = ghost;
    }
    return out;
  }

  /** Model ghost text: only from a model already in memory (loading one never blocks typing), tight timeout. */
  private async ghost(before: string, signal: AbortSignal): Promise<{ text: string; score: number } | null> {
    const m = this.models.tryResolve("suggestions");
    if (!m) return null;
    if (!this.runtime.pool.isLoaded(m.manifest.id)) {
      this.runtime.activate(m.manifest.id).catch(() => undefined);
      return null;
    }
    const timeoutMs = Number(this.env.WS_AI_GHOST_TIMEOUT_MS) || 400;
    try {
      const text = await this.runtime.withModel("suggestions", m.manifest.id, Priority.Interactive, (l) => llamaChat(l.baseUrl, [
        { role: "system", content: "You continue the user's text with the next few words (at most 8). Reply with the continuation only, no quotes, no explanation." },
        { role: "user", content: before.slice(-1500) },
      ], { max_tokens: 16, temperature: 0.2, stop: ["\n"], signal, timeoutMs }), signal, m);
      const t = text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "");
      if (!t.trim()) return null;
      const lead = /\s$/.test(before) ? t.trimStart() : (/^[\s,.;:!?]/.test(t) ? t : " " + t.trimStart());
      return { text: lead, score: 0.5 };
    } catch (e) {
      if (signal.aborted) throw new ApiError("cancelled", "The request was cancelled");
      if (!isAbort(e)) this.diag.record("/v1/text/complete#ghost", 0, 0, "ghost_failed");
      return null;
    }
  }

  // ---- check ----------------------------------------------------------------------------------------
  spelling(text: string, lang: string): Issue[] {
    const issues: Issue[] = [];
    const re = /[\p{L}\p{M}‌‍']+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const w = m[0].replace(/^'+|'+$/g, "");
      if (!w || w.length < 2 || /\d/.test(w)) continue;
      const si = /[඀-෿]/.test(w);
      if (lang === "en" && si) continue;
      if (lang === "si" && !si) continue;
      if (!si && !/^[A-Za-z']+$/.test(w)) continue;
      if (!si && /^[A-Z]{2,}$/.test(w)) continue; // acronyms
      const start = m.index + m[0].indexOf(w);
      if (this.dict.known(w) || (!si && this.dict.known(w.toLowerCase()))) continue;
      if (!si && /^[A-Z]/.test(w) && start > 0 && !/[.!?]\s*$/.test(text.slice(0, start))) continue; // names mid-sentence
      issues.push({ start, end: start + w.length, kind: "spelling", message: si ? "Not in the Sinhala dictionary" : "Possible spelling mistake", replacements: this.suggest(w, si), confidence: si ? 0.4 : 0.7 });
    }
    if (lang !== "en") {
      for (const i of siValidate(text)) {
        if (i.code === "not-nfc") continue;
        const span = text.slice(i.offset, i.offset + i.length);
        issues.push({ start: i.offset, end: i.offset + i.length, kind: "spelling", message: SI_ISSUE_MESSAGE[i.code] || i.code, replacements: i.fixable ? [siNormalize(span).text] : [], confidence: 0.9 });
      }
    }
    return issues.sort((a, b) => a.start - b.start);
  }

  suggest(word: string, si: boolean): string[] {
    const lower = si ? word : word.toLowerCase();
    const known = (w: string) => this.dict.known(w);
    const rank = (w: string) => (si ? this.dict.si.rankOf(w) ?? 1e9 : this.dict.en.rank.get(w) ?? 1e9);
    let c = [...edits1(lower, si ? SI_LETTERS : EN_LETTERS)].filter(known);
    if (!c.length && !si && lower.length <= 12) {
      const set = new Set<string>();
      for (const e of edits1(lower, EN_LETTERS)) for (const e2 of edits1(e, EN_LETTERS)) if (known(e2)) set.add(e2);
      c = [...set];
    }
    // a swapped pair of letters is the commonest typo: those first, then by frequency
    const swapped = (w: string) => w.length === lower.length && [...w].sort().join("") === [...lower].sort().join("") ? 0 : 1;
    c.sort((a, b) => swapped(a) - swapped(b) || rank(a) - rank(b));
    const cap = !si && /^[A-Z]/.test(word);
    return c.slice(0, 5).map((w) => (cap ? w[0].toUpperCase() + w.slice(1) : w));
  }

  async check(b: { text: string; lang: string; kinds: string[] }, signal: AbortSignal) {
    this.feature("correction");
    const lang = this.resolveLang(b.lang, b.text);
    const kinds = new Set(b.kinds.length ? b.kinds : ["spelling", "grammar", "punctuation"]);
    const issues: Issue[] = kinds.has("spelling") ? this.spelling(b.text, lang) : [];
    const skipped: { kind: string; reason: string }[] = [];
    const modelKinds = ["grammar", "punctuation"].filter((k) => kinds.has(k));
    if (modelKinds.length && b.text.trim()) {
      const m = this.models.tryResolve("correction");
      if (!m) modelKinds.forEach((k) => skipped.push({ kind: k, reason: "model_not_installed" }));
      else if (lang === "si" && !passesSiGrammar(m.manifest)) modelKinds.forEach((k) => skipped.push({ kind: k, reason: "capability_unavailable" }));
      else {
        try {
          const found = await this.modelIssues(b.text, lang, modelKinds, signal);
          if (found === null) modelKinds.forEach((k) => skipped.push({ kind: k, reason: "model_output_invalid" }));
          else issues.push(...found);
        } catch (e) {
          if (signal.aborted) throw e;
          const code = e instanceof ApiError ? e.code : "internal";
          modelKinds.forEach((k) => skipped.push({ kind: k, reason: code }));
        }
      }
    }
    if (!kinds.has("spelling") && skipped.length === modelKinds.length && modelKinds.length) {
      throw new ApiError(skipped[0].reason === "model_not_installed" ? "model_not_installed" : "capability_unavailable", "No checker is available for these kinds", { skipped });
    }
    issues.sort((a, b2) => a.start - b2.start);
    return skipped.length ? { lang, issues, skipped } : { lang, issues };
  }

  /** The model's grammar/punctuation edits, validated against the input; null when its output is malformed. */
  async modelIssues(text: string, lang: string, kinds: string[], signal: AbortSignal): Promise<Issue[] | null> {
    const reply = await this.runtime.withModel("correction", null, Priority.Interactive, (l) => llamaChat(l.baseUrl, [
      { role: "system", content: `You are a careful proofreader for ${LANG_NAME[lang] || "the user's language"}. Find ${kinds.join(" and ")} errors only. ` +
        'Reply with JSON only, exactly: {"edits":[{"start":<UTF-16 offset>,"end":<offset>,"original":"<the exact text from start to end>","replacement":"<corrected text>","kind":"' + kinds.join('"|"') + '","message":"<short reason>"}]}. ' +
        "Never change meaning, names, numbers, word choice or spelling. Use an empty list when the text is correct." },
      { role: "user", content: text },
    ], { json: true, temperature: 0, max_tokens: 1024, signal }), signal);
    return validateModelEdits(text, reply, kinds, this.diag);
  }

  // ---- transform -------------------------------------------------------------------------------------
  async transform(b: { text: string; lang: string; op: Op; tone?: string; targetLength?: number; context?: string; allowCloud?: unknown; model?: string }, signal: AbortSignal) {
    this.feature("correction");
    this.cloud(b.allowCloud);
    const lang = this.resolveLang(b.lang, b.text);
    const m = this.models.resolve("correction", b.model);
    if (lang === "si" && !passesSiGrammar(m.manifest)) throw new ApiError("capability_unavailable", "Sinhala rewriting is not available yet", { capability: "text.grammar.si" });
    if (!b.text.trim()) return b.op === "summarize" || b.op === "explain" ? { result: "", model: m.manifest.id, allowCloud: false } : { result: b.text, edits: [], model: m.manifest.id, allowCloud: false };
    let instr = OP_PROMPT[b.op];
    if (b.op === "tone" || b.tone) instr += ` Tone: ${b.tone || "neutral"}.`;
    if (b.targetLength) instr += ` Aim for about ${b.targetLength} words.`;
    const sys = `${instr} Write in ${LANG_NAME[lang] || "the same language as the text"}. Keep paragraph breaks. Reply with the resulting text only, no preamble, no quotes.`;
    const user = b.context ? `Context (for reference only, do not rewrite it):\n${b.context.slice(0, 4000)}\n\nText:\n${b.text}` : b.text;
    const reply = await this.runtime.withModel("correction", m.manifest.id, Priority.Interactive, (l) => llamaChat(l.baseUrl, [
      { role: "system", content: sys }, { role: "user", content: user },
    ], { temperature: b.op === "rewrite" ? 0.7 : 0.3, max_tokens: Math.min(4096, Math.max(256, Math.ceil(b.text.length / 2) * (b.op === "expand" ? 3 : 1.5))), signal }), signal, m);
    const result = b.op === "summarize" || b.op === "explain" ? reply.trim() : cleanRewrite(reply, b.text);
    if (!result.trim()) throw new ApiError("internal", "The model returned nothing");
    if (b.op === "summarize" || b.op === "explain") return { result, model: m.manifest.id, allowCloud: false };
    const edits: Edit[] = wordDiff(b.text, result, b.op);
    return { result, edits, model: m.manifest.id, allowCloud: false };
  }

  // ---- detect / translate -----------------------------------------------------------------------------
  async detect(text: string, signal: AbortSignal): Promise<{ spans: Span[] }> {
    const spans = detectSpans(text, this.dict);
    const unknown = spans.filter((s) => s.lang === "und" && s.end - s.start >= 12);
    if (unknown.length) {
      const m = this.models.tryResolve("translation") || this.models.tryResolve("correction");
      if (m && this.runtime.pool.isLoaded(m.manifest.id)) {
        for (const s of unknown) {
          try {
            const r = await this.runtime.withModel(m.manifest.tasks.includes("translation") ? "translation" : "correction", m.manifest.id, Priority.Interactive, (l) => llamaChat(l.baseUrl, [
              { role: "system", content: 'Identify the language of the text. Romanised Sinhala counts as "si". Reply with JSON only: {"lang":"<ISO 639-1 code>","confidence":<0..1>}' },
              { role: "user", content: text.slice(s.start, s.end).slice(0, 2000) },
            ], { json: true, temperature: 0, max_tokens: 30, signal, timeoutMs: 3000 }), signal, m);
            const j = extractJson(r) as { lang?: string; confidence?: number };
            if (j && typeof j.lang === "string" && /^[a-z]{2,3}$/.test(j.lang)) { s.lang = j.lang; s.confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0.6)); }
          } catch (e) { if (signal.aborted) throw e; }
        }
      }
    }
    return { spans };
  }

  async translate(b: { text: string; from: string; to: string; preserveFormatting: boolean; allowCloud?: unknown; model?: string }, signal: AbortSignal) {
    this.feature("translate");
    this.cloud(b.allowCloud);
    const from = b.from === "auto" ? this.resolveLang("auto", b.text) : b.from;
    const m = this.models.resolve("translation", b.model);
    if (from === b.to || !b.text.trim()) return { text: b.text, from, model: m.manifest.id };
    const fmt = b.preserveFormatting ? " Keep the formatting exactly: line breaks, lists, Markdown, numbers, placeholders like {0} and URLs." : "";
    const reply = await this.runtime.withModel("translation", m.manifest.id, Priority.Interactive, (l) => llamaChat(l.baseUrl, [
      { role: "system", content: `Translate the user's text from ${LANG_NAME[from] || from} to ${LANG_NAME[b.to] || b.to}.${fmt} Reply with the translation only.` },
      { role: "user", content: b.text },
    ], { temperature: 0.1, max_tokens: Math.min(4096, b.text.length * 2 + 64), signal }), signal, m);
    return { text: cleanRewrite(reply, b.text), from, model: m.manifest.id };
  }
}

const SI_ISSUE_MESSAGE: Record<string, string> = {
  "sign-without-base": "A vowel sign with no letter to sit on",
  "kombuva-before-consonant": "Kombuva typed before the consonant (legacy order)",
  "double-vowel-sign": "Two vowel signs on one letter",
  "zwj-order": "Joiner before al-lakuna (yansaya/rakaransaya in the wrong order)",
  "stray-zwj": "A zero-width joiner that joins nothing",
  "stray-zwnj": "A zero-width non-joiner that separates nothing",
};

/**
 * Checks a model's JSON edits against the input: integer offsets inside the text, `original` equal to the
 * text at those offsets (or, when the offsets are off, found exactly once nearby), a real change, an
 * allowed kind. Returns null when the output is not the JSON asked for at all.
 */
export function validateModelEdits(text: string, reply: string, kinds: string[], diag?: Diagnostics): Issue[] | null {
  let parsed: unknown;
  try { parsed = extractJson(reply); } catch { diag?.record("model_output", 0, 0, "model_output_invalid"); return null; }
  const edits = (parsed as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) { diag?.record("model_output", 0, 0, "model_output_invalid"); return null; }
  const out: Issue[] = [];
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const original = typeof e.original === "string" ? e.original : null;
    const replacement = typeof e.replacement === "string" ? e.replacement : null;
    const kind = typeof e.kind === "string" && kinds.includes(e.kind) ? (e.kind as Issue["kind"]) : null;
    if (original === null || replacement === null || !kind || original === replacement) continue;
    let start = Number.isInteger(e.start) ? (e.start as number) : -1;
    let end = Number.isInteger(e.end) ? (e.end as number) : -1;
    const ok = start >= 0 && end >= start && end <= text.length && text.slice(start, end) === original;
    if (!ok) {
      if (!original) continue;
      const first = text.indexOf(original);
      if (first < 0 || text.indexOf(original, first + 1) >= 0) continue; // absent or ambiguous: rejected
      start = first; end = first + original.length;
    }
    if (out.some((o) => start < o.end && end > o.start)) continue; // overlapping edits: keep the first
    out.push({ start, end, kind, message: typeof e.message === "string" ? e.message.slice(0, 200) : kind, replacements: [replacement], confidence: 0.6 });
  }
  return out;
}
