#!/usr/bin/env python3
"""Keys typed while a plugin command runs are kept, not dropped. Applied in CI before sdkjs is built.

The editors ignore every key while a "long action" is in progress (CTextInput.onKeyDown: isLongAction()
-> stopEvent). A plugin's callCommand is one: it ends with onEndBuilderScript, which loads fonts as a long
action, so it holds the editor for 20-130 ms (the first command of a session the longest). Sinhala Tools
writes each Singlish word with a command, so the keys of the next word, typed meanwhile, were lost:
"mama gedhara" became "මම එදර" (the "g" never reached the document). Measured over the DevTools
protocol in the installed app.

Now, while a plugin command is running (and only then: saving, loading and the like still ignore keys),
the keys are queued and replayed in order once the editor is free: printable characters through
addText (the editor's own text input path, so input helpers see them), other keys through onKeyDown.
Replay pauses while a command a replayed key started (a Singlish word committed by a space) runs.

Usage: patch-sdkjs-keys.py path/to/sdkjs            (patches common/text_input2.js, common/plugins.js)
       patch-sdkjs-keys.py --bundle path/to/sdk-all.js   (the same edits in a built editor bundle, for testing)
Running it again changes nothing.
"""
from pathlib import Path
import sys

MARK = "WorkSuite: keys typed during a plugin command"

KEYDOWN_OLD = """CTextInputPrototype.onKeyDown = function(e)
	{
		if (this.Api.isLongAction())
		{
			AscCommon.stopEvent(e);
			return false;
		}"""
KEYDOWN_NEW = """CTextInputPrototype.onKeyDown = function(e)
	{
		// WorkSuite: keys typed during a plugin command are queued and replayed, not lost; while some
		// are still waiting, newer keys queue behind them, so the order stays as typed
		if ((wsPending(this.Api) || wsHolding(this.Api)) && !e.wsReplayed)
		{
			wsQueueKey(this, e, true);
			AscCommon.stopEvent(e);
			return false;
		}
		if (this.Api.isLongAction())
		{
			wsQueueKey(this, e, false);
			AscCommon.stopEvent(e);
			return false;
		}"""
# helpers, put before the onKeyDown above (same closure: text_input2.js's IIFE)
HELPERS = """	// """ + MARK + """ (build/patch-sdkjs-keys.py) are queued here and
	// replayed in order once the editor is free, instead of being dropped by the long-action check.
	function wsCommandRunning(api)
	{
		return !!(api && api.wsPluginCommands > 0);
	}
	function wsHolding(api)
	{
		return !!(api && api.wsHoldUntil && api.wsHoldUntil > Date.now());
	}
	function wsHold(api, ms)
	{
		api.wsHoldUntil = Date.now() + ms;
		clearTimeout(api.wsHoldTimer);
		api.wsHoldTimer = setTimeout(function() { api.wsHoldUntil = 0; wsReplayKeys(api); }, ms + 5);
	}
	function wsPending(api)
	{
		return !!(api && api.wsKeyQueue && api.wsKeyQueue.length);
	}
	function wsQueueKey(input, e, force)
	{
		var api = input.Api;
		if ((!force && !wsCommandRunning(api)) || !e || e.isComposing || 229 === e.keyCode)
			return;
		if (16 === e.keyCode || 17 === e.keyCode || 18 === e.keyCode || 91 === e.keyCode || 93 === e.keyCode)
			return; // modifiers alone
		var q = api.wsKeyQueue || (api.wsKeyQueue = []);
		if (q.length >= 64)
			return;
		q.push({input : input, key : e.key, keyCode : e.keyCode, which : e.which, charCode : e.charCode, code : e.code,
			ctrlKey : !!e.ctrlKey, shiftKey : !!e.shiftKey, altKey : !!e.altKey, metaKey : !!e.metaKey});
	}
	function wsReplayKeys(api)
	{
		if (!api || !api.wsKeyQueue || !api.wsKeyQueue.length || api.wsReplayTimer)
			return;
		api.wsReplayTimer = setTimeout(function()
		{
			api.wsReplayTimer = null;
			if (!api.wsKeyQueue)
				return;
			if (!api.wsKeyQueue.length)
				return;
			// wait while the editor is busy, or a command a replayed key started is running
			if (api.isLongAction() || wsCommandRunning(api) || wsHolding(api))
				return wsReplayKeys(api);
			var k = api.wsKeyQueue.shift();
			var printable = k.key && 1 === Array.from(k.key).length && !k.ctrlKey && !k.metaKey && !k.altKey;
			if (printable)
				k.input.addText(k.key);
			else
				k.input.onKeyDown({type : "keydown", key : k.key, keyCode : k.keyCode, which : k.which, charCode : k.charCode,
					code : k.code, ctrlKey : k.ctrlKey, shiftKey : k.shiftKey, altKey : k.altKey, metaKey : k.metaKey,
					isComposing : false, wsReplayed : true, preventDefault : function() {}, stopPropagation : function() {}});
			// letters follow at once; after any other key the plugin gets time to answer (two message hops),
			// since that key may finish a word and start a command
			if (api.wsKeyQueue.length)
				setTimeout(function() { wsReplayKeys(api); }, printable && /^[A-Za-z]$/.test(k.key) ? 0 : 60);
		}, 0);
	}
	AscCommon.wsReplayKeys = wsReplayKeys;

	"""

HELPER_OLD = """		if (window.g_asc_plugins)
			window.g_asc_plugins.onPluginEvent("onInputHelperInput", { "text" : this.Text });"""
HELPER_NEW = """		if (window.g_asc_plugins)
		{
			let wsHelpers = window.g_asc_plugins.onPluginEvent("onInputHelperInput", { "text" : this.Text });
			// WorkSuite: a key that ends a word went to an input helper (Singlish): it may now write the word
			// with a command, so hold the next keys until that command starts, or for a moment if none comes
			if (wsHelpers && wsHelpers.length && /[\\s.,;:!?)\\]}"'\\-0-9]$/.test(this.Text || ""))
				wsHold(this.Api, 250);
		}"""

CMD_START_OLD = """				else if (!this.api.isLongAction())
				{
					let _t = this;
					this.api.runBuilderScript(function() {"""
CMD_START_NEW = """				else if (!this.api.isLongAction())
				{
					let _t = this;
					// WorkSuite: keys typed during a plugin command (build/patch-sdkjs-keys.py)
					this.api.wsPluginCommands = (this.api.wsPluginCommands || 0) + 1;
					this.api.wsHoldUntil = 0;
					this.api.runBuilderScript(function() {"""
CMD_END_OLD = """						function onEndScript()
						{
							_t.api.onEndBuilderScript(function(result)
							{"""
CMD_END_NEW = """						function onEndScript()
						{
							_t.api.onEndBuilderScript(function(result)
							{
								_t.api.wsPluginCommands = Math.max(0, (_t.api.wsPluginCommands || 1) - 1);
								if (AscCommon.wsReplayKeys)
									AscCommon.wsReplayKeys(_t.api);"""


def edit(text, where, pairs):
    for old, new in pairs:
        if new in text:
            continue
        if text.count(old) != 1:
            sys.exit(f"patch-sdkjs-keys: expected text is in {where} {text.count(old)} times, not once:\n{old[:120]}")
        text = text.replace(old, new)
    return text


def patch_input(text, where):
    if MARK in text:
        return text
    text = edit(text, where, [(KEYDOWN_OLD, KEYDOWN_NEW), (HELPER_OLD, HELPER_NEW)])
    at = text.index("CTextInputPrototype.onKeyDown = function(e)")
    line = text.rfind("\n", 0, at) + 1
    return text[:line] + HELPERS + text[line:]


def patch_plugins(text, where):
    return edit(text, where, [(CMD_START_OLD, CMD_START_NEW), (CMD_END_OLD, CMD_END_NEW)])


if len(sys.argv) == 3 and sys.argv[1] == "--bundle":
    p = Path(sys.argv[2])
    t = p.read_text(encoding="utf-8")
    p.write_text(patch_plugins(patch_input(t, p), p), encoding="utf-8", newline="\n")
    print(f"patched {p}")
elif len(sys.argv) == 2:
    root = Path(sys.argv[1])
    for rel, fn in (("common/text_input2.js", patch_input), ("common/plugins.js", patch_plugins)):
        p = root / rel
        if not p.is_file():
            sys.exit(f"patch-sdkjs-keys: {p} not found")
        p.write_text(fn(p.read_text(encoding="utf-8"), p), encoding="utf-8", newline="\n")
        print(f"patched {p}")
else:
    sys.exit(__doc__)
