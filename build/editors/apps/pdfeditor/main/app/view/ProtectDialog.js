/*
 * WorkSuite Office: the Protect dialog of the PDF Editor's PDF Tools tab.
 *
 * A password to open the PDF and/or a permissions password with what readers may do (print, copy, change).
 * The PagesTab controller saves a protected copy (AES-256) through worksuite-ai. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window',
    'common/main/lib/component/InputField',
    'common/main/lib/component/CheckBox'
], function () {
    'use strict';

    PDFE.Views.ProtectDialog = Common.UI.Window.extend(_.extend({
        options: {
            width: 420,
            header: true,
            style: 'min-width: 420px;',
            cls: 'modal-dlg ws-protect-dlg',
            buttons: null
        },

        // options: onOk({userPassword, ownerPassword, permissions})
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var label = function (text, cls) { return '<div class="input-row" style="margin-bottom: 6px;"><label class="' + (cls || 'light') + '">' + text + '</label></div>'; };
            var field = function (id) { return '<div id="' + id + '" style="margin-bottom: 8px;"></div>'; };
            var indent = function (html) { return '<div style="margin-left: 22px;">' + html + '</div>'; };
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    label(me.txtIntro) +
                    '<div id="ws-protect-open" style="margin-bottom: 6px;"></div>' +
                    indent(field('ws-protect-user') + field('ws-protect-user2')) +
                    '<div id="ws-protect-restrict" style="margin: 4px 0 6px;"></div>' +
                    indent(field('ws-protect-owner') +
                           '<div id="ws-protect-print" style="margin-bottom: 6px;"></div>' +
                           '<div id="ws-protect-copy" style="margin-bottom: 6px;"></div>' +
                           '<div id="ws-protect-change" style="margin-bottom: 10px;"></div>') +
                    label(me.txtNote) +
                '</div>' +
                '<div class="footer center">' +
                    '<button class="btn normal dlg-btn primary" result="ok">' + me.txtOk + '</button>' +
                    '<button class="btn normal dlg-btn" result="cancel">' + me.textCancel + '</button>' +
                '</div>';
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild();
            var input = function (id, placeHolder, validation) {
                return new Common.UI.InputField({el: $w.find('#' + id), type: 'password', style: 'width: 100%;', validateOnBlur: false,
                                                 placeHolder: placeHolder, maxLength: 127, validation: validation});
            };
            this.chOpen = new Common.UI.CheckBox({el: $w.find('#ws-protect-open'), labelText: me.txtOpen, value: true});
            this.inUser = input('ws-protect-user', me.txtPassword, function (v) {
                return !me.chOpen.getValue() || v ? true : me.txtRequired;
            });
            this.inUser2 = input('ws-protect-user2', me.txtRepeat, function (v) {
                return !me.chOpen.getValue() || v === me.inUser.getValue() ? true : me.txtMismatch;
            });
            this.chRestrict = new Common.UI.CheckBox({el: $w.find('#ws-protect-restrict'), labelText: me.txtRestrict, value: false});
            this.inOwner = input('ws-protect-owner', me.txtOwner, function (v) {
                if (!me.chRestrict.getValue()) return true;
                if (!v) return me.txtRequired;
                return me.chOpen.getValue() && v === me.inUser.getValue() ? me.txtSame : true;
            });
            this.chPrint = new Common.UI.CheckBox({el: $w.find('#ws-protect-print'), labelText: me.txtPrint, value: true});
            this.chCopy = new Common.UI.CheckBox({el: $w.find('#ws-protect-copy'), labelText: me.txtCopy, value: false});
            this.chChange = new Common.UI.CheckBox({el: $w.find('#ws-protect-change'), labelText: me.txtChange, value: false});
            var sync = function () {
                var open = me.chOpen.getValue() === 'checked' || me.chOpen.getValue() === true,
                    restrict = me.chRestrict.getValue() === 'checked' || me.chRestrict.getValue() === true;
                me.inUser.setDisabled(!open);
                me.inUser2.setDisabled(!open);
                [me.inOwner, me.chPrint, me.chCopy, me.chChange].forEach(function (c) { c.setDisabled(!restrict); });
            };
            this.chOpen.on('change', sync);
            this.chRestrict.on('change', sync);
            sync();
            this.focusable = [this.chOpen, this.inUser, this.inUser2, this.chRestrict, this.inOwner, this.chPrint, this.chCopy, this.chChange];
            $w.find('.dlg-btn').on('click', function (e) {
                e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close();
            });
        },

        checked: function (box) {
            var v = box.getValue();
            return v === true || v === 'checked';
        },

        submit: function () {
            var open = this.checked(this.chOpen), restrict = this.checked(this.chRestrict);
            if (!open && !restrict) { this.chOpen.focus(); return; }
            var inputs = [this.inUser, this.inUser2, this.inOwner];
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].checkValidate() !== true) { inputs[i].focus(); return; }
            }
            var result = {};
            if (open) result.userPassword = this.inUser.getValue();
            if (restrict) {
                result.ownerPassword = this.inOwner.getValue();
                var change = this.checked(this.chChange);
                result.permissions = {
                    printing: this.checked(this.chPrint) ? 'high' : 'none',
                    copying: this.checked(this.chCopy),
                    modifying: change, annotating: change, fillingForms: true, assembling: change
                };
            }
            this.close();
            this.options.onOk && this.options.onOk(result);
        },

        onPrimary: function () {
            this.submit();
            return false;
        },

        getFocusedComponents: function () { return this.focusable; },
        getDefaultFocusableComponent: function () { return this.inUser; },

        txtTitle: 'Protect PDF',
        txtIntro: 'Save a protected copy of this PDF, encrypted with AES-256.',
        txtOpen: 'Require a password to open the PDF',
        txtPassword: 'Password',
        txtRepeat: 'Repeat the password',
        txtRestrict: 'Restrict printing, copying and changes',
        txtOwner: 'Permissions password (to lift the restrictions)',
        txtPrint: 'Allow printing',
        txtCopy: 'Allow copying text and images',
        txtChange: 'Allow changes, comments and page edits',
        txtNote: 'The copy is saved next to this PDF and opens in a new tab. This PDF is not changed. A forgotten password cannot be recovered.',
        txtRequired: 'Enter a password',
        txtMismatch: 'The passwords do not match',
        txtSame: 'Use a different password from the one to open the PDF',
        txtOk: 'Protect',
        textCancel: 'Cancel'
    }, PDFE.Views.ProtectDialog || {}));
});
