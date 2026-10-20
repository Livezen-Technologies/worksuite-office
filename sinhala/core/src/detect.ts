import { Profile, builtinProfiles, profileForFont } from "./profiles";
import { ZWJ, ZWNJ, isSinhala } from "./script";

export type SegmentKind = "unicode" | "legacy" | "latin";

export interface Segment {
  start: number;
  end: number;
  kind: SegmentKind;
}

export interface Detection {
  /** "mixed": Unicode Sinhala together with legacy text. */
  kind: "unicode" | "legacy" | "mixed" | "latin" | "empty";
  segments: Segment[];
  /** The guessed legacy profile (by font name first), or null when there is no legacy text. */
  profile: string | null;
  /** 0..1: 1 when the run's font names the profile. */
  confidence: number;
}

// Characters that are Sinhala letters in the Wijesekara-layout fonts but rarely sit inside an English word.
const LEGACY_MARKS = /[;:,.<>[{%|]/;
const ENGLISH = new Set(["the", "and", "of", "to", "in", "is", "for", "with", "on", "that", "this", "are", "was", "be",
  "by", "as", "at", "or", "from", "an", "it", "not", "we", "you", "your", "our", "will", "can", "have", "has"]);

function looksLegacy(word: string): number {
  const core = word.replace(/^[("'`]+|[)"'`!?]+$/g, "");
  if (!core) return 0;
  if (ENGLISH.has(core.toLowerCase())) return -2;
  let score = 0;
  // a Wijesekara letter inside the word ("isxy,", "m%Yakh"), not just punctuation after it
  if (LEGACY_MARKS.test(core.slice(0, -1))) score += 2;
  // a kombuva (f / ff) before a consonant key, then a vowel-sign key: "fmd", "ffo"
  if (/^f{1,2}[lL.>pPcC[{gGvVK;:oOkmMnNuUhr,jYIiy<F][adseEqQ]/.test(core)) score += 1;
  // lower-case words with upper-case letters inside ("wOHdmkh") are rare in English
  if (/^[a-z]+[A-Z]/.test(core)) score += 1;
  // yansaya (H) or rakaransaya (%) straight after a consonant key: "wOHdmkh", "m%Yakh"
  if (/[lL.>pPcC[{gGvVK;:oOkmMnNuUhr,jYIiy<F][H%]/.test(core)) score += 1;
  return score;
}

/**
 * Classifies a run of text: Unicode Sinhala, legacy-font text, or plain Latin. A run in a legacy font
 * (fontNames) is legacy wherever it is not Unicode; otherwise the words are scored.
 */
export function detect(text: string, options: { fontNames?: string[] | string | null; profiles?: Profile[] } = {}): Detection {
  const profiles = options.profiles ?? builtinProfiles;
  const fontProfile = profileForFont(options.fontNames ?? null, profiles);
  const segments: Segment[] = [];
  const push = (start: number, end: number, kind: SegmentKind): void => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && last.end === start) last.end = end;
    else segments.push({ start, end, kind });
  };

  let legacyWords = 0;
  let latinWords = 0;
  const re = /\s+|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    const start = m.index;
    const end = start + word.length;
    if (/^\s+$/.test(word)) {
      const last = segments[segments.length - 1];
      if (last) last.end = end;
      continue;
    }
    // split the word into Unicode Sinhala and the rest
    let i = 0;
    while (i < word.length) {
      const sin = isSinhala(word[i]) || word[i] === ZWJ || word[i] === ZWNJ;
      let j = i + 1;
      while (j < word.length && (isSinhala(word[j]) || word[j] === ZWJ || word[j] === ZWNJ) === sin) j++;
      if (sin) push(start + i, start + j, "unicode");
      else {
        const part = word.slice(i, j);
        if (/^[\d\p{P}\p{S}]+$/u.test(part) && !LEGACY_MARKS.test(part)) {
          // numbers and punctuation join whatever is around them
          const last = segments[segments.length - 1];
          if (last && last.end === start + i) last.end = start + j;
          else push(start + i, start + j, fontProfile ? "legacy" : "latin");
        } else if (fontProfile || looksLegacy(part) >= 2) {
          push(start + i, start + j, "legacy");
          legacyWords++;
        } else {
          push(start + i, start + j, "latin");
          latinWords++;
        }
      }
      i = j;
    }
  }

  const has = (k: SegmentKind): boolean => segments.some((s) => s.kind === k);
  let kind: Detection["kind"];
  if (segments.length === 0) kind = "empty";
  else if (has("legacy") && has("unicode")) kind = "mixed";
  else if (has("legacy")) kind = "legacy";
  else if (has("unicode")) kind = "unicode";
  else kind = "latin";

  let profile: string | null = null;
  let confidence = 0;
  if (fontProfile) {
    profile = fontProfile.id;
    confidence = 1;
  } else if (legacyWords > 0) {
    // the shared Wijesekara base cannot tell the fonts apart; % (rakaransaya) is FM's
    profile = (profiles.find((p) => p.id === "fm-abhaya") ?? profiles[0]).id;
    confidence = Math.min(0.9, 0.3 + 0.6 * (legacyWords / (legacyWords + latinWords)));
    confidence = Math.round(confidence * 100) / 100;
  } else if (kind === "unicode") {
    confidence = 1;
  }
  return { kind, segments, profile, confidence };
}
