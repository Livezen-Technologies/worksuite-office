// The Sinhala Tools ribbon icons: one registry for every toolbar command's icon, label and tooltip.
// scripts/render-icons.mjs renders each icon to plugin/src/resources/icons/<theme>/<name>[@<scale>x].png
// (committed, so CI needs no image tools); scripts/build-plugin.mjs checks this registry and the rendered
// files (validateRegistry) and writes scripts/toolbar.js for plugin.js. Icon outlines are Lucide's
// (https://lucide.dev, ISC; see LICENSE-lucide.txt), drawn on a 24x24 grid with currentColor strokes.

import { createHash } from "node:crypto";

/** Toolbar icon colours of the editor themes (ONLYOFFICE's --icon-normal on light and dark themes). */
export const THEMES = { light: "#444444", dark: "#e0e0e0" };
/** The big-button icon is 28x28 CSS px; these are the scales the editor asks for (the %scale% template). */
export const SIZE = 28;
export const SCALES = [100, 125, 150, 175, 200];
export const STROKE = 1.75;

// A small refresh badge in the bottom-right corner; svg() knocks a disc out of the icon under it.
const BADGE = '<!--badge--><g transform="translate(12.6 12.6) scale(0.45)" stroke-width="3.8"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' +
  '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></g>';

/** name -> SVG elements on a 24x24 grid (stroke and fill come from the wrapper). */
export const ICONS = {
  "keyboard": '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  "keyboard-off": '<path d="M20 4a2 2 0 0 1 2 2"/><path d="M22 6v10.41"/><path d="M7 16h9"/><path d="M9.69 4H20"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="m2 2 20 20"/><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/><path d="M6 8h.01"/><path d="M8 12h.01"/>',
  "languages": '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  "file-type-refresh": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M20 7v4"/><path d="M15 2l5 5"/><path d="M8 13v-1h6v1"/><path d="M11 12v6"/><path d="M10 18h2"/>' + BADGE,
  "file-text-refresh": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M20 7v4"/><path d="M15 2l5 5"/><path d="M10 9H8"/><path d="M15 13H8"/><path d="M11 17H8"/>' + BADGE,
  "scan-text": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/>',
  "type": '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  "panel-right-open": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>',
  // shown for a command whose icon is missing (plugin.js falls back to it; the build refuses that anyway)
  "fallback": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
};

/**
 * The ribbon, in order. `group` starts a new group (a separator before it). Labels are short so the
 * big buttons do not wrap badly; the tooltip says the rest. `iconOff` is the state icon while off.
 * Every label and hint is translated in translations/*.json.
 */
export const COMMANDS = [
  { id: "ime", icon: "keyboard", iconOff: "keyboard-off", label: "Sinhala input", group: true,
    hint: "Type Singlish and pick Sinhala words as you type (Ctrl+Shift+Y)" },
  { id: "convertSelection", icon: "languages", label: "Convert", group: true,
    hint: "Legacy font text in the selection to Unicode, in a Noto Sinhala font" },
  { id: "convertToLegacy", icon: "file-type-refresh", label: "To legacy",
    hint: "Unicode in the selection to a legacy font, with a preview" },
  { id: "convertDocument", icon: "file-text-refresh", label: "Convert doc",
    hint: "Every run in a legacy font to Unicode, after a preview" },
  { id: "detect", icon: "scan-text", label: "Detect", group: true, hint: "Highlight text in legacy fonts" },
  { id: "fonts", icon: "type", label: "Fonts", hint: "Apply the Noto Sinhala font to Sinhala text" },
  { id: "validate", icon: "shield-check", label: "Validate",
    hint: "Find broken conjuncts, stray joiners and vowel signs in the wrong order" },
  { id: "panel", icon: "panel-right-open", label: "Panel", group: true, hint: "Open the Sinhala Tools panel" }
];

export function iconFile(theme, name, scale) {
  return `resources/icons/${theme}/${name}${scale === 100 ? "" : "@" + scale / 100 + "x"}.png`;
}

/** The editor's icon template for one icon (expands to every theme and scale, see iconsStr2IconsObj). */
export function iconTemplate(name) {
  return `resources/icons/%theme-type%(light|dark)/${name}%scale%(default).%extension%(png)`;
}

export function svg(name, color) {
  const [body, badge] = ICONS[name].split("<!--badge-->");
  const inner = badge === undefined ? body
    : '<mask id="k"><rect width="24" height="24" fill="#fff" stroke="none"/><circle cx="18" cy="18" r="6.4" fill="#000" stroke="none"/></mask>' +
      '<g mask="url(#k)">' + body + "</g>" + badge;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" ` +
    `stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Problems with the registry: [] when every command has its own existing icon, a label and a hint. */
export function validateRegistry(commands = COMMANDS, icons = ICONS, exists = () => true) {
  const problems = [];
  const ids = new Set();
  const used = new Map();
  for (const c of commands) {
    if (!c.id) { problems.push("a command has no id"); continue; }
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate command`);
    ids.add(c.id);
    if (!c.label) problems.push(`${c.id}: no label`);
    if (!c.hint) problems.push(`${c.id}: no tooltip`);
    for (const key of ["icon", "iconOff"]) {
      const name = c[key];
      if (key === "iconOff" && name === undefined) continue;
      if (!name || !icons[name]) { problems.push(`${c.id}: no ${key}${name ? " " + name : ""} in the registry`); continue; }
      if (name === "fallback") problems.push(`${c.id}: uses the fallback icon`);
      if (used.has(name)) problems.push(`${c.id}: icon ${name} is also ${used.get(name)}'s`);
      used.set(name, c.id);
      for (const theme of Object.keys(THEMES)) for (const scale of SCALES) {
        if (!exists(iconFile(theme, name, scale))) problems.push(`${c.id}: ${iconFile(theme, name, scale)} is missing`);
      }
    }
  }
  return problems;
}

/** The sha256 of an icon's SVG in one theme: plugin/icons/rendered.json holds it for the committed PNGs. */
export function sourceHash(theme, name) {
  return createHash("sha256").update(svg(name, THEMES[theme])).digest("hex");
}
