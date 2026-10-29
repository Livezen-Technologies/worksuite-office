/*
 * WorkSuite Office: the Stamp dialog of the PDF Editor's PDF Tools tab.
 *
 * Header and footer text (left, centre, right), page numbers, Bates numbers and a text watermark on a range
 * of pages. Text may hold {n} (page), {total} (pages), {bates}, {date} and {file}. The PagesTab controller
 * saves a stamped copy through worksuite-ai. Copied into web-apps by build/patch-pdf-convert.py.
 * Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window',
    'common/main/lib/component/InputField',
    'common/main/lib/component/CheckBox',
    'common/main/lib/component/ComboBox',
    'pdfeditor/main/app/controller/PageRanges'
], function (Window, InputField, CheckBox, ComboBox, PageRanges) {
    'use strict';

    var PRESETS = {
        none: null,
        page: '{n}',
        pageOf: 'Page {n} of {total}',
        bates: '{bates}'
    };

    PDFE.Views.StampDialog = Common.UI.Window.extend(_.extend({
        options: {
            width: 480,
            header: true,
            style: 'min-width: 480px;',
            cls: 'modal-dlg ws-stamp-dlg',
            buttons: null
        },

        // options: count (pages), onOk(body for /v1/pdf/stamp, without path)
        initialize: function (options) {
            var me = this;
            this.ranges = PageRanges || window.WsPageRanges;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var cell = function (id) { return '<td style="padding: 0 4px 6px 0;"><div id="' + id + '"></div></td>'; };
            var rowOf = function (label, prefix) {
                return '<tr><td style="padding: 0 8px 6px 0; white-space: nowrap;"><label>' + label + '</label></td>' +
                       cell(prefix + '-left') + cell(prefix + '-center') + cell(prefix + '-right') + '</tr>';
            };
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<table style="width: 100%; table-layout: fixed; margin-bottom: 4px;">' +
                        '<colgroup><col style="width: 70px;"><col><col><col></colgroup>' +
                        '<tr><td></td><td class="light">' + me.txtLeft + '</td><td class="light">' + me.txtCenter + '</td><td class="light">' + me.txtRight + '</td></tr>' +
                        rowOf(me.txtHeader, 'ws-stamp-header') + rowOf(me.txtFooter, 'ws-stamp-footer') +
                    '</table>' +
                    '<div class="input-row" style="margin-bottom: 4px;"><label class="light">' + me.txtTokens + '</label></div>' +
                    '<table style="margin: 6px 0 10px;"><tr>' +
                        '<td style="padding-right: 8px;"><label>' + me.txtNumbers + '</label></td><td style="width: 170px;"><div id="ws-stamp-numbers"></div></td>' +
                    '</tr></table>' +
                    '<table style="margin-bottom: 10px;"><tr>' +
                        '<td style="padding-right: 8px;"><label>' + me.txtBatesPrefix + '</label></td><td style="width: 90px; padding-right: 12px;"><div id="ws-stamp-prefix"></div></td>' +
                        '<td style="padding-right: 8px;"><label>' + me.txtBatesStart + '</label></td><td style="width: 80px;"><div id="ws-stamp-start"></div></td>' +
                    '</tr></table>' +
                    '<div id="ws-stamp-wm" style="margin-bottom: 6px;"></div>' +
                    '<div id="ws-stamp-wm-text" style="margin: 0 0 10px 22px;"></div>' +
                    '<table style="margin-bottom: 10px;"><tr>' +
                        '<td style="padding-right: 8px;"><label>' + me.txtPages + '</label></td><td style="width: 200px;"><div id="ws-stamp-pages"></div></td>' +
                    '</tr></table>' +
                    '<div class="input-row"><label class="light">' + me.txtNote + '</label></div>' +
                '</div>' +
                '<div class="footer center">' +
                    '<button class="btn normal dlg-btn primary" result="ok">' + me.txtOk + '</button>' +
                    '<button class="btn normal dlg-btn" result="cancel">' + me.textCancel + '</button>' +
                '</div>';
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild(), o = this.options;
            var input = function (id, value, placeHolder, validation) {
                return new Common.UI.InputField({el: $w.find('#' + id), style: 'width: 100%;', value: value || '', placeHolder: placeHolder || '',
                                                 maxLength: 200, validateOnBlur: false, validation: validation});
            };
            this.slots = {};
            ['header', 'footer'].forEach(function (row) {
                ['left', 'center', 'right'].forEach(function (pos) {
                    me.slots[row + '.' + pos] = input('ws-stamp-' + row + '-' + pos);
                });
            });
            this.cmbNumbers = new Common.UI.ComboBox({
                el: $w.find('#ws-stamp-numbers'), cls: 'input-group-nr', menuStyle: 'min-width: 100%;', editable: false,
                data: [
                    {value: 'none', displayValue: me.txtNumNone},
                    {value: 'pageOf', displayValue: me.txtNumPageOf},
                    {value: 'page', displayValue: me.txtNumPage},
                    {value: 'bates', displayValue: me.txtNumBates}
                ]
            });
            this.cmbNumbers.setValue('pageOf');
            this.inPrefix = input('ws-stamp-prefix', '', 'ABC-');
            this.inStart = input('ws-stamp-start', '1', '', function (v) { return /^\d{1,12}$/.test(v) ? true : me.txtInvalidNumber; });
            this.chWm = new Common.UI.CheckBox({el: $w.find('#ws-stamp-wm'), labelText: me.txtWatermark, value: false});
            this.inWm = input('ws-stamp-wm-text', me.txtWmDefault, '', function (v) { return !me.checked(me.chWm) || v ? true : me.txtRequired; });
            this.inPages = input('ws-stamp-pages', '1-' + o.count, '1-3, 5', function (v) {
                return me.ranges.parsePages(v, o.count) ? true : me.txtInvalidPages;
            });
            var sync = function () { me.inWm.setDisabled(!me.checked(me.chWm)); };
            this.chWm.on('change', sync);
            sync();
            this.focusable = _.values(this.slots).concat([this.cmbNumbers, this.inPrefix, this.inStart, this.chWm, this.inWm, this.inPages]);
            $w.find('.dlg-btn').on('click', function (e) {
                e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close();
            });
        },

        checked: function (box) {
            var v = box.getValue();
            return v === true || v === 'checked';
        },

        submit: function () {
            var me = this, o = this.options;
            var inputs = [this.inStart, this.inWm, this.inPages];
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].checkValidate() !== true) { inputs[i].focus(); return; }
            }
            var body = {header: {}, footer: {}};
            _.each(this.slots, function (field, key) {
                var v = field.getValue();
                if (v) body[key.split('.')[0]][key.split('.')[1]] = v;
            });
            // the page numbers go in the footer's centre, or its right when the centre is taken
            var preset = PRESETS[this.cmbNumbers.getValue()];
            if (preset) {
                var slot = !body.footer.center ? 'center' : !body.footer.right ? 'right' : 'left';
                body.footer[slot] = body.footer[slot] ? body.footer[slot] + '  ' + preset : preset;
            }
            var all = (body.header.left || '') + (body.header.center || '') + (body.header.right || '') +
                      (body.footer.left || '') + (body.footer.center || '') + (body.footer.right || '');
            if (all.indexOf('{bates}') >= 0)
                body.bates = {prefix: this.inPrefix.getValue(), start: parseInt(this.inStart.getValue(), 10), digits: 6};
            if (this.checked(this.chWm)) body.watermark = {text: this.inWm.getValue(), opacity: 0.15, rotation: 45};
            if (!all && !body.watermark) { this.slots['header.left'].focus(); return; }
            if (_.isEmpty(body.header)) delete body.header;
            if (_.isEmpty(body.footer)) delete body.footer;
            var pages = this.ranges.parsePages(this.inPages.getValue(), o.count);
            if (pages && pages.length < o.count) body.pages = pages.map(function (p) { return p + 1; });
            this.close();
            o.onOk && o.onOk(body);
        },

        onPrimary: function () {
            this.submit();
            return false;
        },

        getFocusedComponents: function () { return this.focusable; },
        getDefaultFocusableComponent: function () { return this.slots['header.left']; },

        txtTitle: 'Header, footer and watermark',
        txtLeft: 'Left',
        txtCenter: 'Centre',
        txtRight: 'Right',
        txtHeader: 'Header',
        txtFooter: 'Footer',
        txtTokens: 'Text may include {n} (page), {total} (pages), {bates}, {date} and {file}.',
        txtNumbers: 'Page numbers',
        txtNumNone: 'None',
        txtNumPageOf: 'Page 1 of 10',
        txtNumPage: '1',
        txtNumBates: 'Bates number',
        txtBatesPrefix: 'Bates prefix',
        txtBatesStart: 'Start at',
        txtWatermark: 'Watermark',
        txtWmDefault: 'CONFIDENTIAL',
        txtPages: 'Pages',
        txtNote: 'A stamped copy is saved next to this PDF and opens in a new tab. This PDF is not changed. Latin letters only for now.',
        txtRequired: 'Enter the watermark text',
        txtInvalidNumber: 'Enter a whole number',
        txtInvalidPages: 'Enter pages of this document, like 1-3, 5, 8-',
        txtOk: 'Stamp',
        textCancel: 'Cancel'
    }, PDFE.Views.StampDialog || {}));
});
