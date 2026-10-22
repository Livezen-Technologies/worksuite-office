#!/usr/bin/env python3
"""WorkSuite's AI agent panel, applied in CI before the desktop editors are deployed.

The AI agent panel is ONLYOFFICE's ai-agent plugin (desktop-sdk/ChromiumBasedEditors/plugins/ai-agent,
guid {9DC93CDB-B576-4F0C-B55E-FCC9C48DD777}). build_tools copies its prebuilt deploy/ folder as it
is; the start page shows it in its AI side panel (or full page) in an iframe.

- The "Connect an AI Model" empty state is compact and centred: a small AI icon, a 17px semibold
  heading, 13px muted text and one 6px-rounded button, nothing clipped in a 300px panel.
- The header is one aligned 48px row (title, New chat, Settings) with a Hide button at its end.
  Hide sends the start page the plugin's "collapse" event (and "minimize" first from the full
  page), which closes the panel and remembers it closed.
- The start page's Settings > General get "Show AI agent panel", bound to that remembered state.

Strings the editors' words assert on are replaced once each; anything upstream moves stops the
build here. Running it again on patched sources changes nothing.

Usage: patch-ai-panel.py path/to/desktop-sdk path/to/desktop-apps
"""
from pathlib import Path
import re
import shutil
import sys

GUID = "{9DC93CDB-B576-4F0C-B55E-FCC9C48DD777}"
here = Path(__file__).resolve().parent
overlay = here / "ai-panel"
sdk = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "desktop-sdk"
apps = Path(sys.argv[2]) if len(sys.argv) > 2 else here.parent / "desktop-apps"


def fail(msg):
    sys.exit(f"patch-ai-panel: {msg}")


def replace_once(text, old, new, where):
    if new in text:  # already patched
        return text
    n = text.count(old)
    if n != 1:
        fail(f"{old[:70]!r} is in {where} {n} times, not once")
    return text.replace(old, new)


def sub_once(text, pattern, repl, where, done):
    if done in text:
        return text
    text, n = re.subn(pattern, repl, text)
    if n != 1:
        fail(f"/{pattern[:70]}/ matched {where} {n} times, not once")
    return text


# --- the plugin -------------------------------------------------------------------------------
plugin = sdk / "ChromiumBasedEditors" / "plugins" / "ai-agent" / "deploy" / GUID
if not (plugin / "index.js").is_file():
    fail(f"{plugin}/index.js not found")
for name in ("ws-ai-panel.css", "ws-ai-panel.js"):
    shutil.copyfile(overlay / name, plugin / name)
    print(f"copied {plugin / name}")

path = plugin / "index.html"
html = path.read_text(encoding="utf-8")
html = replace_once(html, '<script type="module" crossorigin src="index.js"></script>',
                    '<script src="ws-ai-panel.js"></script>\n'
                    '    <script type="module" crossorigin src="index.js"></script>', path)
html = replace_once(html, '<link rel="stylesheet" crossorigin href="index.css">',
                    '<link rel="stylesheet" crossorigin href="index.css">\n'
                    '    <link rel="stylesheet" href="ws-ai-panel.css">', path)
path.write_text(html, encoding="utf-8", newline="\n")
print(f"patched {path}")

path = plugin / "index.js"
js = path.read_text(encoding="utf-8")
# Empty state (src/pages/empty-screen/index.tsx)
for old, new in (
    ('className:"flex items-center justify-center h-full",children:', 'className:"ws-ai-empty-wrap",children:'),
    ('className:"max-w-[573px] text-center flex flex-col items-center gap-[40px]"', 'className:"ws-ai-empty"'),
    ('"select-none text-center text-[32px] font-bold leading-[36px] text-[var(--empty-screen-color)]"',
     '"ws-ai-empty__title"'),
    ('"select-none text-center text-[16px] font-normal leading-[24px] text-[var(--empty-screen-description-color)]"',
     '"ws-ai-empty__text"'),
):
    js = replace_once(js, old, new, path)
js = sub_once(js, r'(\w+\.jsx\(\w+,\{)(onClick:\(\)=>\w+\("settings"\),children:\w+\("ConnectAIModelBtn"\)\}\))',
              r'\1className:"ws-ai-empty__btn",\2', path, 'className:"ws-ai-empty__btn"')
# Header (src/components/layout/sub-components/Header.tsx)
js = replace_once(js, '"w-full flex justify-between items-center h-[56px] min-h-[56px] box-border border-b-[1px] '
                      'border-[var(--header-border-color)] bg-[var(--header-background-color)] px-[32px]"',
                  '"ws-ai-header"', path)
js = replace_once(js, '"text-[var(--header-color)] font-bold text-[16px] leading-[24px]",children:',
                  '"ws-ai-header__title",children:', path)
m = re.search(r'(\w+)\.jsxs\("nav",\{className:"ws-ai-header"', js)
if not m:
    fail(f"the header's nav is not in {path}")
hide = (f'{m.group(1)}.jsx("button",{{type:"button",className:"ws-ai-hide",'
        'title:window.WSAiPanel?window.WSAiPanel.t("HidePanel"):"Hide AI agent panel",'
        '"aria-label":window.WSAiPanel?window.WSAiPanel.t("HidePanel"):"Hide AI agent panel",'
        'onClick:()=>{window.WSAiPanel&&window.WSAiPanel.hide()},"data-testid":"ws-hide-panel-button"})')
js = sub_once(js, r'("data-testid":"settings-button"\}\)\}\))(\]\}\))',
              lambda mm: mm.group(1) + "," + hide + mm.group(2), path, '"ws-hide-panel-button"')
path.write_text(js, encoding="utf-8", newline="\n")
print(f"patched {path}")

# --- the start page: Settings > General > Show AI agent panel --------------------------------
src = apps / "common" / "loginpage" / "src"
store = (src / "stores" / "aichat.js").read_text(encoding="utf-8")
for fn in ("export function openSidePanel()", "export function closeSidePanel()", 'name: "aichat"'):
    if fn not in store:
        fail(f"{fn} is not in stores/aichat.js")

path = src / "routes" / "settings" / "general" / "index.jsx"
text = path.read_text(encoding="utf-8")
text = replace_once(text, 'import { aichat } from "@/stores/aichat";',
                    'import { aichat, openSidePanel, closeSidePanel } from "@/stores/aichat";', path)
anchor = ('<Switch id="chb-use-ai" checked={settings.useai !== false} onChange={(v) => setSettings("useai", v)} />\n'
          '          </div>\n'
          '        </Show>\n')
row = ('\n        {/* WorkSuite: the AI agent side panel, as its Hide button and AI Chat leave it */}\n'
       '        <Show when={aichat.available && settings.useai !== false}>\n'
       '          <div class={styles.fieldRowAuto}>\n'
       '            <label for="chb-ws-ai-panel" class={styles.fieldLabelBlock}>\n'
       '              {t("wsSettShowAiPanel", "Show AI agent panel")}<span class={styles.fieldDescription}>'
       '{t("wsSettShowAiPanelDescr", "Show the AI agent beside the start page. Hide it from its header; AI Chat opens it again")}</span>\n'
       '            </label>\n'
       '            <Switch id="chb-ws-ai-panel" checked={aichat.open} onChange={(v) => (v ? openSidePanel() : closeSidePanel())} />\n'
       '          </div>\n'
       '        </Show>\n')
text = replace_once(text, anchor, anchor + row, path)
path.write_text(text, encoding="utf-8", newline="\n")
print(f"patched {path}")

LOCALE = {
    "en-US": ("Show AI agent panel",
              "Show the AI agent beside the start page. Hide it from its header; AI Chat opens it again"),
    "en-GB": ("Show AI agent panel",
              "Show the AI agent beside the start page. Hide it from its header; AI Chat opens it again"),
    "si": ("AI නියෝජිත පුවරුව පෙන්වන්න",
           "ආරම්භක පිටුව අසල AI නියෝජිතයා පෙන්වන්න. එහි ශීර්ෂයෙන් එය සඟවන්න; AI Chat එය නැවත විවෘත කරයි"),
    # no ta.js in the start page's locales: Tamil falls back to English
}
for code, (label, descr) in LOCALE.items():
    path = apps / "common" / "loginpage" / "locale" / f"{code}.js"
    text = path.read_text(encoding="utf-8")
    if "wsSettShowAiPanel:" in text:
        continue
    body = text.rstrip()
    if not body.endswith("}"):
        fail(f"{path} does not end with its table's closing brace")
    entries = f"    wsSettShowAiPanel: {label!r},\n    wsSettShowAiPanelDescr: {descr!r},\n"
    head = body[:-1].rstrip()
    if not head.endswith(","):
        head += ","
    path.write_text(head + "\n" + entries + "}\n", encoding="utf-8", newline="\n")
    print(f"patched {path}")
