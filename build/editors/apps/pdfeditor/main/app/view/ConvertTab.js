/*
 * WorkSuite Office: the PDF Editor's Convert tab, its buttons.
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

    // The icons: a page in the theme's icon colour with a badge in the colour of the format. The buttons
    // draw them as <svg><use href="#btn-..."> (Euro-Office takes the btn- class, ONLYOFFICE the name after
    // "svgicon"), so they come from symbols added to the page once.
    var page = '<path d="M5.5 3.5h11l5 5v16h-16z" fill="none" stroke="currentColor"/>' +
               '<path d="M16.5 3.5v5h5" fill="none" stroke="currentColor"/>';
    var badge = function (color) {
        return '<rect x="11.5" y="13.5" width="15" height="11" rx="1.5" fill="' + color + '"/>';
    };
    var white = 'fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
    var ICONS = {
        'btn-ws-convert-word':  page + badge('#2b579a') + '<path d="M14.5 16.5l1.8 5.5 2.7-4.5 2.7 4.5 1.8-5.5" ' + white + '/>',
        'btn-ws-convert-image': page + badge('#7a4fbf') + '<path d="M14 22.5l3.5-4 2.5 2.5 1.5-1.5 2.5 3" ' + white + '/>' +
                                '<circle cx="21.5" cy="16.8" r="1.1" fill="#fff"/>',
        'btn-ws-convert-text':  page + badge('#5c6b7a') + '<path d="M14.5 16.5h9M14.5 19h9M14.5 21.5h6" ' + white + '/>',
        'btn-ws-convert-html':  page + badge('#d9541e') + '<path d="M17 16.5l-2.5 2.5 2.5 2.5M21 16.5l2.5 2.5-2.5 2.5M19.8 15.8l-1.6 6.4" ' + white + '/>',
        'btn-ws-convert-ebook': page + badge('#2e8b57') + '<path d="M19 17.3c-1.4-.9-2.9-1-4.5-.8v5.6c1.6-.2 3.1-.1 4.5.8 1.4-.9 2.9-1 4.5-.8v-5.6c-1.6-.2-3.1-.1-4.5.8zM19 17.3v5.6" ' + white + '/>',
        'btn-ws-convert-all':   page + badge('#69707a') + '<circle cx="15.5" cy="19" r="1.1" fill="#fff"/><circle cx="19" cy="19" r="1.1" fill="#fff"/><circle cx="22.5" cy="19" r="1.1" fill="#fff"/>'
    };
    var STYLE =
        // The page follows the theme, as the toolbar's own icons do.
        '.panel[data-tab="convert"] svg.icon { color: var(--icon-normal, #444); }' +
        '.panel[data-tab="convert"] .btn.disabled svg.icon { opacity: .4; }';

    function addIcons() {
        if (document.getElementById('ws-convert-icons')) return;
        var symbols = '';
        for (var id in ICONS)
            symbols += '<symbol id="' + id + '" viewBox="0 0 28 28">' + ICONS[id] + '</symbol>';
        var holder = document.createElement('div');
        holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" id="ws-convert-icons" aria-hidden="true" ' +
                           'style="position:absolute;width:0;height:0;overflow:hidden">' + symbols + '</svg>';
        document.body.appendChild(holder.firstChild);
        var style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    PDFE.Views.ConvertTab = Common.UI.BaseView.extend(_.extend((function () {
        var template =
            '<section class="panel" data-tab="convert" role="tabpanel">' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-word"></span>' +
                '</div>' +
                '<div class="separator long"></div>' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-image"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-text"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-html"></span>' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-ebook"></span>' +
                '</div>' +
                '<div class="separator long"></div>' +
                '<div class="group">' +
                    '<span class="btn-slot text x-huge" id="slot-btn-convert-all"></span>' +
                '</div>' +
            '</section>';

        return {
            options: {},

            initialize: function (options) {
                Common.UI.BaseView.prototype.initialize.call(this);
                this.toolbar = options.toolbar;
                this.appConfig = options.mode;
                addIcons();

                var me = this,
                    _set = Common.enumLock;
                // A button converts to the first of its formats; the menu of a button with more has them all.
                // A format this version of the editors does not know is left out.
                var buttons = [
                    {name: 'word',  caption: me.capWord,  hint: me.tipWord,  formats: [['DOCX', me.txtDocx], ['DOTX', me.txtDotx], ['ODT', me.txtOdt], ['OTT', me.txtOtt], ['RTF', me.txtRtf]]},
                    {name: 'image', caption: me.capImage, hint: me.tipImage, formats: [['PNG', me.txtPng], ['JPG', me.txtJpg]]},
                    {name: 'text',  caption: me.capText,  hint: me.tipText,  formats: [['TXT', me.txtTxt], ['MD', me.txtMd]]},
                    {name: 'html',  caption: me.capHtml,  hint: me.tipHtml,  formats: [['HTML', me.txtHtml]]},
                    {name: 'ebook', caption: me.capEbook, hint: me.tipEbook, formats: [['EPUB', me.txtEpub], ['FB2', me.txtFb2]]}
                ];

                this.lockedControls = [];
                this.formatButtons = [];
                buttons.forEach(function (b) {
                    var formats = b.formats.filter(function (f) {
                        return Asc.c_oAscFileType[f[0]] !== undefined;
                    }).map(function (f) {
                        return {caption: f[1], value: Asc.c_oAscFileType[f[0]]};
                    });
                    if (!formats.length) return;

                    var btn = new Common.UI.Button({
                        cls: 'btn-toolbar x-huge icon-top',
                        iconCls: 'svgicon btn-ws-convert-' + b.name,
                        caption: b.caption,
                        split: formats.length > 1,
                        menu: formats.length > 1,
                        lock: [_set.lostConnect, _set.disableOnStart],
                        dataHint: '1',
                        dataHintDirection: 'bottom',
                        dataHintOffset: 'small'
                    });
                    btn.convertSlot = '#slot-btn-convert-' + b.name;
                    btn.convertHint = b.hint;
                    btn.convertFormats = formats;
                    me.formatButtons.push(btn);
                    me.lockedControls.push(btn);
                });

                this.btnAllFormats = new Common.UI.Button({
                    cls: 'btn-toolbar x-huge icon-top',
                    iconCls: 'svgicon btn-ws-convert-all',
                    caption: me.capAll,
                    lock: [_set.lostConnect, _set.disableOnStart],
                    dataHint: '1',
                    dataHintDirection: 'bottom',
                    dataHintOffset: 'small'
                });
                this.lockedControls.push(this.btnAllFormats);

                Common.UI.LayoutManager.addControls(this.lockedControls);
                Common.Utils.lockControls(_set.disableOnStart, true, {array: this.lockedControls});
            },

            render: function (el) {
                if (el) el.html(this.getPanel());
                return this;
            },

            getPanel: function () {
                this.$el = $(_.template(template)({}));
                var $host = this.$el;
                this.formatButtons.forEach(function (btn) {
                    Common.Utils.injectComponent($host.find(btn.convertSlot), btn);
                });
                Common.Utils.injectComponent($host.find('#slot-btn-convert-all'), this.btnAllFormats);
                return this.$el;
            },

            // After getPanel, once the panel is in the toolbar: the menus need their buttons on the page.
            onAppReady: function () {
                var me = this;
                this.formatButtons.forEach(function (btn) {
                    var formats = btn.convertFormats;
                    if (formats.length > 1) {
                        btn.setMenu(new Common.UI.Menu({items: formats}).on('item:click', function (menu, item) {
                            me.fireEvent('convert:format', [item.value]);
                        }));
                    }
                    btn.on('click', function () {
                        me.fireEvent('convert:format', [formats[0].value]);
                    });
                    btn.updateHint(btn.convertHint);
                });
                this.btnAllFormats.on('click', function () {
                    me.fireEvent('convert:all');
                });
                this.btnAllFormats.updateHint(this.tipAll);
            },

            show: function () {
                Common.UI.BaseView.prototype.show.call(this);
                this.fireEvent('show', this);
            },

            getButtons: function (type) {
                return type === undefined ? this.lockedControls : [];
            },

            SetDisabled: function (state) {
                this.lockedControls.forEach(function (button) {
                    button && button.setDisabled(state);
                });
            },

            textTab: 'Convert',
            capWord: 'Word',
            tipWord: 'Convert to a Word document you can edit',
            capImage: 'Image',
            tipImage: 'Save every page as an image, together in a .zip file',
            capText: 'Text',
            tipText: 'Save the text',
            capHtml: 'Web page',
            tipHtml: 'Convert to a web page (HTML)',
            capEbook: 'E-book',
            tipEbook: 'Convert to an e-book',
            capAll: 'All formats',
            tipAll: 'Choose any format in the Save as dialog',
            txtDocx: 'Word document (.docx)',
            txtDotx: 'Word template (.dotx)',
            txtOdt: 'OpenDocument text (.odt)',
            txtOtt: 'OpenDocument template (.ott)',
            txtRtf: 'Rich Text Format (.rtf)',
            txtPng: 'PNG images (.zip)',
            txtJpg: 'JPEG images (.zip)',
            txtTxt: 'Plain text (.txt)',
            txtMd: 'Markdown (.md)',
            txtHtml: 'Web page (.html)',
            txtEpub: 'EPUB (.epub)',
            txtFb2: 'FictionBook (.fb2)'
        };
    }()), PDFE.Views.ConvertTab || {}));
});
