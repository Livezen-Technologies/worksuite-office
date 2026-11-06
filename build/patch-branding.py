#!/usr/bin/env python3
"""WorkSuite's branding of the editors, applied in CI before web-apps is built.

The editors keep ONLYOFFICE's links and name wherever the web-apps build is not told otherwise. This
rewrites what a user sees or the app opens:

- the build's defaults for {{HELP_URL}}, {{SUPPORT_URL}}, {{PUBLISHER_URL}}, {{COMPANY_NAME}},
  {{APP_TITLE_TEXT}}, ... (build/Gruntfile.js), which each build's environment can still override;
- links written into the sources: the field-codes and macros help (helpcenter/api.onlyoffice.com),
  the desktop editor page's feedback link (helpdesk.onlyoffice.com) and the embedded/forms viewers'
  header logo link;
- the product name in page titles, the "browser not supported" text and the licence-limit titles of
  the locales that spell it out instead of using %1.

Kept: the About panel's licensor block (ONLYOFFICE / Ascensio System SIA, its address, mail, phone and
www.onlyoffice.com), which is the upstream's legal notice; the ONLYOFFICE logo images; internal markers
such as goback "onlyoffice.com" and the ONLYOFFICEFORM signature.

Every rewrite stops with an error when the upstream text it expects has gone (build/v10/check-patches.sh).
The 10.x builds (ONLYOFFICE web-apps at OO_TAG) apply it on every platform.

Usage: patch-branding.py [path/to/web-apps]   (default: the web-apps submodule)
"""
from pathlib import Path
import re
import sys

SITE = "https://worksuitecloud.com"
HELP = "https://worksuitecloud.com/help"
SUPPORT = "https://worksuitecloud.com/support"
SUPPORT_MAIL = "support@worksuitecloud.com"
PRODUCT = "WorkSuite Office"
LICENSOR_URL = "https://www.onlyoffice.com"  # the About panel's licensor link stays the upstream's

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web-apps"
EDITORS = ("documenteditor", "spreadsheeteditor", "presentationeditor", "pdfeditor", "visioeditor")


def fail(msg):
    sys.exit(f"patch-branding: {msg}")


def edit(rel, pairs, optional=False):
    path = root / rel
    if not path.is_file():
        if optional:
            return
        fail(f"{path} not found")
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if isinstance(old, re.Pattern):
            text, n = old.subn(new, text)
        else:
            n = text.count(old)
            text = text.replace(old, new)
        if n == 0 and (callable(new) or isinstance(old, re.Pattern) or new not in text):
            fail(f"expected text not found in {rel}:\n{old.pattern if isinstance(old, re.Pattern) else old}")
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"patched {rel}")


# 1. The web-apps build's defaults
def default(name, value):
    # to: _encode(process.env.NAME) || 'default'   (some also fall back to another variable first)
    return (re.compile(r"(process\.env\.%s\)(?:\s*\|\|\s*_encode\(process\.env\.\w+\))?\s*\|\|\s*)'[^']*'" % name),
            lambda m: f"{m.group(1)}'{value}'")


edit("build/Gruntfile.js", [
    default("SUPPORT_EMAIL", SUPPORT_MAIL),
    default("SUPPORT_URL", SUPPORT),
    default("SALES_EMAIL", SUPPORT_MAIL),
    default("PUBLISHER_URL", SITE),
    default("COMPANY_NAME", PRODUCT),
    default("APP_TITLE_TEXT", PRODUCT),
    default("HELP_URL", HELP),
    default("HELP_CENTER_WEB_DE", HELP),
    default("HELP_CENTER_WEB_SSE", HELP),
    default("HELP_CENTER_WEB_PE", HELP),
    default("SUGGEST_URL", SUPPORT),
])

# The About panel's licensor block is the upstream's notice: it keeps www.onlyoffice.com and its mail
edit("apps/common/main/lib/view/About.js", [
    ("publisherurl: '{{PUBLISHER_URL}}'", f"publisherurl: '{LICENSOR_URL}' /* WorkSuite: licensor notice */"),
    ("supportemail: '{{SUPPORT_EMAIL}}'", "supportemail: 'info@onlyoffice.com' /* WorkSuite: licensor notice */"),
])

# 2. Links in the sources
edit("apps/documenteditor/main/app/controller/HeaderFooterTab.js", [
    ("https://helpcenter.onlyoffice.com/docs/document_editor/InsertFieldCodes.aspx", HELP)])
edit("apps/common/main/lib/view/MacrosDialog.js", [
    ("https://api.onlyoffice.com/docs/plugin-and-macros/macros/getting-started/", HELP)])
edit("apps/api/documents/index.html.desktop", [("https://helpdesk.onlyoffice.com/?desktop=true", SUPPORT)])
logo = re.compile(r'(id="header-logo" class="brand-logo" href=")https?://www\.onlyoffice\.com/?(")')
for editor in EDITORS:
    for sub in ("embed", "forms"):
        for page in sorted((root / "apps" / editor / sub).glob("index*.html*")):
            if 'id="header-logo"' in page.read_text(encoding="utf-8"):
                edit(page.relative_to(root).as_posix(), [(logo, rf"\g<1>{SITE}/\g<2>")])

# 3. The product name
title = re.compile(r"<title>ONLYOFFICE(?: Documents| Document Editor| Spreadsheet Editor| Presentation Editor"
                   r"| PDF Editor| Visio Viewer| Diagram Viewer| Documents Forms)?</title>")
sorry = re.compile(r"Sorry, ONLYOFFICE (Document|Spreadsheet|Presentation|Diagram)")
pages = [p for p in (root / "apps").glob("*/*/index*.html*")] + \
        list((root / "apps" / "api" / "documents").glob("*.html*")) + list((root / "apps" / "common").glob("index.html*"))
named = 0
for page in sorted(set(pages)):
    text = page.read_text(encoding="utf-8")
    new = title.sub(f"<title>{PRODUCT}</title>", text)
    new = sorry.sub(lambda m: f"Sorry, {PRODUCT}", new)
    if new != text:
        page.write_text(new, encoding="utf-8", newline="\n")
        named += 1
if named == 0:
    fail("no editor page title names ONLYOFFICE any more")
print(f"patched the product name in {named} pages")

locales = 0
for editor in EDITORS:
    for loc in sorted((root / "apps" / editor / "main" / "locale").glob("*.json")):
        text = loc.read_text(encoding="utf-8")
        new = re.sub(r'("\w+\.Controllers\.Main\.textNoLicenseTitle":\s*"[^"]*)ONLYOFFICE', rf"\g<1>{PRODUCT}", text)
        if new != text:
            loc.write_text(new, encoding="utf-8", newline="\n")
            locales += 1
print(f"patched the product name in {locales} locales")
