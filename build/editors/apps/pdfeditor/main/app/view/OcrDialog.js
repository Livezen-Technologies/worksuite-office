/*
 * WorkSuite Office: the PDF Editor's "Recognise text" (OCR) dialog, opened from the Convert tab.
 *
 * A fixed header (what this does), the settings in sections that scroll (languages with search, the pages as
 * cards with the page count, scan clean-up switches, what to do with the text), the progress while
 * recognising (percentage, page x of n, stage, elapsed time) and how it ended, and a fixed footer with Cancel,
 * Recognise text and, once done, View results. Every setting is one the recognition really uses. The work is
 * done by the ConvertTab controller, on this computer. Styled with the editors' theme variables, so it
 * follows the light, dark and other themes. Copied into web-apps by build/patch-pdf-convert.py.
 * Licensed under the GNU AGPL v3, as the editors it becomes part of.
 */

define([
    'pdfeditor/main/app/view/OcrSettings',
    'common/main/lib/component/Window',
    'common/main/lib/component/CheckBox',
    'common/main/lib/component/RadioBox',
    'common/main/lib/component/InputField'
], function (OcrSettings) {
    'use strict';

    var CSS =
        '.ws-ocr-dlg .ws-ocr{display:flex;flex-direction:column;color:var(--text-normal,#222);}' +
        '.ws-ocr-dlg .ws-ocr-head{display:flex;gap:12px;align-items:flex-start;padding:4px 16px 12px;border-bottom:1px solid var(--border-divider,#e2e8f0);}' +
        '.ws-ocr-dlg .ws-ocr-icon{flex:none;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;' +
            'background:var(--background-accent-button,#2563eb);color:var(--text-inverse,#fff);}' +
        '.ws-ocr-dlg .ws-ocr-head h2{margin:0 0 2px;font-size:14px;font-weight:bold;}' +
        '.ws-ocr-dlg .ws-ocr-head p{margin:0;color:var(--text-secondary,#666);line-height:1.4;}' +
        '.ws-ocr-dlg .ws-ocr-body{overflow-y:auto;max-height:min(56vh,480px);padding:4px 16px 8px;}' +
        '.ws-ocr-dlg .ws-ocr-sec{padding:12px 0;border-bottom:1px solid var(--border-divider,#e2e8f0);}' +
        '.ws-ocr-dlg .ws-ocr-sec:last-child{border-bottom:0;}' +
        '.ws-ocr-dlg .ws-ocr-sec h3{margin:0 0 8px;font-size:12px;font-weight:bold;display:flex;justify-content:space-between;align-items:baseline;}' +
        '.ws-ocr-dlg .ws-ocr-sec h3 .light{font-weight:normal;}' +
        '.ws-ocr-dlg .ws-ocr-langs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px;max-height:132px;overflow-y:auto;margin-top:8px;}' +
        '.ws-ocr-dlg .ws-ocr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}' +
        '.ws-ocr-dlg .ws-ocr-card{border:1px solid var(--border-regular-control,#c0c0c0);border-radius:6px;padding:8px 10px;cursor:pointer;' +
            'background:var(--background-normal,#fff);}' +
        '.ws-ocr-dlg .ws-ocr-card:hover{background:var(--highlight-button-hover,#f3f4f6);}' +
        '.ws-ocr-dlg .ws-ocr-card.selected{border-color:var(--background-accent-button,#2563eb);box-shadow:0 0 0 1px var(--background-accent-button,#2563eb) inset;}' +
        '.ws-ocr-dlg .ws-ocr-card.disabled,.ws-ocr-dlg .ws-ocr-switch.disabled{opacity:.5;cursor:default;}' +
        '.ws-ocr-dlg .ws-ocr-card .ws-ocr-desc,.ws-ocr-dlg .ws-ocr-switch .ws-ocr-desc{display:block;margin:2px 0 0 20px;color:var(--text-secondary,#666);line-height:1.35;}' +
        '.ws-ocr-dlg .ws-ocr-switch{padding:4px 0;}' +
        '.ws-ocr-dlg .ws-ocr-run{display:none;padding:12px 16px;border-top:1px solid var(--border-divider,#e2e8f0);}' +
        '.ws-ocr-dlg .ws-ocr-run-top{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;}' +
        '.ws-ocr-dlg .ws-ocr-pct{font-weight:bold;font-variant-numeric:tabular-nums;}' +
        '.ws-ocr-dlg .ws-ocr-track{height:6px;border-radius:3px;overflow:hidden;background:var(--border-divider,#e2e8f0);}' +
        '.ws-ocr-dlg .ws-ocr-bar{height:100%;width:0;background:var(--background-accent-button,#2563eb);transition:width .2s;}' +
        '.ws-ocr-dlg .ws-ocr-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:var(--text-secondary,#666);font-variant-numeric:tabular-nums;}' +
        '.ws-ocr-dlg .ws-ocr-result{display:none;margin:0 16px 8px;padding:8px 10px;border-radius:6px;border:1px solid var(--border-regular-control,#c0c0c0);}' +
        '.ws-ocr-dlg .ws-ocr-result.done{border-color:#16a34a;}' +
        '.ws-ocr-dlg .ws-ocr-result.error{border-color:#dc2626;}' +
        '.ws-ocr-dlg .ws-ocr .footer{padding:12px 16px 0;border-top:1px solid var(--border-divider,#e2e8f0);display:flex;justify-content:flex-end;gap:8px;}' +
        '.ws-ocr-dlg .ws-ocr .footer .btn{margin:0;min-width:86px;}' +
        '.ws-ocr-dlg .ws-ocr-body.running{opacity:.6;}';

    var ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
               'stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>' +
               '<path d="M7 9h10M7 12h10M7 15h6"/></svg>';

    var BUILT_IN = ['eng', 'sin', 'tam'], DEFAULT_LANGS = ['eng', 'sin'];

    function isOff(c) { return c.isDisabled ? c.isDisabled() : !!c.disabled; }

    function store() {
        try { return Common.localStorage || window.localStorage; } catch (e) { return null; }
    }

    PDFE.Views.OcrDialog = Common.UI.Window.extend(_.extend({
        options: {
            width: 720,
            header: true,
            style: 'min-width: 360px; max-width: calc(100vw - 32px);',
            cls: 'modal-dlg ws-ocr-dlg',
            buttons: null
        },

        // options: extraLangs ([{code, name}] installed through worksuite-ai), canAddLangs, canPdfa, canImage,
        // pageCount, currentPage (0-based), onStart(settings, dlg), onCancel(), onLanguages()
        initialize: function (options) {
            var me = this;
            _.extend(this.options, {title: this.textTitle}, options || {});
            var o = this.options;
            this.langs = [{code: 'eng', name: me.txtEnglish}, {code: 'sin', name: me.txtSinhala}, {code: 'tam', name: me.txtTamil}]
                .concat((o.extraLangs || []).filter(function (l) { return BUILT_IN.indexOf(l.code) < 0; }));
            var pages = o.pageCount || 0, cur = (o.currentPage || 0) + 1;
            var card = function (group, id, title, desc) {
                return '<div class="ws-ocr-card" data-group="' + group + '" data-value="' + id + '">' +
                           '<div id="ws-ocr-' + group + '-' + id + '"></div>' +
                           '<span class="ws-ocr-desc">' + desc + '</span></div>';
            };
            var sw = function (id, desc) {
                return '<div class="ws-ocr-switch" data-value="' + id + '"><div id="ws-ocr-clean-' + id + '"></div>' +
                       '<span class="ws-ocr-desc">' + desc + '</span></div>';
            };
            this.options.tpl =
                '<div class="ws-ocr" role="document">' +
                    '<div class="ws-ocr-head">' +
                        '<div class="ws-ocr-icon">' + ICON + '</div>' +
                        '<div><h2 id="ws-ocr-heading">' + me.textHeading + '</h2><p id="ws-ocr-intro">' + me.textIntro + '</p></div>' +
                    '</div>' +
                    '<div class="ws-ocr-body">' +
                        '<section class="ws-ocr-sec" aria-labelledby="ws-ocr-h-langs">' +
                            '<h3><span id="ws-ocr-h-langs">' + me.textLanguages + '</span>' +
                                (o.canAddLangs ? '<a href="#" id="ws-ocr-add-langs">' + me.txtAddLangs + '</a>' : '') + '</h3>' +
                            '<div id="ws-ocr-lang-search"></div>' +
                            '<div class="ws-ocr-langs" role="group" aria-labelledby="ws-ocr-h-langs">' +
                                this.langs.map(function (l, i) { return '<div class="ws-ocr-lang" data-i="' + i + '"><div id="ws-ocr-lang-' + i + '"></div></div>'; }).join('') +
                            '</div>' +
                            '<label class="light ws-ocr-nolang" style="display: none; margin-top: 6px;">' + me.txtNoMatch + '</label>' +
                        '</section>' +
                        '<section class="ws-ocr-sec" aria-labelledby="ws-ocr-h-pages">' +
                            '<h3><span id="ws-ocr-h-pages">' + me.textPages + '</span><span class="light">' +
                                Common.Utils.String.format(me.txtPageCount, pages) + '</span></h3>' +
                            '<div class="ws-ocr-cards" role="radiogroup" aria-labelledby="ws-ocr-h-pages">' +
                                card('pages', 'all', me.txtAllPages, Common.Utils.String.format(me.txtAllPagesDesc, pages)) +
                                card('pages', 'current', me.txtCurrentPage, Common.Utils.String.format(me.txtCurrentPageDesc, cur, pages)) +
                                card('pages', 'area', me.txtArea, me.txtAreaDesc) +
                                card('pages', 'image', me.txtImage, o.canImage ? me.txtImageDesc : me.txtImageDesktop) +
                            '</div>' +
                        '</section>' +
                        '<section class="ws-ocr-sec" aria-labelledby="ws-ocr-h-clean">' +
                            '<h3><span id="ws-ocr-h-clean">' + me.textCleanUp + '</span></h3>' +
                            sw('straighten', me.txtStraightenDesc) + sw('upright', me.txtUprightDesc) +
                            sw('contrast', me.txtContrastDesc) + sw('bw', me.txtBlackWhiteDesc) +
                        '</section>' +
                        '<section class="ws-ocr-sec" aria-labelledby="ws-ocr-h-then">' +
                            '<h3><span id="ws-ocr-h-then">' + me.textThen + '</span></h3>' +
                            '<div class="ws-ocr-cards" role="radiogroup" aria-labelledby="ws-ocr-h-then">' +
                                card('then', 'searchable', me.txtSearchable, me.txtSearchableDesc) +
                                card('then', 'word', me.txtWord, me.txtWordDesc) +
                                card('then', 'pdfa', me.txtPdfa, o.canPdfa ? me.txtPdfaDesc : me.txtPdfaNone) +
                                card('then', 'text', me.txtText, me.txtTextDesc) +
                            '</div>' +
                        '</section>' +
                    '</div>' +
                    '<div class="ws-ocr-run" role="status" aria-live="polite">' +
                        '<div class="ws-ocr-run-top"><span class="ws-ocr-stage"></span><span class="ws-ocr-pct">0%</span></div>' +
                        '<div class="ws-ocr-track" role="progressbar" aria-label="' + me.textProgress + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
                            '<div class="ws-ocr-bar"></div></div>' +
                        '<div class="ws-ocr-meta"><span class="ws-ocr-page"></span><span class="ws-ocr-time"></span></div>' +
                    '</div>' +
                    '<div class="ws-ocr-result" role="alert"></div>' +
                    '<div class="footer">' +
                        '<button class="btn normal dlg-btn" result="cancel" id="ws-ocr-cancel">' + me.textCancel + '</button>' +
                        '<button class="btn normal dlg-btn" result="view" id="ws-ocr-view" style="display: none;">' + me.textView + '</button>' +
                        '<button class="btn normal dlg-btn primary" result="ok" id="ws-ocr-start">' + me.textRecognise + '</button>' +
                    '</div>' +
                '</div>';
            Common.UI.Window.prototype.initialize.call(this, this.options);
        },

        render: function () {
            Common.UI.Window.prototype.render.call(this);
            var me = this, o = this.options, $w = this.$w = this.getChild();
            if (!document.getElementById('ws-ocr-style')) $('<style id="ws-ocr-style"></style>').text(CSS).appendTo(document.head);
            $w.attr({'aria-labelledby': 'ws-ocr-heading', 'aria-describedby': 'ws-ocr-intro'});

            // Languages: the last selection, as far as those languages are still installed
            var saved = null, s = store();
            try { saved = s && s.getItem(OcrSettings.STORAGE_KEY); } catch (e) { saved = null; }
            var ticked = OcrSettings.initialLangs(saved, this.langs.map(function (l) { return l.code; }), DEFAULT_LANGS);
            this.chLangs = this.langs.map(function (l, i) {
                var ch = new Common.UI.CheckBox({el: $w.find('#ws-ocr-lang-' + i), labelText: Common.Utils.String.htmlEncode(l.name), value: l.code});
                ch.setValue(ticked.indexOf(l.code) >= 0);
                ch.on('change', _.bind(me.updateStart, me));
                return ch;
            });
            this.inSearch = new Common.UI.InputField({
                el: $w.find('#ws-ocr-lang-search'), style: 'width: 100%;', placeHolder: me.txtSearch,
                validateOnChange: false, validateOnBlur: false
            });
            this.inSearch.$el.find('input').attr({'aria-label': me.txtSearch, type: 'search'});
            this.inSearch.on('changing', function (input, value) { me.filterLangs(value); });
            $w.find('#ws-ocr-add-langs').on('click', function (e) {
                e.preventDefault();
                if (me.running) return;
                me.close();
                o.onLanguages && o.onLanguages();
            });

            var radios = function (group, list) {
                return list.map(function (id, i) {
                    var rb = new Common.UI.RadioBox({el: $w.find('#ws-ocr-' + group + '-' + id), labelText: me[list.labels[i]],
                                                     name: 'ws-ocr-' + group, value: id, checked: i === 0});
                    rb.on('change', function () { me.updateCards(); });
                    return rb;
                });
            };
            var pages = ['all', 'current', 'area', 'image']; pages.labels = ['txtAllPages', 'txtCurrentPage', 'txtArea', 'txtImage'];
            var then = ['searchable', 'word', 'pdfa', 'text']; then.labels = ['txtSearchable', 'txtWord', 'txtPdfa', 'txtText'];
            this.rbPages = radios('pages', pages);
            this.rbThen = radios('then', then);
            if (!o.canImage) this.rbPages[3].setDisabled(true);
            if (!o.canPdfa) this.rbThen[2].setDisabled(true);
            // a click anywhere on a card picks it
            $w.find('.ws-ocr-card').on('click', function (e) {
                var $c = $(e.currentTarget), list = $c.attr('data-group') === 'pages' ? me.rbPages : me.rbThen;
                if ($(e.target).closest('.radiobox').length) return;
                var rb = _.find(list, function (r) { return r.options.value === $c.attr('data-value'); });
                if (rb && !isOff(rb) && !me.running) rb.setValue(true);
            });

            this.chClean = [['straighten', me.txtStraighten, true], ['upright', me.txtUpright, true],
                            ['contrast', me.txtContrast, false], ['bw', me.txtBlackWhite, false]].map(function (c) {
                var ch = new Common.UI.CheckBox({el: $w.find('#ws-ocr-clean-' + c[0]), labelText: c[1], value: c[0]});
                ch.setValue(c[2]);
                return ch;
            });

            this.$body = $w.find('.ws-ocr-body');
            this.$run = $w.find('.ws-ocr-run');
            this.$stage = $w.find('.ws-ocr-stage');
            this.$pct = $w.find('.ws-ocr-pct');
            this.$track = $w.find('.ws-ocr-track');
            this.$bar = $w.find('.ws-ocr-bar');
            this.$page = $w.find('.ws-ocr-page');
            this.$time = $w.find('.ws-ocr-time');
            this.$result = $w.find('.ws-ocr-result');
            this.$start = $w.find('#ws-ocr-start');
            this.$cancel = $w.find('#ws-ocr-cancel');
            this.$view = $w.find('#ws-ocr-view');
            $w.find('.dlg-btn').on('click', _.bind(this.onBtnClick, this));
            this.updateCards();
            this.updateStart();
        },

        controls: function () {
            return this.chLangs.concat([this.inSearch], this.rbPages, this.chClean, this.rbThen);
        },

        getFocusedComponents: function () {
            return [this.inSearch].concat(this.chLangs, this.rbPages, this.chClean, this.rbThen);
        },

        getDefaultFocusableComponent: function () {
            return this.inSearch;
        },

        filterLangs: function (query) {
            var me = this, shown = 0;
            this.$w.find('.ws-ocr-lang').each(function () {
                var l = me.langs[+$(this).attr('data-i')], ok = OcrSettings.matches(l, query);
                $(this).toggle(ok);
                ok && shown++;
            });
            this.$w.find('.ws-ocr-nolang').toggle(!shown);
        },

        getSettings: function () {
            var on = function (ch) { return ch.getValue() === 'checked' || ch.getValue() === true; };
            var pick = function (list) {
                for (var i = 0; i < list.length; i++) if (list[i].getValue()) return list[i].options.value;
            };
            return {
                langs: this.chLangs.filter(on).map(function (ch) { return ch.options.value; }),
                pages: pick(this.rbPages),
                clean: this.chClean.reduce(function (o, ch) { o[ch.options.value] = on(ch); return o; }, {}),
                then: pick(this.rbThen)
            };
        },

        // An area or an image file is recognised to text to check and copy: the pages are not changed.
        // Turning upright needs a whole page, so it is off for an area.
        updateCards: function () {
            if (!this.rbThen) return;
            var pages = this.getSettings().pages, textOnly = pages === 'area' || pages === 'image', o = this.options;
            if (textOnly) this.rbThen[3].setValue(true);
            if (!this.running) {
                for (var i = 0; i < 3; i++) this.rbThen[i].setDisabled(textOnly || (i === 2 && !o.canPdfa));
                this.chClean[1].setDisabled(pages === 'area');
            }
            var me = this;
            this.$w.find('.ws-ocr-card').each(function () {
                var $c = $(this), list = $c.attr('data-group') === 'pages' ? me.rbPages : me.rbThen,
                    rb = _.find(list, function (r) { return r.options.value === $c.attr('data-value'); });
                $c.toggleClass('selected', !!rb.getValue()).toggleClass('disabled', isOff(rb));
            });
            this.$w.find('.ws-ocr-switch').each(function (i) { $(this).toggleClass('disabled', isOff(me.chClean[i])); });
        },

        updateStart: function () {
            if (!this.$start) return;
            var off = !this.getSettings().langs.length || this.running;
            this.$start.toggleClass('disabled', off).prop('disabled', off).attr('aria-disabled', off);
        },

        onPrimary: function () {
            this.start();
            return false;
        },

        onBtnClick: function (e) {
            var r = e.currentTarget.attributes['result'].value;
            if (r === 'ok') this.start();
            else if (r === 'view') this.viewResults();
            else this.cancel();
        },

        start: function () {
            if (this.running || this.closed) return;
            var settings = this.getSettings();
            if (!settings.langs.length) return;
            try { var s = store(); s && s.setItem(OcrSettings.STORAGE_KEY, JSON.stringify(settings.langs)); } catch (e) { /* not remembered */ }
            this.running = true;
            this.onResults = null;
            this.controls().forEach(function (c) { c.setDisabled(true); });
            this.$body.addClass('running').attr('aria-busy', true);
            this.$w.find('.ws-ocr-card, .ws-ocr-switch').addClass('disabled');
            this.$result.hide();
            this.$view.hide();
            this.$start.text(this.textRecognising);
            this.$cancel.text(this.textCancelRun);
            this.updateStart();
            this.$run.show();
            this.started = Date.now();
            var me = this;
            this.tick = setInterval(function () { me.$time.text(Common.Utils.String.format(me.txtElapsed, OcrSettings.formatElapsed(Date.now() - me.started))); }, 1000);
            this.$time.text(Common.Utils.String.format(me.txtElapsed, OcrSettings.formatElapsed(0)));
            this.$page.text('');
            this.setProgress(0, this.txtStarting);
            this.$cancel.focus();
            this.options.onStart && this.options.onStart(settings, this);
        },

        stopTimer: function () {
            this.tick && clearInterval(this.tick);
            this.tick = null;
        },

        // How the recognition ended: 'done' (onResults, when given, is what View results opens), 'empty',
        // 'cancelled' or 'error'. The settings come back for another go.
        showResult: function (state, message, onResults) {
            if (this.closed) return;
            this.running = false;
            this.stopTimer();
            var secs = this.started ? OcrSettings.formatElapsed(Date.now() - this.started) : '';
            if (state === 'done') this.setProgress(1, this.txtStageDone, undefined, undefined, true);
            this.controls().forEach(function (c) { c.setDisabled(false); });
            if (!this.options.canImage) this.rbPages[3].setDisabled(true);
            if (!this.options.canPdfa) this.rbThen[2].setDisabled(true);
            this.$body.removeClass('running').attr('aria-busy', false);
            this.$w.find('.ws-ocr-card, .ws-ocr-switch').removeClass('disabled');
            this.updateCards();
            if (state !== 'done') this.$run.hide();
            var text = message || (state === 'done' ? this.txtDone : state === 'cancelled' ? this.txtCancelled : this.txtFailedHere);
            this.$result.removeClass('done error').addClass(state === 'done' ? 'done' : state === 'error' ? 'error' : '')
                .text(text + (state === 'done' && secs ? ' ' + Common.Utils.String.format(this.txtTook, secs) : '')).show();
            this.onResults = onResults || null;
            this.$view.toggle(!!onResults);
            this.$start.text(state === 'cancelled' || state === 'error' ? this.textRetry : this.textRecognise);
            this.$cancel.text(state === 'done' ? this.textClose : this.textCancel);
            this.updateStart();
            (onResults ? this.$view : this.$cancel).focus();
        },

        viewResults: function () {
            var show = this.onResults;
            if (!show) return;
            this.close();
            show();
        },

        // While recognising, Cancel stops it (the pages done so far stay changed, and can be undone) and the
        // dialog says so; otherwise it closes the dialog.
        cancel: function () {
            if (this.running) {
                if (this.options.onCancel) this.options.onCancel();
                this.$stage.text(this.txtCancelling);
                return;
            }
            this.close();
        },

        onClose: function () {
            if (this.running && this.options.onCancel) this.options.onCancel();
            this.close();
        },

        close: function () {
            if (this.closed) return;
            if (this.running && this.options.onCancel) this.options.onCancel();
            this.running = false;
            this.closed = true;
            this.stopTimer();
            Common.UI.Window.prototype.close.apply(this, arguments);
        },

        // fraction 0..1 of the whole job; stage: what it is doing; page, total: the page it is on
        setProgress: function (fraction, stage, page, total, finished) {
            if (!this.$bar) return;
            var pct = OcrSettings.percent(fraction, finished || fraction >= 1);
            this.$bar.css('width', pct + '%');
            this.$pct.text(pct + '%');
            this.$track.attr('aria-valuenow', pct);
            if (stage !== undefined && !(this.running && this.$stage.text() === this.txtCancelling)) this.$stage.text(stage);
            if (page && total) this.$page.text(Common.Utils.String.format(this.txtPageOf, page, total));
        },

        textTitle: 'Recognise text (OCR)',
        textHeading: 'Recognise text in scanned pages',
        textIntro: 'Turns scanned pages and images into text you can search, copy or edit. Recognition runs on this computer; nothing is uploaded.',
        textLanguages: 'Languages',
        txtSearch: 'Search languages',
        txtNoMatch: 'No installed language matches.',
        txtEnglish: 'English',
        txtSinhala: 'Sinhala',
        txtTamil: 'Tamil',
        txtAddLangs: 'Add languages…',
        textPages: 'Pages',
        txtPageCount: '{0} pages in this PDF',
        txtAllPages: 'All pages',
        txtAllPagesDesc: 'Every scanned page (of {0}). Pages that already have text are skipped.',
        txtCurrentPage: 'Current page',
        txtCurrentPageDesc: 'Page {0} of {1}.',
        txtArea: 'Selected area',
        txtAreaDesc: 'Draw over part of the current page; shows the text to copy.',
        txtImage: 'Import image',
        txtImageDesc: 'A PNG, JPEG, BMP, GIF or WebP file; shows the text to copy.',
        txtImageDesktop: 'Only in the WorkSuite Office desktop app.',
        textCleanUp: 'Scan enhancement',
        txtStraighten: 'Straighten tilted pages',
        txtStraightenDesc: 'Measures the slant of the text lines (up to 5°) and rotates the page level.',
        txtUpright: 'Turn pages upright',
        txtUprightDesc: 'Finds sideways and upside-down pages and turns them. Not for an area.',
        txtContrast: 'Enhance contrast',
        txtContrastDesc: 'Makes faint or grey scans darker on whiter paper before recognising.',
        txtBlackWhite: 'Black and white',
        txtBlackWhiteDesc: 'Converts to pure black and white and removes specks: crisper text and a smaller file.',
        textThen: 'Output',
        txtSearchable: 'Searchable PDF',
        txtSearchableDesc: 'Keeps each page as it looks, with the text invisible on top. Undo puts the pages back.',
        txtWord: 'Word document (DOCX)',
        txtWordDesc: 'Makes the PDF searchable, then opens Save as Word.',
        txtPdfa: 'PDF/A',
        txtPdfaDesc: 'Makes the PDF searchable, then saves it for archiving.',
        txtPdfaNone: 'This version of the editors cannot save PDF/A.',
        txtText: 'Extract text',
        txtTextDesc: 'Shows the text to check, correct and copy to the clipboard. The PDF is not changed.',
        textProgress: 'Recognition progress',
        txtStarting: 'Starting…',
        txtStageLoading: 'Loading the recognition engine and languages…',
        txtStagePrepare: 'Preparing the page…',
        txtStageRecognise: 'Recognising text…',
        txtStageReplace: 'Adding the text to the page…',
        txtStageDone: 'Finished',
        txtCancelling: 'Cancelling…',
        txtPageOf: 'Page {0} of {1}',
        txtElapsed: 'Elapsed {0}',
        txtTook: '({0})',
        txtDone: 'Text recognised.',
        txtDonePages: 'Text recognised on {0} pages. Undo puts them back.',
        txtCancelled: 'Recognition cancelled. Pages already recognised stay changed and can be undone.',
        txtFailedHere: 'The text could not be recognised.',
        textRecognise: 'Recognise text',
        textRecognising: 'Recognising…',
        textRetry: 'Try again',
        textView: 'View results',
        textCancel: 'Cancel',
        textCancelRun: 'Cancel recognition',
        textClose: 'Close'
    }, PDFE.Views.OcrDialog || {}));
});
