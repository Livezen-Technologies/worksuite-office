import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@worksuite/sinhala-core": resolve(__dirname, "../sinhala/core/src/index.ts") } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 20000, pool: "forks" },
});
