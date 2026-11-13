/*
 * WorkSuite Office Pro upsell for the PDF Editor. When a gated action is refused by the local AI
 * service with HTTP 402 (error code "payment_required", ai-service/src/license.ts), the tab's error
 * handler calls ProUpgrade.prompt() instead of a plain failure: a dialog that says the feature needs
 * Pro and offers Upgrade (opens the upgrade page in the browser) and where to enter a key.
 *
 * The editor frame cannot open an external URL through the "worksuite:open" shell command (that only
 * answers the start page), so Upgrade uses window.open, which the desktop shell opens in the system
 * browser. Copied into web-apps by build/patch-pdf-convert.py. Licensed under the GNU AGPL v3.
 */
define([], function () {
    'use strict';

    var UPGRADE_URL = 'https://worksuitecloud.com/pro';

    // True when the service refused the action because the feature is Pro and this copy is not licensed.
    function is402(err) {
        return !!err && err.code === 'payment_required';
    }

    function openUpgrade() {
        try { window.open(UPGRADE_URL, '_blank'); } catch (e) { /* nothing more we can do from here */ }
    }

    // strings: {title, msg, upgrade, close}. msg is the feature-specific explanation.
    function prompt(strings) {
        var s = strings || {};
        Common.UI.warning({
            title: s.title || 'WorkSuite Office Pro',
            msg: s.msg || '',
            buttons: [
                {value: 'upgrade', caption: s.upgrade || 'Upgrade to Pro', primary: true},
                {value: 'close', caption: s.close || 'Close'}
            ],
            primary: 'upgrade',
            callback: function (btn) { if (btn === 'upgrade') openUpgrade(); }
        });
    }

    return {is402: is402, prompt: prompt, openUpgrade: openUpgrade, UPGRADE_URL: UPGRADE_URL};
});
