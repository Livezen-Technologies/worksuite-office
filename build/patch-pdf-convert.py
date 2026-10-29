#!/usr/bin/env python3
"""Adds the Convert and PDF Tools (Pages) tabs to the PDF Editor, applied in CI before web-apps is built.

Copies build/editors/ over web-apps (the tabs' controllers and views) and registers the
controllers in the PDF Editor's app.js and app_dev.js, after the Redact tab's: Convert, then Pages.
The Pages tab inserts, replaces, duplicates, extracts and splits pages, and runs the start page's
Merge, Split and Extract pages tools. The tab
converts the open PDF to Word, images, text, a web page or an e-book with the converter
the editors already have,
saves as PDF/A, and recognises the text of scanned pages (OCR, with the engine build/v10/ocr.sh ships
in the desktop app). Works on the Euro-Office web-apps (Windows/Linux) and the
ONLYOFFICE web-apps (macOS), and again on a web-apps it has patched.

Usage: patch-pdf-convert.py [path/to/web-apps]   (default: the web-apps submodule)
"""
from pathlib import Path
import re
import shutil
import sys

here = Path(__file__).resolve().parent
root = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "web-apps"
overlay = here / "editors"

for src in sorted(p for p in overlay.rglob("*") if p.is_file()):
    dst = root / src.relative_to(overlay)
    if not dst.parent.is_dir():
        sys.exit(f"patch-pdf-convert: {dst.parent} not found")
    shutil.copyfile(src, dst)
    print(f"copied {dst}")

# In the controllers list, and in the list of modules to load.
REGISTER = (
    ("'RedactTab',", "'ConvertTab',"),
    ("'ConvertTab',", "'PagesTab',"),
    ("'pdfeditor/main/app/controller/RedactTab',", "'pdfeditor/main/app/controller/ConvertTab',"),
    ("'pdfeditor/main/app/controller/ConvertTab',", "'pdfeditor/main/app/controller/PagesTab',"),
)
for name in ("app.js", "app_dev.js"):
    path = root / "apps" / "pdfeditor" / "main" / name
    text = path.read_text(encoding="utf-8")
    for after, entry in REGISTER:
        if entry in text:
            continue
        pattern = re.compile(r"^([ \t]*)%s[^\n]*$" % re.escape(after), re.M)
        text, count = pattern.subn(lambda m: f"{m.group(0)}\n{m.group(1)}{entry}", text)
        if count != 1:
            sys.exit(f"patch-pdf-convert: {after} is in {path} {count} times, not once")
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"patched {path}")
