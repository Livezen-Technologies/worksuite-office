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
    'pdfeditor/main/app/view/ConvertTab'
], function () {
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
                    'convert:all': this.onConvertAll.bind(this)
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

        SetDisabled: function (state) {
            this.view && this.view.SetDisabled(state);
        },

        getView: function (name) {
            return !name && this.view ? this.view : Backbone.Controller.prototype.getView.call(this, name);
        }
    }, PDFE.Controllers.ConvertTab || {}));
});
