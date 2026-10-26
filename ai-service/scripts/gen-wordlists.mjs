// Writes generated/words.json: the word lists /v1/text/complete and /v1/text/check rank and spell with.
// - si: Sinhala Tools' merged list (sinhala/wordlist, sha256-checked by sinhala/scripts/wordlist.mjs)
// - en: SCOWL (wordlist-english, MIT), frequency tiers 10..50 of English, American and British, commonest first
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordList } from "../../sinhala/scripts/wordlist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const base = dirname(require.resolve("wordlist-english/package.json"));
const en = [];
const seen = new Set();
for (const tier of [10, 20, 35, 40, 50]) {
  for (const dialect of ["english", "american", "british"]) {
    for (const w of JSON.parse(readFileSync(join(base, `${dialect}-words-${tier}.json`), "utf8"))) {
      if (!/^[A-Za-z][a-z']*$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      en.push(w);
    }
  }
}
const si = buildWordList();
mkdirSync(join(here, "..", "generated"), { recursive: true });
writeFileSync(join(here, "..", "generated", "words.json"), JSON.stringify({ en, si }));
console.log(`generated/words.json: ${en.length} English, ${si.length} Sinhala words`);
