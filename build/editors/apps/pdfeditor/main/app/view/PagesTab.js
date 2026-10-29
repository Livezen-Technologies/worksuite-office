/*
 * WorkSuite Office: the PDF Editor's PDF Tools tab, its buttons.
 *
 * Copied into web-apps by build/patch-pdf-convert.py before the editors are built, like the rest of
 * build/editors/. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/util/utils',
    'common/main/lib/component/BaseView',
    'common/main/lib/component/Layout'
], function () {
    'use strict';

    // Pages drawn in the theme's icon colour, as on the Convert tab: <svg><use href="#btn-ws-pages-...">
    var sheet = function (x, y) {
        return '<path d="M' + x + ' ' + y + 'h8l3 3v11h-11z" fill="none" stroke="currentColor"/>';
    };
    var ICONS = {
        'btn-ws-pages-merge':     sheet(4.5, 4.5) + sheet(12.5, 9.5),
        'btn-ws-pages-insert':    sheet(5.5, 4.5) + '<path d="M20 15.5v8M16 19.5h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
        'btn-ws-pages-replace':   sheet(5.5, 4.5) + '<path d="M17.5 17.5h6l-2-2M23.5 21.5h-6l2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
        'btn-ws-pages-extract':   sheet(5.5, 4.5) + '<path d="M17 20.5h7M21.5 18l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
        'btn-ws-pages-split':     sheet(8.5, 3.5) + '<path d="M4.5 18.5h2M9 18.5h2M13.5 18.5h2M18 18.5h2M22.5 18.5h2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
        'btn-ws-pages-duplicate': sheet(9.5, 8.5) + '<path d="M6.5 19.5v-14h8" fill="none" stroke="currentColor"/>',
        'btn-ws-pages-stamp':     sheet(5.5, 4.5) + '<path d="M8 8.5h6M8 18.5h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M17.5 23.5l6-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
        'btn-ws-pages-images':    '<path d="M4.5 6.5h15v12h-15z" fill="none" stroke="currentColor"/><path d="M5 17l4.5-5 3 3 2-2 4.5 4.5" fill="none" stroke="currentColor" stroke-linejoin="round"/><circle cx="15.5" cy="9.5" r="1.3" fill="currentColor"/>' + '<path d="M20 15.5v8M16 19.5h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" transform="translate(1 0)"/>',
        'btn-ws-pages-formdata':  sheet(5.5, 4.5) + '<path d="M8 9.5h6M8 13.5h3" fill="none" stroke="currentColor" stroke-linecap="round"/><path d="M15.5 16.5h9v7h-9z" fill="none" stroke="currentColor"/><path d="M17.5 20h5" fill="none" stroke="currentColor" stroke-linecap="round"/>',
        'btn-ws-pages-protect':   sheet(5.5, 4.5) + '<path d="M16.5 18.5h8v6h-8z" fill="none" stroke="currentColor"/><path d="M18.5 18.5v-2a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor"/>'
    };
    var STYLE =
        '.panel[data-tab="wspages"] svg.icon { color: var(--icon-normal, #444); }' +
        '.panel[data-tab="wspages"] .btn.disabled svg.icon { opacity: .4; }';

    function addIcons() {
        if (document.getElementById('ws-pages-icons')) return;
        var symbols = '';
        for (var id in ICONS)
            symbols += '<symbol id="' + id + '" viewBox="0 0 28 28">' + ICONS[id] + '</symbol>';
        var holder = document.createElement('div');
        holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" id="ws-pages-icons" aria-hidden="true" ' +
                           'style="position:absolute;width:0;height:0;overflow:hidden">' + symbols + '</svg>';
        document.body.appendChild(holder.firstChild);
        var style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    PDFE.Views.PagesTab = Common.UI.BaseView.extend(_.extend((function () {
        var NAMES = ['merge', 'images', 'insert', 'replace', 'duplicate', 'extract', 'split', 'stamp', 'formdata', 'protect'];
        var template =
            '<section class="panel" data-tab="wspages" role="tabpanel">' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-merge"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-images"></span>' +
                '</div>' +
                '<div class="separator long"></div>' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-insert"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-replace"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-duplicate"></span>' +
                '</div>' +
                '<div class="separator long"></div>' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-extract"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-split"></span>' +
                '</div>' +
                '<div class="separator long"></div>' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-stamp"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-formdata"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-wspages-protect"></span>' +
                '</div>' +
            '</section>';

        return {
            options: {},

            initialize: function (options) {
                Common.UI.BaseView.prototype.initialize.call(this);
                this.toolbar = options.toolbar;
                this.appConfig = options.mode;
                addIcons();
                var me = this, _set = Common.enumLock;
                this.buttons = {};
                this.lockedControls = NAMES.map(function (name) {
                    return me.buttons[name] = new Common.UI.Button({
                        cls: 'btn-toolbar x-huge icon-top',
                        iconCls: 'svgicon btn-ws-pages-' + name,
                        caption: me['cap_' + name],
                        split: name === 'insert',
                        menu: name === 'insert' || name === 'formdata',
                        lock: [_set.lostConnect, _set.disableOnStart],
                        dataHint: '1',
                        dataHintDirection: 'bottom',
                        dataHintOffset: 'small'
                    });
                });
                Common.UI.LayoutManager.addControls(this.lockedControls);
                Common.Utils.lockControls(_set.disableOnStart, true, {array: this.lockedControls});
            },

            render: function (el) {
                if (el) el.html(this.getPanel());
                return this;
            },

            getPanel: function () {
                this.$el = $(_.template(template)({}));
                var $host = this.$el, me = this;
                NAMES.forEach(function (name) {
                    Common.Utils.injectComponent($host.find('#slot-btn-wspages-' + name), me.buttons[name]);
                });
                return this.$el;
            },

            onAppReady: function () {
                var me = this, b = this.buttons;
                b.insert.setMenu(new Common.UI.Menu({items: [
                    {caption: me.txtInsertBefore, value: 'before'},
                    {caption: me.txtInsertAfter, value: 'after'},
                    {caption: me.txtInsertEnd, value: 'end'}
                ]}).on('item:click', function (menu, item) { me.fireEvent('pages:insert', [item.value]); }));
                b.insert.on('click', function () { me.fireEvent('pages:insert', ['after']); });
                b.formdata.setMenu(new Common.UI.Menu({items: [
                    {caption: me.txtFormImport, value: 'import'},
                    {caption: '--'},
                    {caption: me.txtFormExportJson, value: 'json'},
                    {caption: me.txtFormExportCsv, value: 'csv'},
                    {caption: me.txtFormExportXfdf, value: 'xfdf'},
                    {caption: '--'},
                    {caption: me.txtFormFlatten, value: 'flatten'}
                ]}).on('item:click', function (menu, item) { me.fireEvent('pages:formdata', [item.value]); }));
                ['merge', 'images', 'replace', 'duplicate', 'extract', 'split', 'stamp', 'protect'].forEach(function (name) {
                    b[name].on('click', function () { me.fireEvent('pages:' + name); });
                });
                NAMES.forEach(function (name) { b[name].updateHint(me['tip_' + name]); });
            },

            show: function () {
                Common.UI.BaseView.prototype.show.call(this);
                this.fireEvent('show', this);
            },

            getButtons: function (type) {
                return type === undefined ? this.lockedControls : [];
            },

            SetDisabled: function (state) {
                this.lockedControls.forEach(function (button) { button && button.setDisabled(state); });
            },

            textTab: 'PDF Tools',
            cap_merge: 'Merge',
            tip_merge: 'Add other PDFs at the end, then save the result as a new PDF',
            cap_insert: 'Insert from file',
            tip_insert: 'Insert the pages of other PDFs',
            txtInsertBefore: 'Before the current page',
            txtInsertAfter: 'After the current page',
            txtInsertEnd: 'At the end',
            cap_replace: 'Replace',
            tip_replace: 'Replace pages with the pages of another PDF',
            cap_duplicate: 'Duplicate',
            tip_duplicate: 'Duplicate the selected pages',
            cap_extract: 'Extract',
            tip_extract: 'Save pages as a new PDF',
            cap_split: 'Split',
            tip_split: 'Save this PDF as several PDFs, by page ranges or every N pages',
            cap_protect: 'Protect',
            tip_protect: 'Save a copy with a password to open it, or with printing, copying and changes restricted (AES-256)',
            cap_formdata: 'Form data',
            tip_formdata: 'Fill the form from a data file, save its answers as data, or flatten it',
            txtFormImport: 'Fill from data file (JSON, CSV, XFDF)…',
            txtFormExportJson: 'Save answers as JSON',
            txtFormExportCsv: 'Save answers as CSV',
            txtFormExportXfdf: 'Save answers as XFDF',
            txtFormFlatten: 'Flatten form (answers become part of the page)',
            txtFormFilled: 'The filled copy is saved as {0}. It opens in a new tab.',
            txtFormUnknown: 'These fields are not in this form and were skipped: {0}',
            txtFormExported: 'The answers are saved as {0}, next to this PDF.',
            txtFlattened: 'The flattened copy is saved as {0}. It opens in a new tab.',
            txtNoFields: 'This PDF has no form fields.',
            cap_stamp: 'Stamp',
            tip_stamp: 'Add headers, footers, page numbers, Bates numbers or a watermark',
            cap_images: 'From images',
            tip_images: 'Make a new PDF from PNG and JPEG images, one page each',
            txtStamped: 'The stamped copy is saved as {0}. It opens in a new tab.',
            txtImagesDone: 'The new PDF is saved as {0}, next to the first image. It opens in a new tab.',
            txtProtected: 'The protected copy is saved as {0}. It opens in a new tab.',
            txtNoService: 'This tool needs the WorkSuite Local AI service, which is not running or is turned off by your organization.',
            txtJobFailed: 'The PDF could not be made: {0}',
            txtNotLocal: 'Stamp, Form data and Protect work on PDFs saved on this computer. Save this PDF to a folder first.',
            txtFailed: 'The pages could not be changed. The PDF may be protected with a password, or plugins may be turned off.',
            txtSaveFirst: 'Save this PDF first. Extract, Split, Stamp and Protect work on the PDF as it is saved.',
            txtSavePart: 'Save part {0} of {1}. Choose its name in the next dialog.',
            txtMergeChoose: 'Choose the PDFs to add after this one.',
            txtMergeSave: 'The PDFs are merged. Save the result as a new PDF now? The original files are not changed.'
        };
    }()), PDFE.Views.PagesTab || {}));
});
