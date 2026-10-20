import { AL_LAKUNA, KOMBUVA, KOMBU_DEKA, ZWJ, ZWNJ, isConsonant, isIndependentVowel, isSign, isSinhala, isVowelSign } from "./script";

export type IssueCode =
  | "not-nfc"
  | "sign-without-base"
  | "kombuva-before-consonant"
  | "double-vowel-sign"
  | "zwj-order"
  | "stray-zwj"
  | "stray-zwnj";

export interface Issue {
  offset: number;
  length: number;
  code: IssueCode;
  /** fixed by normalize() */
  fixable: boolean;
}

/**
 * Unicode Sinhala as it should be stored: NFC; ේ + ා written as ෝ; yansaya and rakaransaya as
 * al-lakuna + ZWJ + ය/ර (not ZWJ + al-lakuna, which is the touching-letter order); no repeated joiners;
 * no joiner that is not next to an al-lakuna. Everything else is left as it is.
 */
export function normalize(input: string): { text: string; changed: boolean } {
  let text = input.normalize("NFC");
  // vowel-sign order: kombuva + al-lakuna, then aela-pilla, is ෝ
  text = text.split("ේා").join("ෝ");
  text = text.replace(/‍්([යර])/g, "්‍$1");
  text = text.replace(/‍{2,}/g, ZWJ).replace(/‌{2,}/g, ZWNJ);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === ZWJ || ch === ZWNJ) && text[i - 1] !== AL_LAKUNA && text[i + 1] !== AL_LAKUNA) continue;
    out += ch;
  }
  text = out.normalize("NFC");
  return { text, changed: text !== input };
}

/** Problems in Unicode Sinhala text: broken conjuncts, stray joiners, vowel signs in legacy order. */
export function validate(text: string): Issue[] {
  const issues: Issue[] = [];
  if (text.normalize("NFC") !== text) issues.push({ offset: 0, length: text.length, code: "not-nfc", fixable: true });
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (ch === ZWJ || ch === ZWNJ) {
      if (prev !== AL_LAKUNA && next !== AL_LAKUNA) {
        issues.push({ offset: i, length: 1, code: ch === ZWJ ? "stray-zwj" : "stray-zwnj", fixable: true });
      } else if (ch === ZWJ && next === AL_LAKUNA && (text[i + 2] === "ය" || text[i + 2] === "ර")) {
        issues.push({ offset: i, length: 2, code: "zwj-order", fixable: true });
      }
      continue;
    }
    if (!isSinhala(ch) || !isSign(ch)) continue;
    const base = prev === ZWJ || prev === ZWNJ ? (i > 1 ? text[i - 2] : "") : prev;
    if (ch === KOMBUVA || ch === KOMBU_DEKA) {
      // kombuva with nothing to sit on and a consonant after it: text typed or converted in legacy order
      if (!isConsonant(base) && !isSign(base) && isConsonant(next)) {
        issues.push({ offset: i, length: 2, code: "kombuva-before-consonant", fixable: false });
        continue;
      }
    }
    if (!base || !(isConsonant(base) || isIndependentVowel(base) || isSign(base))) {
      issues.push({ offset: i, length: 1, code: "sign-without-base", fixable: false });
      continue;
    }
    if (isVowelSign(ch) && isVowelSign(base) && !(base === "ේ" && ch === "ා")) {
      issues.push({ offset: i, length: 1, code: "double-vowel-sign", fixable: false });
    } else if (isVowelSign(ch) && isVowelSign(base)) {
      issues.push({ offset: i - 1, length: 2, code: "double-vowel-sign", fixable: true });
    }
  }
  return issues;
}
