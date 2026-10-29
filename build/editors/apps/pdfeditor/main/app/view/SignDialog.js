/*
 * WorkSuite Office: the dialogs of the PDF Editor's PDF Tools tab for signing, cropping and version history.
 *
 * SignDialog asks for a certificate file (.p12/.pfx), its password, the reason and place, and whether to show a
 * signature box; CropDialog for the margins to cut, in millimetres; VersionsDialog lists the kept versions of
 * this PDF. The PagesTab controller does the work through worksuite-ai. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window',
    'common/main/lib/component/InputField',
    'common/main/lib/component/CheckBox'
], function () {
    'use strict';

    var row = function (label, id, extra) {
        return '<div class="input-row" style="margin-bottom: 4px;"><label>' + label + '</label></div>' +
               '<div id="' + id + '" style="margin-bottom: 10px;' + (extra || '') + '"></div>';
    };
    var footer = function (ok, cancel) {
        return '<div class="footer center">' +
                   (ok ? '<button class="btn normal dlg-btn primary" result="ok">' + ok + '</button>' : '') +
                   '<button class="btn normal dlg-btn" result="cancel">' + cancel + '</button>' +
               '</div>';
    };
    var checked = function (box) {
        var v = box.getValue();
        return v === true || v === 'checked';
    };

    PDFE.Views.SignDialog = Common.UI.Window.extend(_.extend({
        options: {width: 420, header: true, style: 'min-width: 420px;', cls: 'modal-dlg ws-sign-dlg', buttons: null},

        // options: page (current, 1-based), onOk({certificate, certificatePassword, reason, location, visiblePage?})
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 10px;"><label class="light">' + me.txtIntro + '</label></div>' +
                    '<div class="input-row" style="margin-bottom: 4px;"><label>' + me.txtCertificate + '</label></div>' +
                    '<div style="display: flex; gap: 6px; margin-bottom: 10px;"><div id="ws-sign-cert" style="flex: 1;"></div>' +
                        '<button class="btn btn-text-default" id="ws-sign-browse" style="min-width: 80px;">' + me.txtBrowse + '</button></div>' +
                    row(me.txtPassword, 'ws-sign-pass') + row(me.txtReason, 'ws-sign-reason') + row(me.txtLocation, 'ws-sign-location') +
                    '<div id="ws-sign-visible" style="margin-bottom: 10px;"></div>' +
                    '<div class="input-row"><label class="light">' + me.txtNote + '</label></div>' +
                '</div>' + footer(me.txtOk, me.textCancel);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild();
            this.inCert = new Common.UI.InputField({el: $w.find('#ws-sign-cert'), style: 'width: 100%;', validateOnBlur: false, placeHolder: me.txtCertHint,
                validation: function (v) { return /\.(p12|pfx)$/i.test(v) ? true : me.txtCertHint; }});
            this.inPass = new Common.UI.InputField({el: $w.find('#ws-sign-pass'), type: 'password', style: 'width: 100%;'});
            this.inReason = new Common.UI.InputField({el: $w.find('#ws-sign-reason'), style: 'width: 100%;', maxLength: 200, value: me.txtReasonDefault});
            this.inLocation = new Common.UI.InputField({el: $w.find('#ws-sign-location'), style: 'width: 100%;', maxLength: 200});
            this.chVisible = new Common.UI.CheckBox({el: $w.find('#ws-sign-visible'),
                labelText: Common.Utils.String.format(me.txtVisible, this.options.page || 1), value: true});
            $w.find('#ws-sign-browse').on('click', function () {
                window.AscDesktopEditor.OpenFilenameDialog('(*.p12 *.pfx)', false, function (files) {
                    var f = (Array.isArray(files) ? files : [files]).filter(function (x) { return !!x; })[0];
                    if (f) me.inCert.setValue(f);
                });
            });
            this.focusable = [this.inCert, this.inPass, this.inReason, this.inLocation, this.chVisible];
            $w.find('.dlg-btn').on('click', function (e) { e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close(); });
        },

        submit: function () {
            if (this.inCert.checkValidate() !== true) { this.inCert.focus(); return; }
            var result = {certificate: this.inCert.getValue(), certificatePassword: this.inPass.getValue(),
                          reason: this.inReason.getValue(), location: this.inLocation.getValue()};
            if (checked(this.chVisible)) result.visiblePage = this.options.page || 1;
            this.close();
            this.options.onOk && this.options.onOk(result);
        },

        onPrimary: function () { this.submit(); return false; },
        getFocusedComponents: function () { return this.focusable; },
        getDefaultFocusableComponent: function () { return this.inCert; },

        txtTitle: 'Sign PDF',
        txtIntro: 'Sign a copy of this PDF with your digital certificate. Anyone can then check that it has not changed since.',
        txtCertificate: 'Certificate file (.p12 or .pfx)',
        txtCertHint: 'Choose a .p12 or .pfx file',
        txtBrowse: 'Browse…',
        txtPassword: 'Certificate password',
        txtReason: 'Reason',
        txtReasonDefault: 'I approve this document',
        txtLocation: 'Place (optional)',
        txtVisible: 'Show a signature box on page {0}',
        txtNote: 'The signed copy is saved next to this PDF and opens in a new tab. Sign last: any later change breaks the signature.',
        txtOk: 'Sign',
        textCancel: 'Cancel'
    }, PDFE.Views.SignDialog || {}));

    PDFE.Views.CropDialog = Common.UI.Window.extend(_.extend({
        options: {width: 340, header: true, style: 'min-width: 340px;', cls: 'modal-dlg ws-crop-dlg', buttons: null},

        // options: onOk({top, right, bottom, left} in points)
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var cell = function (label, id) {
                return '<td style="padding: 0 10px 8px 0;"><label>' + label + '</label><div id="' + id + '" style="width: 90px; margin-top: 4px;"></div></td>';
            };
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 10px;"><label class="light">' + me.txtIntro + '</label></div>' +
                    '<table><tr>' + cell(me.txtTop, 'ws-crop-top') + cell(me.txtBottom, 'ws-crop-bottom') + '</tr>' +
                    '<tr>' + cell(me.txtLeft, 'ws-crop-left') + cell(me.txtRight, 'ws-crop-right') + '</tr></table>' +
                    '<div class="input-row"><label class="light">' + me.txtNote + '</label></div>' +
                '</div>' + footer(me.txtOk, me.textCancel);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild();
            var mm = function (v) { return /^\s*\d{1,3}(\.\d+)?\s*$/.test(v) ? true : me.txtInvalid; };
            this.inputs = ['top', 'bottom', 'left', 'right'].map(function (k) {
                var f = new Common.UI.InputField({el: $w.find('#ws-crop-' + k), style: 'width: 100%;', value: '10', validateOnBlur: false, validation: mm});
                f.side = k;
                return f;
            });
            $w.find('.dlg-btn').on('click', function (e) { e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close(); });
        },

        submit: function () {
            var out = {};
            for (var i = 0; i < this.inputs.length; i++) {
                if (this.inputs[i].checkValidate() !== true) { this.inputs[i].focus(); return; }
                out[this.inputs[i].side] = Math.round(parseFloat(this.inputs[i].getValue()) * 72 / 25.4 * 100) / 100;
            }
            this.close();
            this.options.onOk && this.options.onOk(out);
        },

        onPrimary: function () { this.submit(); return false; },
        getFocusedComponents: function () { return this.inputs; },
        getDefaultFocusableComponent: function () { return this.inputs[0]; },

        txtTitle: 'Crop pages',
        txtIntro: 'Cut these margins off every page, in millimetres.',
        txtTop: 'Top', txtBottom: 'Bottom', txtLeft: 'Left', txtRight: 'Right',
        txtNote: 'The cropped copy opens in a new tab. Nothing is deleted: the margins are only hidden.',
        txtInvalid: 'Enter millimetres, like 10',
        txtOk: 'Crop',
        textCancel: 'Cancel'
    }, PDFE.Views.CropDialog || {}));

    PDFE.Views.VersionsDialog = Common.UI.Window.extend(_.extend({
        options: {width: 440, header: true, style: 'min-width: 440px;', cls: 'modal-dlg ws-versions-dlg', buttons: null},

        // options: versions ([{id, savedAt, size, note}]), onOpen(id)
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var list = (this.options.versions || []).map(function (v) {
                var when = new Date(v.savedAt), size = v.size > 1048576 ? (v.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(v.size / 1024)) + ' KB';
                return '<tr><td style="padding: 6px 8px 6px 0;">' + Common.Utils.String.htmlEncode(when.toLocaleString()) +
                       (v.note ? '<div class="light">' + Common.Utils.String.htmlEncode(v.note) + '</div>' : '') + '</td>' +
                       '<td class="light" style="padding: 6px 8px; white-space: nowrap;">' + size + '</td>' +
                       '<td style="text-align: end;"><button class="btn btn-text-default ws-version-open" data-id="' +
                       Common.Utils.String.htmlEncode(v.id) + '">' + me.txtOpen + '</button></td></tr>';
            }).join('');
            this.options.tpl =
                '<div class="box" style="padding: 0 4px; max-height: 360px; overflow-y: auto;">' +
                    '<div class="input-row" style="margin-bottom: 8px;"><label class="light">' + me.txtIntro + '</label></div>' +
                    (list ? '<table style="width: 100%;">' + list + '</table>' : '<label>' + me.txtEmpty + '</label>') +
                '</div>' + footer(null, me.textClose);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild();
            $w.find('.ws-version-open').on('click', function (e) {
                var id = $(e.currentTarget).attr('data-id');
                me.close();
                me.options.onOpen && me.options.onOpen(id);
            });
            $w.find('.dlg-btn').on('click', function () { me.close(); });
        },

        txtTitle: 'Version history',
        txtIntro: 'Versions of this PDF kept on this computer: one each time it is opened with changes since the last, and each time you save a version. Open makes a copy next to the PDF.',
        txtEmpty: 'No versions are kept yet.',
        txtOpen: 'Open',
        textClose: 'Close'
    }, PDFE.Views.VersionsDialog || {}));
});
