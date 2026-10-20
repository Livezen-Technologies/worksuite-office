import { Profile } from "./profiles";
import { AL_LAKUNA, ZWJ, isConsonant, isSinhala, ZWNJ } from "./script";

export type Direction = "toUnicode" | "toLegacy";

/** A character the profile has no mapping for. It is left in the output as it was, never dropped. */
export interface Unmapped {
  /** Offset (UTF-16 code units) in the input; for toLegacy, in the NFC form of the input. */
  offset: number;
  text: string;
  /** "U+0041" */
  codePoint: string;
}

export interface ConvertResult {
  text: string;
  unmapped: Unmapped[];
  profile: string;
  profileVersion: string;
  direction: Direction;
}

interface Tables {
  forward: Map<string, string>;
  forwardLengths: number[];
  reverse: Map<string, string>;
  reverseLengths: number[];
}

const tableCache = new Map<string, Tables>();

function tables(profile: Profile): Tables {
  const key = profile.id + "@" + profile.version + "#" + profile.sha256;
  let t = tableCache.get(key);
  if (!t) {
    const forward = new Map<string, string>();
    const reverse = new Map<string, string>();
    for (const [legacy, unicode] of profile.map) {
      forward.set(legacy, unicode);
      // the first legacy spelling of a Unicode sequence is the one encoding writes
      if (!reverse.has(unicode)) reverse.set(unicode, legacy);
    }
    const lengths = (m: Map<string, string>): number[] =>
      Array.from(new Set(Array.from(m.keys()).map((k) => k.length))).sort((a, b) => b - a);
    t = { forward, forwardLengths: lengths(forward), reverse, reverseLengths: lengths(reverse) };
    tableCache.set(key, t);
  }
  return t;
}

function codePoint(ch: string): string {
  return "U+" + (ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0");
}

interface Token {
  text: string;
  mapped: boolean;
}

/** Legacy font text to Unicode Sinhala: longest-match lookup, then kombuva moved after its consonant cluster. */
export function toUnicode(input: string, profile: Profile): ConvertResult {
  const t = tables(profile);
  const tokens: Token[] = [];
  const unmapped: Unmapped[] = [];
  let i = 0;
  while (i < input.length) {
    let matched = false;
    for (const len of t.forwardLengths) {
      if (i + len > input.length) continue;
      const u = t.forward.get(input.substr(i, len));
      if (u !== undefined) {
        tokens.push({ text: u, mapped: true });
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = String.fromCodePoint(input.codePointAt(i) as number);
    // Unicode Sinhala (already converted) and the joiners are kept as they are
    if (!profile.passthrough.includes(ch) && !isSinhala(ch) && ch !== ZWJ && ch !== ZWNJ) {
      unmapped.push({ offset: i, text: ch, codePoint: codePoint(ch) });
    }
    tokens.push({ text: ch, mapped: false });
    i += ch.length;
  }

  // Legacy order writes the kombuva (and kombu deka) before the consonant; Unicode after the cluster
  // (consonant plus yansaya / rakaransaya).
  const out: string[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const next = tokens[k + 1];
    if (tok.mapped && profile.prebase.includes(tok.text) && next && next.mapped && isConsonant(next.text[0])) {
      let end = k + 2;
      while (end < tokens.length && tokens[end].mapped && tokens[end].text.startsWith(AL_LAKUNA + ZWJ)) end++;
      for (let m = k + 1; m < end; m++) out.push(tokens[m].text);
      out.push(tok.text);
      k = end - 1;
      continue;
    }
    out.push(tok.text);
  }

  let text = out.join("");
  for (const [seq, composed] of profile.compose) text = text.split(seq).join(composed);
  text = text.normalize("NFC");
  return { text, unmapped, profile: profile.id, profileVersion: profile.version, direction: "toUnicode" };
}

interface Unit {
  ch: string;
  offset: number;
}

/** Unicode Sinhala to a legacy font's encoding: decompose, kombuva before the cluster, reverse lookup. */
export function toLegacy(input: string, profile: Profile): ConvertResult {
  const t = tables(profile);
  const source = input.normalize("NFC");
  let units: Unit[] = [];
  for (let i = 0; i < source.length; ) {
    const ch = String.fromCodePoint(source.codePointAt(i) as number);
    for (const d of isSinhala(ch) ? ch.normalize("NFD") : ch) units.push({ ch: d, offset: i });
    i += ch.length;
  }
  // independent vowels the legacy fonts build from parts (ආ = අ + ා)
  for (const [seq, composed] of profile.compose) {
    units = units.flatMap((u) => (u.ch === composed ? Array.from(seq).map((c) => ({ ch: c, offset: u.offset })) : [u]));
  }
  // kombuva / kombu deka back in front of the consonant cluster
  for (let p = 0; p < units.length; p++) {
    if (!profile.prebase.includes(units[p].ch)) continue;
    let s = p - 1;
    if (s < 0 || !isConsonant(units[s].ch)) continue;
    while (s >= 3 && isConsonant(units[s - 3].ch) &&
      ((units[s - 2].ch === AL_LAKUNA && units[s - 1].ch === ZWJ) || (units[s - 2].ch === ZWJ && units[s - 1].ch === AL_LAKUNA))) {
      s -= 3;
    }
    const [sign] = units.splice(p, 1);
    units.splice(s, 0, sign);
  }

  const out: string[] = [];
  const unmapped: Unmapped[] = [];
  for (let i = 0; i < units.length; ) {
    let matched = false;
    for (const len of t.reverseLengths) {
      if (i + len > units.length) continue;
      const key = units.slice(i, i + len).map((u) => u.ch).join("");
      const legacy = t.reverse.get(key);
      if (legacy !== undefined) {
        out.push(legacy);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const u = units[i];
    if (!profile.passthrough.includes(u.ch)) unmapped.push({ offset: u.offset, text: u.ch, codePoint: codePoint(u.ch) });
    out.push(u.ch);
    i++;
  }
  return { text: out.join(""), unmapped, profile: profile.id, profileVersion: profile.version, direction: "toLegacy" };
}

export function convert(text: string, profile: Profile, direction: Direction = "toUnicode"): ConvertResult {
  return direction === "toLegacy" ? toLegacy(text, profile) : toUnicode(text, profile);
}
