/*
 * Sinhala Tools in WorkSuite Project and Diagram, as in the document editors' Sinhala Tools tab: Singlish typing
 * (type "ammaa", get අම්මා, a word at a time as you finish it), legacy-font text (FM Abhaya, DL Manel, Kaputa, …)
 * converted to Unicode, and malformed Sinhala cleaned up. The engine is @worksuite/sinhala-core, the same bundle the
 * plugin ships (sinhala-core.js, a classic script setting window.WorkSuiteSinhala; refreshed by
 * sinhala/scripts/build-plugin.mjs and copied here).
 */
const S = () => globalThis.WorkSuiteSinhala;

/** The legacy fonts the converter knows: [{ id, name }]. */
export function profiles() {
  return S() ? S().builtinProfiles.map((p) => ({ id: p.id, name: p.name })) : [];
}

/** Legacy-font text to Unicode with a profile ("fm-abhaya" …): { text, unmapped }. */
export function toUnicode(text, profileId = "fm-abhaya") {
  const p = S().getProfile ? S().getProfile(profileId) : S().builtinProfiles.find((x) => x.id === profileId);
  if (!p) throw new Error(`no Sinhala font layout ${profileId}`);
  const r = S().convert(String(text ?? ""), p);
  return { text: r.text, unmapped: (r.unmapped || []).length };
}

/** Malformed Sinhala made well-formed (vowel signs in order, stray joiners removed). */
export const fix = (text) => S().normalize(String(text ?? "")).text;

/**
 * Singlish to Sinhala for the latin word just before the caret, the way the editors' Singlish typing works: called when
 * a word ends (space, Enter, punctuation). Returns { value, caret } or null when there is nothing to change.
 */
export function singlishAt(value, caret) {
  const before = value.slice(0, caret);
  const m = /([A-Za-z][A-Za-z.^~]*)$/.exec(before);
  if (!m) return null;
  const si = S().transliterate(m[1]);
  if (!si || si === m[1]) return null;
  const start = caret - m[1].length;
  return { value: value.slice(0, start) + si + value.slice(caret), caret: start + si.length };
}

const ENDS = new Set([" ", "Enter", ".", ",", "?", "!", ";", ":", ")"]);

/** Turns Singlish typing on for the text fields of `doc` while isOn() says so. */
export function attachSinglish(doc, isOn) {
  doc.addEventListener("keydown", (e) => {
    if (!isOn() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || !ENDS.has(e.key)) return;
    const el = e.target;
    const field = el instanceof doc.defaultView.HTMLTextAreaElement || (el instanceof doc.defaultView.HTMLInputElement && /^(text|search|)$/.test(el.type));
    if (!field || el.selectionStart !== el.selectionEnd || el.closest("[data-latin]")) return;
    const r = singlishAt(el.value, el.selectionStart);
    if (!r) return;
    el.value = r.value;
    el.setSelectionRange(r.caret, r.caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);
}
