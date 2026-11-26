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
  it("ocr, pdf.sign, convert, assistant, project.edit, diagram.edit are gated out of the box; others are free", () => {
    const { pub } = keypair();
    const { s, dir } = store({ pub }); // no extra pro list: use the built-in PRO_FEATURES
    try {
      for (const f of ["ocr", "pdf.sign", "convert", "assistant", "project.edit", "diagram.edit"]) {
        expect(s.entitled(f)).toBe(false);
        expect(() => s.require(f)).toThrow(/Pro/);
      }
      for (const f of ["view", "stamp", "merge", "form-fill"]) expect(s.entitled(f)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("WorkSuite Project and Diagram: viewing free, creating and editing Pro", () => {
  const VIEW = ["project.view", "diagram.view"];
  const EDIT = ["project.edit", "diagram.edit"];

  it("without a license: view is free, edit needs Pro (built-in PRO_FEATURES)", () => {
    const { pub } = keypair();
    const { s, dir } = store({ pub });
    try {
      for (const f of VIEW) expect(s.entitled(f)).toBe(true);
      for (const f of EDIT) {
        expect(s.entitled(f)).toBe(false);
        expect(() => s.require(f)).toThrow(/Pro/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a Pro license unlocks editing; a license granting only Project leaves Diagram editing Pro", async () => {
    const { seed, pub } = keypair();
    const all = store({ pub });
    const one = store({ pub });
    try {
      await all.s.activate(license(seed));
      for (const f of EDIT) expect(all.s.entitled(f)).toBe(true);
      await one.s.activate(license(seed, { features: ["project.edit"] }));
      expect(one.s.entitled("project.edit")).toBe(true);
      expect(one.s.entitled("diagram.edit")).toBe(false);
      expect(one.s.entitled("diagram.view")).toBe(true);
    } finally {
      rmSync(all.dir, { recursive: true, force: true });
      rmSync(one.dir, { recursive: true, force: true });
    }
  });

  it("a lapsed license: files still open read-only (view free), editing is Pro again", async () => {
    const { seed, pub } = keypair();
    let t = Date.parse("2026-06-01T00:00:00Z");
    const { s, dir } = store({ pub, now: () => t });
    try {
      await s.activate(license(seed, { expiresAt: "2026-07-01T00:00:00Z" }));
      expect(s.entitled("project.edit")).toBe(true);
      t = Date.parse("2026-08-01T00:00:00Z");
      expect(s.status().active).toBe(false);
      for (const f of VIEW) expect(s.entitled(f)).toBe(true);
      for (const f of EDIT) expect(() => s.require(f)).toThrow(/Pro/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("LicenseStore — activation keys (WSO-…) redeemed at the Update Center", () => {
  const KEY = "WSO-7H2KQ-ENXNX-QN54K-ZCP9J";
  it("a typed key is swapped for this computer's signed licence, then works offline", async () => {
    const { seed, pub } = keypair();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      if (url.endsWith("/redeem")) return new Response(JSON.stringify({ status: "active", license_id: "L-9", license: license(seed, { licenseId: "L-9", device: deviceId() }) }), { status: 200 });
      return new Response(JSON.stringify({ status: "active" }), { status: 200 });
    }) as typeof fetch;
    const { s, dir } = store({ pub, fetcher });
    const st = await s.activate(" wso 7h2kq-enxnx qn54k-zcp9j ");
    expect(st).toMatchObject({ plan: "pro", active: true, licenseId: "L-9" });
    expect(calls[0].url).toBe("https://uc.test/api/v1/license/redeem");
    expect(calls[0].body).toMatchObject({ key: "wso 7h2kq-enxnx qn54k-zcp9j", device: deviceId(), product: "office" });
    expect(calls[1].url).toBe("https://uc.test/api/v1/license/activate");
    rmSync(dir, { recursive: true, force: true });
  });

  it("the server's refusals come back with their reason; offline says so", async () => {
    const { pub } = keypair();
    const refuse = (status: number, code: string, message: string) => (async () => new Response(JSON.stringify({ error: { code, message } }), { status })) as unknown as typeof fetch;
    for (const [status, code, apiCode] of [[409, "LICENSE_SEATS_FULL", "forbidden_by_policy"], [403, "LICENSE_REVOKED", "forbidden_by_policy"], [404, "LICENSE_KEY_UNKNOWN", "bad_request"]] as const) {
      const { s, dir } = store({ pub, fetcher: refuse(status, code, "said the server") });
      await expect(s.activate(KEY)).rejects.toMatchObject({ code: apiCode, message: "said the server", detail: { reason: code } });
      expect(s.status().plan).toBe("free");
      rmSync(dir, { recursive: true, force: true });
    }
    const { s, dir } = store({ pub }); // the default fetcher throws: offline
    await expect(s.activate(KEY)).rejects.toMatchObject({ code: "capability_unavailable", detail: { reason: "offline" } });
    rmSync(dir, { recursive: true, force: true });
  });

  it("tells keys from licence text", async () => {
    const { isActivationKey } = await import("../src/license");
    expect(isActivationKey(KEY)).toBe(true);
    expect(isActivationKey("ws0 7h2kq enxnx qn54k zcp9j")).toBe(true);
    expect(isActivationKey("WSO-1234")).toBe(false);
    expect(isActivationKey('{"v":1}')).toBe(false);
  });
});
