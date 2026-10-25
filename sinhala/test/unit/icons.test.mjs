// The ribbon icon registry: every command has its own icon (both themes, every scale), a label and a
// tooltip; the build refuses anything else; the built toolbar hands the editor per-command templates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { COMMANDS, ICONS, SCALES, SIZE, THEMES, iconFile, sourceHash, validateRegistry } from "../../plugin/icons/registry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "plugin", "src");
const exists = (f) => { try { return statSync(join(src, f)).isFile(); } catch { return false; } };

test("the registry is valid: an icon, a label and a tooltip per command, no icon used twice", () => {
  assert.deepEqual(validateRegistry(COMMANDS, ICONS, exists), []);
  assert.deepEqual(COMMANDS.map((c) => c.id),
    ["inputMode", "sinhalaFont", "ime", "suggestions", "convertSelection", "convertDocument", "toLegacy", "toUnicode", "detect", "validate", "panel"]);
  assert.deepEqual(COMMANDS.filter((c) => c.group).map((c) => c.id), ["inputMode", "convertSelection", "detect", "panel"]);
  for (const c of COMMANDS) assert.ok(c.label.length <= 15, `${c.id}: "${c.label}" fits a big button's two lines`);
});

test("validateRegistry reports a missing icon, tooltip, duplicate and missing file", () => {
  const bad = [
    { id: "a", icon: "keyboard", label: "A", hint: "a" },
    { id: "b", icon: "keyboard", label: "B", hint: "b" },
    { id: "c", icon: "nope", label: "C", hint: "c" },
    { id: "d", icon: "type", label: "D" },
    { id: "a", icon: "fallback", label: "E", hint: "e" }
  ];
  const p = validateRegistry(bad, ICONS, (f) => !f.includes("dark/type@2x"));
  for (const want of ["b: icon keyboard is also a's", "c: no icon nope", "d: no tooltip", "a: duplicate command",
    "a: uses the fallback icon", "d: resources/icons/dark/type@2x.png is missing"]) {
    assert.ok(p.some((x) => x.startsWith(want)), want + " in " + p.join("; "));
  }
});

test("the committed PNGs exist at every size and match the registry's SVGs", () => {
  const rendered = JSON.parse(readFileSync(join(root, "plugin", "icons", "rendered.json"), "utf8"));
  for (const theme of Object.keys(THEMES)) for (const name of Object.keys(ICONS)) {
    assert.equal(rendered[`${theme}/${name}`], sourceHash(theme, name), `${theme}/${name} rendered from the current SVG`);
    for (const scale of SCALES) {
      const png = readFileSync(join(src, iconFile(theme, name, scale)));
      assert.equal(png.readUInt32BE(16), Math.round(SIZE * scale / 100), `${theme}/${name}@${scale} width`);
    }
  }
  assert.notDeepEqual(readFileSync(join(src, iconFile("light", "type", 100))), readFileSync(join(src, iconFile("dark", "type", 100))));
});

test("the built plugin: per-command icon templates that resolve to packaged files, and the build fails on a bad registry", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ws-sinhala-icons-"));
  try {
    const out = join(tmp, "dist");
    execFileSync(process.execPath, [join(root, "scripts", "build-plugin.mjs"), "--out", out], { stdio: "pipe" });
    const ctx = vm.createContext({});
    vm.runInContext(readFileSync(join(out, "scripts", "toolbar.js"), "utf8") + "\nthis.T = WorkSuiteSinhalaToolbar;", ctx);
    const items = ctx.T.items;
    assert.equal(new Set(items.map((i) => i.icons)).size, items.length, "no two buttons share an icon");
    for (const i of items) {
      assert.match(i.icons, /^resources\/icons\/%theme-type%\(light\|dark\)\/[a-z-]+%scale%\(default\)\.%extension%\(png\)$/);
      for (const theme of ["light", "dark"]) for (const scale of ["", "@1.25x", "@1.5x", "@1.75x", "@2x"]) {
        // what the editor's iconsStr2IconsObj makes of the template
        const f = i.icons.replace("%theme-type%(light|dark)", theme).replace("%scale%(default)", scale).replace("%extension%(png)", "png");
        statSync(join(out, f));
      }
    }
    statSync(join(out, "licenses", "lucide-icons-ISC.txt"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
