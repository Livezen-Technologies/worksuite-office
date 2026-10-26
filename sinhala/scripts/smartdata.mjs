// The Smart Typing data: wordlist/smart/sources.json's files, each checked against its pinned sha256,
// plus SCOWL (wordlist/english/scowl-20.txt) and the Sinhala word list (wordlist.mjs), as the
// SmartData object @worksuite/sinhala-core's SmartEngine takes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "wordlist");

export function readSmartSources() {
  return JSON.parse(readFileSync(join(dir, "smart", "sources.json"), "utf8")).lists;
}

function read(file, sha256) {
  const bytes = readFileSync(join(dir, "smart", file));
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`wordlist/smart/${file}: sha256 does not match sources.json`);
  return bytes.toString("utf8").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l && !l.startsWith("#"));
}

/** Everything but the word lists the plugin already ships (SCOWL, the Sinhala list). */
export function buildSmartData() {
  const by = Object.fromEntries(readSmartSources().map((l) => [l.file, read(l.file, l.sha256)]));
  const split = (lines, n) => lines.map((l) => l.split("\t").map((x) => x.trim())).filter((p) => p.length >= n && p.slice(0, n).every(Boolean)).map((p) => p.slice(0, n));
  return {
    englishFrequent: by["en-frequent.txt"],
    englishBusiness: by["en-business.txt"],
    misspellings: split(by["en-misspellings.txt"], 2),
    englishBigrams: split(by["en-bigrams.txt"], 2),
    sinhalaBigrams: split(by["si-bigrams.txt"], 2).map(([a, b]) => [a.normalize("NFC"), b.normalize("NFC")]),
    mixed: split(by["mixed.txt"], 3).map(([a, b, c]) => [a, b.normalize("NFC"), c])
  };
}
