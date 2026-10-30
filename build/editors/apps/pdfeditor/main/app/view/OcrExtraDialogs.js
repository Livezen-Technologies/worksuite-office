/*
 * WorkSuite Office: the extra dialogs of the PDF Editor's text recognition (OCR).
 *
 * OcrAreaDialog shows the current page and lets you draw the area to recognise; OcrTextDialog shows recognised
 * text to check and copy, with the words Tesseract was unsure of marked; OcrLanguagesDialog adds and removes
 * recognition languages through worksuite-ai. The ConvertTab controller drives them. Copied into web-apps by
 * build/patch-pdf-convert.py. Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'common/main/lib/component/Window'
], function () {
    'use strict';

    var footer = function (ok, cancel) {
        return '<div class="footer center">' +
                   (ok ? '<button class="btn normal dlg-btn primary" result="ok">' + ok + '</button>' : '') +
                   '<button class="btn normal dlg-btn" result="cancel">' + cancel + '</button>' +
               '</div>';
    };

    PDFE.Views.OcrAreaDialog = Common.UI.Window.extend(_.extend({
        options: {width: 600, header: true, cls: 'modal-dlg ws-ocr-area-dlg', buttons: null},

        // options: image (a canvas of the page), onOk({x, y, w, h} as fractions of the page)
        initialize: function (options) {
            _.extend(this.options, {title: this.txtTitle}, options || {});
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 8px;"><label class="light">' + this.txtIntro + '</label></div>' +
                    '<div id="ws-ocr-area" style="position: relative; display: inline-block; cursor: crosshair; user-select: none; ' +
                        'border: 1px solid var(--border-regular-control, #c0c0c0); line-height: 0;"></div>' +
                '</div>' + footer(this.txtOk, this.textCancel);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild(), src = this.options.image,
                scale = Math.min(560 / src.width, 520 / src.height),
                view = document.createElement('canvas');
            view.width = Math.round(src.width * scale);
            view.height = Math.round(src.height * scale);
            view.getContext('2d').drawImage(src, 0, 0, view.width, view.height);
            var $host = $w.find('#ws-ocr-area').append(view),
                $box = $('<div style="position: absolute; border: 2px solid #2563eb; background: rgba(37, 99, 235, .12); display: none;"></div>').appendTo($host);
            var start = null;
            var at = function (e) {
                var r = view.getBoundingClientRect();
                return {x: Math.max(0, Math.min(view.width, e.clientX - r.left)), y: Math.max(0, Math.min(view.height, e.clientY - r.top))};
            };
            var draw = function (a, b) {
                me.area = {x: Math.min(a.x, b.x) / view.width, y: Math.min(a.y, b.y) / view.height,
                           w: Math.abs(a.x - b.x) / view.width, h: Math.abs(a.y - b.y) / view.height};
                $box.css({left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)}).show();
            };
            $(view).on('mousedown', function (e) { start = at(e); draw(start, start); e.preventDefault(); });
            $(document).on('mousemove.wsocrarea', function (e) { if (start) draw(start, at(e)); })
                       .on('mouseup.wsocrarea', function () { start = null; });
            $w.find('.dlg-btn').on('click', function (e) { e.currentTarget.attributes['result'].value === 'ok' ? me.submit() : me.close(); });
        },

        submit: function () {
            if (!this.area || this.area.w < 0.01 || this.area.h < 0.01) return;
            this.close();
            this.options.onOk && this.options.onOk(this.area);
        },

        close: function () {
            $(document).off('.wsocrarea');
            Common.UI.Window.prototype.close.apply(this, arguments);
        },

        onPrimary: function () { this.submit(); return false; },

        txtTitle: 'Choose the area',
        txtIntro: 'Drag over the part of the page to recognise.',
        txtOk: 'Recognise',
        textCancel: 'Cancel'
    }, PDFE.Views.OcrAreaDialog || {}));

    PDFE.Views.OcrTextDialog = Common.UI.Window.extend(_.extend({
        options: {width: 560, header: true, cls: 'modal-dlg ws-ocr-text-dlg', buttons: null},

        // options: lines ([[{text, confidence}], …], an empty line between paragraphs), threshold (0–100)
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var unsure = 0, threshold = this.options.threshold || 70;
            var html = (this.options.lines || []).map(function (line) {
                return line.map(function (w) {
                    var text = Common.Utils.String.htmlEncode(w.text);
                    if (w.confidence >= threshold) return text;
                    unsure++;
                    return '<mark title="' + Math.round(w.confidence) + '%" style="background: rgba(245, 158, 11, .35); color: inherit; border-radius: 2px;">' + text + '</mark>';
                }).join(' ');
            }).join('<br>');
            this.unsure = unsure;
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 8px;"><label class="light">' +
                        (unsure ? Common.Utils.String.format(me.txtUnsure, unsure) : me.txtAllSure) + '</label></div>' +
                    '<div id="ws-ocr-text" contenteditable="true" spellcheck="false" style="height: 300px; overflow: auto; padding: 8px; white-space: normal; ' +
                        'border: 1px solid var(--border-regular-control, #c0c0c0); background: var(--background-normal, #fff); color: var(--text-normal, #222); ' +
                        'font-size: 13px; line-height: 1.5; user-select: text;">' + (html || '') + '</div>' +
                '</div>' + footer(me.txtCopy, me.textClose);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild();
            $w.find('.dlg-btn').on('click', function (e) {
                if (e.currentTarget.attributes['result'].value !== 'ok') return me.close();
                me.copy();
            });
        },

        // the text as checked and corrected here, without the marks
        copy: function () {
            var el = this.getChild().find('#ws-ocr-text')[0], text = el.innerText, me = this;
            var done = function () { me.getChild().find('.dlg-btn.primary').text(me.txtCopied); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { me.copySelected(el); done(); });
            } else {
                this.copySelected(el);
                done();
            }
        },

        copySelected: function (el) {
            var range = document.createRange();
            range.selectNodeContents(el);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            try { document.execCommand('copy'); } catch (e) { /* the text stays selected to copy by hand */ }
        },

        onPrimary: function () { this.copy(); return false; },

        txtTitle: 'Recognised text',
        txtUnsure: '{0} words the recognition was unsure of are marked. Check them and correct them here, then copy the text.',
        txtAllSure: 'Check the text and correct it here if needed, then copy it.',
        txtCopy: 'Copy text',
        txtCopied: 'Copied',
        textClose: 'Close'
    }, PDFE.Views.OcrTextDialog || {}));

    PDFE.Views.OcrLanguagesDialog = Common.UI.Window.extend(_.extend({
        options: {width: 460, header: true, cls: 'modal-dlg ws-ocr-langs-dlg', buttons: null},

        // options: languages ([{code, name, size, installed}]), onInstall(code, done(err)), onRemove(code, done(err))
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: me.txtTitle}, options || {});
            var rows = (this.options.languages || []).map(function (l) {
                return '<tr data-code="' + l.code + '"><td style="padding: 5px 8px 5px 0;">' + Common.Utils.String.htmlEncode(l.name) + '</td>' +
                       '<td class="light" style="padding: 5px 8px; white-space: nowrap;">' + (l.size / 1048576).toFixed(1) + ' MB</td>' +
                       '<td style="text-align: end; white-space: nowrap;"><button class="btn btn-text-default ws-ocr-lang" style="min-width: 80px;">' +
                       (l.installed ? me.txtRemove : me.txtAdd) + '</button></td></tr>';
            }).join('');
            this.options.tpl =
                '<div class="box" style="padding: 0 4px;">' +
                    '<div class="input-row" style="margin-bottom: 8px;"><label class="light">' + me.txtIntro + '</label></div>' +
                    '<div style="max-height: 340px; overflow-y: auto;"><table style="width: 100%;">' + rows + '</table></div>' +
                '</div>' + footer(null, me.textClose);
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, $w = this.getChild(), byCode = {};
            (this.options.languages || []).forEach(function (l) { byCode[l.code] = l; });
            $w.find('.ws-ocr-lang').on('click', function (e) {
                var $b = $(e.currentTarget), code = $b.closest('tr').attr('data-code'), l = byCode[code];
                if ($b.prop('disabled')) return;
                $b.prop('disabled', true).text(l.installed ? me.txtRemoving : me.txtAdding);
                var done = function (err) {
                    $b.prop('disabled', false);
                    if (!err) l.installed = !l.installed;
                    $b.text(err ? me.txtFailed : (l.installed ? me.txtRemove : me.txtAdd));
                    me.changed = true;
                };
                l.installed ? me.options.onRemove(code, done) : me.options.onInstall(code, done);
            });
            $w.find('.dlg-btn').on('click', function () { me.close(); });
        },

        txtTitle: 'Recognition languages',
        txtIntro: 'English, Sinhala and Tamil come with WorkSuite Office. Add others here: each is downloaded once from Tesseract (tessdata_fast) and checked.',
        txtAdd: 'Add',
        txtAdding: 'Adding…',
        txtRemove: 'Remove',
        txtRemoving: 'Removing…',
        txtFailed: 'Failed – retry',
        textClose: 'Close'
    }, PDFE.Views.OcrLanguagesDialog || {}));
});
