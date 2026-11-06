#!/usr/bin/env python3
"""WorkSuite's offline help, applied in CI before web-apps is built.

The editors' help pages (apps/<editor>/main/resources/help/<lang>/) ship with the app, and
the desktop editors open them from disk, so Help works without internet. They are the
upstream pages, so this rebrands them:

- "ONLYOFFICE Desktop Editors", "ONLYOFFICE Docs" and a lone "ONLYOFFICE" read
  "WorkSuite Office"; "ONLYOFFICE <name>" (Document Editor, editors, ...) reads "WorkSuite <name>".
- Links to onlyoffice.com sites go to WorkSuite's help instead.

Only text is changed: file names, image paths and the help's own links stay as they are.

Usage: patch-help.py [path/to/web-apps]   (default: the web-apps submodule)
"""
from pathlib import Path
import re
import sys

HELP = "https://worksuitecloud.com/help"
EDITORS = ("documenteditor", "spreadsheeteditor", "presentationeditor", "pdfeditor", "visioeditor")
SUFFIXES = {".htm", ".html", ".json", ".js"}

LINK = re.compile(r"https?://(?:[a-z0-9-]+\.)*onlyoffice\.com(?:/[^\"'\s<>)]*)?", re.I)
WORDS = [
    (re.compile(r"\bONLYOFFICE Desktop Editors\b"), "WorkSuite Office"),
    (re.compile(r"\bONLYOFFICE Docs\b"), "WorkSuite Office"),
    # a name after it: "ONLYOFFICE Document Editor" -> "WorkSuite Document Editor"
    (re.compile(r"(?<![/\w-])ONLYOFFICE(?= [A-Za-z])"), "WorkSuite"),
    (re.compile(r"(?<![/\w-])ONLYOFFICE(?![\w/-])(?!\.\w)"), "WorkSuite Office"),
]


def rebrand(text):
    text = LINK.sub(HELP, text)
    for pattern, new in WORDS:
        text = pattern.sub(new, text)
    return text


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web-apps"
    folders = [root / "apps" / e / "main" / "resources" / "help" for e in EDITORS]
    folders = [f for f in folders if f.is_dir()]
    if not folders:
        print(f"patch-help: no help folders under {root}/apps/*/main/resources/help, nothing to do")
        return
    changed = 0
    for folder in folders:
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            new = rebrand(text)
            if new != text:
                path.write_text(new, encoding="utf-8", newline="")
                changed += 1
    print(f"patch-help: rebranded {changed} files in {len(folders)} help folders")


if __name__ == "__main__":
    main()
