// Bundles the service into one CommonJS file (dist/worksuite-ai.cjs), the input of the Node SEA build.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [resolve(root, "src/cli.ts")],
  outfile: resolve(root, "dist/worksuite-ai.cjs"),
  bundle: true, platform: "node", target: "node22", format: "cjs", minify: false, sourcemap: false, legalComments: "eof",
  alias: { "@worksuite/sinhala-core": resolve(root, "../sinhala/core/src/index.ts") },
  // ws's optional native helpers are not shipped
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "info",
});
