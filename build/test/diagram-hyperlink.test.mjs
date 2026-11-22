import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { parseLink, linkText, safeUrl, linkError } from "../apps/diagram/core/hyperlink.js";

test("hyperlinks: to a page by its name or to a web or mail address; unsafe addresses refused; links to a removed page go", () => {
  const m = new DiagramModel(newDiagram("Site"));
  const p2 = m.addPage("Details");
  const pages = m.doc.pages;
  assert.deepEqual(parseLink("details", pages), { link: { page: p2 } });
  assert.deepEqual(parseLink("www.example.com", pages), { link: { url: "https://www.example.com" } });
  assert.deepEqual(parseLink("mailto:ops@example.com", pages), { link: { url: "mailto:ops@example.com" } });
  assert.ok(parseLink("javascript:alert(1)", pages).error);
  assert.equal(safeUrl("file:///etc/passwd"), false);
  assert.match(linkError({ page: "nope" }, pages.map((p) => p.id)), /not in the diagram/);
  const s = m.addShape({ type: "rect", x: 10, y: 10, text: "More" });
  m.setLink(s, { page: p2 });
  assert.equal(linkText(m.item(s).link, pages), "Details");
  assert.deepEqual(parse(serialize(m.doc)).pages[0].items[0].link, { page: p2 });
  assert.throws(() => m.setLink(s, { url: "javascript:x" }), /must start with http/);
  m.removePage(p2);
  assert.equal(m.item(s).link, undefined, "a link to a removed page goes with it");
});

test("hyperlinks go through a .vsdx file: page links by name, addresses as they are", async () => {
  const { toVsdx, fromVsdx } = await import("../apps/diagram/core/vsdx.js");
  const { shapePath } = await import("../apps/diagram/editor/geometry.js");
  const m = new DiagramModel(newDiagram("Site"));
  const p2 = m.addPage("Details");
  const a = m.addShape({ type: "rect", x: 10, y: 10, w: 100, h: 50, text: "More" });
  const b = m.addShape({ type: "rect", x: 200, y: 10, w: 100, h: 50, text: "Web" });
  m.setLink(a, { page: p2 }); m.setLink(b, { url: "https://example.com/a?b=1&c=2" });
  m.addShape({ type: "rect", x: 10, y: 10, w: 100, h: 50, text: "Back" }, p2);
  const back = await fromVsdx(toVsdx(m.doc, (x) => shapePath(x.type, x.w, x.h, x.path), () => []));
  const doc = back.doc, [first, second] = doc.pages;
  assert.deepEqual(first.items.find((i) => i.text === "More").link, { page: second.id });
  assert.deepEqual(first.items.find((i) => i.text === "Web").link, { url: "https://example.com/a?b=1&c=2" });
});
