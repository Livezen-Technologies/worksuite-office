// The word list for Sinhala input: wordlist/sources.json's lists merged, most frequent first.
// Each third-party file is checked against its pinned sha256 (null: WorkSuite's own, edited in place).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "wordlist");
const SINHALA = /^[඀-෿‍]+$/;
// a joiner belongs after an al-lakuna and before a letter; entries with a stray one are dropped
const STRAY_ZWJ = /(?<!\u0DCA)\u200D|\u200D$/;

/** Adds the zero-width joiner some sources leave out of rakaransaya and yansaya (්ර, ්ය). */
export function repairJoiners(word) {
  return word.replace(/්(?=[යර])/g, "්‍");
}

export function readSources() {
  return JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")).lists;
}

export function buildWordList() {
  const out = [];
  const seen = new Set();
  for (const list of readSources()) {
    const bytes = readFileSync(join(dir, list.file));
    if (list.sha256 && createHash("sha256").update(bytes).digest("hex") !== list.sha256) {
      throw new Error(`wordlist/${list.file}: sha256 does not match sources.json`);
    }
    let words = bytes.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      .map((w) => repairJoiners(w.normalize("NFC"))).filter((w) => SINHALA.test(w) && !STRAY_ZWJ.test(w));
    if (/^alphabetical/.test(list.order)) {
      words = words.map((w, i) => [w, i]).sort((a, b) => a[0].length - b[0].length || a[1] - b[1]).map((p) => p[0]);
    }
    for (const w of words) if (!seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}
