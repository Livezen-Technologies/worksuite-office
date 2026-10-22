/*
 * WorkSuite Office: the OCR worker, editors/ocr/worker.js. The desktop editors open from file:// URLs,
 * which fetch() cannot read; tesseract.js reads its models with fetch(), so file:// requests go through
 * XMLHttpRequest, which the desktop app allows for files. Then tesseract.js's own worker.
 */
(function () {
    'use strict';
    var nativeFetch = self.fetch;
    self.fetch = function (url) {
        var href = typeof url === 'string' ? url : (url && url.url) || '';
        if (href.indexOf('file:') !== 0) return nativeFetch.apply(self, arguments);
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', href, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function () {
                if ((xhr.status === 0 || xhr.status === 200) && xhr.response)
                    resolve(new Response(xhr.response, {status: 200}));
                else
                    reject(new Error('Cannot read ' + href + ' (' + xhr.status + ')'));
            };
            xhr.onerror = function () { reject(new Error('Cannot read ' + href)); };
            xhr.send();
        });
    };
})();
importScripts('worker.min.js');
