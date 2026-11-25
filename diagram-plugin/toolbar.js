/*
 * WorkSuite Diagram plugin, background part: a Diagram button on the Insert tab of the document, spreadsheet and
 * presentation editors. The button opens the Diagram editor (index.html) in a window; its Insert sends the drawing
 * here, and this inserts it as the same OLE object the modal plugin makes, so double-clicking it later opens the
 * diagram to change, as before.
 */
import { olePayload } from "./ole.js";
import { TOOLBAR_ITEM, toolbarItems, WINDOW } from "./ribbon.js";

const plugin = window.Asc.plugin;
let win = null;

function openEditor() {
  if (win) return;
  win = new window.Asc.PluginWindow();
  win.attachEvent("onDiagramInsert", (d) => {
    try {
      const payload = olePayload({ guid: plugin.info.guid, data: d.data, imgSrc: d.imgSrc, widthPt: d.widthPt, heightPt: d.heightPt });
      plugin.executeMethod("AddOleObject", [payload], close);
    } catch (e) { close(); }
  });
  win.attachEvent("onWindowClose", close);
  win.show({ ...WINDOW, buttons: [{ text: plugin.tr ? plugin.tr("Insert") : "Insert", primary: true }, { text: plugin.tr ? plugin.tr("Cancel") : "Cancel", primary: false }] });
}
function close() { if (win) { const w = win; win = null; try { w.close(); } catch (e) { /* already closed */ } } }

plugin.init = function () {
  plugin.executeMethod("AddToolbarMenuItem", [toolbarItems(plugin.info.guid)]);
  plugin.attachToolbarMenuClickEvent(TOOLBAR_ITEM, openEditor);
};
plugin.button = function () { close(); };
