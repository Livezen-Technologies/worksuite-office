// Every map entry, both ways, in every profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../../core/dist/src/index.js";

for (const profile of S.builtinProfiles) {
  test(`${profile.id}: every map entry converts both ways`, () => {
    // the profile's own spelling of ක (FM, DL and Kaputa "l", Thara and Kandy "k")
    const ka = profile.map.find(([, u]) => u === "ක")[0];
    for (const [legacy, unicode] of profile.map) {
      const head = unicode.codePointAt(0);
      const standalone = S.isConsonant(unicode[0]) || (head >= 0x0d85 && head <= 0x0d96);
      let l, u;
      if (standalone) [l, u] = [legacy, unicode];
      else if (profile.prebase.includes(unicode)) [l, u] = [legacy + ka, "ක" + unicode];
      else [l, u] = [ka + legacy, "ක" + unicode];
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
