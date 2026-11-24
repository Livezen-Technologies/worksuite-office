/*
 * WorkSuite Diagram plugin (#85): a diagram inside a document, spreadsheet or presentation, as an OLE object.
 * Insert: an empty diagram opens; Insert puts the picture and the diagram into the document.
 * Double-click the object later: the plugin opens with its diagram (Asc.plugin.init gets the data), and
 * Insert puts the changes back (EditOleObject). Free viewing, Pro editing: without Pro the diagram opens
 * read-only and Insert only closes the window (common/licence.js, asked through the editor frame).
 */
import { checkEdit, reasonText } from "./apps/common/licence.js";
import { olePayload, oleMethod } from "./ole.js";

const plugin = window.Asc.plugin;
const frame = document.getElementById("wd-editor");
let api = null, readOnly = false;

const ready = new Promise((resolve) => {
  const check = () => { const a = frame.contentWindow && frame.contentWindow.WorkSuiteDiagram; if (a) resolve(a); else setTimeout(check, 50); };
  frame.addEventListener("load", check);
  check();
});

plugin.init = async function (data) {
  api = await ready;
  if (typeof data === "string" && data.trim().startsWith("{")) {
    try { api.load(data, "Diagram.wsdiagram"); } catch (e) { /* not ours: start empty rather than fail */ }
  }
  const licence = await checkEdit("diagram.edit", window, window.parent);
  readOnly = !licence.edit;
  api.setReadOnly(readOnly);
  if (readOnly) frame.contentWindow.document.title = reasonText(licence.reason);
};

/** The drawing as a PNG data URL at twice its size, from its cropped SVG. */
function rasterize(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round((width * 96) / 72 * scale); c.height = Math.round((height * 96) / 72 * scale);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("the diagram could not be drawn as a picture"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

const IN_WINDOW = new URLSearchParams(location.search).has("window"); // a window of the Insert › Diagram button
const closeMe = () => (IN_WINDOW ? plugin.sendToPlugin("onWindowClose", {}) : plugin.executeCommand("close", ""));

plugin.button = async function (id) {
  if (id !== 0 || readOnly || !api) { closeMe(); return; }
  try {
    const fit = api.svgFit(16);
    const drawing = { data: api.text(), imgSrc: await rasterize(fit.svg, fit.width, fit.height), widthPt: fit.width, heightPt: fit.height };
    // opened from Insert › Diagram (toolbar.js): the background part inserts it
    if (IN_WINDOW) { plugin.sendToPlugin("onDiagramInsert", drawing); return; }
    const payload = olePayload({ guid: plugin.info.guid, ...drawing, objectId: plugin.info.objectId });
    plugin.executeMethod(oleMethod(plugin.info.objectId), [payload], () => plugin.executeCommand("close", ""));
  } catch (e) {
    closeMe();
  }
};
