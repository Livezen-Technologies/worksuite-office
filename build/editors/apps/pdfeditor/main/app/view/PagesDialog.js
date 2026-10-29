/*
 * WorkSuite Office: the dialog of the PDF Editor's Pages tab for Extract, Split and Replace.
 *
 * Asks which pages (as "1-3, 5, 8-"), or for Split how to cut the PDF, and checks the answer against the
 * document. The PagesTab controller does the work. Copied into web-apps by build/patch-pdf-convert.py.
 * Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window',
    'common/main/lib/component/InputField',
    'common/main/lib/component/RadioBox',
    'pdfeditor/main/app/controller/PageRanges'
], function (Window, InputField, RadioBox, PageRanges) {
    'use strict';

    PDFE.Views.PagesDialog = Common.UI.Window.extend(_.extend({
        options: {
            width: 400,
            header: true,
            style: 'min-width: 400px;',
            cls: 'modal-dlg ws-pages-dlg',
            buttons: null
        },

        // options: mode ('extract' | 'split' | 'replace'), count (pages), pages (the selected ones), onOk(result)
        initialize: function (options) {
            var me = this, mode = options.mode;
            this.ranges = PageRanges || window.WsPageRanges;
            _.extend(this.options, {title: me['title_' + mode]}, options || {});
            var row = function (html) { return '<div class="input-row" style="margin-bottom: 8px;">' + html + '</div>'; };
            var body = row('<label class="light">' + Common.Utils.String.format(me['intro_' + mode], options.count) + '</label>');
            if (mode === 'split') {
                body += '<div id="ws-pages-by-ranges" style="margin-bottom: 6px;"></div>' +
                        '<div id="ws-pages-ranges" style="margin: 0 0 10px 22px;"></div>' +
                        '<div id="ws-pages-by-every" style="margin-bottom: 6px;"></div>' +
                        '<div id="ws-pages-every" style="margin: 0 0 10px 22px; width: 80px;"></div>';
            } else {
                body += row('<label class="font-weight-bold">' + me.textPages + '</label>') +
                        '<div id="ws-pages-ranges" style="margin-bottom: 10px;"></div>';
            }
            body += row('<label class="light">' + me['note_' + mode] + '</label>');
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' + body + '</div>' +
                '<div class="footer center">' +
                    '<button class="btn normal dlg-btn primary" result="ok">' + me['ok_' + mode] + '</button>' +
                    '<button class="btn normal dlg-btn" result="cancel">' + me.textCancel + '</button>' +
                '</div>';
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild(), o = this.options;
            var selected = o.pages && o.pages.length ? this.ranges.format(o.pages) : '';
            var check = function (value) {
                return me.parse(value) ? true : me.textInvalid;
            };
            this.inRanges = new Common.UI.InputField({
                el: $w.find('#ws-pages-ranges'), style: 'width: 100%;', validateOnBlur: false,
                value: o.mode === 'split' ? '' : (selected || '1-' + o.count),
                placeHolder: o.mode === 'split' ? '1-3, 4-' + o.count : '1-3, 5',
                validation: function (value) { return (o.mode !== 'split' || me.rbRanges.getValue()) ? check(value) : true; }
            });
            this.focusable = [this.inRanges];
            if (o.mode === 'split') {
                this.rbRanges = new Common.UI.RadioBox({el: $w.find('#ws-pages-by-ranges'), labelText: me.txtByRanges, name: 'ws-pages-split', checked: true});
                this.rbEvery = new Common.UI.RadioBox({el: $w.find('#ws-pages-by-every'), labelText: me.txtEvery, name: 'ws-pages-split'});
                this.inEvery = new Common.UI.InputField({
                    el: $w.find('#ws-pages-every'), style: 'width: 100%;', value: '1', validateOnBlur: false,
                    validation: function (value) { return me.rbRanges.getValue() || me.ranges.everyN(value, o.count) ? true : me.textInvalid; }
                });
                this.inRanges.on('changing', function () { me.rbRanges.setValue(true); });
                this.inEvery.on('changing', function () { me.rbEvery.setValue(true); });
                this.focusable = [this.rbRanges, this.inRanges, this.rbEvery, this.inEvery];
            }
            $w.find('.dlg-btn').on('click', function (e) {
                e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close();
            });
        },

        // extract / replace: the pages; split: one list of pages per file
        parse: function (value) {
            var o = this.options;
            return o.mode === 'split' ? this.ranges.parseGroups(value, o.count) : this.ranges.parsePages(value, o.count);
        },

        result: function () {
            if (this.options.mode === 'split' && this.rbEvery.getValue())
                return this.ranges.everyN(this.inEvery.getValue(), this.options.count);
            return this.parse(this.inRanges.getValue());
        },

        submit: function () {
            var input = this.options.mode === 'split' && this.rbEvery.getValue() ? this.inEvery : this.inRanges;
            if (input.checkValidate() !== true) { input.focus(); return; }
            var result = this.result();
            if (!result || !result.length) { input.focus(); return; }
            this.close();
            this.options.onOk && this.options.onOk(result);
        },

        onPrimary: function () {
            this.submit();
            return false;
        },

        getFocusedComponents: function () { return this.focusable; },
        getDefaultFocusableComponent: function () { return this.inRanges; },

        title_extract: 'Extract pages',
        title_split: 'Split PDF',
        title_replace: 'Replace pages',
        intro_extract: 'Save these pages as a new PDF. This document has {0} pages.',
        intro_split: 'Save this PDF as several PDFs. It has {0} pages.',
        intro_replace: 'Replace these pages with the pages of another PDF. This document has {0} pages.',
        note_extract: 'You choose where to save the new PDF. This PDF opens again in a new tab, unchanged.',
        note_split: 'You choose where to save each part, in turn. This PDF opens again in a new tab, unchanged.',
        note_replace: 'Next, choose the PDF with the new pages. Undo puts the old pages back.',
        ok_extract: 'Extract',
        ok_split: 'Split',
        ok_replace: 'Choose PDF',
        textPages: 'Pages',
        txtByRanges: 'By page ranges, one PDF per range (e.g. 1-3, 4-6, 7-)',
        txtEvery: 'Every N pages',
        textInvalid: 'Enter pages of this document, like 1-3, 5, 8-',
        textCancel: 'Cancel'
    }, PDFE.Views.PagesDialog || {}));
});
