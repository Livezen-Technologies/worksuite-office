// Renders the toolbar icons (plugin/src/resources/svg/*.svg, 28x28, currentColor) to the PNGs the
// editors load: resources/{light,dark}/<name><scale>.png at 100%, 125%, 150%, 175% and 200%, in the
// toolbar's icon colours (#444 on light themes, #e6e6e6 on dark ones). Needs Playwright's Chromium
// (PLAYWRIGHT_BROWSERS_PATH); the PNGs are committed, so the plugin build does not.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(join(process.execPath, "..", "..", "lib", "node_modules", "playwright")); }
const res = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "src", "resources");
const SCALES = [["", 1], ["@1.25x", 1.25], ["@1.5x", 1.5], ["@1.75x", 1.75], ["@2x", 2]];
const THEMES = { light: "#444444", dark: "#e6e6e6" };

const browser = await pw.chromium.launch();
for (const [suffix, scale] of SCALES) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 28, height: 28 } });
  for (const file of readdirSync(join(res, "svg")).filter((f) => f.endsWith(".svg")).sort()) {
    const svg = readFileSync(join(res, "svg", file), "utf8");
    for (const [theme, color] of Object.entries(THEMES)) {
      await page.setContent(`<html><body style="margin:0;background:transparent;color:${color}">${svg}</body></html>`);
      const png = await page.locator("svg").screenshot({ omitBackground: true });
      writeFileSync(join(res, theme, file.replace(/\.svg$/, "") + suffix + ".png"), png);
    }
  }
  await page.close();
}
await browser.close();
console.log("icons written to", res);
