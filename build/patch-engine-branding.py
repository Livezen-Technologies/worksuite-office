#!/usr/bin/env python3
"""Apply WorkSuite Office branding to document engine source trees.

Keep storage, installer upgrade keys, URL schemes, public SDK symbols and source
repository paths stable. Those identify existing installations and integrations,
not the product's display name. Copyright and license notices stay verbatim.

Usage: patch-engine-branding.py [web-apps] [desktop-apps]
       patch-engine-branding.py --web-only /path/to/web-apps
"""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
BRANDING = json.loads((ROOT / "build/engine-branding.json").read_text(encoding="utf-8"))
DISPLAY_NAME = BRANDING["product_name"]
ENGINE_NAME = BRANDING["engine_name"]
SDK_NAME = BRANDING["sdk_name"]
SERVER_NAME = BRANDING["server_name"]
EXTENSIONS = {".js", ".jsx", ".json", ".html", ".htm", ".ejs", ".cpp", ".h", ".m", ".mm",
              ".strings", ".xib", ".storyboard", ".plist", ".ts", ".iss", ".ps1", ".aip"}
LEGAL = {"license", "licenses", "3dparty", "vendor", "node_modules"}
# These strings must continue finding credentials and the existing uninstaller.
STABLE_LINES = ("#define SECRET_SERVICE ", "# define REG_UNINST_KEY ",
                "#define ASCC_REG_REGISTERED_APP_NAME ", "Property=\"RegisteredAppName\"")


def rename_text(text):
    lines = []
    for line in text.splitlines(keepends=True):
        if any(marker in line for marker in STABLE_LINES) or re.search(r"copyright|©", line, re.I):
            lines.append(line)
            continue
        line = line.replace("WorkSuite Office", DISPLAY_NAME)
        line = re.sub(r"\b(?:ONLYOFFICE|Euro-Office) (?:Document Server|Docs)\b", SERVER_NAME, line)
        line = re.sub(r"\b(?:ONLYOFFICE|Euro-Office) SDK\b", SDK_NAME, line)
        # Upstream names in prose and translated messages. Do not touch standalone
        # code identifiers, resource paths, URLs, or public API namespaces.
        line = re.sub(r"\b(?:ONLYOFFICE Desktop Editors|ONLYOFFICE DesktopEditors|Euro-Office DesktopEditors|Euro Office|Euro-Office)(?=[ <.,:!?'\"]|$)",
                      DISPLAY_NAME, line)
        line = re.sub(r"\bONLYOFFICE(?= (?:[A-Z][A-Za-z]|can\b|cannot\b|is\b|has\b|was\b|will\b|does\b))",
                      DISPLAY_NAME, line)
        line = re.sub(r"((?:appName|txtDefaultTitle|title|appTitle)\s*:\s*['\"])ONLYOFFICE(['\"])",
                      rf"\g<1>{DISPLAY_NAME}\2", line)
        lines.append(line)
    return "".join(lines)


def display_text(text):
    """Brand plain resource text, including translated grammar around the name."""
    if re.search(r"copyright|©", text, re.I):
        return text
    text = re.sub(r"\b(?:ONLYOFFICE|Euro-Office) (?:Document Server|Docs)\b", SERVER_NAME, text)
    text = re.sub(r"\b(?:ONLYOFFICE|Euro-Office) SDK\b", SDK_NAME, text)
    return re.sub(r"\b(?:ONLYOFFICE|Euro Office|Euro-Office)\b", DISPLAY_NAME, text)


def write(path, text, encoding="utf-8"):
    path.write_bytes(text.encode(encoding))


def patch(web, desktop=None):
    if not (web / "apps").is_dir():
        raise SystemExit(f"patch-engine-branding: web source missing at {web}")
    if desktop is not None and not (desktop / "win-linux/src/defines.h").is_file():
        raise SystemExit(f"patch-engine-branding: desktop source missing at {desktop}")
    changed = 0
    roots = [web / "apps"]
    if desktop is not None:
        roots += [desktop / "common/loginpage", desktop / "win-linux", desktop / "macos/ONLYOFFICE", desktop / "package"]
    for root in roots:
        for path in root.rglob("*"):
            if not path.is_file() or not any(s in EXTENSIONS for s in path.suffixes):
                continue
            if any(part.lower() in LEGAL for part in path.relative_to(root).parts):
                continue
            if re.search(r"license|eula|3dparty", path.name, re.I):
                continue
            raw = path.read_bytes()
            encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8"
            try:
                text = raw.decode(encoding)
            except UnicodeDecodeError:
                encoding = "latin-1"
                text = raw.decode(encoding)
            header = re.match(r"\s*/\*.*?\*/", text, re.S)
            start = header.end() if header else 0
            result = text[:start] + rename_text(text[start:])
            if any(part in {"locale", "locales", "langs"} for part in path.parts) and path.suffix in {".json", ".js"}:
                # Translated grammar need not have an English word after the
                # brand. These files contain UI strings, not SDK identifiers.
                if path.suffix == ".json":
                    result = re.sub(r'(:\s*)("(?:[^"\\]|\\.)*")',
                                    lambda m: m[1] + json.dumps(display_text(json.loads(m[2])), ensure_ascii=False),
                                    result)
                else:
                    result = text[:start] + "".join(display_text(line) for line in result[start:].splitlines(keepends=True))
            if any(s in {".html", ".htm", ".ejs", ".xib", ".storyboard", ".plist", ".ts"} for s in path.suffixes):
                # Text nodes carry translated UI/help text, while tag attributes
                # retain resource names, keys and paths used by native toolchains.
                result = re.sub(r">([^<>]+)<", lambda m: ">" + display_text(m[1]) + "<", result)
            if path.suffix == ".strings":
                result = "".join(display_text(line) if "=" in line and "Copyright" not in line
                                 else line for line in result.splitlines(keepends=True))
            if result != text:
                write(path, result, encoding)
                changed += 1

    path = web / "build/theme.config.mjs"
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        text = re.sub(r"('app_title',\s*)'ONLYOFFICE'", rf"\g<1>'{DISPLAY_NAME}'", text)
        write(path, text)

    # The macOS source version predates theme metadata. Its Grunt defaults must
    # carry the same names when the build does not provide explicit branding.
    path = web / "build/Gruntfile.js"
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        for key, value in (("COMPANY_NAME", "WorkSuite"), ("APP_TITLE_TEXT", DISPLAY_NAME),
                           ("APP_CUSTOMER_NAME", DISPLAY_NAME), ("PUBLISHER_NAME", "Livezen Technologies LLC")):
            pattern = r"(process\.env(?:\." + key + r"|\['" + key + r"'\])\)?\s*\|\|\s*)'[^']*'"
            text = re.sub(pattern, lambda m: m[1] + repr(value), text)
        write(path, text)

    # Theme metadata also supplies the embedded editors' page titles and About.
    for path in (web / "theme").glob("*/meta/config.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(company_name="WorkSuite", publisher_name="Livezen Technologies LLC",
                    app_title=DISPLAY_NAME, publisher_url="https://worksuitecloud.com/",
                    support_url="https://worksuitecloud.com/", help_url="https://worksuitecloud.com/")
        write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    # Internal component documentation uses the engine/SDK names. Keep public
    # symbols and package dependency keys unchanged for API compatibility.
    for component, name in (("core", ENGINE_NAME), ("sdkjs", SDK_NAME), ("desktop-sdk", SDK_NAME),
                            ("server", SERVER_NAME)):
        path = web.parent / component / "README.md"
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            text = re.sub(r"^# [^\n]+", "# " + name, text, count=1, flags=re.M)
            write(path, text)

    assets = ROOT / "branding/document-engine"
    images = web / "apps/common/main/resources/img"
    for name, asset in (("about/logo_s.svg", "wordmark-light.svg"),
                        ("about/logo-white_s.svg", "wordmark-dark.svg"),
                        ("header/header-logo_s.svg", "icon.svg"), ("header/dark-logo_s.svg", "icon.svg")):
        path = images / name
        if path.is_file():
            path.write_bytes((assets / asset).read_bytes())
    if desktop is not None:
        for mode in ("light", "dark"):
            (desktop / f"win-linux/res/icons/logo-{mode}-eo.svg").write_bytes((assets / f"wordmark-{mode}.svg").read_bytes())
        for path in (desktop / "win-linux/res/styles").glob("*.qss"):
            text = path.read_text(encoding="utf-8")
            text = re.sub(r"logo-(light|dark)-eo(?:_[\d.x]+)?\.png", r"logo-\1-eo.svg", text)
            write(path, text)
        for name in ("idx-logo-light.svg", "idx-logo-dark.svg"):
            (desktop / "common/loginpage/res/img" / name).write_bytes((assets / "icon.svg").read_bytes())
    for theme in (web / "theme").glob("*/assets/img"):
        for name, mode in (("about/logo.svg", "light"), ("embed/logo.svg", "light"),
                           ("header/eo_logo_light.svg", "light"), ("header/eo_logo_dark.svg", "dark")):
            path = theme / name
            if path.is_file():
                path.write_bytes((assets / f"wordmark-{mode}.svg").read_bytes())
        for name in ("header/header-logo_s.svg", "header/dark-logo_s.svg"):
            path = theme / name
            if path.is_file():
                path.write_bytes((assets / "icon.svg").read_bytes())
    print(f"{ENGINE_NAME}: branded {changed} source/resource files as {DISPLAY_NAME}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--web-only":
        if len(sys.argv) != 3:
            raise SystemExit("usage: patch-engine-branding.py --web-only /path/to/web-apps")
        patch(Path(sys.argv[2]))
    else:
        patch(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web-apps",
              Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "desktop-apps")
