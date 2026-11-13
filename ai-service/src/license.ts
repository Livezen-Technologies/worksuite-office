// WorkSuite Office licensing: Free by default; a signed license unlocks Pro features.
//
// Trust model (the same Ed25519 root as the catalog and models, signing.ts):
//   - A license is a small JSON document signed by WorkSuite's release key. The signature is verified
//     OFFLINE against the pinned public keys, so Pro works with no network and cannot be forged.
//   - An ONLINE check with the Update Center (download center) adds revocation and seat enforcement.
//     It is not required to use Pro: when the Update Center cannot be reached the last good offline
//     entitlement stands for GRACE_MS, then Pro is suspended until the next successful check.
//
// Which features are Pro is a product decision: PRO_FEATURES lists the gated keys (ocr, pdf.sign,
// convert, assistant). Policy or WS_AI_PRO_FEATURES can extend it, and WS_AI_LICENSE_ALL=1 is a
// managed-config "all features on" override. Turning a feature Pro is a one-line change plus a
// license.require("<key>") at its entry point.
import { createHash, KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { ApiError } from "./errors";
import { checkSignature } from "./signing";

export const LICENSE_VERSION = 1;
const GRACE_MS = 30 * 24 * 3600 * 1000; // offline grace after the last good online check

/** The Pro feature keys. A key here is gated; anything not listed is Free. Policy or
 * WS_AI_PRO_FEATURES can extend it; WS_AI_LICENSE_ALL=1 unlocks everything (managed config). */
export const PRO_FEATURES: readonly string[] = ["ocr", "pdf.sign", "convert", "assistant"];

export interface LicenseDoc {
  v: number;
  licenseId: string;
  plan: "pro";
  /** granted feature keys, or ["*"] for every Pro feature */
  features: string[];
  issuedTo?: string;
  issuedAt: string;
  /** ISO date, or null/absent for perpetual */
  expiresAt?: string | null;
  /** when set, the license is bound to this device id (see deviceId()) */
  device?: string | null;
  seats?: number;
  signature: string;
}

export type OnlineStatus = "active" | "revoked" | "expired" | "unknown";

interface Stored {
  doc: LicenseDoc;
  activatedAt: string;
  lastOnlineOk?: string; // ISO of the last successful online validation
  online?: OnlineStatus;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface LicenseStatus {
  plan: "free" | "pro";
  active: boolean;
  licenseId?: string;
  issuedTo?: string;
  expiresAt?: string | null;
  features: string[];
  online?: OnlineStatus;
  lastOnlineOk?: string | null;
  reason?: string; // when not active: "expired" | "revoked" | "grace_expired" | "wrong_device" | "bad_signature"
}

/** A stable, non-identifying device id: a hash of host + user, never the raw values. */
export function deviceId(): string {
  let name = "";
  try { name = userInfo().username; } catch { /* ignore */ }
  return createHash("sha256").update(`${hostname()}\0${name}`).digest("hex").slice(0, 32);
}

function proFeatureSet(env: NodeJS.ProcessEnv, extra: readonly string[]): Set<string> {
  const fromEnv = (env.WS_AI_PRO_FEATURES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...PRO_FEATURES, ...extra, ...fromEnv]);
}

export class LicenseStore {
  private file: string;
  private cache: Stored | null = null;
  private loaded = false;

  constructor(
    dataDir: string,
    private keys: () => KeyObject[],
    private fetcher: Fetcher = fetch,
    private env: NodeJS.ProcessEnv = process.env,
    private baseUrl = process.env.WS_AI_LICENSE_URL || "https://download.worksuitecloud.com/api/v1/license",
    private now: () => number = Date.now,
    private extraPro: readonly string[] = [],
  ) {
    this.file = join(dataDir, "license.json");
  }

  private read(): Stored | null {
    if (this.loaded) return this.cache;
    this.loaded = true;
    try {
      if (existsSync(this.file)) this.cache = JSON.parse(readFileSync(this.file, "utf8")) as Stored;
    } catch { this.cache = null; }
    return this.cache;
  }

  private write(s: Stored | null): void {
    this.cache = s;
    this.loaded = true;
    if (!s) { rmSync(this.file, { force: true }); return; }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(s), { mode: 0o600 });
  }

  /** Verifies a license document offline: signature, version, expiry and (if bound) device. */
  verify(doc: LicenseDoc): { ok: true } | { ok: false; reason: NonNullable<LicenseStatus["reason"]> } {
    if (!doc || doc.v !== LICENSE_VERSION || doc.plan !== "pro" || !Array.isArray(doc.features))
      return { ok: false, reason: "bad_signature" };
    if (checkSignature(doc as unknown as Record<string, unknown>, this.keys()) !== "valid")
      return { ok: false, reason: "bad_signature" };
    if (doc.expiresAt && Date.parse(doc.expiresAt) <= this.now()) return { ok: false, reason: "expired" };
    if (doc.device && doc.device !== deviceId()) return { ok: false, reason: "wrong_device" };
    return { ok: true };
  }

  /** The current entitlement, honouring offline grace and the last known online status. */
  status(): LicenseStatus {
    const s = this.read();
    if (this.env.WS_AI_LICENSE_ALL === "1" && !s) return { plan: "pro", active: true, features: ["*"], issuedTo: "Site license" };
    if (!s) return { plan: "free", active: true, features: [] };
    const v = this.verify(s.doc);
    const base = { licenseId: s.doc.licenseId, issuedTo: s.doc.issuedTo, expiresAt: s.doc.expiresAt ?? null, features: s.doc.features, online: s.online ?? "unknown", lastOnlineOk: s.lastOnlineOk ?? null };
    if (!v.ok) return { plan: "free", active: false, reason: v.reason, ...base };
    if (s.online === "revoked") return { plan: "free", active: false, reason: "revoked", ...base };
    // offline grace: if we have ever validated online, it must have been within GRACE_MS
    if (s.lastOnlineOk && this.now() - Date.parse(s.lastOnlineOk) > GRACE_MS)
      return { plan: "free", active: false, reason: "grace_expired", ...base };
    return { plan: "pro", active: true, ...base };
  }

  /** True when the caller may use `feature`: Free features always; Pro features only with an active Pro
   * license that grants them ("*" or the exact key). */
  entitled(feature: string): boolean {
    // Site/enterprise "all features on" override (managed config); off unless explicitly set.
    if (this.env.WS_AI_LICENSE_ALL === "1") return true;
    if (!proFeatureSet(this.env, this.extraPro).has(feature)) return true;
    const st = this.status();
    if (st.plan !== "pro" || !st.active) return false;
    return st.features.includes("*") || st.features.includes(feature);
  }

  /** Throws payment_required when `feature` is Pro and not entitled. */
  require(feature: string): void {
    if (!this.entitled(feature)) {
      const st = this.status();
      throw new ApiError("payment_required", `"${feature}" needs WorkSuite Office Pro`, { feature, reason: st.reason || "no_license" });
    }
  }

  proFeatures(): string[] { return [...proFeatureSet(this.env, this.extraPro)]; }

  /** Activate from a pasted key or a .wslicense file's text. Verifies offline, stores, then tries the
   * online activation (non-fatal if offline). */
  async activate(keyText: string): Promise<LicenseStatus> {
    let doc: LicenseDoc;
    try { doc = parseLicense(keyText); } catch { throw new ApiError("bad_request", "This is not a valid license key"); }
    const v = this.verify(doc);
    if (!v.ok) throw new ApiError("bad_request", `The license could not be verified (${v.reason})`, { reason: v.reason });
    const stored: Stored = { doc, activatedAt: new Date(this.now()).toISOString() };
    try {
      const r = await this.online("activate", doc.licenseId);
      stored.online = r.status;
      if (r.status === "active") stored.lastOnlineOk = new Date(this.now()).toISOString();
      if (r.license) { const nd = parseLicense(r.license); if (this.verify(nd).ok) stored.doc = nd; } // server may bind to device
      if (r.status === "revoked") throw new ApiError("forbidden_by_policy", "This license has been revoked", { reason: "revoked" });
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden_by_policy") throw e;
      stored.online = "unknown"; // offline: offline signature still grants Pro within grace
    }
    this.write(stored);
    return this.status();
  }

  /** Online revalidation; updates the stored status and the grace clock. */
  async refresh(): Promise<LicenseStatus> {
    const s = this.read();
    if (!s) return this.status();
    try {
      const r = await this.online("validate", s.doc.licenseId);
      s.online = r.status;
      if (r.status === "active") s.lastOnlineOk = new Date(this.now()).toISOString();
      this.write(s);
    } catch { /* keep the stored status; grace handles it */ }
    return this.status();
  }

  async deactivate(): Promise<LicenseStatus> {
    const s = this.read();
    if (s) { try { await this.online("deactivate", s.doc.licenseId); } catch { /* best effort */ } }
    this.write(null);
    return this.status();
  }

  private async online(action: "activate" | "validate" | "deactivate", licenseId: string): Promise<{ status: OnlineStatus; license?: string }> {
    const res = await this.fetcher(`${this.baseUrl}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ licenseId, device: deviceId(), product: "office", version: this.env.WS_AI_VERSION || "" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`license ${action}: HTTP ${res.status}`);
    const j = (await res.json()) as { status?: string; license?: string };
    const status: OnlineStatus = j.status === "active" || j.status === "revoked" || j.status === "expired" ? j.status : "unknown";
    return { status, license: typeof j.license === "string" ? j.license : undefined };
  }
}

/** A license key is the signed JSON, optionally base64-wrapped and/or framed as a .wslicense file. */
export function parseLicense(text: string): LicenseDoc {
  let t = text.trim();
  // strip a "-----BEGIN WORKSUITE LICENSE-----" frame if present
  t = t.replace(/-----[^-]+-----/g, "").trim();
  if (t[0] !== "{") { // base64 of the JSON
    try { t = Buffer.from(t, "base64").toString("utf8").trim(); } catch { throw new Error("not a license"); }
  }
  const doc = JSON.parse(t) as LicenseDoc;
  if (!doc || typeof doc !== "object" || typeof doc.signature !== "string") throw new Error("not a license");
  return doc;
}
