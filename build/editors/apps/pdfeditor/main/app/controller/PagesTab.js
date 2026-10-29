/*
 * WorkSuite Office: the PDF Editor's Pages tab.
 *
 * Insert the pages of other PDFs, replace pages, duplicate them, extract them to a new PDF, and split the
 * PDF into several, and save a protected copy (AES-256, through worksuite-ai: controller/LocalPdf.js). All through the document builder the editors already have (ApiDocument.Merge, Split,
 * RemovePage, as a plugin would) and the desktop app's own file dialogs; dragging thumbnails still
 * reorders pages. The start page's Merge, Split and Extract pages tools (desktop-apps
 * common/loginpage/src/worksuite/pdf-tools.js) hand their task to this tab through localStorage.
 * Copied into web-apps by build/patch-pdf-convert.py, which also registers it. Licensed under the
 * GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'core',
    'pdfeditor/main/app/view/PagesTab',
    'pdfeditor/main/app/view/PagesDialog',
    'pdfeditor/main/app/view/ProtectDialog',
    'pdfeditor/main/app/controller/PageRanges',
    'pdfeditor/main/app/controller/LocalPdf'
], function (core, view, dialog, protectDialog, PageRanges, LocalPdf) {
    'use strict';

    // Must match desktop-apps common/loginpage/src/worksuite/pdf-tools.js
    var TASK_KEY = 'ws:pdf-task', TASK_VERSION = 1, TASK_TTL_MS = 3 * 60 * 1000,
        TASK_ACTIONS = {merge: 1, split: 1, extract: 1};

    PDFE.Controllers.PagesTab = Backbone.Controller.extend(_.extend({
        models: [],
        collections: [],
        views: [
            'PagesTab'
        ],
        sdkViewName: '#id_main',

        onLaunch: function () {
            this.ranges = PageRanges;
            Common.NotificationCenter.on('app:face', this.onAppShowed.bind(this));
            Common.NotificationCenter.on('document:ready', this.onDocumentReady.bind(this));
            Common.NotificationCenter.on('api:disconnect', this.onCoAuthoringDisconnect.bind(this));
        },

        // The desktop app only: the tab opens and saves files with its dialogs.
        onAppShowed: function (config) {
            if (this.view || !config || !config.isEdit || !config.isDesktopApp || !window.AscDesktopEditor) return;
            var toolbarController = this.getApplication().getController('Toolbar'),
                toolbar = toolbarController && toolbarController.toolbar;
            if (!toolbar || !toolbar.addTab) return;

            this.mode = config;
            this.api = toolbarController.api;
            this.view = this.createView('PagesTab', {toolbar: toolbar, mode: config});
            this.addListeners({
                'PagesTab': {
                    'pages:merge': this.onMerge.bind(this),
                    'pages:insert': this.onInsert.bind(this),
                    'pages:replace': this.onReplace.bind(this),
                    'pages:duplicate': this.onDuplicate.bind(this),
                    'pages:extract': this.onExtract.bind(this),
                    'pages:split': this.onSplit.bind(this),
                    'pages:protect': this.onProtect.bind(this)
                }
            });
            // Registered after the Convert tab, at the same place: Pages comes just before Convert.
            var tab = {caption: this.view.textTab, action: 'wspages', extcls: 'canedit',
                       layoutname: 'toolbar-wspages', dataHintTitle: 'G'};
            toolbar.addTab(tab, this.view.getPanel(), 8);
            toolbar.setVisible('wspages', Common.UI.LayoutManager.isElementVisible('toolbar-wspages'));
            this.view.onAppReady(config);
            this.toolbar = toolbar;

            this.api && this.api.asc_registerCallback('asc_onCoAuthoringDisconnect', this.onCoAuthoringDisconnect.bind(this));
            if (this.getApplication().getController('Main')._isDocReady)
                this.onDocumentReady();
        },

        onDocumentReady: function () {
            if (!this.view || this.ready) return;
            this.ready = true;
            Common.Utils.lockControls(Common.enumLock.disableOnStart, false, {array: this.view.lockedControls});
            var task = this.takePendingTask();
            if (!task) return;
            var me = this;
            setTimeout(function () {
                me.toolbar && me.toolbar.setTab && me.toolbar.setTab('wspages');
                if (task.action === 'merge') me.onMerge();
                else if (task.action === 'split') me.onSplit();
                else me.onExtract();
            }, 300);
        },

        onCoAuthoringDisconnect: function () {
            this.view && Common.Utils.lockControls(Common.enumLock.lostConnect, true, {array: this.view.lockedControls});
        },

        // The start page's task, once: removed when read, used only while fresh.
        takePendingTask: function () {
            var raw = null;
            try {
                raw = window.localStorage.getItem(TASK_KEY);
                if (raw !== null) window.localStorage.removeItem(TASK_KEY);
            } catch (e) {
                return null;
            }
            var task = null, now = Date.now();
            try { task = JSON.parse(raw || 'null'); } catch (e) { return null; }
            if (!task || task.v !== TASK_VERSION || !TASK_ACTIONS[task.action]) return null;
            if (typeof task.at !== 'number' || now < task.at || now - task.at > TASK_TTL_MS) return null;
            return task;
        },

        pagesCount: function () {
            var viewer = this.api && this.api.getDocumentRenderer && this.api.getDocumentRenderer();
            return viewer && viewer.file && viewer.file.pages ? viewer.file.pages.length : 0;
        },

        currentPage: function () {
            return Math.max(0, this.api.getCurrentPage ? this.api.getCurrentPage() : 0);
        },

        selectedPages: function () {
            var pages = (this.api.getSelectedPages && this.api.getSelectedPages()) || [];
            pages = pages.filter(function (p) { return typeof p === 'number' && p >= 0; });
            return pages.length ? pages.sort(function (a, b) { return a - b; }) : [this.currentPage()];
        },

        // A document-builder command (as the Convert tab's OCR does): one undo step.
        build: function (scope, fn) {
            var api = this.api;
            return new Promise(function (resolve, reject) {
                if (!window.g_asc_plugins) return reject(new Error('no document builder (plugins are off)'));
                window.Asc.scope = scope;
                api.callCommand(fn, true, function (ok) {
                    window.Asc.scope = {};
                    (ok === false || (ok && ok['onlyoffice_id_error_message'])) ? reject(new Error('the pages were not changed')) : resolve(ok);
                });
            });
        },

        // The desktop app's Open dialog for PDFs, then each file's bytes as base64.
        pickPdfs: function (multi) {
            var native = window.AscDesktopEditor;
            return new Promise(function (resolve) {
                native.OpenFilenameDialog('(*.pdf)', !!multi, function (files) {
                    files = (Array.isArray(files) ? files : [files]).filter(function (f) { return !!f; });
                    resolve(files);
                });
            }).then(function (files) {
                return Promise.all(files.map(function (path) {
                    return new Promise(function (resolve, reject) {
                        native.loadLocalFile(path, function (bytes) {
                            if (!bytes || !bytes.length) return reject(new Error('could not read ' + path));
                            bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                            resolve(AscCommon.Base64.encode(bytes, 0, bytes.length));
                        });
                    });
                }));
            });
        },

        failed: function (err) {
            console.error('WorkSuite Pages', err);
            Common.UI.warning({msg: this.view.txtFailed});
        },

        // Insert the pages of one or more PDFs before or after the current page, or at the end.
        onInsert: function (where) {
            var me = this;
            return this.pickPdfs(true).then(function (files) {
                if (!files.length) return false;
                var pos = where === 'end' ? me.pagesCount() : me.currentPage() + (where === 'after' ? 1 : 0);
                return me.build({wsPos: pos, wsFiles: files}, function () {
                    return Api.GetDocument().Merge(Asc.scope.wsPos, 0, Asc.scope.wsFiles);
                }).then(function () { return true; });
            }).catch(function (err) { me.failed(err); return false; });
        },

        // Merge (the tab's button, or the start page's task): add the other PDFs at the end, then save the result as a new PDF.
        onMerge: function () {
            var me = this;
            Common.UI.info({msg: this.view.txtMergeChoose, callback: function () {
                me.onInsert('end').then(function (done) {
                    if (!done) return;
                    Common.UI.confirm({msg: me.view.txtMergeSave, callback: function (btn) {
                        if (btn === 'yes' || btn === 'ok') me.saveAs();
                    }});
                });
            }});
        },

        onReplace: function () {
            var me = this;
            new PDFE.Views.PagesDialog({mode: 'replace', count: this.pagesCount(), pages: this.selectedPages(), onOk: function (pages) {
                me.pickPdfs(false).then(function (files) {
                    if (!files.length) return;
                    return me.build({wsPages: pages, wsFile: files[0]}, function () {
                        var doc = Api.GetDocument(), pages = Asc.scope.wsPages;
                        for (var i = pages.length - 1; i >= 0; i--) doc.RemovePage(pages[i]);
                        return doc.Merge(pages[0], 0, [Asc.scope.wsFile]);
                    });
                }).catch(function (err) { me.failed(err); });
            }}).show();
        },

        // The selected pages (or the current one) again, right after the last of them.
        onDuplicate: function () {
            var me = this, pages = this.selectedPages();
            this.build({wsPages: pages}, function () {
                var doc = Api.GetDocument(), pages = Asc.scope.wsPages;
                return doc.Merge(pages[pages.length - 1] + 1, 0, [doc.Split(pages)]);
            }).catch(function (err) { me.failed(err); });
        },

        onExtract: function () {
            var me = this;
            if (!this.checkSaved()) return;
            new PDFE.Views.PagesDialog({mode: 'extract', count: this.pagesCount(), pages: this.selectedPages(), onOk: function (pages) {
                me.saveParts([pages]);
            }}).show();
        },

        onSplit: function () {
            var me = this;
            if (!this.checkSaved()) return;
            new PDFE.Views.PagesDialog({mode: 'split', count: this.pagesCount(), onOk: function (parts) {
                me.saveParts(parts);
            }}).show();
        },

        // A protected copy next to the saved PDF, made by worksuite-ai; it opens in a new tab.
        onProtect: function () {
            var me = this, native = window.AscDesktopEditor, v = this.view;
            if (!this.checkSaved()) return;
            var source = native.LocalFileGetSourcePath ? native.LocalFileGetSourcePath() : '';
            if (!source || !/\.pdf$/i.test(source) || /^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
                Common.UI.warning({msg: v.txtNotLocal});
                return;
            }
            new PDFE.Views.ProtectDialog({onOk: function (options) {
                var body = _.extend({path: source}, options);
                me.api.sync_StartAction && me.api.sync_StartAction(Asc.c_oAscAsyncActionType.BlockInteraction, Asc.c_oAscAsyncAction.Waiting);
                var end = function () {
                    me.api.sync_EndAction && me.api.sync_EndAction(Asc.c_oAscAsyncActionType.BlockInteraction, Asc.c_oAscAsyncAction.Waiting);
                };
                LocalPdf.run('protect', body).then(function (result) {
                    end();
                    var name = result.file.replace(/^.*[\\\/]/, '');
                    Common.UI.info({msg: Common.Utils.String.format(v.txtProtected, Common.Utils.String.htmlEncode(name)), callback: function () {
                        native.execCommand('open:recent', JSON.stringify({id: -1, path: result.file, name: name}));
                    }});
                }, function (err) {
                    end();
                    if (err.code === 'service_unavailable' || err.code === 'forbidden_by_policy')
                        Common.UI.warning({msg: v.txtNoService});
                    else
                        Common.UI.warning({msg: Common.Utils.String.format(v.txtProtectFailed, Common.Utils.String.htmlEncode(err.message || err.code))});
                });
            }}).show();
        },

        // Extract and Split save from this PDF as it is on disk: unsaved changes would end up in the parts only.
        checkSaved: function () {
            if (this.api.isDocumentModified && this.api.isDocumentModified()) {
                Common.UI.warning({msg: this.view.txtSaveFirst});
                return false;
            }
            return true;
        },

        // The desktop app's Save as dialog for a PDF. Resolves true when the file was saved. Save as makes
        // this tab the new file (the desktop app's Save as does that); the original is not touched.
        saveAs: function () {
            var api = this.api;
            return new Promise(function (resolve) {
                var onEnd = function (type, id) {
                    if (id !== Asc.c_oAscAsyncAction.Save) return;
                    api.asc_unregisterCallback('asc_onEndAction', onEnd);
                    setTimeout(function () { resolve(!(api.isDocumentModified && api.isDocumentModified())); }, 0);
                };
                api.asc_registerCallback('asc_onEndAction', onEnd);
                api.asc_DownloadAs(new Asc.asc_CDownloadOptions(Asc.c_oAscFileType.PDF));
            });
        },

        // Each part: remove the other pages (one undo step), Save as, and Undo for the next part. The tab ends
        // as the last part, saved; the original PDF opens again in a new tab.
        saveParts: function (parts) {
            var me = this,
                native = window.AscDesktopEditor,
                original = native.LocalFileGetSourcePath ? native.LocalFileGetSourcePath() : '',
                count = this.pagesCount(),
                saved = 0;
            var next = function (k) {
                if (k >= parts.length) return Promise.resolve();
                var remove = me.ranges.removalOrder(parts[k], count);
                var trim = remove.length ? me.build({wsRemove: remove}, function () {
                    var doc = Api.GetDocument(), r = Asc.scope.wsRemove;
                    for (var i = 0; i < r.length; i++) doc.RemovePage(r[i]);
                    return true;
                }) : Promise.resolve();
                return trim.then(function () {
                    if (parts.length < 2) return;
                    return new Promise(function (resolve) {
                        Common.UI.info({msg: Common.Utils.String.format(me.view.txtSavePart, k + 1, parts.length), callback: resolve});
                    });
                }).then(function () {
                    return me.saveAs();
                }).then(function (ok) {
                    if (!ok) {
                        remove.length && me.api.Undo();
                        return;
                    }
                    saved++;
                    if (k + 1 < parts.length) {
                        remove.length && me.api.Undo();
                        return next(k + 1);
                    }
                });
            };
            next(0).then(function () {
                if (saved && original)
                    native.execCommand('open:recent', JSON.stringify({id: -1, path: original, name: original.replace(/^.*[\\\/]/, '')}));
            }, function (err) { me.failed(err); });
        },

        SetDisabled: function (state) {
            this.view && this.view.SetDisabled(state);
        },

        getView: function (name) {
            return !name && this.view ? this.view : Backbone.Controller.prototype.getView.call(this, name);
        }
    }, PDFE.Controllers.PagesTab || {}));
});
