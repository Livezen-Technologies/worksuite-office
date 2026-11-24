/*
 * WorkSuite Diagram: comments and review (roadmap stage 6). Pure ES module, no DOM.
 *
 * A page keeps its comments in `comments`: threads of { id, target (a shape id, or null for the page), author, text,
 * at (ISO time), done (resolved), replies: [{ author, text, at }] }. A comment on a shape that is removed stays, as a
 * comment on the page, so nothing anyone said is lost.
 */

export const MAX_TEXT = 4000;

/** Why a page's comments are wrong, or "" (left out is fine). */
export function commentsError(comments, shapeIds = null) {
  if (comments === undefined) return "";
  if (!Array.isArray(comments)) return "comments are a list";
  const ids = new Set();
  const textOk = (t) => typeof t === "string" && t.trim() && t.length <= MAX_TEXT;
  for (const c of comments) {
    if (!c || typeof c.id !== "string" || !c.id || ids.has(c.id)) return "each comment needs its own id";
    ids.add(c.id);
    if (c.target !== null && typeof c.target !== "string") return `comment ${c.id}: its target is a shape or the page`;
    if (shapeIds && c.target !== null && !shapeIds.has(c.target)) return `comment ${c.id}: its shape is not on the page`;
    if (!textOk(c.text)) return `comment ${c.id}: the text is empty or longer than ${MAX_TEXT} characters`;
    if (typeof c.author !== "string" || !c.author.trim()) return `comment ${c.id}: it needs an author`;
    if (Number.isNaN(Date.parse(c.at))) return `comment ${c.id}: its time is not a date`;
    if (typeof c.done !== "boolean") return `comment ${c.id}: done is true or false`;
    if (!Array.isArray(c.replies) || c.replies.some((r) => !r || !textOk(r.text) || typeof r.author !== "string" || !r.author.trim() || Number.isNaN(Date.parse(r.at)))) return `comment ${c.id}: a reply needs an author, text and a time`;
  }
  return "";
}

/** The open (not resolved) threads on each shape: Map shape id → count; the page's own are under null. */
export function openCounts(comments = []) {
  const out = new Map();
  for (const c of comments) if (!c.done) out.set(c.target, (out.get(c.target) || 0) + 1);
  return out;
}

/** Threads in the order to show them: open first, then newest activity first. */
export function sortThreads(comments = []) {
  const last = (c) => Math.max(Date.parse(c.at), ...c.replies.map((r) => Date.parse(r.at)));
  return [...comments].sort((a, b) => Number(a.done) - Number(b.done) || last(b) - last(a));
}

/** "just now", "5 min ago", "3 h ago", "yesterday", else the date. */
export function ago(at, now = new Date()) {
  const s = Math.max(0, (now - new Date(at)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(at).toISOString().slice(0, 10);
}

/** Initials for an author's badge: "Anura Perera" → "AP". */
export const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
