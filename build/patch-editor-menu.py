#!/usr/bin/env python3
"""Turns off the editors' Help and Suggest a Feature items, applied in CI before web-apps is built.

Both items lead to ONLYOFFICE's own help and feature-request pages. They are switched
off where each editor decides whether to show them (appOptions.canHelp and
appOptions.canSuggest in its Main controller), so the File menu entries, their panels
and the F1 shortcut all go, and the remaining items close up with no gap. Works on the
Euro-Office web-apps (Windows/Linux) and the ONLYOFFICE web-apps (macOS).

Usage: patch-editor-menu.py [path/to/web-apps]   (default: the web-apps submodule)
"""
from pathlib import Path
import re
import sys

EDITORS = ("documenteditor", "spreadsheeteditor", "presentationeditor", "pdfeditor", "visioeditor")
OPTIONS = {
    "canHelp": "WorkSuite: no ONLYOFFICE help",
    "canSuggest": "WorkSuite: no ONLYOFFICE feature requests",
}

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web-apps"

for editor in EDITORS:
    path = root / "apps" / editor / "main" / "app" / "controller" / "Main.js"
    if not path.is_file():
        if editor == "visioeditor":  # not in every web-apps version
            continue
        sys.exit(f"patch-editor-menu: {path} not found")

    text = path.read_text(encoding="utf-8")
    for option, note in OPTIONS.items():
        pattern = re.compile(r"(this\.appOptions\.%s\s*=\s*)[^;\n]*;[^\n]*" % option)
        text, count = pattern.subn(lambda m: f"{m.group(1)}false; // {note}", text)
        if count == 0:
            sys.exit(f"patch-editor-menu: appOptions.{option} not set in {path}")
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"patched {path}")
