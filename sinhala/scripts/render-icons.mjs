// Renders plugin/icons/registry.mjs to plugin/src/resources/icons/<theme>/<name>[@<scale>x].png with
// Chromium (Playwright), and plugin/icons/rendered.json, the sha256 of each icon's SVG source, so the
// build and the tests notice an icon edited without rendering again. Run after changing the registry:
//   node scripts/render-icons.mjs            (needs `playwright` resolvable and its Chromium)
// The PNGs are committed: the plugin build itself needs no image tools.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONS, SCALES, SIZE, THEMES, iconFile, sourceHash, svg } from "../plugin/icons/registry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(join(process.env.NPM_GLOBAL || "/opt/node22/lib/node_modules", "playwright")); }

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
const stamp = {};
for (const theme of Object.keys(THEMES)) {
  for (const name of Object.keys(ICONS).sort()) {
    stamp[`${theme}/${name}`] = sourceHash(theme, name);
    for (const scale of SCALES) {
      const px = Math.round(SIZE * scale / 100);
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg(name, THEMES[theme]).replace("<svg ", `<svg style="display:block;width:${px}px;height:${px}px" `)}</body></html>`);
      const file = join(root, "plugin", "src", iconFile(theme, name, scale));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } }));
    }
  }
}
await browser.close();
writeFileSync(join(root, "plugin", "icons", "rendered.json"), JSON.stringify(stamp, null, 2) + "\n");
console.log(`rendered ${Object.keys(stamp).length} icons x ${SCALES.length} scales`);
