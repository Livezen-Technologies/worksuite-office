// GET /v1/policy: the organisation's AI policy, read from the managed-configuration location of each OS
// (desktop-apps docs/managed-configuration.md: one schema, the same value names everywhere):
//   Windows  HKLM\Software\Policies\WorkSuite\Office\AI   (REG_SZ / DWORD / REG_MULTI_SZ values)
//            and aiFunctions=off on HKLM\Software\Policies\WorkSuite\Office
//   macOS    managed preferences of domain lk.worksuite.office: an "ai" dictionary, plus aiFunctions
//   Linux    /etc/worksuite/office/policy.json (AI keys at the top level), and the "ai" object and
//            aiFunctions of the app's /etc/worksuite-office/policy.json
// WS_AI_POLICY_FILE (a JSON file in the Linux form) replaces all of them, for tests and kiosks.
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { run } from "./exec";

export const FEATURES = ["stt", "suggestions", "correction", "translate", "tts", "assistant"] as const;
export type Feature = (typeof FEATURES)[number];

export interface Policy {
  managed: boolean;
  features: Record<Feature, boolean>;
  cloudAllowed: boolean;
  /** [] = no restriction (see modelsRestricted) */
  approvedModels: string[];
  /** 0 = no cap beyond the service's own (70% of RAM) */
  maxMemMB: number;
  gpuAllowed: boolean;
  orgDictionaryUrl: string | null;
  /** additive: true when approvedModels is enforced */
  modelsRestricted: boolean;
  /** additive: the organisation's name from the app's policy, when set */
  organization?: string | null;
  /** additive: where the policy came from (registry, managed-preferences, file path) */
  source?: string | null;
  /** additive: a managed storage folder for models (aiStoragePath) */
  storagePath?: string | null;
  /** additive: a mirrored catalog (organisations mirror the Update Center's signed catalog) */
  catalogUrl?: string | null;
}

export type RawPolicy = Record<string, unknown>;

export function asBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return undefined;
}

function asList(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v).split(/[,\n\0;]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The Office app's managed keys for Local AI (desktop-apps docs/managed-configuration.md, "Local AI"):
 * the same registry key / macOS domain / Linux policy.json as the other Office keys, prefixed "ai".
 */
export const APP_AI_KEYS: Record<string, string> = {
  aiSpeechToText: "stt", aiSuggestions: "suggestions", aiCorrection: "correction", aiTranslation: "translate", aiReadAloud: "tts",
  aiAssistant: "assistant", aiCloudAllowed: "cloudAllowed", aiApprovedModels: "approvedModels", aiMaxMemoryMB: "maxMemMB",
  aiGpuAllowed: "gpuAllowed", aiDictionaryUrl: "orgDictionaryUrl", aiCatalogUrl: "catalogUrl", aiStoragePath: "storagePath",
};

export function fromAppKeys(app: RawPolicy | null): RawPolicy | null {
  if (!app) return null;
  const o: RawPolicy = {};
  for (const [k, v] of Object.entries(APP_AI_KEYS)) if (app[k] !== undefined && app[k] !== null && app[k] !== "") o[v] = app[k];
  return Object.keys(o).length ? o : null;
}

/** Turns raw values (any source) into the contract's shape. `app` is the app-level policy (aiFunctions, organization). */
export function normalizePolicy(aiIn: RawPolicy | null, app: RawPolicy | null = null, source: string | null = null): Policy {
  const fromApp = fromAppKeys(app);
  const ai = aiIn || fromApp ? { ...(aiIn || {}), ...(fromApp || {}) } : null;
  const a = ai || {};
  const off = String((app && app.aiFunctions) ?? a.aiFunctions ?? "").toLowerCase() === "off";
  const enabled = asBool(a.enabled);
  const featuresRaw = (a.features && typeof a.features === "object" ? a.features : a) as RawPolicy;
  const features = {} as Record<Feature, boolean>;
  for (const f of FEATURES) features[f] = !off && enabled !== false && asBool(featuresRaw[f]) !== false;
  const approved = asList(a.approvedModels);
  const maxMem = Number(a.maxMemMB);
  const managed = !!(ai && Object.keys(ai).length) || off;
  return {
    managed,
    features,
    cloudAllowed: !off && asBool(a.cloudAllowed) !== false,
    approvedModels: approved || [],
    maxMemMB: Number.isFinite(maxMem) && maxMem > 0 ? Math.round(maxMem) : 0,
    gpuAllowed: asBool(a.gpuAllowed) !== false,
    orgDictionaryUrl: typeof a.orgDictionaryUrl === "string" && /^https:\/\//.test(a.orgDictionaryUrl) ? a.orgDictionaryUrl : null,
    modelsRestricted: !!approved && approved.length > 0,
    organization: app && typeof app.organization === "string" ? app.organization : null,
    source: managed ? source : null,
    storagePath: typeof a.storagePath === "string" && a.storagePath ? a.storagePath : null,
    catalogUrl: typeof a.catalogUrl === "string" && /^https:\/\//.test(a.catalogUrl) ? a.catalogUrl : null,
  };
}

/** `reg query` output -> {name: value}. REG_DWORD 0x1 -> 1, REG_MULTI_SZ a\0b -> "a\0b". */
export function parseRegQuery(out: string): RawPolicy {
  const o: RawPolicy = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_SZ|REG_DWORD|REG_MULTI_SZ|REG_EXPAND_SZ|REG_QWORD)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, type, value] = m;
    o[name] = type === "REG_DWORD" || type === "REG_QWORD" ? parseInt(value, 16) : type === "REG_MULTI_SZ" ? value.replace(/\\0/g, "\n") : value;
  }
  return o;
}

function readJson(path: string): RawPolicy | null {
  try {
    if (!existsSync(path)) return null;
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as RawPolicy) : null;
  } catch {
    return null;
  }
}

export type PolicyReader = () => Promise<Policy>;

export function systemPolicyReader(env = process.env, platform = process.platform, exec = run): PolicyReader {
  return async () => {
    if (env.WS_AI_POLICY_FILE) {
      const f = readJson(env.WS_AI_POLICY_FILE);
      return normalizePolicy(f && (f.ai as RawPolicy) ? (f.ai as RawPolicy) : f, f, env.WS_AI_POLICY_FILE);
    }
    if (platform === "win32") {
      const ai = await exec("reg", ["query", "HKLM\\Software\\Policies\\WorkSuite\\Office\\AI"]);
      const app = await exec("reg", ["query", "HKLM\\Software\\Policies\\WorkSuite\\Office"]);
      return normalizePolicy(ai ? parseRegQuery(ai) : null, app ? parseRegQuery(app) : null, "HKLM\\Software\\Policies\\WorkSuite\\Office\\AI");
    }
    if (platform === "darwin") {
      // only forced (managed) values count; a person's own `defaults write` is not policy
      let user = "";
      try { user = userInfo().username; } catch { /* no user */ }
      for (const p of [`/Library/Managed Preferences/${user}/lk.worksuite.office.plist`, "/Library/Managed Preferences/lk.worksuite.office.plist"]) {
        if (!existsSync(p)) continue;
        const json = await exec("plutil", ["-convert", "json", "-o", "-", p]);
        if (!json) continue;
        try {
          const app = JSON.parse(json) as RawPolicy;
          return normalizePolicy((app.ai as RawPolicy) || null, app, p);
        } catch { /* unreadable profile: unmanaged */ }
      }
      return normalizePolicy(null);
    }
    const ai = readJson("/etc/worksuite/office/policy.json");
    const app = readJson("/etc/worksuite-office/policy.json");
    const merged = ai || (app && (app.ai as RawPolicy)) || null;
    return normalizePolicy(merged, app, ai ? "/etc/worksuite/office/policy.json" : app ? "/etc/worksuite-office/policy.json" : null);
  };
}
