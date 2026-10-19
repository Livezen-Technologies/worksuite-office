#!/usr/bin/env bash
# Prepares a checkout of ONLYOFFICE 10 sources (core, sdkjs, web-apps, ...) and our desktop-apps for
# ONLYOFFICE's public build_tools, which stops at 9.4. Run from the folder holding build_tools/, core/, ...
#   build/v10/prepare.sh <path to this repository>
set -euo pipefail
repo="$1"

# WorkSuite's changes to the editors
python "$repo/build/patch-editor-menu.py" web-apps
python "$repo/build/patch-pdf-convert.py" web-apps

# The v10 start page is built with Vite (build_tools 9.4 only knows Grunt)
( cd desktop-apps/common/loginpage
  npm config set legacy-peer-deps true
  for d in addondialog noconnect .; do (cd "$d" && npm install --no-audit --no-fund && npm run build); done )

# v10 core fetches libxml2 itself; build_tools 9.4 does not call it
( cd core/Common/3dParty/libxml && python fetch.py && test -f libxml2/HTMLparser.c )

python - <<'PY'
p = "build_tools/scripts/core_common/make_common.py"
s = open(p).read()
old = "    websocket_all.make()\n  return"
assert old in s, "make_common.py changed"
# v10's desktop core uses socket.io's asio (WebSocket/localipc); 9.4 fetches it for mobile only
s = s.replace(old, "    websocket_all.make()\n  if not config.check_option(\"module\", \"mobile\"):\n    websocket_all.make()\n  return")
open(p, "w").write(s)
p = "build_tools/scripts/build_js.py"
s = open(p).read()
old = '    build_interface(base_dir + "/../desktop-apps/common/loginpage/build")\n'
assert old in s, "build_js.py changed"
open(p, "w").write(s.replace(old, ""))
# build_tools 9.4 builds x265 into heif/x265_git; v10's heif.pri links it from heif/x265
# (patched here rather than symlinked: Git Bash on Windows copies instead of linking)
p = "core/Common/3dParty/heif/heif.pri"
s = open(p).read()
assert "$$PWD/x265/build" in s, "heif.pri changed"
open(p, "w").write(s.replace("$$PWD/x265/build", "$$PWD/x265_git/build"))
# V8 (Linux/Windows) is built with depot_tools cloned at its moving HEAD, which build_tools 9.4's
# bootstrap edits no longer fit ("no pinned SHA256 ... in the *.digests file"): pin depot_tools to
# its state when build_tools 9.4 was current
p = "build_tools/scripts/core_common/modules/v8_89.py"
s = open(p).read()
old = '    base.cmd("git", ["clone", "https://chromium.googlesource.com/chromium/tools/depot_tools.git"])\n'
assert old in s, "v8_89.py changed"
pin = '    base.cmd_in_dir("depot_tools", "git", ["checkout", "-q", base.run_command("git -C depot_tools rev-list -1 --before=2026-05-20 HEAD")["stdout"].strip()])\n'
# on Windows depot_tools runs git.bat, which its own bootstrap makes; with DEPOT_TOOLS_UPDATE=0 that never runs
gitbat = '    if "windows" == base.host_platform():\n      base.writeFile("depot_tools/git.bat", "@\\"" + base.run_command("where git")["stdout"].splitlines()[0].strip() + "\\" %*\\n")\n'
s = s.replace(old, old + pin + gitbat, 1)
open(p, "w").write(s)
PY
