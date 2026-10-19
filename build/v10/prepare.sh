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
# build_tools 9.4 builds x265 into heif/x265_git; v10's heif.pri links it from heif/x265
ln -sfn x265_git core/Common/3dParty/heif/x265

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
PY
