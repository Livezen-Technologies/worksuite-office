// Singlish (romanised Sinhala) to Sinhala Unicode: the phonetic rules behind Sinhala input.
//
// The scheme is the one most Sri Lankans type on phones and in Google Input Tools / Helakuru-style
// keyboards: consonants as they sound (k, g, ch, j, t, d, n, p, b, m, y, r, l, w/v, s, h, f), aspirates
// with an "h" or a capital (kh/K ඛ, th ත, Th ථ, dh ද (as in kohomadha), Dh ධ, bh/B භ ...), the inherent "a" left out after a
// consonant, long vowels doubled (aa ා, ii/ee ී, uu ූ, oo ෝ), ae/A ැ, aee/Aa ෑ, e ෙ, o ො, ai ෛ,
// au ෞ, R ෘ, x ං, H ඃ. A consonant with no vowel after it takes the al-lakuna (hal kirīma). "y" and "r"
// straight after a consonant join it as yansaya (්‍ය) and rakaransaya (්‍ර), with a zero-width joiner;
// repaya (ර්‍ + consonant) and the prenasalised letters (ඳ ඹ ඟ) are alternatives the candidate list
// offers. Nothing here touches the DOM or Node: the same code runs in the plugin and in tests.
//
// A romanisation is ambiguous ("t" is ට or ත, a final "a" may be long, "n" before a consonant may be
// ං): segment() splits the Latin into segments, each with its options in order of preference and a
// penalty, and variants() lists the renderings from the best (lowest total penalty) down.

import { AL_LAKUNA, ZWJ } from "./script";

export type VowelKey = "a" | "aa" | "ae" | "aee" | "i" | "ii" | "u" | "uu" | "e" | "ee" | "ai" | "o" | "oo" | "au" | "ru";

/** What one option of a segment writes: consonants (several = a cluster), a vowel, or a sign/letter. */
export type Piece =
  | { kind: "c"; letters: string[]; joins?: boolean; repaya?: boolean }
  | { kind: "v"; vowel: VowelKey }
  | { kind: "x"; text: string }; // ං ඃ, or any character passed through

export interface Option { piece: Piece; penalty: number }
export interface Segment { latin: string; options: Option[] }

const INDEPENDENT: Record<VowelKey, string> = {
  a: "අ", aa: "ආ", ae: "ඇ", aee: "ඈ", i: "ඉ", ii: "ඊ", u: "උ", uu: "ඌ",
  e: "එ", ee: "ඒ", ai: "ඓ", o: "ඔ", oo: "ඕ", au: "ඖ", ru: "ඍ",
};
const SIGN: Record<VowelKey, string> = {
  a: "", aa: "ා", ae: "ැ", aee: "ෑ", i: "ි", ii: "ී", u: "ු", uu: "ූ",
  e: "ෙ", ee: "ේ", ai: "ෛ", o: "ො", oo: "ෝ", au: "ෞ", ru: "ෘ",
};

// Vowels: [latin, preferred, alternatives...] (alternatives cost 1 each, in order).
const VOWELS: [string, VowelKey, ...VowelKey[]][] = [
  ["aee", "aee"], ["aea", "aee"], ["Aa", "aee"], ["AA", "aee"],
  ["aa", "aa"], ["ae", "ae", "aee"], ["ai", "ai"], ["au", "au"], ["ou", "au"],
  ["ii", "ii"], ["ee", "ii", "ee"], ["ie", "ii"], ["uu", "uu"], ["oo", "oo", "uu"],
  ["a", "a"], ["A", "ae", "aee"], ["i", "i", "ii"], ["I", "ii"], ["u", "u", "uu"], ["U", "uu"],
  ["e", "e", "ee"], ["E", "ee"], ["o", "o", "oo"], ["O", "oo"], ["R", "ru"],
];

// Consonants: [latin, preferred, alternatives...]. "y" and "r" are marked: they join a consonant before.
const CONSONANTS: [string, string, ...string[]][] = [
  ["chh", "ඡ"], ["Ch", "ඡ"], ["ch", "ච", "ඡ"], ["kh", "ඛ"], ["gh", "ඝ"], ["jh", "ඣ"], ["Th", "ථ"],
  ["th", "ත", "ථ"], ["Dh", "ඪ"], ["dh", "ද", "ධ"], ["ph", "ඵ"], ["bh", "භ"], ["sh", "ශ", "ෂ"], ["Sh", "ෂ"],
  ["ny", "ඤ"], ["gn", "ඥ"], ["kn", "ඥ"],
  ["k", "ක", "ඛ"], ["K", "ඛ"], ["g", "ග", "ඝ"], ["G", "ඝ"], ["c", "ච", "ක"], ["j", "ජ", "ඣ"], ["J", "ඣ"],
  ["t", "ට", "ත"], ["T", "ඨ"], ["d", "ද", "ඩ"], ["D", "ඩ"], ["n", "න", "ණ"], ["N", "ණ"],
  ["p", "ප", "ඵ"], ["P", "ඵ"], ["f", "ෆ"], ["F", "ෆ"], ["b", "බ", "භ"], ["B", "භ"], ["m", "ම"], ["M", "ම"],
  ["y", "ය"], ["Y", "ය"], ["r", "ර"], ["l", "ල", "ළ"], ["L", "ළ"], ["w", "ව"], ["W", "ව"], ["v", "ව"], ["V", "ව"],
  ["s", "ස", "ශ", "ෂ"], ["S", "ෂ"], ["h", "හ"], ["z", "ස"], ["Z", "ස"], ["q", "ක"], ["Q", "ක"], ["C", "ච"],
];

const VOWEL_START = /^(?:aee|aea|Aa|AA|aa|ae|ai|au|ou|ii|ee|ie|uu|oo|[aAiIuUeEoOR])/;

function startsVowel(rest: string): boolean {
  return VOWEL_START.test(rest);
}

/** Splits romanised text (letters only; anything else passes through) into ambiguous segments. */
export function segment(latin: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  const one = (text: string, piece: Piece): Segment => ({ latin: text, options: [{ piece, penalty: 0 }] });
  while (i < latin.length) {
    const rest = latin.slice(i);
    const prev = out.length ? out[out.length - 1] : null;
    const prevIsConsonant = !!prev && prev.options[0].piece.kind === "c";

    // anusvara and visarga
    if (rest[0] === "x") { out.push(one("x", { kind: "x", text: "ං" })); i++; continue; }
    if (rest[0] === "H" && prev && !prevIsConsonant && prev.options[0].piece.kind === "v") {
      out.push(one("H", { kind: "x", text: "ඃ" })); i++; continue;
    }

    // prenasalised clusters before a vowel: nd ඳ, mb ඹ, ng ංග / ඟ; ng elsewhere is ං
    const nasal = /^(nd|mb|ng)/.exec(rest);
    if (nasal) {
      const after = rest.slice(2);
      if (nasal[1] === "ng" && !startsVowel(after)) {
        out.push({ latin: "ng", options: [{ piece: { kind: "x", text: "ං" }, penalty: 0 }, { piece: { kind: "c", letters: ["න", "ග"] }, penalty: 1 }] });
        i += 2; continue;
      }
      if (startsVowel(after) && !/^h/.test(after)) {
        const options: Option[] = nasal[1] === "nd"
          ? [{ piece: { kind: "c", letters: ["න", "ද"] }, penalty: 0 }, { piece: { kind: "c", letters: ["ඳ"] }, penalty: 1 }, { piece: { kind: "c", letters: ["ණ", "ඩ"] }, penalty: 2 }]
          : nasal[1] === "mb"
            ? [{ piece: { kind: "c", letters: ["ම", "බ"] }, penalty: 0 }, { piece: { kind: "c", letters: ["ඹ"] }, penalty: 1 }]
            : [{ piece: { kind: "c", letters: ["ං", "ග"] }, penalty: 0 }, { piece: { kind: "c", letters: ["ඟ"] }, penalty: 1 }, { piece: { kind: "c", letters: ["න", "ග"] }, penalty: 2 }];
        out.push({ latin: nasal[1], options });
        i += 2; continue;
      }
    }

    // vowels
    const v = VOWELS.find(([l]) => rest.startsWith(l));
    if (v) {
      const [l, first, ...alts] = v;
      const final = i + l.length === latin.length || !/[A-Za-z]/.test(latin[i + l.length]);
      const options: Option[] = [{ piece: { kind: "v", vowel: first }, penalty: 0 }];
      // a short "a" after a consonant may be long, at the end of a word most of all (amma අම්මා, thaththa තාත්තා)
      if (first === "a" && prevIsConsonant) options.push({ piece: { kind: "v", vowel: "aa" }, penalty: final ? 1 : 2.5 });
      alts.forEach((a, n) => options.push({ piece: { kind: "v", vowel: a }, penalty: (final ? 1 : 2) + n }));
      out.push({ latin: l, options });
      i += l.length; continue;
    }

    // consonants
    const c = CONSONANTS.find(([l]) => rest.startsWith(l));
    if (c) {
      const [l, first, ...alts] = c;
      const after = latin.slice(i + l.length);
      const joins = (first === "ය" || first === "ර") && prevIsConsonant;
      const options: Option[] = [{ piece: { kind: "c", letters: [first], joins }, penalty: 0 }];
      if (joins) options.push({ piece: { kind: "c", letters: [first], joins: false }, penalty: 2 });
      alts.forEach((a, n) => options.push({ piece: { kind: "c", letters: [a] }, penalty: 1.5 + n }));
      // n before another consonant may be the anusvara (lanka ලංකා, sinhala සිංහල)
      if (l === "n" && after && /^[A-Za-z]/.test(after) && !startsVowel(after) && !/^[nmyNM]/.test(after)) {
        options.splice(1, 0, { piece: { kind: "x", text: "ං" }, penalty: 1 });
      }
      // r before another consonant may be the repaya (ර්‍ + consonant)
      if (l === "r" && after && !startsVowel(after) && /^[A-Za-z]/.test(after) && !/^[yr]/.test(after)) {
        options.push({ piece: { kind: "c", letters: ["ර"], repaya: true }, penalty: 1 });
      }
      // "ru" after a consonant is also the vowel sign ෘ (kRuthi / kruthi කෘති)
      if (l === "r" && prevIsConsonant && /^u(?!u)/.test(after)) {
        out.push({ latin: "r", options: [
          { piece: { kind: "c", letters: ["ර"], joins: true }, penalty: 0 },
          { piece: { kind: "v", vowel: "ru" }, penalty: 1 },
        ] });
        // the "u" stays its own segment: rakaransaya + ු, or eaten by ෘ in render()
        i += 1; continue;
      }
      out.push({ latin: l, options });
      i += l.length; continue;
    }

    out.push(one(rest[0], { kind: "x", text: rest[0] }));
    i++;
  }
  return out;
}

/** Writes one choice of pieces as Sinhala Unicode. */
export function render(pieces: Piece[]): string {
  // flatten clusters into single consonants; a cluster's letters join with al-lakuna
  type Flat = { kind: "c"; ch: string; joins?: boolean; repaya?: boolean } | { kind: "v"; vowel: VowelKey } | { kind: "x"; text: string };
  const flat: Flat[] = [];
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    if (p.kind === "c") {
      p.letters.forEach((ch, n) => {
        if (ch === "ං") flat.push({ kind: "x", text: ch });
        else flat.push({ kind: "c", ch, joins: n === p.letters.length - 1 ? p.joins : false, repaya: p.repaya });
      });
    } else if (p.kind === "v" && p.vowel === "ru") {
      flat.push(p);
      // ෘ from "ru": the "u" segment that follows is part of it
      const next = pieces[k + 1];
      if (next && next.kind === "v" && (next.vowel === "u" || next.vowel === "uu") && k > 0 && pieces[k - 1].kind === "c") k++;
    } else flat.push(p);
  }
  let out = "";
  for (let k = 0; k < flat.length; k++) {
    const f = flat[k];
    if (f.kind === "x") { out += f.text; continue; }
    if (f.kind === "v") { out += INDEPENDENT[f.vowel]; continue; }
    const next = flat[k + 1];
    if (next && next.kind === "v") { out += f.ch + SIGN[next.vowel]; k++; continue; }
    out += f.ch + AL_LAKUNA;
    if (next && next.kind === "c" && (next.joins || f.repaya)) out += ZWJ;
  }
  return out;
}

/** The preferred rendering: transliterate("amma") is "අම්ම", transliterate("shrii") "ශ්‍රී". */
export function transliterate(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => render(segment(word).map((s) => s.options[0].piece)));
}

export interface Variant { text: string; penalty: number }

/**
 * The renderings of one romanised word from the best down, at most `limit`: best-first over the
 * segments' options (total penalty, then fewer changes). `open` leaves a final consonant without
 * al-lakuna, for prefix matching while the word is still being typed.
 */
export function variants(latin: string, limit = 64, open = false): Variant[] {
  const segs = segment(latin);
  if (!segs.length) return [];
  const seen = new Map<string, number>();
  const result: Variant[] = [];
  const key = (choice: number[]) => choice.join(",");
  const cost = (choice: number[]) => choice.reduce((sum, c, n) => sum + segs[n].options[c].penalty, 0);
  const frontier: { choice: number[]; penalty: number }[] = [{ choice: segs.map(() => 0), penalty: 0 }];
  const visited = new Set<string>([key(frontier[0].choice)]);
  let steps = 0;
  while (frontier.length && result.length < limit && steps++ < limit * 40) {
    frontier.sort((a, b) => a.penalty - b.penalty);
    const { choice, penalty } = frontier.shift()!;
    const pieces = choice.map((c, n) => segs[n].options[c].piece);
    let text = render(pieces);
    if (open && text.endsWith(AL_LAKUNA)) text = text.slice(0, -1);
    if (!seen.has(text)) { seen.set(text, penalty); result.push({ text, penalty }); }
    for (let n = 0; n < segs.length; n++) {
      if (choice[n] + 1 >= segs[n].options.length) continue;
      const next = choice.slice();
      next[n]++;
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      frontier.push({ choice: next, penalty: cost(next) });
    }
  }
  return result;
}
