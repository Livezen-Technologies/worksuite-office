#!/usr/bin/env bash
# Builds worksuite-ai (ai-service/, the Local AI service) as a single executable for this runner's
# platform and puts it next to the app:
#   build/v10/ai-service.sh <path to this repository> <app folder>
# - macOS: <app folder> = WorkSuite Office.app/Contents/MacOS (the workflow signs it after)
# - Windows: the DesktopEditors folder (the install dir); Linux: desktopeditors (packaged to /opt/…)
# Needs Node 22 or newer (Node SEA). Runs the service's tests first; any failure stops the build.
set -euo pipefail
repo="$1"
dest="$2"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "::error::worksuite-ai needs Node 22+, this is $(node -v)"; exit 1; }
[ -d "$dest" ] || { echo "::error::app folder $dest does not exist"; exit 1; }
cd "$repo/ai-service"
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run sea
case "$(uname -s)" in
  Darwin) plat="darwin-$(uname -m | sed 's/x86_64/x64/')"; exe=worksuite-ai ;;
  MINGW*|MSYS*|CYGWIN*) plat="win-x64"; exe=worksuite-ai.exe ;;
  *) plat="linux-x64"; exe=worksuite-ai ;;
esac
bin="dist/$plat/$exe"
[ -x "$bin" ] || [ -f "$bin" ] || { echo "::error::worksuite-ai was not built ($bin)"; exit 1; }
"$bin" --version
cp -fv "$bin" "$dest/$exe"
chmod 755 "$dest/$exe"
"$dest/$exe" --version | grep -q '^worksuite-ai ' || { echo "::error::$dest/$exe does not run"; exit 1; }
echo "worksuite-ai: $dest/$exe"
