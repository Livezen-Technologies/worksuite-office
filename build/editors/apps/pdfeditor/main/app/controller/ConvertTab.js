/*
 * WorkSuite Office: the PDF Editor's Convert tab.
 *
 * Converts the open PDF to Word, images, text, a web page or an e-book with the converter the editors
 * already have: each button does what choosing that format under File > Save as (Download as when the
 * document is online) does, warnings and dialogs included. Copied into web-apps by
 * build/patch-pdf-convert.py, which also registers it. Licensed under the GNU AGPL v3, as the editors
 * it becomes part of.
 */

define([
    'core',
    'pdfeditor/main/app/view/ConvertTab',
    'pdfeditor/main/app/view/OcrDialog',
    'pdfeditor/main/app/controller/OcrImage'
], function (core, view, dialog, OcrImage) {
    'use strict';

    PDFE.Controllers.ConvertTab = Backbone.Controller.extend(_.extend({
        models: [],
        collections: [],
        views: [
            'ConvertTab'
        ],
        sdkViewName: '#id_main',

        onLaunch: function () {
            // Registered after the Toolbar controller's, so the toolbar and its tabs are there when this runs.
            Common.NotificationCenter.on('app:face', this.onAppShowed.bind(this));
            Common.NotificationCenter.on('document:ready', this.onDocumentReady.bind(this));
            Common.NotificationCenter.on('api:disconnect', this.onCoAuthoringDisconnect.bind(this));
        },

        onAppShowed: function (config) {
            if (this.view || !config || !config.canDownload) return;
            var toolbarController = this.getApplication().getController('Toolbar'),
                toolbar = toolbarController && toolbarController.toolbar;
            if (!toolbar || !toolbar.addTab) return;

            this.mode = config;
            this.api = toolbarController.api;
            this.view = this.createView('ConvertTab', {toolbar: toolbar, mode: config});
            this.addListeners({
                'ConvertTab': {
                    'convert:format': this.onConvert.bind(this),
                    'convert:all': this.onConvertAll.bind(this),
                    'convert:ocr': this.onOcr.bind(this)
                }
            });

            // View is added after the 8th tab place. Taking that place too puts Convert just before View,
            // in every mode, with Plugins still last.
            var tab = {caption: this.view.textTab, action: 'convert', extcls: config.isEdit ? 'canedit' : '',
                       layoutname: 'toolbar-convert', dataHintTitle: 'O'};
            toolbar.addTab(tab, this.view.getPanel(), 8);
            toolbar.setVisible('convert', Common.UI.LayoutManager.isElementVisible('toolbar-convert'));
            this.view.onAppReady(config);

            this.api && this.api.asc_registerCallback('asc_onCoAuthoringDisconnect', this.onCoAuthoringDisconnect.bind(this));
            if (this.getApplication().getController('Main')._isDocReady)
                this.onDocumentReady();
        },

        onDocumentReady: function () {
            this.view && Common.Utils.lockControls(Common.enumLock.disableOnStart, false, {array: this.view.lockedControls});
        },

        onCoAuthoringDisconnect: function () {
            this.view && Common.Utils.lockControls(Common.enumLock.lostConnect, true, {array: this.view.lockedControls});
        },

        // As choosing the format in the File menu: the PDF's "converted to an editable format" warning, the
        // encoding of a text file, then the desktop's Save dialog for that format, or the download online.
        onConvert: function (format) {
            this.getApplication().getController('LeftMenu').clickSaveAsFormat({hide: function () {}}, format);
        },

        // The Save as dialog with every format, or online the File menu's Download as.
        onConvertAll: function () {
            if (this.mode.isDesktopApp && this.mode.isOffline)
                this.api && this.api.asc_DownloadAs();
            else
                this.getApplication().getController('LeftMenu').leftMenu.showMenu('file:saveas');
        },

        // Recognise text (OCR). Tesseract (tesseract.js, WebAssembly) runs in a worker in this window, with
        // the engine and the English, Sinhala and Tamil models that build/v10/ocr.sh puts in editors/ocr/
        // of the desktop app: nothing leaves the computer. Each page is drawn at 300 dpi by the editor's own
        // PDF renderer, recognised, and replaced by Tesseract's page: the same picture with the recognised
        // text, invisible, on top (as every "searchable PDF" OCR does). Then, as asked, the Save dialog for
        // Word or PDF/A. Undo puts the pages back.
        onOcr: function () {
            var me = this,
                viewer = this.api && this.api.getDocumentRenderer && this.api.getDocumentRenderer();
            if (!viewer || !viewer.file) return;
            var dlg = new PDFE.Views.OcrDialog({
                canPdfa: Asc.c_oAscFileType.PDFA !== undefined,
                onStart: function (settings) {
                    me.ocrJob = {cancelled: false};
                    me.runOcr(settings, me.ocrJob, dlg).then(function (done) {
                        if (me.ocrJob && me.ocrJob.cancelled) return;
                        me.ocrJob = null;
                        dlg.close();
                        if (!done) {
                            Common.UI.info({msg: me.view.txtOcrNothing});
                        } else if (settings.then === 'word') {
                            me.onConvert(Asc.c_oAscFileType.DOCX);
                        } else if (settings.then === 'pdfa') {
                            me.onConvert(Asc.c_oAscFileType.PDFA);
                        }
                    }, function (err) {
                        var cancelled = me.ocrJob && me.ocrJob.cancelled;
                        me.ocrJob = null;
                        dlg.close();
                        if (!cancelled) {
                            console.error('WorkSuite OCR', err);
                            Common.UI.warning({msg: me.view.txtOcrFailed});
                        }
                    });
                },
                onCancel: function () {
                    if (!me.ocrJob) return;
                    me.ocrJob.cancelled = true;
                    me.ocrJob.worker && me.ocrJob.worker.terminate();
                }
            });
            dlg.show();
        },

        // The folder holding tesseract.min.js, worker.js, core/ and lang/: editors/ocr next to editors/web-apps.
        ocrBase: function () {
            var href = window.location.href.split('#')[0].split('?')[0],
                i = href.lastIndexOf('/web-apps/');
            return i < 0 ? null : href.substring(0, i) + '/ocr/';
        },

        loadTesseract: function (base) {
            if (this.Tesseract) return Promise.resolve(this.Tesseract);
            var me = this;
            return new Promise(function (resolve, reject) {
                // tesseract.min.js is UMD: under the editors' RequireJS it defines an anonymous module
                require([base + 'tesseract.min.js'], function (T) {
                    T = T || window.Tesseract;
                    T ? resolve(me.Tesseract = T) : reject(new Error('tesseract.js did not load'));
                }, reject);
            });
        },

        runOcr: function (settings, job, dlg) {
            var me = this,
                view = this.view,
                viewer = this.api.getDocumentRenderer(),
                file = viewer.file,
                base = this.ocrBase();
            if (!base) return Promise.reject(new Error('no editors folder in ' + window.location.href));

            var pages = [];
            if (settings.pages === 'current') {
                pages.push(Math.max(0, viewer.currentPage || 0));
            } else {
                for (var i = 0; i < file.pages.length; i++) pages.push(i);
            }
            // Pages already turned into editable content are drawn by the editor, not the PDF renderer: skip them
            pages = pages.filter(function (n) {
                var p = file.pages[n];
                return p && p.originIndex !== undefined && !p.isRecognized;
            });
            if (!pages.length) return Promise.resolve(0);

            var step = 0, total = pages.length, done = 0;
            var progress = function (inPage, text) {
                dlg.setProgress((step + inPage) / total, text);
            };

            return this.loadTesseract(base).then(function (T) {
                if (job.cancelled) throw new Error('cancelled');
                progress(0, view.txtOcrLoading);
                return T.createWorker(settings.langs, 1 /* LSTM only */, {
                    workerPath: base + 'worker.js',
                    workerBlobURL: false,
                    corePath: base + 'core',
                    langPath: base + 'lang',
                    gzip: false,
                    cacheMethod: 'none',
                    logger: function (m) {
                        if (m && m.status === 'recognizing text')
                            progress(m.progress || 0, Common.Utils.String.format(view.txtOcrPage, step + 1, total));
                    }
                });
            }).then(function (worker) {
                job.worker = worker;
                if (job.cancelled) throw new Error('cancelled');
                return worker.setParameters({user_defined_dpi: '300'}).then(function () {
                    var chain = Promise.resolve();
                    pages.forEach(function (n, k) {
                        chain = chain.then(function () {
                            if (job.cancelled) throw new Error('cancelled');
                            step = k;
                            progress(0, Common.Utils.String.format(view.txtOcrPage, k + 1, total));
                            return me.ocrPage(worker, file, n, settings.clean || {}).then(function (res) {
                                if (job.cancelled) throw new Error('cancelled');
                                return me.replacePage(n, res.pdf, res.turned);
                            }).then(function () { done++; });
                        });
                    });
                    return chain;
                }).then(function () {
                    worker.terminate();
                    job.worker = null;
                    dlg.setProgress(1);
                    return done;
                }, function (err) {
                    worker.terminate();
                    job.worker = null;
                    throw err;
                });
            });
        },

        // One page at 300 dpi (as far as the renderer's canvas limit allows), cleaned up as asked, for Tesseract,
        // which keeps it as the page's picture. Resolves to {pdf: the one-page PDF Tesseract writes, turned:
        // whether the page was turned upright (its old rotation then no longer applies)}.
        ocrPage: function (worker, file, n, clean) {
            var me = this,
                page = file.pages[n],
                dpi = 300,
                w = Math.round(page.W * dpi / page.Dpi),
                h = Math.round(page.H * dpi / page.Dpi),
                image = file.getPage(n, w, h, true, 0xFFFFFF);
            if (!image) return Promise.reject(new Error('page ' + n + ' did not render'));
            var canvas = this.toCanvas(image, 0);
            // the dpi the page really got, so that Tesseract's page is the original's size
            var realDpi = Math.round(canvas.width * page.Dpi / page.W),
                turned = 0;
            var ready = clean.upright ? this.detectOrientation(worker, canvas) : Promise.resolve(0);
            return ready.then(function (quarter) {
                if (quarter) { turned = quarter; canvas = me.toCanvas(canvas, quarter); }
                if (clean.straighten || clean.bw) canvas = me.cleanUp(canvas, clean);
                return worker.setParameters({user_defined_dpi: String(realDpi)});
            }).then(function () {
                // black and white compresses best as PNG; colour as a good JPEG
                return new Promise(function (resolve) {
                    clean.bw ? canvas.toBlob(resolve, 'image/png') : canvas.toBlob(resolve, 'image/jpeg', 0.92);
                });
            }).then(function (blob) {
                return worker.recognize(blob, {}, {text: false, blocks: false, pdf: true, pdfTitle: ''});
            }).then(function (res) {
                if (!res || !res.data || !res.data.pdf) throw new Error('no PDF from Tesseract');
                return {pdf: new Uint8Array(res.data.pdf), turned: !!turned};
            });
        },

        // A white canvas holding the image turned by a quarter turn (0, 90, 180, 270 degrees clockwise)
        toCanvas: function (image, quarter) {
            var c = document.createElement('canvas'), side = quarter === 90 || quarter === 270;
            c.width = side ? image.height : image.width;
            c.height = side ? image.width : image.height;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate(quarter * Math.PI / 180);
            ctx.drawImage(image, -image.width / 2, -image.height / 2);
            return c;
        },

        // Which quarter turn makes the page upright: a quick trial recognition of the middle of the page in each
        // of the four ways, at a quarter of the size; the most confident wins when it clearly leads.
        detectOrientation: function (worker, canvas) {
            var me = this,
                side = Math.round(Math.min(canvas.width, canvas.height) * 0.5),
                crop = document.createElement('canvas');
            crop.width = crop.height = Math.round(side / 2);
            crop.getContext('2d').drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, crop.width, crop.height);
            var confidences = {}, chain = Promise.resolve();
            [0, 90, 180, 270].forEach(function (q) {
                chain = chain.then(function () {
                    return worker.recognize(me.toCanvas(crop, q), {}, {text: true, blocks: false, pdf: false});
                }).then(function (res) {
                    confidences[q] = res && res.data ? res.data.confidence || 0 : 0;
                });
            });
            return chain.then(function () { return OcrImage.bestOrientation(confidences); }, function () { return 0; });
        },

        // Straightens the page (rotating it back by the skew of its lines) and/or makes it black and white.
        cleanUp: function (canvas, clean) {
            var ctx = canvas.getContext('2d'),
                data = ctx.getImageData(0, 0, canvas.width, canvas.height),
                gray = OcrImage.toGray(data.data, canvas.width, canvas.height),
                ink = OcrImage.binarize(gray, OcrImage.otsu(gray));
            if (clean.bw) {
                OcrImage.despeckle(ink, canvas.width, canvas.height);
                ctx.putImageData(new ImageData(OcrImage.inkToRgba(ink, data.data), canvas.width, canvas.height), 0, 0);
            }
            var angle = clean.straighten ? OcrImage.skewAngle(ink, canvas.width, canvas.height) : 0;
            if (Math.abs(angle) < 0.1) return canvas;
            var out = document.createElement('canvas');
            out.width = canvas.width;
            out.height = canvas.height;
            var octx = out.getContext('2d');
            octx.fillStyle = '#fff';
            octx.fillRect(0, 0, out.width, out.height);
            octx.translate(out.width / 2, out.height / 2);
            octx.rotate(-angle * Math.PI / 180);
            octx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
            return out;
        },

        // Replaces page n with the recognised one through the document builder (as a plugin would), keeping
        // the page's rotation unless the page was turned upright. One undo step per page.
        replacePage: function (n, pdf, turned) {
            var api = this.api,
                b64 = AscCommon.Base64.encode(pdf, 0, pdf.length);
            return new Promise(function (resolve, reject) {
                if (!window.g_asc_plugins) return reject(new Error('no document builder (plugins are off)'));
                window.Asc.scope = {wsPage: n, wsPdf: b64, wsTurned: !!turned};
                api.callCommand(function () {
                    var doc = Api.GetDocument(),
                        n = Asc.scope.wsPage,
                        rotation = Asc.scope.wsTurned ? 0 : doc.GetPage(n).GetRotation();
                    if (!doc.Merge(n, 1, [Asc.scope.wsPdf])) return false;
                    if (rotation) doc.GetPage(n).SetRotation(rotation);
                    return true;
                }, true, function (ok) {
                    window.Asc.scope = {};
                    (ok === false || (ok && ok['onlyoffice_id_error_message'])) ? reject(new Error('page ' + n + ' was not replaced')) : resolve();
                });
            });
        },

        SetDisabled: function (state) {
            this.view && this.view.SetDisabled(state);
        },

        getView: function (name) {
            return !name && this.view ? this.view : Backbone.Controller.prototype.getView.call(this, name);
        }
    }, PDFE.Controllers.ConvertTab || {}));
});
