// Bundles the service into one CommonJS file (dist/worksuite-ai.cjs), the input of the Node SEA build.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The production licence public key(s), from the build's WS_LICENSE_PUBLIC_KEYS (a repository variable): raw 32-byte
// Ed25519 keys, base64, comma-separated. A malformed one stops the build rather than shipping an app that rejects
// every licence.
const licenseKeys = (process.env.WS_LICENSE_PUBLIC_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
for (const k of licenseKeys) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(k) || Buffer.from(k, "base64").length !== 32) {
    console.error(`WS_LICENSE_PUBLIC_KEYS: "${k}" is not a base64 Ed25519 public key (32 bytes)`);
    process.exit(1);
  }
}
console.log(licenseKeys.length ? `Licence keys pinned: ${licenseKeys.length}` : "Licence keys pinned: none (licences need WS_AI_LICENSE_KEYS at run time)");
await build({
  entryPoints: [resolve(root, "src/cli.ts")],
  outfile: resolve(root, "dist/worksuite-ai.cjs"),
  bundle: true, platform: "node", target: "node22", format: "cjs", minify: false, sourcemap: false, legalComments: "eof",
  alias: { "@worksuite/sinhala-core": resolve(root, "../sinhala/core/src/index.ts") },
  // ws's optional native helpers and pdf.js's optional canvas (drawing, unused: only text is read)
  external: ["bufferutil", "utf-8-validate", "canvas"],
  define: { __WS_LICENSE_PUBLIC_KEYS__: JSON.stringify(licenseKeys.join(",")) },
  logLevel: "info",
});
