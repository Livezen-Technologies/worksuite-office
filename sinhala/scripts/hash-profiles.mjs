// Writes each profile's sha256 (over the canonical JSON of everything but the sha256 field).
// Run it after changing a profile, and raise the profile's version: same input + same profile version
// must give the same output. With --check it only reports profiles whose sha256 is stale.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { canonicalJson, sha256Hex } = require("../core/dist/src/sha256.js");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "core", "profiles");
const check = process.argv.includes("--check");
let stale = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  const profile = JSON.parse(text);
  const { sha256, ...rest } = profile;
  const hash = sha256Hex(canonicalJson(rest));
  if (hash === sha256) continue;
  stale++;
  if (check) {
    console.error(`${file}: sha256 is ${sha256 || "empty"}, should be ${hash}`);
  } else {
    writeFileSync(path, text.replace(/"sha256": "[0-9a-f]*"/, `"sha256": "${hash}"`));
    console.log(`${file}: ${hash}`);
  }
}
process.exit(check && stale ? 1 : 0);
