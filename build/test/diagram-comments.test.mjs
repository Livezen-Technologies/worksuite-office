import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagramModel, newDiagram, serialize, parse } from "../apps/diagram/core/diagram.js";
import { commentsError, openCounts, sortThreads, ago, initials } from "../apps/diagram/core/comments.js";

test("comments: threads on shapes and the page, replies, resolve, delete; each one undo step; saved", () => {
  const m = new DiagramModel(newDiagram("Review"));
  const a = m.addShape({ type: "rect", x: 0, y: 0, w: 100, h: 50, text: "Check order" });
  const c1 = m.addComment(a, "Who checks it?", "Anura Perera", "2026-11-24T08:00:00Z");
  const c2 = m.addComment(null, "Add the refund limit", "Bimali", "2026-11-24T09:00:00Z");
  m.replyComment(c1, "Finance", "Bimali", "2026-11-24T10:00:00Z");
  assert.deepEqual([...openCounts(m.page().comments)], [[a, 1], [null, 1]]);
  m.resolveComment(c2);
  assert.deepEqual(sortThreads(m.page().comments).map((c) => c.id), [c1, c2], "open first");
  m.undo();
  assert.equal(m.page().comments.find((c) => c.id === c2).done, false, "one undo step");
  const back = parse(serialize(m.doc)).pages[0].comments;
  assert.equal(back.find((c) => c.id === c1).replies[0].text, "Finance");
  m.remove([a]);
  assert.equal(m.page().comments.find((c) => c.id === c1).target, null, "a removed shape's comments stay, on the page");
  m.deleteComment(c1); m.deleteComment(c2);
  assert.equal(m.page().comments, undefined);
  assert.throws(() => m.resolveComment("nope"), /no such comment/);
  assert.throws(() => m.addComment(null, "  ", "Anura"), /text is empty/);
  assert.throws(() => m.addComment(null, "Hi", ""), /needs an author/);
});

test("comment checks and helpers", () => {
  const ok = { id: "m1", target: null, author: "A", text: "t", at: "2026-11-24T00:00:00Z", done: false, replies: [] };
  assert.equal(commentsError([ok]), "");
  assert.match(commentsError([ok, ok]), /own id/);
  assert.match(commentsError([{ ...ok, target: "s9" }], new Set(["s1"])), /not on the page/);
  assert.match(commentsError([{ ...ok, at: "soon" }]), /not a date/);
  assert.match(commentsError([{ ...ok, replies: [{ author: "B", text: "", at: ok.at }] }]), /reply needs/);
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(ago("2026-11-24T11:59:30Z", now), "just now");
  assert.equal(ago("2026-11-24T11:30:00Z", now), "30 min ago");
  assert.equal(ago("2026-11-23T10:00:00Z", now), "yesterday");
  assert.equal(ago("2026-11-01T10:00:00Z", now), "2026-11-01");
  assert.equal(initials("Anura Perera"), "AP");
  assert.equal(initials(""), "?");
});
