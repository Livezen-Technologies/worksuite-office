import { canonicalJson, sha256Hex } from "./sha256";
import fmAbhaya from "../profiles/fm-abhaya.json";
import dlManel from "../profiles/dl-manel.json";
import kaputa from "../profiles/kaputa.json";

/**
 * A legacy font's code-point map. Profiles are data: versioned, hashed (sha256 over the canonical JSON
 * of everything but the sha256 field) and never edited by hand-copying between hosts.
 */
export interface Profile {
  id: string;
  name: string;
  version: string;
  /** "provisional": only the keyboard-layout base is mapped; the font's extra glyphs are reported unmapped. */
  status: "verified" | "provisional";
  /** Font family names (as documents name them) written in this encoding. */
  fontNames: string[];
  notes: string;
  /** Legacy characters that mean themselves (digits, spaces): copied, never reported. */
  passthrough: string;
  /** [legacy, unicode] pairs; legacy keys are matched longest first. */
  map: [string, string][];
  /** Unicode vowel signs the legacy encoding writes before the consonant (kombuva). */
  prebase: string[];
  /** [sequence, composed] pairs applied after reordering (e.g. අ + ා = ආ), undone before encoding. */
  compose: [string, string][];
  sha256: string;
}

export function profileHash(profile: Omit<Profile, "sha256"> & { sha256?: string }): string {
  const copy: Record<string, unknown> = { ...profile };
  delete copy.sha256;
  return sha256Hex(canonicalJson(copy));
}

/** Checks a profile's shape and sha256; a tampered or hand-edited profile is refused. */
export function verifyProfile(data: unknown): Profile {
  const p = data as Profile;
  if (!p || typeof p.id !== "string" || !Array.isArray(p.map) || !Array.isArray(p.fontNames)) {
    throw new Error("not a Sinhala profile");
  }
  for (const pair of p.map) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || !pair[1]) throw new Error(`profile ${p.id}: bad map entry`);
  }
  const seen = new Set<string>();
  for (const [legacy] of p.map) {
    if (seen.has(legacy)) throw new Error(`profile ${p.id}: "${legacy}" is mapped twice`);
    seen.add(legacy);
  }
  const hash = profileHash(p);
  if (hash !== p.sha256) throw new Error(`profile ${p.id} ${p.version}: sha256 ${hash} does not match ${p.sha256}`);
  return p;
}

export const builtinProfiles: Profile[] = [fmAbhaya, dlManel, kaputa].map((p) => verifyProfile(p));

export function getProfile(id: string, profiles: Profile[] = builtinProfiles): Profile {
  const p = profiles.find((x) => x.id === id);
  if (!p) throw new Error(`no Sinhala profile "${id}"`);
  return p;
}

const STYLE_SUFFIX = /(regular|bold|italic|bolditalic|normal)$/;
const squash = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, "");

/** The profile whose font a run uses: "FMAbhaya", "FM-Abhaya", "DL-Manel-bold" and so on. */
export function profileForFont(fontNames: string | string[] | undefined | null, profiles: Profile[] = builtinProfiles): Profile | null {
  const names = (Array.isArray(fontNames) ? fontNames : [fontNames]).filter((n): n is string => typeof n === "string" && n !== "");
  for (const name of names) {
    let s = squash(name);
    for (let i = 0; i < 2; i++) {
      for (const p of profiles) {
        if (p.fontNames.some((f) => squash(f) === s)) return p;
      }
      s = s.replace(STYLE_SUFFIX, "");
    }
  }
  return null;
}
