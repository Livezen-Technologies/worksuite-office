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

    function call(method, path, body, start) {
        return discover(start).then(function (ep) {
            return fetch(ep.base + path, {
                method: method,
                headers: {'Authorization': 'Bearer ' + ep.token, 'Content-Type': 'application/json'},
                body: body === undefined ? undefined : JSON.stringify(body)
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (json) {
                    if (res.status === 401) cached = null;
                    if (!res.ok) {
                        var err = (json && json.error) || {};
                        throw LocalPdfError(err.code || 'internal', err.message, err.detail);
                    }
                    return json;
                });
            }, function () {
                cached = null;
                throw LocalPdfError('service_unavailable');
            });
        });
    }

    // Polls a job until it ends; resolves with its result.
    function wait(jobId, onProgress) {
        return new Promise(function (resolve, reject) {
            var poll = function () {
                call('GET', '/jobs/' + encodeURIComponent(jobId)).then(function (job) {
                    if (job.state === 'done') return resolve(job.result);
                    if (job.state === 'failed' || job.state === 'cancelled') {
                        var err = job.error || {};
                        return reject(LocalPdfError(err.code || job.state, err.message, err.detail));
                    }
                    onProgress && onProgress(job.progress || 0);
                    setTimeout(poll, 250);
                }, reject);
            };
            poll();
        });
    }

    // Starts a PDF job and resolves with its result ({file, files, pages}) when it is done.
    function run(op, body, onProgress) {
        return call('POST', '/pdf/' + op, body).then(function (started) { return wait(started.jobId, onProgress); });
    }

    // As run, with files: a multipart body (FormData) instead of JSON.
    function upload(op, form, onProgress) {
        return discover().then(function (ep) {
            return fetch(ep.base + '/pdf/' + op, {method: 'POST', headers: {'Authorization': 'Bearer ' + ep.token}, body: form})
                .then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (json) {
                        if (!res.ok) {
                            var err = (json && json.error) || {};
                            throw LocalPdfError(err.code || 'internal', err.message, err.detail);
                        }
                        return wait(json.jobId, onProgress);
                    });
                }, function () {
                    cached = null;
                    throw LocalPdfError('service_unavailable');
                });
        });
    }

    return {run: run, upload: upload, call: call, discover: discover};
});
