// Ed25519 signatures over manifests and the catalog (node:crypto, no extra dependency).
// A signed document carries "signature": "ed25519:<base64 of 64 bytes>" and is signed over the canonical
// JSON (keys sorted, no whitespace) of the document without its "signature" field.
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign, verify } from "node:crypto";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * WorkSuite's model-signing public keys (raw 32-byte, base64). The production key is generated and held
 * offline by release engineering; until it is pinned here, nothing verifies by default and installs need
 * WS_AI_DEV=1 or a key in WS_AI_TRUSTED_KEYS. (Pin it in the same PR that the Update Center starts
 * signing the catalog in.)
 */
export const BUILTIN_KEYS: string[] = [];

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}

export function publicKeyFromRaw(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("an Ed25519 public key is 32 bytes");
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: "der", type: "spki" });
}

export function trustedKeys(env = process.env): KeyObject[] {
  const extra = (env.WS_AI_TRUSTED_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const out: KeyObject[] = [];
  for (const k of [...BUILTIN_KEYS, ...extra]) {
    try { out.push(publicKeyFromRaw(k)); } catch { /* a malformed key is ignored */ }
  }
  return out;
}

function payload(doc: Record<string, unknown>): Buffer {
  const { signature: _sig, ...rest } = doc;
  void _sig;
  return Buffer.from(canonicalJson(rest), "utf8");
}

export type SignatureCheck = "valid" | "unsigned" | "invalid";

export function checkSignature(doc: Record<string, unknown>, keys: KeyObject[]): SignatureCheck {
  const sig = doc.signature;
  if (typeof sig !== "string" || !sig.startsWith("ed25519:") || sig === "ed25519:...") return "unsigned";
  const bytes = Buffer.from(sig.slice(8), "base64");
  if (bytes.length !== 64) return "invalid";
  const data = payload(doc);
  return keys.some((k) => { try { return verify(null, data, k, bytes); } catch { return false; } }) ? "valid" : "invalid";
}

export function signDoc<T extends Record<string, unknown>>(doc: T, privateKeyRaw: string): T & { signature: string } {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(privateKeyRaw, "base64")]), format: "der", type: "pkcs8" });
  const sig = sign(null, payload(doc), key).toString("base64");
  return { ...doc, signature: "ed25519:" + sig };
}

/** A fresh key pair as raw base64 (for tests and for scripts/sign-catalog.mjs --new-key). */
export function newKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_ED25519.length);
  const priv = privateKey.export({ format: "der", type: "pkcs8" }).subarray(PKCS8_ED25519.length);
  return { publicKey: Buffer.from(pub).toString("base64"), privateKey: Buffer.from(priv).toString("base64") };
}

export const devMode = (env = process.env): boolean => env.WS_AI_DEV === "1";
