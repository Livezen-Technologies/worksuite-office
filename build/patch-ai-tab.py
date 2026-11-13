#!/usr/bin/env python3
"""One AI tab: the editors' AI plugin and WorkSuite Local AI share it. Applied in CI before the desktop
editors are deployed.

ONLYOFFICE's AI plugin (onlyoffice.github.io, sdkjs-plugins/content/ai) makes its toolbar tab with
new Asc.ButtonToolbar(), which gives the tab a new random id every time the editor starts. WorkSuite
Local AI (ai-plugin) puts its buttons in the tab with the id "ai", so the two never met and the
editors showed two tabs captioned AI. The AI plugin's tab gets the id "ai", and both plugins' buttons
are in one AI tab. Running it again on patched sources changes nothing.

Usage: patch-ai-tab.py path/to/onlyoffice.github.io
"""
from pathlib import Path
import sys

AI_TAB = "ai"  # ai-plugin/plugin/src/scripts/plugin.js AI_TAB

root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-ai-tab.py path/to/onlyoffice.github.io")
path = root / "sdkjs-plugins" / "content" / "ai" / "scripts" / "engine" / "register.js"
if not path.is_file():
    sys.exit(f"patch-ai-tab: {path} not found")

text = path.read_text(encoding="utf-8")
old = "let buttonMainToolbar = new Asc.ButtonToolbar();"
new = f'let buttonMainToolbar = new Asc.ButtonToolbar(null, "{AI_TAB}"); // WorkSuite: one AI tab with WorkSuite Local AI'
if new not in text:
    if text.count(old) != 1:
        sys.exit(f"patch-ai-tab: {old!r} is in {path} {text.count(old)} times, not once")
    text = text.replace(old, new)
    path.write_text(text, encoding="utf-8", newline="\n")
print(f"patched {path}")
