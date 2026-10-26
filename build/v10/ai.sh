#!/usr/bin/env bash
# Adds WorkSuite Local AI (ai-plugin/, the asc.ws-ai editor plugin for the local worksuite-ai service) to a
# v10 build, before build_tools' make.py. Run from the folder holding build_tools/:
#   build/v10/ai.sh <path to this repository>
# - builds the plugin into ./worksuite-ai-plugin (no dependencies: its icons are committed PNGs)
# - has build_tools' desktop deploy copy it to editors/sdkjs-plugins/{guid}, next to Sinhala Tools
set -euo pipefail
repo="$1"

( cd "$repo/ai-plugin" && npm run build:plugin )
rm -rf worksuite-ai-plugin
cp -R "$repo/ai-plugin/plugin/dist" worksuite-ai-plugin

python - <<'PY'
import json
guid = json.load(open("worksuite-ai-plugin/config.json", encoding="utf-8"))["guid"]
assert guid.startswith("asc.{"), guid
p = "build_tools/scripts/deploy_desktop.py"
s = open(p).read()
line = '    base.copy_dir(git_dir + "/worksuite-ai-plugin", root_dir + "/editors/sdkjs-plugins/' + guid[4:] + '")\n'
if line not in s:
    old = '    base.copy_sdkjs_plugins(root_dir + "/editors/sdkjs-plugins", True, True, isWindowsXP)\n'
    assert old in s, "deploy_desktop.py plugins changed"
    s = s.replace(old, old + line, 1)
    open(p, "w").write(s)
PY
echo "WorkSuite Local AI: plugin in worksuite-ai-plugin"
