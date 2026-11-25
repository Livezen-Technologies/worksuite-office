/*
 * WorkSuite Diagram: stencils, "My shapes" (roadmap stage 6). Pure ES module, no DOM.
 *
 * A diagram may carry a stencil: { name, shapes: [{ id, name, shape }] }, where `shape` is a shape as the page holds
 * it, less its place: { type, w, h, path?, text, style, data? }. The panel shows it as a library; dropping one adds a
 * copy. Shapes come from the page (Add to My shapes) or from a Visio stencil (.vssx, vsdx.js fromVssx), and the
 * stencil is saved as a .vssx (toVssx) for Visio or another WorkSuite diagram.
 */
import { dataError } from "./shapedata.js";

export const MAX_STENCIL_SHAPES = 500;
const KEEP = ["type", "w", "h", "path", "text", "style", "data"];

/** Why a stencil is wrong, or "" (left out is fine). */
export function stencilError(st) {
  if (st === undefined) return "";
  if (!st || typeof st !== "object" || !Array.isArray(st.shapes)) return "a stencil is a name and a list of shapes";
  if (typeof st.name !== "string" || !st.name.trim() || st.name.length > 120) return "a stencil needs a name of up to 120 characters";
  if (st.shapes.length > MAX_STENCIL_SHAPES) return `a stencil holds at most ${MAX_STENCIL_SHAPES} shapes`;
  const ids = new Set();
  for (const e of st.shapes) {
    if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id)) return "each stencil shape needs its own id";
    ids.add(e.id);
    if (typeof e.name !== "string" || !e.name.trim()) return `stencil shape ${e.id}: it needs a name`;
    const s = e.shape;
    if (!s || typeof s.type !== "string" || !s.type || !(s.w > 0) || !(s.h > 0)) return `stencil shape ${e.id}: it needs a type and a size`;
    if (s.type === "path" && typeof s.path !== "string") return `stencil shape ${e.id}: a drawn shape needs its outline`;
    if (dataError(s.data)) return `stencil shape ${e.id}: ${dataError(s.data)}`;
  }
  return "";
}

/** A page shape as a stencil shape (its place, layer and links left behind). */
export function entryFrom(shape, id, name = "") {
  const kept = {};
  for (const k of KEEP) if (shape[k] !== undefined) kept[k] = structuredClone(shape[k]);
  kept.text ??= "";
  kept.style ??= {};
  return { id, name: (name || shape.text || shape.type).split("\n")[0].trim().slice(0, 80) || shape.type, shape: kept };
}

/** A stencil shape as fields for DiagramModel.addShape, centred on `at` ({ x, y }). */
export function shapeFrom(entry, at) {
  const s = structuredClone(entry.shape);
  return { ...s, x: Math.round(at.x - s.w / 2), y: Math.round(at.y - s.h / 2) };
}
