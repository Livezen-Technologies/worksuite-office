// Signs a catalog for the Update Center (or an organisation's mirror) with the WorkSuite model key:
//   node scripts/sign-catalog.mjs <catalog.json> <out.json>     key: WS_AI_SIGNING_KEY (raw Ed25519 private key, base64)
//   node scripts/sign-catalog.mjs --new-key                      prints a fresh key pair
// Each model entry's manifest (MANIFEST_KEYS, without download URLs) and each engine package are signed,
// then the whole document. Entries whose sha256 is "TODO" are refused: pin real hashes first.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const MANIFEST_KEYS = ["id", "name", "version", "tasks", "languages", "engine", "engineMin", "files", "ramMB", "backends", "license", "source", "evaluation", "voice", "contextSize"];
const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";

if (process.argv[2] === "--new-key") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  console.log(JSON.stringify({
    publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).subarray(16).toString("base64"),
  }, null, 2));
  process.exit(0);
}
const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.WS_AI_SIGNING_KEY) { console.error("usage: WS_AI_SIGNING_KEY=… node scripts/sign-catalog.mjs <catalog.json> <out.json>"); process.exit(2); }
const key = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(process.env.WS_AI_SIGNING_KEY, "base64")]), format: "der", type: "pkcs8" });
const sig = (doc) => { const { signature: _s, ...rest } = doc; return "ed25519:" + sign(null, Buffer.from(canonical(rest)), key).toString("base64"); };
const doc = JSON.parse(readFileSync(input, "utf8"));
for (const e of [...doc.models, ...(doc.engines || [])]) {
  for (const f of e.files) if (!/^[0-9a-f]{64}$/.test(f.sha256)) { console.error(`${e.id || e.engine}: ${f.path} has no pinned sha256`); process.exit(1); }
}
doc.models = doc.models.map((m) => { const man = {}; for (const k of MANIFEST_KEYS) if (m[k] !== undefined) man[k] = m[k]; return { ...m, signature: sig(man) }; });
doc.engines = (doc.engines || []).map((e) => ({ ...e, signature: sig(e) }));
delete doc.signature;
doc.signature = sig(doc);
writeFileSync(output, JSON.stringify(doc, null, 2) + "\n");
console.log(`signed ${doc.models.length} models, ${doc.engines.length} engine packages; public key ${createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12).toString("base64")}`);
