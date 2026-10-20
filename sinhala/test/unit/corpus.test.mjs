// The golden corpus: 100 % match both ways is required for release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import S from "../../core/dist/src/index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

test("every profile has a corpus", () => {
  assert.deepEqual(files.map((f) => f.replace(/\.json$/, "")).sort(), S.builtinProfiles.map((p) => p.id).sort());
});

for (const file of files) {
  const corpus = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const profile = S.getProfile(corpus.profile);
  for (const [set, lines] of Object.entries(corpus.sets)) {
    test(`${corpus.profile} corpus: ${set}`, () => {
      for (const [legacy, unicode] of lines) {
        const nonAscii = Array.from(legacy).filter((c) => c.charCodeAt(0) > 0x7e);
        const forward = S.toUnicode(legacy, profile);
        assert.equal(forward.text, unicode, legacy);
        assert.deepEqual(forward.unmapped.map((u) => u.text), nonAscii, `unmapped in ${legacy}`);
        assert.equal(S.toLegacy(unicode, profile).text, legacy, `back: ${unicode}`);
        assert.deepEqual(S.validate(forward.text), [], `valid: ${unicode}`);
      }
    });
  }
  for (const doc of corpus.mixed ?? []) {
    test(`${corpus.profile} corpus: mixed runs, ${doc.title}`, () => {
      for (const run of doc.runs) {
        const p = S.profileForFont(run.font);
        const out = p ? S.toUnicode(run.text, p).text : run.text;
        assert.equal(out, run.expect, `${run.font}: ${run.text}`);
      }
    });
  }
}
