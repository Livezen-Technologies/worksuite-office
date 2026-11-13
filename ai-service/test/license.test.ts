import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LicenseStore, LICENSE_VERSION, deviceId, parseLicense, type LicenseDoc } from "../src/license";
import { signDoc, publicKeyFromRaw } from "../src/signing";

// a throwaway signing key, injected as the trust root
function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(16).toString("base64"); // 32-byte seed
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64"); // 32-byte raw
  return { seed, pub };
}

function license(seed: string, over: Partial<LicenseDoc> = {}): string {
  const doc: Omit<LicenseDoc, "signature"> = {
    v: LICENSE_VERSION, licenseId: "L-123", plan: "pro", features: ["*"],
    issuedTo: "Acme Ltd", issuedAt: "2026-01-01T00:00:00Z", expiresAt: null, ...over,
  };
  return JSON.stringify(signDoc(doc as unknown as Record<string, unknown>, seed));
}

function store(opts: { pub: string; fetcher?: typeof fetch; now?: () => number; pro?: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), "lic-"));
  const s = new LicenseStore(dir, () => [publicKeyFromRaw(opts.pub)], opts.fetcher ?? (async () => { throw new Error("offline"); }),
    {} as NodeJS.ProcessEnv, "https://uc.test/api/v1/license", opts.now ?? Date.now, opts.pro ?? []);
  return { s, dir };
}

describe("LicenseStore — free by default", () => {
  it("no license: plan free, active, and non-Pro features are allowed", () => {
    const { pub } = keypair();
    const { s, dir } = store({ pub, pro: ["pdf.sign"] });
    try {
      expect(s.status()).toMatchObject({ plan: "free", active: true });
      expect(s.entitled("anything")).toBe(true); // not a Pro feature
      expect(s.entitled("pdf.sign")).toBe(false); // Pro feature, no license
      expect(() => s.require("pdf.sign")).toThrow(/Pro/);
      expect(() => s.require("view")).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("LicenseStore — activation (offline)", () => {
  it("a validly signed license unlocks Pro features", async () => {
    const { seed, pub } = keypair();
    const { s, dir } = store({ pub, pro: ["pdf.sign", "ocr"] });
    try {
      const st = await s.activate(license(seed));
      expect(st).toMatchObject({ plan: "pro", active: true, issuedTo: "Acme Ltd" });
      expect(s.entitled("pdf.sign")).toBe(true);
      expect(() => s.require("ocr")).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("grants only the listed features when not '*'", async () => {
    const { seed, pub } = keypair();
    const { s, dir } = store({ pub, pro: ["pdf.sign", "ocr"] });
    try {
      await s.activate(license(seed, { features: ["pdf.sign"] }));
      expect(s.entitled("pdf.sign")).toBe(true);
      expect(s.entitled("ocr")).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a forged signature, an expired license and a wrong-device license", async () => {
    const { seed, pub } = keypair();
    const other = keypair();
    const { s, dir } = store({ pub, pro: ["x"] });
    try {
      await expect(s.activate(license(other.seed))).rejects.toThrow(/verified|valid/i); // signed by the wrong key
      await expect(s.activate(license(seed, { expiresAt: "2020-01-01T00:00:00Z" }))).rejects.toThrow(/expired|verified/i);
      await expect(s.activate(license(seed, { device: "not-this-device" }))).rejects.toThrow(/device|verified/i);
      expect(s.status().plan).toBe("free");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("accepts a device-bound license for this device", async () => {
    const { seed, pub } = keypair();
    const { s, dir } = store({ pub });
    try {
      const st = await s.activate(license(seed, { device: deviceId() }));
      expect(st.plan).toBe("pro");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("LicenseStore — online check and grace", () => {
  it("online 'revoked' downgrades to free", async () => {
    const { seed, pub } = keypair();
    const fetcher = (async () => new Response(JSON.stringify({ status: "revoked" }), { status: 200 })) as unknown as typeof fetch;
    const { s, dir } = store({ pub, fetcher, pro: ["x"] });
    try {
      await expect(s.activate(license(seed))).rejects.toThrow(/revoked/i);
      expect(s.status().plan).toBe("free"); // a revoked license is refused and not stored
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("offline activation grants Pro, but Pro lapses once grace expires without an online OK", async () => {
    const { seed, pub } = keypair();
    let t = Date.parse("2026-02-01T00:00:00Z");
    // online 'active' once (sets the grace clock), then goes offline
    let calls = 0;
    const fetcher = (async () => (++calls === 1 ? new Response(JSON.stringify({ status: "active" }), { status: 200 }) : (() => { throw new Error("offline"); })())) as unknown as typeof fetch;
    const { s, dir } = store({ pub, fetcher, now: () => t, pro: ["x"] });
    try {
      expect((await s.activate(license(seed))).plan).toBe("pro");
      t += 10 * 24 * 3600 * 1000; // 10 days later, still within 30-day grace
      expect((await s.refresh()).plan).toBe("pro");
      t += 40 * 24 * 3600 * 1000; // now well past grace with no online OK
      expect(s.status()).toMatchObject({ plan: "free", reason: "grace_expired" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("deactivate clears the stored license", async () => {
    const { seed, pub } = keypair();
    const { s, dir } = store({ pub });
    try {
      await s.activate(license(seed));
      expect(s.status().plan).toBe("pro");
      await s.deactivate();
      expect(s.status().plan).toBe("free");
      expect(existsSync(join(dir, "license.json"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("parseLicense", () => {
  it("accepts raw JSON, base64 and a framed key", () => {
    const { seed } = keypair();
    const raw = license(seed);
    expect(parseLicense(raw).licenseId).toBe("L-123");
    expect(parseLicense(Buffer.from(raw).toString("base64")).licenseId).toBe("L-123");
    expect(parseLicense(`-----BEGIN WORKSUITE LICENSE-----\n${Buffer.from(raw).toString("base64")}\n-----END WORKSUITE LICENSE-----`).licenseId).toBe("L-123");
  });
  it("rejects junk", () => { expect(() => parseLicense("not a license")).toThrow(); });
});

describe("default Pro feature set", () => {
  it("ocr, pdf.sign, convert, assistant are gated out of the box; others are free", () => {
    const { pub } = keypair();
    const { s, dir } = store({ pub }); // no extra pro list: use the built-in PRO_FEATURES
    try {
      for (const f of ["ocr", "pdf.sign", "convert", "assistant"]) {
        expect(s.entitled(f)).toBe(false);
        expect(() => s.require(f)).toThrow(/Pro/);
      }
      for (const f of ["view", "stamp", "merge", "form-fill"]) expect(s.entitled(f)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
