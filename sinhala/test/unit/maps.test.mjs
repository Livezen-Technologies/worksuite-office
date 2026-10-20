// Every map entry, both ways, in every profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

for (const profile of S.builtinProfiles) {
  test(`${profile.id}: every map entry converts both ways`, () => {
    for (const [legacy, unicode] of profile.map) {
      const head = unicode.codePointAt(0);
      const standalone = S.isConsonant(unicode[0]) || (head >= 0x0d85 && head <= 0x0d96);
      let l, u;
      if (standalone) [l, u] = [legacy, unicode];
      else if (profile.prebase.includes(unicode)) [l, u] = [legacy + "l", "ක" + unicode];
      else [l, u] = ["l" + legacy, "ක" + unicode];
      const forward = S.toUnicode(l, profile);
      assert.equal(forward.text, u.normalize("NFC"), `${JSON.stringify(legacy)} to Unicode`);
      assert.deepEqual(forward.unmapped, []);
      const back = S.toLegacy(forward.text, profile);
      assert.equal(back.text, l, `${JSON.stringify(unicode)} back to ${profile.id}`);
      assert.deepEqual(back.unmapped, []);
    }
  });

  test(`${profile.id}: every composed vowel converts both ways`, () => {
    for (const [seq, composed] of profile.compose) {
      const legacy = S.toLegacy(composed, profile);
      assert.deepEqual(legacy.unmapped, []);
      assert.equal(S.toUnicode(legacy.text, profile).text, composed, `${seq} = ${composed}`);
    }
  });
}
