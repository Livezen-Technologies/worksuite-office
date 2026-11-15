#!/usr/bin/env python3
"""Remove upstream About UI and outgoing vendor links before packaging.

Usage: patch-branding.py [web-apps] [desktop-apps]
Source copyright headers, licenses and third-party notices are retained.
The bare onlyoffice.com value used as the native offline/back command is not a URL.
"""
from pathlib import Path
import re
import sys

SITE = "https://worksuitecloud.com/"
URL = re.compile(r"https?://(?:[\w-]+\.)*onlyoffice\.com\b[^\s\"'<>`\\)]*", re.I)
EMAIL = re.compile(r"[\w.+-]+@(?:[\w-]+\.)*onlyoffice\.com\b", re.I)
HERE = Path(__file__).resolve().parent.parent


def edit(path, old, new):
    text = path.read_text(encoding="utf-8")
    if old not in text:
        if new and new in text:
            return
        raise SystemExit(f"patch-branding: expected About markup missing in {path}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def patch(web, desktop):
    about = desktop / "common/loginpage/src/panelabout.js"
    edit(about, "return _lang.aboutVersion.replace('$1', short).replace('$2', edition);",
         "return _lang.strVersion + ' ' + short; // WorkSuite: no edition label")
    edit(about, "if ( !!opts.license ) _links.push(_link(opts.license, _lang.aboutLicenseAgreement, 'ver-license'));",
         "// WorkSuite: license remains in the packaged legal documents.")
    edit(about, "${_opts.edition}", "<!-- WorkSuite: no license edition row -->")
    edit(about, '<div class="ver-copyright about-field">${_based_on}${_opts.rights}</div>',
         '<!-- WorkSuite: attribution remains in the packaged notices. -->')

    about = web / "apps/common/main/lib/view/About.js"
    # Euro-Office has a shared attribution row; ONLYOFFICE 9.3 does not.
    text = about.read_text(encoding="utf-8")
    text = text.replace("'<%= scope.renderRow(\"attribution\", \"\", attribution) %>',", "'' ,")
    about.write_text(text, encoding="utf-8")

    # These are service endpoints, not navigation links. Omit the old cloud
    # connectors and stop online template requests without a configured service.
    edit(desktop / "common/loginpage/src/panelconnect.js",
         "utils.fn.sortProviders(sdk.externalClouds());",
         "utils.fn.sortProviders(sdk.externalClouds().filter(item => "
         "!['box', 'dropbox'].includes(item.provider))); // WorkSuite: no vendor-hosted connectors")
    templates = desktop / "common/loginpage/src/paneltemplates.js"
    text = templates.read_text(encoding="utf-8")
    text = re.sub(r"const _domain = localStorage.templatesdomain .*?;[^\n]*",
                  "const _domain = localStorage.templatesdomain || ''; // WorkSuite: configured template service only",
                  text)
    if "if (!_domain) { isCloudTmplsLoading = false; return; }" not in text:
        text = text.replace("            const _url = `${_domain}/dashboard/api/oforms",
                            "            if (!_domain) { isCloudTmplsLoading = false; return; }\n"
                            "            const _url = `${_domain}/dashboard/api/oforms")
    templates.write_text(text, encoding="utf-8")

    # Rewrite links in shipped UI, localized help and build-time theme defaults.
    # Keep legal documents and bundled third-party code intact. Never rewrite
    # source headers: the first block comment is the upstream copyright notice.
    roots = [web / "apps", web / "build", web / "theme",
             desktop / "common/loginpage", desktop / "win-linux/src",
             desktop / "macos/ONLYOFFICE/Code"]
    extensions = {".js", ".jsx", ".mjs", ".json", ".html", ".htm", ".ejs", ".cpp", ".h", ".m", ".mm"}
    changed = 0
    for root in roots:
        for path in root.rglob("*"):
            if not path.is_file() or not any(s in extensions for s in path.suffixes):
                continue
            if any(part.lower() in {"vendor", "node_modules", "license", "licenses", "3dparty"}
                   for part in path.relative_to(root).parts):
                continue
            if any(word in path.name.lower() for word in ("license", "eula", "3dparty")):
                continue
            raw = path.read_bytes()
            # Some localized legacy help pages use a single-byte encoding.
            # Latin-1 round-trips those bytes without altering their charset.
            try:
                text = raw.decode("utf-8")
                encoding = "utf-8"
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
                encoding = "latin-1"
            header = re.match(r"\s*/\*.*?\*/", text, re.S)
            start = header.end() if header else 0
            body = text[start:]
            body = URL.sub(SITE, body)
            # Do not invent a WorkSuite mailbox. Route mailto links to the site.
            body = re.sub(r"mailto:" + EMAIL.pattern, SITE, body, flags=re.I)
            body = EMAIL.sub("", body)
            result = text[:start] + body
            if result != text:
                path.write_bytes(result.encode(encoding))
                changed += 1
    print(f"patch-branding: patched About screens and {changed} files with vendor links")


if __name__ == "__main__":
    patch(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "web-apps",
          Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "desktop-apps")
