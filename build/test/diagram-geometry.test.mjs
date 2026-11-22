// build/apps/diagram/editor/geometry.js: the Diagram editor's canvas geometry (#79–#81): shape outlines, the
// shape libraries, grid snapping, smart guides, connector routes (straight, elbow, curved), midpoints and
// corner resizing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapePath, LIBRARIES, libraryShape, snap, alignGuides, route, midpoint, resizeBox } from "../apps/diagram/editor/geometry.js";

test("every library shape has an outline, a size and a unique type per library", () => {
  for (const lib of LIBRARIES) {
    assert.ok(lib.shapes.length > 0, lib.id);
    for (const s of lib.shapes) {
      assert.match(shapePath(s.type, s.w, s.h), /^M[\d.]+ [\d.]+/, s.type);
      assert.ok(s.w > 0 && s.h > 0, s.type);
    }
  }
  assert.deepEqual(LIBRARIES.slice(0, 4).map((l) => l.id), ["flowchart", "basic", "org", "network"]);
  assert.equal(libraryShape("diamond").name, "Decision");
  assert.equal(shapePath("unknown", 10, 20), "M0 0 H10 V20 H0 Z");
});

test("outlines stay inside their box", () => {
  for (const s of LIBRARIES.flatMap((l) => l.shapes)) {
    const nums = shapePath(s.type, 100, 60).replace(/[A-Za-z]/g, " ").trim().split(/[\s,]+/).map(Number);
    assert.ok(nums.every((n) => n >= -0.01 && n <= 100.01), s.type);
  }
});

test("grid snapping", () => {
  assert.equal(snap(14, 10), 10);
  assert.equal(snap(15, 10), 20);
  assert.equal(snap(14, 0), 14);
});

test("smart guides snap to the nearest edge or centre within the tolerance", () => {
  const other = { x: 100, y: 100, w: 100, h: 50 };
  const g = alignGuides({ x: 103, y: 300, w: 40, h: 40 }, [other]); // left edges 3 apart
  assert.equal(g.x, 100);
  assert.deepEqual(g.guides, [{ axis: "x", at: 100 }]);
  const c = alignGuides({ x: 128, y: 104, w: 40, h: 40 }, [other]); // centres x 148 vs 150; middles 124 vs 125 beat tops 104 vs 100
  assert.equal(c.x, 130);
  assert.equal(c.y, 105); // the nearest guide wins
  assert.equal(c.guides.length, 2);
  assert.deepEqual(alignGuides({ x: 400, y: 400, w: 10, h: 10 }, [other]).guides, []);
});

test("routes: straight is two points, elbow leaves and enters at right angles, curved is a cubic", () => {
  const a = { x: 100, y: 50 }, b = { x: 300, y: 150 };
  assert.deepEqual(route("straight", a, b), [[100, 50], [300, 150]]);
  const el = route("elbow", a, b, "right", "left");
  assert.deepEqual(el[0], [100, 50]);
  assert.deepEqual(el.at(-1), [300, 150]);
  for (let i = 1; i < el.length; i++) assert.ok(el[i][0] === el[i - 1][0] || el[i][1] === el[i - 1][1], "every segment is horizontal or vertical");
  const down = route("elbow", { x: 200, y: 100 }, { x: 200, y: 200 }, "bottom", "top");
  assert.deepEqual(down, [[200, 100], [200, 200]]); // straight down, no needless bends
  assert.equal(route("curved", a, b, "right", "left").length, 4);
});

test("the midpoint of a route is halfway along its length", () => {
  assert.deepEqual(midpoint([[0, 0], [100, 0]]), [50, 0]);
  assert.deepEqual(midpoint([[0, 0], [100, 0], [100, 100]]), [100, 0]);
});

test("corner resizing keeps the opposite corner and a minimum size", () => {
  const box = { x: 100, y: 100, w: 80, h: 40 };
  assert.deepEqual(resizeBox(box, "se", 20, 10), { x: 100, y: 100, w: 100, h: 50 });
  assert.deepEqual(resizeBox(box, "nw", 20, 10), { x: 120, y: 110, w: 60, h: 30 });
  assert.deepEqual(resizeBox(box, "nw", 500, 500), { x: 170, y: 130, w: 10, h: 10 });
});

test("the floor plan, UML, BPMN and cloud libraries: own types, closed outlines, numbers only, VSDX-ready", async () => {
  const { pathToGeometry } = await import("../apps/diagram/core/vsdx.js");
  const { OPEN_LIBRARIES } = await import("../apps/diagram/editor/geometry.js");
  assert.deepEqual(LIBRARIES.map((l) => l.id), ["flowchart", "basic", "org", "network", "floor", "uml", "bpmn", "cloud"]);
  assert.ok(OPEN_LIBRARIES.every((id) => LIBRARIES.some((l) => l.id === id)));
  const fresh = LIBRARIES.filter((l) => ["floor", "uml", "bpmn", "cloud"].includes(l.id)).flatMap((l) => l.shapes);
  const types = fresh.map((s) => s.type);
  assert.equal(new Set(types).size, types.length); // no type shared within the new libraries…
  for (const s of fresh) {
    assert.equal(libraryShape(s.type), s); // …nor with the older ones, so a drop gets this shape's size
    const d = shapePath(s.type, s.w, s.h);
    if (!["room", "wall"].includes(s.type)) assert.notEqual(d, shapePath("unknown-type", s.w, s.h), s.type + " draws its own outline"); // a room and a wall are boxes
    assert.doesNotMatch(d, /NaN|undefined|[a-z]/, s.type); // absolute commands, finite numbers
    assert.ok(pathToGeometry(d, s.w, s.h).length >= 1, s.type);
  }
});

test("line jumps: a crossing hops on the later line only, not near ends, curved lines left alone", async () => {
  const { lineJumps, jumpPath } = await import("../apps/diagram/editor/geometry.js");
  const h = [[0, 50], [100, 50]], v = [[50, 0], [50, 100]], touch = [[100, 50], [100, 100]], near = [[3, 0], [3, 100]];
  const j = lineJumps([h, v, null, touch, near]);
  assert.deepEqual(j[0], [[]], "the first line keeps straight");
  assert.deepEqual(j[1], [[50]], "the vertical line hops the horizontal at 50");
  assert.equal(j[2], null);
  assert.deepEqual(j[3], [[]], "meeting at an end is not a crossing");
  assert.deepEqual(j[4], [[]], "too close to the other line's end to hop");
  assert.equal(jumpPath(v, j[1]), "M50 0 L50 45 A5 5 0 0 1 50 55 L50 100");
  const elbow = [[0, 20], [60, 20], [60, 80], [120, 80]], cross = [[30, 0], [30, 100]];
  assert.deepEqual(lineJumps([elbow, cross])[1], [[20]]);
});
