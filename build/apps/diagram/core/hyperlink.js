/*
 * WorkSuite Diagram: hyperlinks (roadmap stage 6). Pure ES module, no DOM.
 *
 * A shape's `link` goes to another page of the diagram, { page: pageId }, or to a web or mail address, { url }.
 * In a Visio file it is the shape's first Hyperlink row: Address (the URL) or SubAddress (the page's name).
 */

/** What is wrong with a shape's link, or null. `pageIds`: the diagram's pages. */
export function linkError(link, pageIds = null) {
  if (link === undefined) return null;
  if (!link || typeof link !== "object") return "a link goes to a page or an address";
  if (link.page !== undefined) {
    if (typeof link.page !== "string" || !link.page) return "a link to a page needs the page";
    if (pageIds && !pageIds.includes(link.page)) return "the link goes to a page that is not in the diagram";
    return null;
  }
  if (typeof link.url !== "string" || !safeUrl(link.url)) return "a link's address must start with http://, https:// or mailto:";
  return null;
}

/** An address a link may open: web and mail only (never javascript: or file:). */
export const safeUrl = (url) => /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(String(url || "").trim());

/** Typed text as a link: a page by its name (or "Page 2"), else an address (www. gets https://); { link } or { error }. */
export function parseLink(text, pages) {
  const s = String(text || "").trim();
  if (!s) return { link: undefined };
  const page = pages.find((p) => p.name.toLowerCase() === s.toLowerCase());
  if (page) return { link: { page: page.id } };
  const url = /^www\./i.test(s) ? `https://${s}` : s;
  return safeUrl(url) ? { link: { url } } : { error: `"${s}" is neither a page of this diagram nor a web or mail address` };
}

/** A link as typed: the page's name, or the address. */
export const linkText = (link, pages) => (!link ? "" : link.page ? pages.find((p) => p.id === link.page)?.name || "" : link.url);

/** The Visio Hyperlink section for a shape's link (cell() writes a cell). */
export function toHyperlinkSection(link, pages, cell) {
  if (!link) return "";
  const page = link.page ? pages.find((p) => p.id === link.page) : null;
  if (link.page && !page) return "";
  return `<Section N="Hyperlink"><Row N="Hyperlink.Row_1">${page ? cell("SubAddress", page.name) : cell("Address", link.url)}${cell("Description", page ? page.name : link.url)}</Row></Section>`;
}

/** A link from a Visio shape's Hyperlink rows (cells by name): the first with an address or a page it can find. */
export function fromHyperlinkRows(rows, pages) {
  for (const c of rows) {
    if (c.Del === "1") continue;
    const sub = String(c.SubAddress || "").replace(/\/.*$/, ""), page = sub && pages.find((p) => p.name === sub);
    if (page) return { page: page.id };
    if (c.Address && safeUrl(c.Address)) return { url: c.Address };
  }
  return undefined;
}
