// Sinhala script facts the engine relies on (Unicode 15, block U+0D80–U+0DFF).

export const ZWJ = "‍";
export const ZWNJ = "‌";
export const AL_LAKUNA = "්"; // ් hal kirima
export const KOMBUVA = "ෙ"; // ෙ
export const KOMBU_DEKA = "ෛ"; // ෛ

export function isSinhala(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0x0d80 && c <= 0x0dff;
}

/** Consonants ක (U+0D9A) to ෆ (U+0DC6). */
export function isConsonant(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0x0d9a && c <= 0x0dc6;
}

/** Independent vowels අ (U+0D85) to ඖ (U+0D96). */
export function isIndependentVowel(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0x0d85 && c <= 0x0d96;
}

/** Dependent vowel signs, al-lakuna, anusvara and visarga: marks that need a base. */
export function isSign(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x0d81 && c <= 0x0d83) || c === 0x0dca || (c >= 0x0dcf && c <= 0x0ddf) || c === 0x0df2 || c === 0x0df3;
}

/** Dependent vowel signs only (not al-lakuna, anusvara or visarga). */
export function isVowelSign(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x0dcf && c <= 0x0ddf) || c === 0x0df2 || c === 0x0df3;
}
