// The shared look (common/office.css, common/theme.js): both apps load it, and the theme follows WorkSuite Office.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../apps/${p}`, import.meta.url), "utf8");

test("both apps load the theme first and the editors' look after their own styles", () => {
  for (const app of ["project", "diagram"]) {
    const html = read(`${app}/editor/index.html`);
    const theme = html.indexOf("common/theme.js"), own = html.indexOf('href="editor.css"'), look = html.indexOf("common/office.css");
    assert.ok(theme > 0 && theme < own && own < look, app);
  }
});

test("the theme is read from the address, the desktop shell, then the editors' saved choice", () => {
  const run = ({ search = "", renderer, store = {} }) => {
    const attrs = {};
    const ctx = {
      location: { search }, URLSearchParams,
      localStorage: { getItem: (k) => store[k] ?? null },
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } } },
      addEventListener() {},
    };
    ctx.window = ctx;
    if (renderer) ctx.RendererProcessVariable = { theme: renderer };
    vm.runInNewContext(read("common/theme.js"), ctx);
    return attrs;
  };
  assert.deepEqual(run({ search: "?theme=dark" }), { "data-theme": "dark" });
  assert.deepEqual(run({ renderer: { id: "theme-contrast-dark", type: "dark" } }), { "data-theme": "dark", "data-contrast": "" });
  assert.deepEqual(run({ renderer: { id: "theme-classic-light", type: "light" } }), { "data-theme": "light" });
  assert.deepEqual(run({ store: { "ui-theme-id": "theme-dark" } }), { "data-theme": "dark" });
  assert.deepEqual(run({ store: { "ui-theme": JSON.stringify({ id: "theme-white", type: "light" }) } }), { "data-theme": "light" });
  assert.deepEqual(run({ store: { "ui-theme-id": "theme-system" } }), {}, "the system's: left to prefers-color-scheme");
  assert.deepEqual(run({}), {});
});

test("the header's end: initials, the Editing / Viewing switch, and the editors' own icons in the toolbar", async () => {
  const { initials } = await import("../apps/common/headerbar.js");
  assert.equal(initials("Mia Silva"), "MS");
  assert.equal(initials(" hasa "), "H");
  assert.equal(initials(""), "");
  const { iconSvg } = await import("../apps/common/ribbon.js");
  const { EDITOR_ICONS } = await import("../apps/common/editor-icons.js");
  assert.ok(Object.keys(EDITOR_ICONS).length >= 40);
  assert.match(iconSvg("undo"), /currentColor/);
  assert.doesNotMatch(iconSvg("undo"), /#000/, "drawn in the theme's colour");
  assert.match(iconSvg("gantt"), /stroke="currentColor"/, "our own where the editors have none");
  for (const app of ["project", "diagram"]) assert.match(read(`${app}/editor/editor.js`), /mountHeaderbar\(/, app);
});
