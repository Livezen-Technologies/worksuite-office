import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const src = join(root, "plugin", "src");
const require = createRequire(import.meta.url);
export const lib = (name) => require(join(src, "lib", name + ".js"));
export function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}
