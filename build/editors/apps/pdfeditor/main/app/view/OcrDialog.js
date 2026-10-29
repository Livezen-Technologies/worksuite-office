/*
 * WorkSuite Office: the PDF Editor's "Recognise text" (OCR) dialog, opened from the Convert tab.
 *
 * Asks for the languages, the pages and what to do with the text, then shows the progress with Cancel.
 * The work is done by the ConvertTab controller, on this computer. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window',
    'common/main/lib/component/CheckBox',
    'common/main/lib/component/RadioBox'
], function () {
    'use strict';

    PDFE.Views.OcrDialog = Common.UI.Window.extend(_.extend({
        options: {
            width: 380,
            header: true,
            style: 'min-width: 380px;',
            cls: 'modal-dlg ws-ocr-dlg',
            buttons: null
        },

        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: this.textTitle}, options || {});
            this.template =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 12px;"><label class="light">' + me.textIntro + '</label></div>' +
                    '<div class="input-row"><label class="font-weight-bold">' + me.textLanguages + '</label></div>' +
                    '<div id="ws-ocr-lang-eng" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-lang-sin" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-lang-tam" style="margin-bottom: 12px;"></div>' +
                    '<div class="input-row"><label class="font-weight-bold">' + me.textPages + '</label></div>' +
                    '<div id="ws-ocr-pages-all" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-pages-current" style="margin-bottom: 12px;"></div>' +
                    '<div class="input-row"><label class="font-weight-bold">' + me.textCleanUp + '</label></div>' +
                    '<div id="ws-ocr-clean-straighten" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-clean-upright" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-clean-bw" style="margin-bottom: 12px;"></div>' +
                    '<div class="input-row"><label class="font-weight-bold">' + me.textThen + '</label></div>' +
                    '<div id="ws-ocr-then-searchable" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-then-word" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-ocr-then-pdfa" style="margin-bottom: 12px;"></div>' +
                    '<div id="ws-ocr-progress" style="display: none; margin-bottom: 4px;">' +
                        '<label id="ws-ocr-status" class="light" style="display: block; margin-bottom: 6px;"></label>' +
                        '<div style="height: 6px; border-radius: 3px; overflow: hidden; background: var(--border-divider, #e2e8f0);">' +
                            '<div id="ws-ocr-bar" style="height: 100%; width: 0; background: var(--background-accent-button, #2563eb);"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="footer center">' +
                    '<button class="btn normal dlg-btn primary" result="ok" id="ws-ocr-start">' + me.textRecognise + '</button>' +
                    '<button class="btn normal dlg-btn" result="cancel">' + me.textCancel + '</button>' +
                '</div>';
            this.options.tpl = this.template;
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this,
                $w = this.getChild();

            this.chLangs = [['eng', me.txtEnglish, true], ['sin', me.txtSinhala, true], ['tam', me.txtTamil, false]].map(function (l) {
                var ch = new Common.UI.CheckBox({el: $w.find('#ws-ocr-lang-' + l[0]), labelText: l[1], value: l[0]});
                ch.setValue(l[2]);
                ch.on('change', _.bind(me.updateStart, me));
                return ch;
            });
            this.rbPages = [['all', me.txtAllPages, true], ['current', me.txtCurrentPage, false]].map(function (p) {
                return new Common.UI.RadioBox({el: $w.find('#ws-ocr-pages-' + p[0]), labelText: p[1], name: 'ws-ocr-pages', value: p[0], checked: p[2]});
            });
            this.chClean = [['straighten', me.txtStraighten, true], ['upright', me.txtUpright, true], ['bw', me.txtBlackWhite, false]].map(function (c) {
                var ch = new Common.UI.CheckBox({el: $w.find('#ws-ocr-clean-' + c[0]), labelText: c[1], value: c[0]});
                ch.setValue(c[2]);
                return ch;
            });
            this.rbThen = [['searchable', me.txtSearchable, true], ['word', me.txtWord, false], ['pdfa', me.txtPdfa, false]].map(function (t) {
                return new Common.UI.RadioBox({el: $w.find('#ws-ocr-then-' + t[0]), labelText: t[1], name: 'ws-ocr-then', value: t[0], checked: t[2]});
            });
            if (!this.options.canPdfa) this.rbThen[2].setDisabled(true);

            this.$progress = $w.find('#ws-ocr-progress');
            this.$status = $w.find('#ws-ocr-status');
            this.$bar = $w.find('#ws-ocr-bar');
            this.$start = $w.find('#ws-ocr-start');
            $w.find('.dlg-btn').on('click', _.bind(this.onBtnClick, this));
        },

        getFocusedComponents: function () {
            return this.chLangs.concat(this.rbPages, this.chClean, this.rbThen);
        },

        getDefaultFocusableComponent: function () {
            return this.chLangs[0];
        },

        getSettings: function () {
            var pick = function (list) {
                for (var i = 0; i < list.length; i++) if (list[i].getValue()) return list[i].options.value;
            };
            return {
                langs: this.chLangs.filter(function (ch) { return ch.getValue() === 'checked' || ch.getValue() === true; })
                                   .map(function (ch) { return ch.options.value; }),
                pages: pick(this.rbPages),
                clean: this.chClean.reduce(function (o, ch) {
                    o[ch.options.value] = ch.getValue() === 'checked' || ch.getValue() === true;
                    return o;
                }, {}),
                then: pick(this.rbThen)
            };
        },

        updateStart: function () {
            var none = !this.getSettings().langs.length;
            this.$start.toggleClass('disabled', none || this.running).prop('disabled', none || this.running);
        },

        onPrimary: function () {
            this.start();
            return false;
        },

        onBtnClick: function (e) {
            if (e.currentTarget.attributes['result'].value === 'ok')
                this.start();
            else
                this.cancel();
        },

        start: function () {
            if (this.running) return;
            var settings = this.getSettings();
            if (!settings.langs.length) return;
            this.running = true;
            this.chLangs.concat(this.rbPages, this.chClean, this.rbThen).forEach(function (c) { c.setDisabled(true); });
            this.updateStart();
            this.$progress.show();
            this.setProgress(0, this.txtStarting);
            this.options.onStart && this.options.onStart(settings, this);
        },

        // While recognising, Cancel stops it (the pages done so far stay changed, and can be undone);
        // otherwise it closes the dialog.
        cancel: function () {
            if (this.running && this.options.onCancel) this.options.onCancel();
            this.close();
        },

        onClose: function () {
            this.cancel();
        },

        close: function () {
            this.running = false;
            Common.UI.Window.prototype.close.apply(this, arguments);
        },

        setProgress: function (fraction, text) {
            this.$bar && this.$bar.css('width', Math.max(0, Math.min(100, Math.round(fraction * 100))) + '%');
            if (text !== undefined && this.$status) this.$status.text(text);
        },

        textTitle: 'Recognise text (OCR)',
        textIntro: 'Turns scanned pages into text. Recognising runs on this computer; nothing is uploaded.',
        textLanguages: 'Languages',
        txtEnglish: 'English',
        txtSinhala: 'Sinhala',
        txtTamil: 'Tamil',
        textPages: 'Pages',
        txtAllPages: 'All pages',
        txtCurrentPage: 'Current page',
        textCleanUp: 'Clean up scans',
        txtStraighten: 'Straighten tilted pages',
        txtUpright: 'Turn sideways and upside-down pages upright',
        txtBlackWhite: 'Make pages black and white (crisper, smaller)',
        textThen: 'Then',
        txtSearchable: 'Make this PDF searchable',
        txtWord: 'Convert to Word',
        txtPdfa: 'Save as PDF/A',
        textRecognise: 'Recognise',
        textCancel: 'Cancel',
        txtStarting: 'Starting…'
    }, PDFE.Views.OcrDialog || {}));
});
