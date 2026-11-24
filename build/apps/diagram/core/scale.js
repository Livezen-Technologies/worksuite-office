/*
 * WorkSuite Diagram: drawing scale, measurements and print tiling (roadmap stage 6). Pure ES module, no DOM.
 *
 * A page can have a drawing scale, { paper, paperUnit, real, realUnit }: `paper` of paperUnit on the page stands for
 * `real` of realUnit in the world (1 cm = 1 m, or 1:100 as 1 mm = 100 mm). Shape sizes and dimension lines then read
 * in real units. Pages are measured in points (1/72 inch).
 * A page bigger than the paper prints at actual size across several sheets: tiles() cuts it up.
 */

export const UNITS = { mm: 72 / 25.4, cm: 720 / 25.4, m: 72000 / 25.4, km: 72000000 / 25.4, in: 72, ft: 864, yd: 2592, mi: 4561920 };
export const PAPER_UNITS = ["mm", "cm", "in"];
export const PRESETS = [
  { id: "1:20", name: "1:20 (metric)", scale: { paper: 1, paperUnit: "mm", real: 20, realUnit: "mm" } },
  { id: "1:50", name: "1:50 (metric)", scale: { paper: 1, paperUnit: "cm", real: 0.5, realUnit: "m" } },
  { id: "1:100", name: "1:100 (metric)", scale: { paper: 1, paperUnit: "cm", real: 1, realUnit: "m" } },
  { id: "1:200", name: "1:200 (metric)", scale: { paper: 1, paperUnit: "cm", real: 2, realUnit: "m" } },
  { id: "1:1000", name: "1:1000 (site plans)", scale: { paper: 1, paperUnit: "cm", real: 10, realUnit: "m" } },
  { id: "1/4in", name: "1/4 in = 1 ft (architectural)", scale: { paper: 0.25, paperUnit: "in", real: 1, realUnit: "ft" } },
  { id: "1/8in", name: "1/8 in = 1 ft (architectural)", scale: { paper: 0.125, paperUnit: "in", real: 1, realUnit: "ft" } },
];
export const PAPERS = { A4: { w: 595, h: 842 }, A3: { w: 842, h: 1191 }, Letter: { w: 612, h: 792 }, Legal: { w: 612, h: 1008 } };

/** Why a drawing scale is wrong, or "" (left out is fine). */
export function scaleError(scale) {
  if (scale === undefined) return "";
  if (!scale || typeof scale !== "object") return "a drawing scale is { paper, paperUnit, real, realUnit }";
  if (!(scale.paper > 0) || !(scale.real > 0)) return "a drawing scale's amounts are more than 0";
  if (!PAPER_UNITS.includes(scale.paperUnit)) return `a drawing scale's page unit is one of ${PAPER_UNITS.join(", ")}`;
  if (!(scale.realUnit in UNITS)) return `a drawing scale's real unit is one of ${Object.keys(UNITS).join(", ")}`;
  return "";
}

/** Points on the page to real length (in the scale's real unit; without a scale, millimetres on the page). */
export const toReal = (points, scale) => (scale ? (points * scale.real) / (scale.paper * UNITS[scale.paperUnit]) : points / UNITS.mm);
/** Real length back to points on the page. */
export const fromReal = (length, scale) => (scale ? (length * scale.paper * UNITS[scale.paperUnit]) / scale.real : length * UNITS.mm);
export const unitOf = (scale) => (scale ? scale.realUnit : "mm");

/** A length for people: "4.25 m", "12 ft 6 in" for feet, at most two decimals. */
export function formatLength(points, scale) {
  const v = toReal(points, scale), unit = unitOf(scale);
  if (unit === "ft") {
    let ft = Math.floor(v + 1e-9), inch = Math.round((v - ft) * 12);
    if (inch === 12) { ft += 1; inch = 0; }
    return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
  }
  return `${trim(v)} ${unit}`;
}
const trim = (n) => String(Math.round(n * 100) / 100);

/** The ratio a scale stands for, "1:100", when both sides are lengths. */
export function ratioOf(scale) {
  if (!scale) return "1:1";
  const r = (scale.real * UNITS[scale.realUnit]) / (scale.paper * UNITS[scale.paperUnit]);
  return `1:${trim(r)}`;
}
/** How a scale reads: "1 cm = 1 m (1:100)". */
export const scaleText = (scale) => (scale ? `${trim(scale.paper)} ${scale.paperUnit} = ${trim(scale.real)} ${scale.realUnit} (${ratioOf(scale)})` : "No scale (1:1)");

/**
 * The sheets a page prints on at actual size: [{ x, y, w, h, row, col }] in page points, each the printable part of a
 * sheet (paper less margins), in reading order. The paper is turned whichever way takes fewer sheets.
 * { paper: { w, h } in points, margin in points }.
 */
export function tiles(pageW, pageH, { paper = PAPERS.A4, margin = 28 } = {}) {
  const cut = (pw, ph) => {
    const tw = pw - 2 * margin, th = ph - 2 * margin;
    return { tw, th, cols: Math.max(1, Math.ceil(pageW / tw - 1e-9)), rows: Math.max(1, Math.ceil(pageH / th - 1e-9)) };
  };
  const portrait = cut(paper.w, paper.h), landscape = cut(paper.h, paper.w);
  const best = landscape.cols * landscape.rows < portrait.cols * portrait.rows ? { ...landscape, landscape: true } : { ...portrait, landscape: false };
  const out = [];
  for (let row = 0; row < best.rows; row++) for (let col = 0; col < best.cols; col++)
    out.push({ x: col * best.tw, y: row * best.th, w: best.tw, h: best.th, row: row + 1, col: col + 1 });
  out.landscape = best.landscape;
  out.rows = best.rows; out.cols = best.cols;
  return out;
}
