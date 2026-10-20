#!/usr/bin/env bash
# Adds Sinhala Tools (sinhala/) to a v10 build, before build_tools' make.py. Run from the folder holding
# build_tools/ and core-fonts/:
#   build/v10/sinhala.sh <path to this repository>
# - builds the worksuite-sinhala-tools plugin into ./worksuite-sinhala-tools
# - fetches Noto Sans Sinhala and Noto Serif Sinhala (pinned, sha256-checked) into core-fonts/worksuite-sinhala
# - has build_tools' desktop deploy copy both: the plugin to editors/sdkjs-plugins/{guid}, the fonts to
#   fonts/worksuite-sinhala, which allfontsgen then reads with the other fonts
# Legacy fonts (FM, DL, Kaputa) are never shipped: the converter only needs their maps.
set -euo pipefail
repo="$1"

( cd "$repo/sinhala" && npm ci --no-audit --no-fund && npm run build:plugin )
rm -rf worksuite-sinhala-tools
cp -R "$repo/sinhala/plugin/dist" worksuite-sinhala-tools

rm -rf core-fonts/worksuite-sinhala
python "$repo/sinhala/fonts/fetch-fonts.py" core-fonts/worksuite-sinhala

python - <<'PY'
import json
guid = json.load(open("worksuite-sinhala-tools/config.json", encoding="utf-8"))["guid"]
assert guid.startswith("asc.{"), guid
p = "build_tools/scripts/deploy_desktop.py"
s = open(p).read()
old = '    base.copy_file(git_dir + "/core-fonts/ASC.ttf",    root_dir + "/fonts/ASC.ttf")\n'
assert old in s, "deploy_desktop.py fonts changed"
s = s.replace(old, old + '    base.copy_dir(git_dir + "/core-fonts/worksuite-sinhala", root_dir + "/fonts/worksuite-sinhala")\n', 1)
old = '    base.copy_sdkjs_plugins(root_dir + "/editors/sdkjs-plugins", True, True, isWindowsXP)\n'
assert old in s, "deploy_desktop.py plugins changed"
s = s.replace(old, old + '    base.copy_dir(git_dir + "/worksuite-sinhala-tools", root_dir + "/editors/sdkjs-plugins/' + guid[4:] + '")\n', 1)
open(p, "w").write(s)
PY
echo "Sinhala Tools: plugin in worksuite-sinhala-tools, fonts:"
find core-fonts/worksuite-sinhala -type f -print
