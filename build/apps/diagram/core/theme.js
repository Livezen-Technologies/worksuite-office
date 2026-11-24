/*
 * WorkSuite Diagram: themes and variants, backgrounds, and borders and titles (roadmap stage 6). Pure ES module, no DOM.
 *
 * A page can carry a theme, { id, variant }: four accent colours and a line colour for connectors. Each shape takes
 * the accent for its kind (processes, decisions, starts and ends, data), drawn the variant's way: light (pale fill,
 * coloured outline), bold (coloured fill, white text) or outline (white fill). A shape's own fill and line colours
 * always win. Lanes, containers, callouts and floor plan shapes keep their own colours.
 * A page can also have a background colour, and a border: a thin frame with a title box, or a band across the top
 * holding the title.
 */

export const THEMES = [
  { id: "office", name: "Office", accents: ["#2563eb", "#d97706", "#0891b2", "#7c3aed"], connector: "#475569" },
  { id: "ocean", name: "Ocean", accents: ["#0369a1", "#0d9488", "#1d4ed8", "#0e7490"], connector: "#334155" },
  { id: "forest", name: "Forest", accents: ["#15803d", "#a16207", "#047857", "#4d7c0f"], connector: "#3f3f46" },
  { id: "sunset", name: "Sunset", accents: ["#c2410c", "#be123c", "#b45309", "#9f1239"], connector: "#57534e" },
  { id: "berry", name: "Berry", accents: ["#7e22ce", "#be185d", "#6d28d9", "#a21caf"], connector: "#52525b" },
  { id: "slate", name: "Slate", accents: ["#334155", "#64748b", "#1e293b", "#475569"], connector: "#1e293b" },
];
export const VARIANTS = ["light", "bold", "outline"];
export const BORDERS = ["frame", "band"];
export const BORDER_TITLE_H = 36; // the band's height, and the frame's title box
const HEX = /^#[0-9a-f]{6}$/i;

// the accent each kind of shape takes: 1 decisions, 2 starts and ends, 3 data and documents, 0 everything else
const SLOT = {
  diamond: 1, gateway: 1,
  terminator: 2, ellipse: 2, event: 2, endevent: 2, actor: 2,
  data: 3, database: 3, document: 3, manual: 3, note: 3, bucket: 3, queue: 3,
};
// shapes that keep their own colours whatever the theme
const OWN = new Set(["dimension", "lane", "pool", "container", "callout", "room", "wall", "door", "window", "stairs", "table", "desk", "sofa"]);

/** Mixes a colour toward white (k > 0) or black (k < 0) by |k| (0 to 1). */
export function mix(hex, k) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  const out = c.map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Contrast ratio of two colours (WCAG). */
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** The accent darkened just enough for white text to read on it (4.5:1). */
const forWhite = (a) => { let c = a; for (let k = 0.08; contrast(c, "#ffffff") < 4.5 && k < 1; k += 0.08) c = mix(a, -k); return c; };

export const themeById = (id) => THEMES.find((t) => t.id === id) || null;

/** Why a page's theme is wrong, or "" when it is fine (left out is fine). */
export function themeError(theme) {
  if (theme === undefined) return "";
  if (!theme || !themeById(theme.id)) return `unknown theme ${theme?.id}`;
  if (!VARIANTS.includes(theme.variant)) return `a theme's variant is one of ${VARIANTS.join(", ")}`;
  return "";
}
/** Why a page's background or border is wrong, or "". */
export function pageLookError(page) {
  if (page.background !== undefined && !HEX.test(page.background)) return "a background is a colour like #f8fafc";
  const b = page.border;
  if (b !== undefined) {
    if (!b || !BORDERS.includes(b.style)) return `a border is one of ${BORDERS.join(", ")}`;
    if (b.title !== undefined && typeof b.title !== "string") return "a border's title is text";
    if (b.color !== undefined && !HEX.test(b.color)) return "a border's colour is like #1e3a8a";
  }
  return "";
}

/** The colours a shape is drawn with under a theme: { fill, line, text }, or null when the theme does not colour it. */
export function themeColors(theme, type) {
  const t = theme && themeById(theme.id);
  if (!t || OWN.has(type)) return null;
  const a = t.accents[SLOT[type] || 0];
  if (theme.variant === "bold") { const f = forWhite(a); return { fill: f, line: mix(f, -0.3), text: "#ffffff" }; }
  if (theme.variant === "outline") return { fill: "#ffffff", line: a, text: mix(a, -0.45) };
  return { fill: mix(a, 0.86), line: a, text: "#1f2937" };
}

/** Connector colour under a theme, or null. */
export const themeConnector = (theme) => (theme && themeById(theme.id)?.connector) || null;

/** The colour of a border: its own, else the theme's first accent, else navy. */
export const borderColor = (page) => page.border?.color || (page.theme && themeById(page.theme.id)?.accents[0]) || "#1e3a8a";

/**
 * The border of a page as drawing parts, in page points: { frame: {x,y,w,h} | null, band: {x,y,w,h} | null,
 * titleBox: {x,y,w,h} | null, title: {x, y, anchor, text} | null, color }. The editor turns them into SVG.
 */
export function borderParts(page) {
  const b = page.border;
  if (!b) return null;
  const color = borderColor(page), title = b.title || "", W = page.width, H = page.height, inset = 12;
  if (b.style === "band") {
    return { frame: null, band: { x: 0, y: 0, w: W, h: BORDER_TITLE_H }, titleBox: null, title: title ? { x: 20, y: BORDER_TITLE_H / 2 + 6, anchor: "start", text: title } : null, color };
  }
  const frame = { x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset };
  const tw = Math.min(frame.w, Math.max(160, title.length * 8 + 32));
  const titleBox = title ? { x: frame.x + frame.w - tw, y: frame.y + frame.h - BORDER_TITLE_H, w: tw, h: BORDER_TITLE_H } : null;
  return { frame, band: null, titleBox, title: title ? { x: titleBox.x + tw / 2, y: titleBox.y + BORDER_TITLE_H / 2 + 5, anchor: "middle", text: title } : null, color };
}
