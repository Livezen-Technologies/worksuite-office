#!/usr/bin/env bash
# WorkSuite Project and WorkSuite Diagram (build/apps, #72): their web apps into <app folder>/apps, where the
# desktop shell opens them ("worksuite:open-app": <app dir>/apps on Windows and Linux, Contents/Resources/apps
# in the macOS bundle).
#   build/v10/apps.sh <path to this repository> <app folder>
set -euo pipefail
repo="$1"
dest="$2"
[ -d "$dest" ] || { echo "::error::app folder $dest does not exist"; exit 1; }
src="$repo/build/apps"
rm -rf "$dest/apps"
mkdir -p "$dest/apps"
for part in common project/core project/editor diagram/core diagram/editor; do
  [ -d "$src/$part" ] || { echo "::error::build/apps/$part is missing"; exit 1; }
  mkdir -p "$dest/apps/$part"
  cp -R "$src/$part/." "$dest/apps/$part/"
done
for app in project diagram; do
  [ -f "$dest/apps/$app/editor/index.html" ] || { echo "::error::$app/editor/index.html did not arrive"; exit 1; }
done
find "$dest/apps" -type f | sort | sed "s|^$dest/||"
echo "WorkSuite Project and Diagram: $(find "$dest/apps" -type f | wc -l | tr -d ' ') files in $dest/apps"
