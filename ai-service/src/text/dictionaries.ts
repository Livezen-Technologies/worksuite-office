// Word lists: built-in English (SCOWL) and Sinhala (Sinhala Tools' list), the person's own words, and
// the organisation's dictionary (policy.orgDictionaryUrl: one word per line, or {version, words:[]}).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Learner, Lexicon, VERSION as SINHALA_CORE_VERSION } from "@worksuite/sinhala-core";
import words from "../../generated/words.json";
import type { Fetcher } from "../catalog";

const SINHALA_WORD = /^[඀-෿‍]+$/;

export class EnglishList {
  readonly rank = new Map<string, number>();
  readonly sorted: string[];
  constructor(list: readonly string[]) {
    for (const w of list) if (!this.rank.has(w.toLowerCase())) this.rank.set(w.toLowerCase(), this.rank.size);
    this.sorted = [...this.rank.keys()].sort();
  }
  has(w: string): boolean { return this.rank.has(w.toLowerCase()); }
  complete(prefix: string, limit = 10): string[] {
    const p = prefix.toLowerCase();
    if (!p) return [];
    let lo = 0; let hi = this.sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.sorted[mid] < p) lo = mid + 1; else hi = mid; }
    const out: string[] = [];
    for (let i = lo; i < this.sorted.length && this.sorted[i].startsWith(p); i++) {
      if (this.sorted[i] !== p) out.push(this.sorted[i]);
      if (out.length > 3000) break;
    }
    return out.sort((a, b) => this.rank.get(a)! - this.rank.get(b)!).slice(0, limit);
  }
}

interface PersonalFile { version: 1; words: string[]; learned: unknown; updatedAt: string | null }
interface OrgFile { url: string; version: string; words: string[]; fetchedAt: string }

export class Dictionaries {
  readonly en = new EnglishList((words as { en: string[] }).en);
  private siBase: string[] = (words as { si: string[] }).si;
  si: Lexicon;
  personal: PersonalFile;
  learner: Learner;
  org: OrgFile | null = null;
  private personalSet = new Set<string>();
  private orgSet = new Set<string>();

  constructor(private dir: string, private fetcher: Fetcher = fetch) {
    this.personal = { version: 1, words: [], learned: null, updatedAt: null };
    try {
      if (existsSync(this.personalFile)) this.personal = { ...this.personal, ...JSON.parse(readFileSync(this.personalFile, "utf8")) };
    } catch { /* replaced on save */ }
    try {
      if (existsSync(this.orgFile)) this.org = JSON.parse(readFileSync(this.orgFile, "utf8"));
    } catch { this.org = null; }
    this.learner = new Learner(this.personal.learned);
    this.si = this.rebuild();
  }

  private get personalFile() { return join(this.dir, "personal.json"); }
  private get orgFile() { return join(this.dir, "organization.json"); }

  private rebuild(): Lexicon {
    this.personalSet = new Set(this.personal.words);
    this.orgSet = new Set(this.org?.words || []);
    // personal and organisation words rank first in completion
    this.si = new Lexicon([...this.personal.words.filter((w) => SINHALA_WORD.test(w)), ...(this.org?.words || []).filter((w) => SINHALA_WORD.test(w)), ...this.siBase]);
    return this.si;
  }

  sourceOf(word: string): "personal" | "org" | "dictionary" {
    if (this.personalSet.has(word)) return "personal";
    if (this.orgSet.has(word)) return "org";
    return "dictionary";
  }
  /** spelled correctly by any list */
  known(word: string): boolean {
    return this.personalSet.has(word) || this.orgSet.has(word) || this.personalSet.has(word.toLowerCase()) || this.orgSet.has(word.toLowerCase()) ||
      (SINHALA_WORD.test(word) ? this.si.has(word) : this.en.has(word));
  }
  extraLatin(prefix: string): string[] {
    const p = prefix.toLowerCase();
    return [...this.personal.words, ...(this.org?.words || [])].filter((w) => /^[A-Za-z]/.test(w) && w.toLowerCase().startsWith(p) && w.toLowerCase() !== p);
  }

  private savePersonal(): void {
    mkdirSync(this.dir, { recursive: true });
    this.personal.learned = this.learner.data;
    this.personal.updatedAt = new Date().toISOString();
    writeFileSync(this.personalFile + ".tmp", JSON.stringify(this.personal), { mode: 0o600 });
    renameSync(this.personalFile + ".tmp", this.personalFile);
  }

  addPersonal(list: string[]): string[] {
    const added: string[] = [];
    for (const raw of list) {
      const w = String(raw).normalize("NFC").trim();
      if (!w || w.length > 64 || /\s/.test(w) || this.personalSet.has(w)) continue;
      this.personal.words.push(w);
      this.personalSet.add(w);
      added.push(w);
    }
    if (added.length) { this.savePersonal(); this.rebuild(); }
    return added;
  }
  removePersonal(list: string[]): string[] {
    const del = new Set(list.map((w) => String(w).normalize("NFC").trim()));
    const removed = this.personal.words.filter((w) => del.has(w));
    if (removed.length) { this.personal.words = this.personal.words.filter((w) => !del.has(w)); this.savePersonal(); this.rebuild(); }
    return removed;
  }
  learn(latin: string, word: string): void { this.learner.record(latin, word); this.savePersonal(); }
  clearLearned(): void {
    this.personal.words = [];
    this.learner.forget();
    this.savePersonal();
    rmSync(this.personalFile, { force: true });
    this.rebuild();
  }

  /** Pulls the organisation dictionary; keeps the cached copy when offline. */
  async refreshOrg(url: string | null): Promise<void> {
    if (!url) { if (this.org) { this.org = null; rmSync(this.orgFile, { force: true }); this.rebuild(); } return; }
    try {
      const res = await this.fetcher(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      let list: string[];
      let version: string;
      try {
        const j = JSON.parse(body) as { version?: string; words?: string[] };
        list = Array.isArray(j.words) ? j.words.map(String) : [];
        version = j.version || createHash("sha256").update(body).digest("hex").slice(0, 12);
      } catch {
        list = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
        version = createHash("sha256").update(body).digest("hex").slice(0, 12);
      }
      this.org = { url, version, words: list.map((w) => w.normalize("NFC")).slice(0, 200000), fetchedAt: new Date().toISOString() };
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.orgFile, JSON.stringify(this.org));
      this.rebuild();
    } catch {
      /* offline: keep what we have */
    }
  }

  /** GET /v1/dictionaries */
  summary() {
    return [
      { id: "personal", kind: "personal", name: "Personal dictionary", version: this.personal.updatedAt || "0", words: this.personal.words.length, updatedAt: this.personal.updatedAt },
      { id: "organization", kind: "organization", name: "Organization dictionary", version: this.org?.version || null, words: this.org?.words.length || 0, url: this.org?.url || null, updatedAt: this.org?.fetchedAt || null },
      { id: "builtin-si", kind: "builtin", lang: "si", name: "Sinhala (Sinhala Tools)", version: `sinhala-core ${SINHALA_CORE_VERSION}`, words: this.siBase.length },
      { id: "builtin-en", kind: "builtin", lang: "en", name: "English (SCOWL)", version: "wordlist-english 1.2.1", words: this.en.rank.size },
    ];
  }
}
