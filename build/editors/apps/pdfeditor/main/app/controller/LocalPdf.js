/*
 * WorkSuite Office: the PDF Editor's client of the PDF jobs of worksuite-ai (the Local AI service).
 *
 * Finds the service through the desktop shell, as the AI plugin does (desktop-apps docs/local-ai-bridge.md):
 * execCommand("ws-ai:endpoint", {req, start:true}) is answered by on_native_message in this frame. Then
 * POST /v1/pdf/<op> starts a job on a file on this computer, and GET /v1/jobs/<id> is polled until it ends.
 * Copied into web-apps by build/patch-pdf-convert.py. Licensed under the GNU AGPL v3.
 */

define([], function () {
    'use strict';

    var COMMAND = 'ws-ai:endpoint', seq = 0, cached = null;

    function LocalPdfError(code, message, detail) {
        var e = new Error(message || code);
        e.code = code;
        e.detail = detail || null;
        return e;
    }

    // The shell's answer to our request: {req, ok, port, token, base} or {req, ok:false, reason}.
    // start: false asks only a service that is already running (nothing is launched for background work)
    function discover(start) {
        if (cached) return Promise.resolve(cached);
        var native = window.AscDesktopEditor;
        if (!native || typeof native.execCommand !== 'function') return Promise.reject(LocalPdfError('service_unavailable'));
        var req = 'ws-pdf-' + Date.now().toString(36) + '-' + (++seq);
        return new Promise(function (resolve, reject) {
            var previous = window.on_native_message, timer;
            var listener = function (cmd, param) {
                if (cmd === COMMAND) {
                    var a = null;
                    try { a = typeof param === 'string' ? JSON.parse(param) : param; } catch (e) { a = null; }
                    if (a && a.req === req) {
                        done();
                        if (!a.ok || !(Number(a.port) > 0)) return reject(LocalPdfError(a.reason === 'disabled-by-policy' ? 'forbidden_by_policy' : 'service_unavailable'));
                        cached = {base: 'http://127.0.0.1:' + Number(a.port) + '/v1', token: String(a.token || '')};
                        return resolve(cached);
                    }
                }
                if (typeof previous === 'function') return previous.apply(this, arguments);
            };
            var done = function () {
                clearTimeout(timer);
                if (window.on_native_message === listener) window.on_native_message = previous;
            };
            window.on_native_message = listener;
            timer = setTimeout(function () { done(); reject(LocalPdfError('service_unavailable')); }, start === false ? 4000 : 25000);
            native.execCommand(COMMAND, JSON.stringify({req: req, start: start !== false}));
        });
    }

    // HTTP to the service with XMLHttpRequest, not window.fetch: in the editors' frame fetch is replaced by a
    // loader for their own files that always sends a GET (no method, headers or body) and reports 200 on
    // file: pages whatever the answer. Through it every PDF Tools job went out as an unauthenticated GET,
    // the 401 came back as success, and the editor waited for a job that never existed ("Please, wait..."
    // for ever). Resolves with {status, json} or {status, buffer}; rejects only when the service is unreachable.
    function request(method, url, token, body, as) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            if (as === 'arraybuffer') xhr.responseType = 'arraybuffer';
            var payload = body;
            if (body !== undefined && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
                xhr.setRequestHeader('Content-Type', 'application/json');
                payload = JSON.stringify(body);
            }
            xhr.timeout = 120000;
            xhr.onload = function () {
                if (as === 'arraybuffer') return resolve({status: xhr.status, buffer: xhr.response});
                var json = {};
                try { json = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) { json = {}; }
                resolve({status: xhr.status, json: json});
            };
            xhr.onerror = xhr.ontimeout = function () { reject(LocalPdfError('service_unavailable')); };
            xhr.send(payload === undefined ? null : payload);
        });
    }

    function failure(res) {
        if (res.status === 401) cached = null;
        var err = (res.json && res.json.error) || {};
        return LocalPdfError(err.code || (res.status === 401 ? 'service_unavailable' : 'internal'), err.message, err.detail);
    }

    function call(method, path, body, start) {
        return discover(start).then(function (ep) {
            return request(method, ep.base + path, ep.token, body).then(function (res) {
                if (res.status < 200 || res.status >= 300) throw failure(res);
                return res.json;
            }, function (e) { cached = null; throw e; });
        });
    }

    // Polls a job until it ends; resolves with its result. An answer without a job state (no such job)
    // ends the wait instead of polling for ever.
    function wait(jobId, onProgress) {
        if (!jobId) return Promise.reject(LocalPdfError('internal', 'The service did not start the job'));
        return new Promise(function (resolve, reject) {
            var odd = 0;
            var poll = function () {
                call('GET', '/jobs/' + encodeURIComponent(jobId)).then(function (job) {
                    if (job.state === 'done') return resolve(job.result);
                    if (job.state === 'failed' || job.state === 'cancelled') {
                        var err = job.error || {};
                        return reject(LocalPdfError(err.code || job.state, err.message, err.detail));
                    }
                    if (job.state !== 'queued' && job.state !== 'running' && job.state !== 'paused') {
                        if (++odd >= 3) return reject(LocalPdfError('internal', 'The service lost the job'));
                    } else odd = 0;
                    onProgress && onProgress(job.progress || 0);
                    setTimeout(poll, 250);
                }, reject);
            };
            poll();
        });
    }

    // Starts a PDF job and resolves with its result ({file, files, pages}) when it is done.
    function run(op, body, onProgress) {
        return call('POST', '/pdf/' + op, body).then(function (started) { return wait(started && started.jobId, onProgress); });
    }

    // As run, with files: a multipart body (FormData) instead of JSON.
    function upload(op, form, onProgress) {
        return discover().then(function (ep) {
            return request('POST', ep.base + '/pdf/' + op, ep.token, form).then(function (res) {
                if (res.status < 200 || res.status >= 300) throw failure(res);
                return wait(res.json && res.json.jobId, onProgress);
            }, function (e) { cached = null; throw e; });
        });
    }

    // A file the service serves (an OCR language model), as an ArrayBuffer.
    function binary(path) {
        return discover().then(function (ep) {
            return request('GET', ep.base + path, ep.token, undefined, 'arraybuffer').then(function (res) {
                if (res.status < 200 || res.status >= 300)
                    throw LocalPdfError(res.status === 404 ? 'not_found' : res.status === 402 ? 'payment_required' : 'internal');
                return res.buffer;
            });
        });
    }

    return {run: run, upload: upload, call: call, wait: wait, binary: binary, discover: discover};
});
