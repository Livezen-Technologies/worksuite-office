/*
 * WorkSuite Office: the OCR dialog's settings logic, with no editor dependencies.
 *
 * The language search, the languages remembered from the last recognition, and the elapsed time shown while
 * recognising. Used by view/OcrDialog.js; unit tests in build/test/ocr-settings.test.mjs. Copied into
 * web-apps by build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */
(function (factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
}(function () {
    'use strict';

    var STORAGE_KEY = 'ws-pdfe-ocr-langs';

    // Whether a language ({code, name}) matches the search: any word of its name or its code starting with it,
    // without regard to case. An empty search matches every language.
    function matches(lang, query) {
        var q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        var name = String(lang.name || '').toLowerCase(), code = String(lang.code || '').toLowerCase();
        return code.indexOf(q) === 0 || name.indexOf(q) === 0 || name.split(/[\s(),-]+/).some(function (w) { return w.indexOf(q) === 0; });
    }

    // The codes to tick: the last selection (a JSON list of codes) as far as those languages are still installed,
    // otherwise the defaults.
    function initialLangs(saved, available, defaults) {
        var list;
        try { list = JSON.parse(saved || 'null'); } catch (e) { list = null; }
        if (Array.isArray(list)) {
            var ok = list.filter(function (c) { return available.indexOf(c) >= 0; });
            if (ok.length) return ok;
        }
        return defaults.filter(function (c) { return available.indexOf(c) >= 0; });
    }

    // Milliseconds as m:ss (or h:mm:ss)
    function formatElapsed(ms) {
        var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, pad = function (n) { return (n < 10 ? '0' : '') + n; };
        s %= 60;
        return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
    }

    // A fraction (0..1) as a whole percentage, never 100 before the end
    function percent(fraction, finished) {
        if (finished) return 100;
        return Math.max(0, Math.min(99, Math.floor((fraction || 0) * 100)));
    }

    return {STORAGE_KEY: STORAGE_KEY, matches: matches, initialLangs: initialLangs, formatElapsed: formatElapsed, percent: percent};
}));
