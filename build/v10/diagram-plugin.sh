#!/usr/bin/env bash
# Adds the WorkSuite Diagram plugin (diagram-plugin/, #85: diagrams inside documents, spreadsheets and
# presentations as OLE objects) to a v10 build, before build_tools' make.py. Run from the folder holding build_tools/:
#   build/v10/diagram-plugin.sh <path to this repository>
# - assembles ./worksuite-diagram-plugin: the plugin, and the Diagram editor it embeds (build/apps)
# - has build_tools' desktop deploy copy it to editors/sdkjs-plugins/{guid}, next to the AI plugin
set -euo pipefail
repo="$1"

rm -rf worksuite-diagram-plugin
mkdir -p worksuite-diagram-plugin/apps
cp -R "$repo/diagram-plugin/." worksuite-diagram-plugin/
# the editor and what it imports: its model, the shared zip and licence modules, the XML reader .vsdx uses
for part in common diagram/core diagram/editor project/core; do
  mkdir -p "worksuite-diagram-plugin/apps/$part"
  cp -R "$repo/build/apps/$part/." "worksuite-diagram-plugin/apps/$part/"
done
[ -f worksuite-diagram-plugin/apps/diagram/editor/index.html ] || { echo "::error::the Diagram editor did not arrive"; exit 1; }

python - <<'PY'
import json
guid = json.load(open("worksuite-diagram-plugin/config.json", encoding="utf-8"))["guid"]
assert guid.startswith("asc.{"), guid
p = "build_tools/scripts/deploy_desktop.py"
s = open(p).read()
line = '    base.copy_dir(git_dir + "/worksuite-diagram-plugin", root_dir + "/editors/sdkjs-plugins/' + guid[4:] + '")\n'
if line not in s:
    old = '    base.copy_sdkjs_plugins(root_dir + "/editors/sdkjs-plugins", True, True, isWindowsXP)\n'
    assert old in s, "deploy_desktop.py plugins changed"
    s = s.replace(old, old + line, 1)
    open(p, "w").write(s)
PY
echo "WorkSuite Diagram: plugin in worksuite-diagram-plugin ($(find worksuite-diagram-plugin -type f | wc -l | tr -d ' ') files)"
