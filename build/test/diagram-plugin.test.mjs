// diagram-plugin/ (#85): WorkSuite Diagram inside documents as an OLE object. The plugin's config (a modal, visual
// plugin holding OLE data, for the three editors), the object it inserts or edits (the diagram as data, a PNG as
// the picture, its size in mm and pixels), and the build step that assembles it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { olePayload, oleMethod, pictureSize } from "../../diagram-plugin/ole.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(readFileSync(join(root, "diagram-plugin", "config.json"), "utf8"));
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const DATA = JSON.stringify({ app: "worksuite.diagram", v: 1, name: "D", pages: [] });

test("the plugin is a modal, visual plugin that keeps OLE data, in the three editors", () => {
  assert.match(config.guid, /^asc\.\{[0-9A-F-]{36}\}$/);
  const v = config.variations[0];
  assert.equal(v.initDataType, "ole");
  assert.equal(v.isVisual, true);
  assert.equal(v.isModal, true);
  assert.deepEqual(v.EditorsSupport, ["word", "cell", "slide"]);
  assert.deepEqual(v.buttons.map((b) => b.text), ["Insert", "Cancel"]);
  for (const icon of v.icons) assert.ok(existsSync(join(root, "diagram-plugin", icon)), icon);
  assert.notEqual(config.guid, JSON.parse(readFileSync(join(root, "ai-plugin", "plugin", "src", "config.json"), "utf8")).guid);
});

test("picture size: points → pixels at 2× and mm in the document", () => {
  assert.deepEqual(pictureSize(72, 36), { widthPix: 192, heightPix: 96, width: 25.4, height: 12.7 });
  assert.deepEqual(pictureSize(0, 0).widthPix, 1);
});

test("the object: insert new, edit existing", () => {
  const add = olePayload({ guid: config.guid, data: DATA, imgSrc: PNG, widthPt: 144, heightPt: 72 });
  assert.equal(oleMethod(null), "AddOleObject");
  assert.equal(add.objectId, undefined);
  assert.deepEqual([add.width, add.height, add.widthPix, add.heightPix], [50.8, 25.4, 384, 192]);
  assert.equal(add.data, DATA);
  const edit = olePayload({ guid: config.guid, data: DATA, imgSrc: PNG, widthPt: 144, heightPt: 72, objectId: "42" });
  assert.equal(oleMethod("42"), "EditOleObject");
  assert.equal(edit.objectId, "42");
});

test("refuses what would put a broken object into a document", () => {
  assert.throws(() => olePayload({ guid: "nope", data: DATA, imgSrc: PNG, widthPt: 1, heightPt: 1 }), /guid/);
  assert.throws(() => olePayload({ guid: config.guid, data: "{}", imgSrc: PNG, widthPt: 1, heightPt: 1 }), /not a WorkSuite diagram/);
  assert.throws(() => olePayload({ guid: config.guid, data: DATA, imgSrc: "data:image/svg+xml,", widthPt: 1, heightPt: 1 }), /PNG/);
});

test("the build adds the plugin next to the AI plugin, on every platform", () => {
  const script = readFileSync(join(root, "build", "v10", "diagram-plugin.sh"), "utf8");
  for (const part of ["common", "diagram/core", "diagram/editor", "project/core"]) assert.ok(script.includes(part), part);
  assert.match(readFileSync(join(root, "build", "v10", "prepare.sh"), "utf8"), /diagram-plugin\.sh/);
  assert.match(readFileSync(join(root, ".github", "workflows", "build-mac.yml"), "utf8"), /diagram-plugin\.sh/);
});

test("Insert › Diagram: a background part puts the button on the Insert tab, and its window inserts the drawing", async () => {
  const { toolbarItems, TOOLBAR_ITEM, INSERT_TAB, WINDOW } = await import("../../diagram-plugin/ribbon.js");
  const bg = config.variations[1];
  assert.equal(bg.type, "background");
  assert.equal(bg.url, "toolbar.html");
  assert.deepEqual(bg.events, ["onToolbarMenuClick"]);
  assert.deepEqual(bg.EditorsSupport, ["word", "cell", "slide"]);
  assert.equal(config.variations[0].initDataType, "ole", "the modal editor stays first: double-clicking an object opens it");
  const t = toolbarItems(config.guid);
  assert.equal(t.guid, config.guid);
  assert.equal(t.tabs[0].id, INSERT_TAB);
  assert.equal(t.tabs[0].items[0].id, TOOLBAR_ITEM);
  assert.equal(t.tabs[0].items[0].lockInViewMode, true);
  assert.ok(existsSync(join(root, "diagram-plugin", "resources", "light", "icon@2x.png")) && existsSync(join(root, "diagram-plugin", "resources", "dark", "icon.png")));
  assert.equal(WINDOW.url, "index.html?window");
  for (const f of ["toolbar.html", "toolbar.js"]) assert.ok(existsSync(join(root, "diagram-plugin", f)), f);
  const js = readFileSync(join(root, "diagram-plugin", "toolbar.js"), "utf8");
  assert.match(js, /AddToolbarMenuItem/);
  assert.match(js, /attachToolbarMenuClickEvent\(TOOLBAR_ITEM/);
  assert.match(js, /"AddOleObject"/);
  assert.match(readFileSync(join(root, "diagram-plugin", "plugin.js"), "utf8"), /sendToPlugin\("onDiagramInsert"/);
});
