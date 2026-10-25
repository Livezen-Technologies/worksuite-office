// Sinhala -> Singlish (the romanisation Sinhala Tools' input reads back): consonants carry an inherent
// "a" unless followed by a vowel sign or al-lakuna. Round-trips the common words through transliterate().
const CONS: Record<string, string> = {
  "ක": "k", "ඛ": "kh", "ග": "g", "ඝ": "gh", "ඞ": "ng", "ඟ": "nng", "ච": "ch", "ඡ": "chh", "ජ": "j", "ඣ": "jh", "ඤ": "ny", "ඥ": "gn", "ඦ": "nj",
  "ට": "t", "ඨ": "T", "ඩ": "d", "ඪ": "D", "ණ": "N", "ඬ": "nd", "ත": "th", "ථ": "Th", "ද": "dh", "ධ": "Dh", "න": "n", "ඳ": "ndh",
  "ප": "p", "ඵ": "ph", "බ": "b", "භ": "bh", "ම": "m", "ඹ": "mb", "ය": "y", "ර": "r", "ල": "l", "ව": "w", "ශ": "sh", "ෂ": "Sh",
  "ස": "s", "හ": "h", "ළ": "L", "ෆ": "f",
};
const IND: Record<string, string> = {
  "අ": "a", "ආ": "aa", "ඇ": "ae", "ඈ": "aee", "ඉ": "i", "ඊ": "ii", "උ": "u", "ඌ": "uu", "ඍ": "ru", "ඎ": "ruu",
  "එ": "e", "ඒ": "ee", "ඓ": "ai", "ඔ": "o", "ඕ": "oo", "ඖ": "au",
};
const SIGN: Record<string, string> = {
  "ා": "aa", "ැ": "ae", "ෑ": "aee", "ි": "i", "ී": "ii", "ු": "u", "ූ": "uu", "ෘ": "ru", "ෲ": "ruu",
  "ෙ": "e", "ේ": "ee", "ෛ": "ai", "ො": "o", "ෝ": "oo", "ෞ": "au", "ෟ": "lu",
};
const AL = "්";

export function toSinglish(text: string): string {
  const s = text.normalize("NFC");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (CONS[ch]) {
      out += CONS[ch];
      const next = s[i + 1];
      if (next === AL) { i++; if (s[i + 1] === "‍") i++; continue; }
      if (next && SIGN[next]) { out += SIGN[next]; i++; continue; }
      out += "a";
      continue;
    }
    if (IND[ch]) { out += IND[ch]; continue; }
    if (ch === "ං") { out += "n"; continue; }
    if (ch === "ඃ") { out += "h"; continue; }
    if (ch === "‍" || ch === "‌") continue;
    out += ch;
  }
  return out;
}
