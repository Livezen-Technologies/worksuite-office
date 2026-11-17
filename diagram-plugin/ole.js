/*
 * WorkSuite Diagram in documents (#85): the OLE object the editors keep for a diagram. Pure, so the tests cover it.
 * The object holds the diagram itself (its canonical JSON, the same as a .wsdiagram's document.json) as its data,
 * and a PNG of it as the picture people see; double-clicking the object opens this plugin with that data again.
 */
export const MM_PER_PX = 25.4 / 96;

/** Picture size: points of the drawing → pixels at `scale`, and the size it takes in the document in mm. */
export function pictureSize(widthPt, heightPt, scale = 2) {
  const widthPix = Math.max(1, Math.round((widthPt * 96) / 72 * scale)), heightPix = Math.max(1, Math.round((heightPt * 96) / 72 * scale));
  return { widthPix, heightPix, width: Math.round((widthPt * 25.4) / 72 * 100) / 100, height: Math.round((heightPt * 25.4) / 72 * 100) / 100 };
}

/** The argument of AddOleObject / EditOleObject. objectId: the object being edited (absent when inserting). */
export function olePayload({ guid, data, imgSrc, widthPt, heightPt, objectId = null, scale = 2 }) {
  if (!/^asc\.\{[0-9A-F-]{36}\}$/i.test(guid || "")) throw new Error("the plugin guid is missing");
  if (typeof data !== "string" || !data.includes('"worksuite.diagram"')) throw new Error("not a WorkSuite diagram");
  if (!/^data:image\/png;base64,/.test(imgSrc || "")) throw new Error("the picture must be a PNG data URL");
  const size = pictureSize(widthPt, heightPt, scale);
  const out = { guid, data, imgSrc, width: size.width, height: size.height, widthPix: size.widthPix, heightPix: size.heightPix };
  if (objectId !== null && objectId !== undefined && objectId !== "") out.objectId = objectId;
  return out;
}

/** The method to call: EditOleObject for an object being edited, AddOleObject for a new one. */
export const oleMethod = (objectId) => (objectId !== null && objectId !== undefined && objectId !== "" ? "EditOleObject" : "AddOleObject");
