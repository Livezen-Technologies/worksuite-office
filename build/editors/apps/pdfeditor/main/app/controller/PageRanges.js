/*
 * WorkSuite Office: page ranges for the PDF Editor's Pages tab ("1-3, 5, 8-"), with no editor dependencies.
 *
 * Pages are numbered from 1 in the text and from 0 in the results. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */
(function (factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
}(function () {
    'use strict';

    // One group per comma: "3" is [2], "2-4" is [1, 2, 3], "8-" runs to the last page, "-3" from the first.
    // null when a part is not a page number or range of this document.
    function parseGroups(text, count) {
        var parts = String(text || '').split(/[,;]/).map(function (s) { return s.replace(/\s+/g, ''); })
                                                    .filter(function (s) { return s.length; });
        if (!parts.length) return null;
        var groups = [];
        for (var i = 0; i < parts.length; i++) {
            var m = /^(\d*)(?:([-–])(\d*))?$/.exec(parts[i]);
            if (!m || (!m[1] && !m[3] && m[2]) || (!m[1] && !m[2])) return null;
            var from = m[1] ? parseInt(m[1], 10) : 1,
                to = m[2] ? (m[3] ? parseInt(m[3], 10) : count) : from;
            if (from < 1 || to > count || from > to) return null;
            var g = [];
            for (var p = from; p <= to; p++) g.push(p - 1);
            groups.push(g);
        }
        return groups;
    }

    // All the pages of the text, each once, in document order.
    function parsePages(text, count) {
        var groups = parseGroups(text, count);
        if (!groups) return null;
        var seen = {}, pages = [];
        groups.forEach(function (g) { g.forEach(function (p) { if (!seen[p]) { seen[p] = true; pages.push(p); } }); });
        return pages.sort(function (a, b) { return a - b; });
    }

    // Pages 0..count-1 in parts of n pages (the last may be shorter).
    function everyN(n, count) {
        n = parseInt(n, 10);
        if (!(n >= 1) || count < 1) return null;
        var parts = [];
        for (var p = 0; p < count; p += n) {
            var g = [];
            for (var q = p; q < Math.min(count, p + n); q++) g.push(q);
            parts.push(g);
        }
        return parts;
    }

    // The text for page indexes: [0, 1, 2, 4] is "1-3, 5".
    function format(pages) {
        var sorted = (pages || []).slice().sort(function (a, b) { return a - b; }), out = [];
        for (var i = 0; i < sorted.length; i++) {
            var start = sorted[i];
            while (i + 1 < sorted.length && sorted[i + 1] <= sorted[i] + 1) i++;
            out.push(start === sorted[i] ? String(start + 1) : (start + 1) + '-' + (sorted[i] + 1));
        }
        return out.join(', ');
    }

    // The pages to remove so that only `keep` is left, last first (so each index is still right when removed).
    function removalOrder(keep, count) {
        var k = {}, out = [];
        keep.forEach(function (p) { k[p] = true; });
        for (var p = count - 1; p >= 0; p--) if (!k[p]) out.push(p);
        return out;
    }

    return {parseGroups: parseGroups, parsePages: parsePages, everyN: everyN, format: format, removalOrder: removalOrder};
}));
