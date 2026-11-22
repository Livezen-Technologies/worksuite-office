/*
 * WorkSuite Diagram: data graphics (roadmap stage 6), Visio's Data Graphics. Pure ES module, no DOM.
 *
 * A page's `graphics` say how shapes show their shape data (shapedata.js):
 *   { field, rules: "red if = \"Late\"; yellow if = \"At risk\"; green", fill: true, icon: true, bar: { field, max } }
 * `rules` use the same words as Project's indicators (formula.js): the first rule that holds picks a colour; `fill`
 * tints the shape with it and `icon` puts its mark in the shape's corner. `bar` draws a bar under each shape with a
 * number in `bar.field`, full at `bar.max`. A shape without the field is left as it is.
 */
import { parseIndicators, indicatorFor, ICONS } from "../../project/core/formula.js";

/** The tint each rule colour gives a shape's fill. */
export const TINTS = { red: "#fecaca", yellow: "#fef08a", green: "#bbf7d0", blue: "#bfdbfe", flag: "#fecaca", check: "#bbf7d0", warn: "#fde68a", cross: "#fecaca", star: "#fef08a" };

/** What is wrong with a page's graphics, or null. */
export function graphicsError(g) {
  if (g === undefined) return null;
  if (!g || typeof g !== "object") return "data graphics must be a set of options";
  if (g.rules !== undefined) {
    if (typeof g.field !== "string" || !g.field.trim()) return "data graphics need the shape data they read";
    try { parseIndicators(g.rules); } catch (e) { return `data graphics: ${e.message}`; }
  }
  if (g.bar !== undefined) {
    if (typeof g.bar?.field !== "string" || !g.bar.field.trim()) return "a data bar needs the shape data it reads";
    if (!(Number.isFinite(g.bar.max) && g.bar.max > 0)) return "a data bar needs a full value more than 0";
  }
  return null;
}

const valueOf = (shape, field) => (shape.data || []).find((d) => d.label.toLowerCase() === String(field).toLowerCase())?.value;

/** How a shape looks under the page's graphics: { fill?, icon?, bar? (0..1), barLabel? } (nothing for no change). */
export function graphicFor(shape, g) {
  const out = {};
  if (!g || shape.type === "lane") return out;
  if (g.rules && g.field) {
    const v = valueOf(shape, g.field);
    if (v !== undefined && v !== "") {
      let rules;
      try { rules = parseIndicators(g.rules); } catch { rules = []; }
      const k = indicatorFor(rules, v);
      if (k) { if (g.fill !== false) out.fill = TINTS[k]; if (g.icon) out.icon = ICONS[k]; }
    }
  }
  if (g.bar?.field) {
    const v = valueOf(shape, g.bar.field);
    if (typeof v === "number") { out.bar = Math.max(0, Math.min(1, v / g.bar.max)); out.barLabel = `${g.bar.field}: ${v}`; }
  }
  return out;
}

/** The shape data labels used on a page, for choosing a field. */
export const dataLabels = (page) => [...new Set(page.items.flatMap((i) => (i.data || []).map((d) => d.label)))].sort((a, b) => a.localeCompare(b));
