/*
 * WorkSuite Office: scan clean-up before text recognition, on canvas pixels, with no editor dependencies.
 *
 * Greyscale, Otsu's threshold (black and white), despeckle (lone dots), and the skew of the text lines by
 * projection profiles: the angle at which the rows of dark pixels are sharpest. Used by the Convert tab's
 * OCR (controller/ConvertTab.js); unit tests in build/test/ocr-image.test.mjs. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */
(function (factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
}(function () {
    'use strict';

    // RGBA (ImageData.data) to luminance, 0..255
    function toGray(rgba, width, height) {
        var n = width * height, gray = new Uint8Array(n);
        for (var i = 0, j = 0; i < n; i++, j += 4)
            gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
        return gray;
    }

    // The threshold that best splits the histogram in two (Otsu 1979)
    function otsu(gray) {
        var hist = new Array(256).fill(0), n = gray.length, i;
        for (i = 0; i < n; i++) hist[gray[i]]++;
        var sum = 0;
        for (i = 0; i < 256; i++) sum += i * hist[i];
        var sumB = 0, wB = 0, best = 0, threshold = 127;
        for (i = 0; i < 256; i++) {
            wB += hist[i];
            if (!wB) continue;
            var wF = n - wB;
            if (!wF) break;
            sumB += i * hist[i];
            var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) { best = between; threshold = i; }
        }
        return threshold;
    }

    // 1 for ink (darker than the threshold), 0 for paper
    function binarize(gray, threshold) {
        var ink = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) ink[i] = gray[i] <= threshold ? 1 : 0;
        return ink;
    }

    // Removes specks: groups of touching ink pixels (8 neighbours) of at most maxArea pixels (6: a 2×2 dot
    // goes, a full stop at 300 dpi stays). Returns how many pixels were removed.
    function despeckle(ink, width, height, maxArea) {
        maxArea = maxArea || 6;
        var seen = new Uint8Array(ink.length), stack = [], group = [], removed = 0;
        for (var start = 0; start < ink.length; start++) {
            if (!ink[start] || seen[start]) continue;
            seen[start] = 1;
            stack.push(start);
            group.length = 0;
            while (stack.length) {
                var i = stack.pop(), x = i % width, y = (i - x) / width;
                if (group.length <= maxArea) group.push(i);
                for (var dy = -1; dy <= 1; dy++) {
                    var yy = y + dy;
                    if (yy < 0 || yy >= height) continue;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = x + dx, j = yy * width + xx;
                        if (xx < 0 || xx >= width || seen[j] || !ink[j]) continue;
                        seen[j] = 1;
                        stack.push(j);
                    }
                }
            }
            if (group.length <= maxArea) {
                for (var k = 0; k < group.length; k++) ink[group[k]] = 0;
                removed += group.length;
            }
        }
        return removed;
    }

    // The skew of the text lines in degrees: lines fall by tan(angle) per pixel to the right (y downwards,
    // as on a canvas), so rotating the page by -angle straightens it. Searches ±maxDeg; 0 when the page
    // has too little ink to tell. Works on every step-th pixel to stay fast on 300 dpi pages.
    function skewAngle(ink, width, height, opts) {
        opts = opts || {};
        var maxDeg = opts.maxDeg || 5, stepDeg = opts.stepDeg || 0.2,
            step = Math.max(1, Math.round(Math.max(width, height) / 1200)),
            xs = [], ys = [];
        for (var y = 0; y < height; y += step) {
            for (var x = 0; x < width; x += step) {
                if (ink[y * width + x]) { xs.push(x); ys.push(y); }
            }
        }
        if (xs.length < 50) return 0;
        var score = function (deg) {
            var t = Math.tan(deg * Math.PI / 180), bins = {}, min = Infinity, max = -Infinity;
            for (var i = 0; i < xs.length; i++) {
                var r = Math.round((ys[i] - xs[i] * t) / step);
                bins[r] = (bins[r] || 0) + 1;
                if (r < min) min = r;
                if (r > max) max = r;
            }
            var s = 0, prev = 0;
            for (var b = min; b <= max + 1; b++) {
                var v = bins[b] || 0;
                s += (v - prev) * (v - prev);
                prev = v;
            }
            return s;
        };
        var best = 0, bestScore = score(0);
        for (var d = -maxDeg; d <= maxDeg + 1e-9; d += stepDeg) {
            var sc = score(d);
            if (sc > bestScore * 1.0001) { bestScore = sc; best = d; }
        }
        // refine around the best coarse angle
        var fine = best;
        for (var f = best - stepDeg; f <= best + stepDeg + 1e-9; f += stepDeg / 5) {
            var s2 = score(f);
            if (s2 > bestScore) { bestScore = s2; fine = f; }
        }
        return Math.round(fine * 100) / 100;
    }

    // Ink back to RGBA: black on white
    function inkToRgba(ink, rgba) {
        for (var i = 0, j = 0; i < ink.length; i++, j += 4) {
            var v = ink[i] ? 0 : 255;
            rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
            rgba[j + 3] = 255;
        }
        return rgba;
    }

    // The quarter turn (0, 90, 180, 270) whose trial recognition was most confident; 0 unless one is clearly better.
    function bestOrientation(confidences) {
        var best = 0;
        [90, 180, 270].forEach(function (a) {
            if ((confidences[a] || 0) > (confidences[best] || 0) + 10) best = a;
        });
        return best;
    }

    return {toGray: toGray, otsu: otsu, binarize: binarize, despeckle: despeckle, skewAngle: skewAngle,
            inkToRgba: inkToRgba, bestOrientation: bestOrientation};
}));
