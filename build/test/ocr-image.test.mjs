// Unit tests of the PDF editor's scan clean-up (build/editors/.../controller/OcrImage.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const O = require("../editors/apps/pdfeditor/main/app/controller/OcrImage.js");

// A page of text-like lines falling by tan(deg) per pixel, as ink (1) on paper (0).
function page(width, height, deg) {
  const ink = new Uint8Array(width * height), t = Math.tan((deg * Math.PI) / 180);
  for (let line = 60; line < height - 60; line += 40) {
    for (let x = 40; x < width - 40; x++) {
      if (x % 23 > 18) continue; // gaps between "words"
      for (let h = 0; h < 8; h++) {
        const y = Math.round(line + h + x * t);
        if (y >= 0 && y < height) ink[y * width + x] = 1;
      }
    }
  }
  return ink;
}

test("skewAngle finds the slope of the lines", () => {
  for (const deg of [0, 1.5, -2.3, 4]) {
    const got = O.skewAngle(page(800, 1000, deg), 800, 1000);
    assert.ok(Math.abs(got - deg) <= 0.15, `${deg}° measured as ${got}°`);
  }
});

test("skewAngle is 0 on a blank page", () => {
  assert.equal(O.skewAngle(new Uint8Array(400 * 400), 400, 400), 0);
});

test("otsu splits dark text from light paper", () => {
  const gray = new Uint8Array(1000).map((_, i) => (i % 10 === 0 ? 30 + (i % 7) : 220 - (i % 13)));
  const t = O.otsu(gray);
  assert.ok(t >= 36 && t < 207, `threshold ${t}`);
  const ink = O.binarize(gray, t);
  assert.equal(ink.reduce((a, b) => a + b, 0), 100);
});

test("toGray weighs green most", () => {
  assert.deepEqual([...O.toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]), 3, 1)], [76, 149, 255]);
});

test("despeckle removes specks and keeps strokes", () => {
  const w = 10, h = 10, ink = new Uint8Array(w * h);
  ink[0] = ink[1] = ink[w] = ink[w + 1] = 1; // a 2×2 speck
  for (let x = 2; x < 9; x++) ink[6 * w + x] = 1; // a stroke of 7
  assert.equal(O.despeckle(ink, w, h), 4);
  assert.equal(ink[0], 0);
  assert.equal(ink.reduce((a, b) => a + b, 0), 7);
});

test("bestOrientation needs a clear lead", () => {
  assert.equal(O.bestOrientation({ 0: 40, 90: 45, 180: 30, 270: 20 }), 0);
  assert.equal(O.bestOrientation({ 0: 20, 90: 15, 180: 85, 270: 10 }), 180);
  assert.equal(O.bestOrientation({ 0: 0, 90: 70 }), 90);
});

test("inkToRgba draws black on white", () => {
  assert.deepEqual([...O.inkToRgba(new Uint8Array([1, 0]), new Uint8ClampedArray(8))], [0, 0, 0, 255, 255, 255, 255, 255]);
});
