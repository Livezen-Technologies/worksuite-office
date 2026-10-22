#!/usr/bin/env bash
# Tests WorkSuite's editor patches against the upstream sources every 10.x platform builds (NFR-19, G-13).
#   build/v10/check-patches.sh [work dir]
# All three 10.x builds take ONLYOFFICE's sources at one OO_TAG. Windows and Linux apply the patches through
# build/v10/prepare.sh; macOS lists them in build-mac.yml. This script
#   1. checks the three workflows name the same OO_TAG (one upstream, not three),
#   2. checks build-mac.yml applies the same build/patch-*.py scripts to the same repositories as prepare.sh,
#   3. clones each patched repository at OO_TAG and applies every patch to it, as the builds do.
# Each patch stops with an error when the upstream text it expects has gone, so a drifted patch fails here
# instead of hours into a build. The patches change only platform-independent sources (web-apps, sdkjs, ...),
# so one checkout at OO_TAG is what all three platforms patch.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="${1:-$(mktemp -d)}"
wf="$repo/.github/workflows"
fail() { echo "::error::$*"; exit 1; }

tag() { sed -n 's/^  OO_TAG: *//p' "$1" | head -1; }
oo_tag="$(tag "$wf/build-mac.yml")"
[ -n "$oo_tag" ] || fail "no OO_TAG in build-mac.yml"
for f in build-linux-v10.yml build-windows-v10.yml; do
  [ "$(tag "$wf/$f")" = "$oo_tag" ] || fail "$f builds ONLYOFFICE $(tag "$wf/$f"), build-mac.yml $oo_tag: the 10.x platforms must share one upstream tag"
done
echo "All 10.x builds: ONLYOFFICE $oo_tag"

# "patch-x.py <repository> [<repository> ...]" for each patch call; each repository is the last path part
calls() { grep -oE 'build/patch-[A-Za-z0-9_-]+\.py"?( +[^ ;)&|]+)+' "$1" | sed -E 's#^build/##; s#"##g; s# +# #g; s# [^ ]*/# #g' | sort -u; }
win_linux="$(calls "$repo/build/v10/prepare.sh")"
mac="$(calls "$wf/build-mac.yml")"
[ -n "$win_linux" ] || fail "prepare.sh applies no build/patch-*.py"
if [ "$win_linux" != "$mac" ]; then
  diff <(echo "$win_linux") <(echo "$mac") | sed 's/^/  /' || true
  fail "build-mac.yml and build/v10/prepare.sh apply different patches (< prepare.sh, > build-mac.yml)"
fi
echo "Patches on every 10.x platform:"; echo "$win_linux" | sed 's/^/  /'
# a patch script nobody calls is a patch no platform gets
for p in "$repo"/build/patch-*.py; do
  n="$(basename "$p")"
  [ "$n" = patch-upstream.py ] && continue # the 9.3 (Euro-Office) build's own fixes, build.yml
  grep -q "^$n " <<<"$win_linux" || echo "::warning::$n is not applied by the 10.x builds"
done

mkdir -p "$work"
# desktop-apps is WorkSuite's fork at the commit the builds pin (one ref for all three: checked below);
# everything else is ONLYOFFICE's at OO_TAG
da_ref="$(sed -n 's/^  DESKTOP_APPS_REF: *//p' "$wf/build-mac.yml" | head -1)"
for f in build-linux-v10.yml build-windows-v10.yml; do
  [ "$(sed -n 's/^  DESKTOP_APPS_REF: *//p' "$wf/$f" | head -1)" = "$da_ref" ] || echo "::warning::$f pins desktop-apps $(sed -n 's/^  DESKTOP_APPS_REF: *//p' "$wf/$f" | head -1), build-mac.yml $da_ref"
done
for r in $(cut -d' ' -f2- <<<"$win_linux" | tr ' ' '\n' | sort -u); do
  [ -d "$work/$r" ] && continue
  if [ "$r" = desktop-apps ]; then
    git clone -q https://github.com/Livezen-Technologies/worksuite-office-desktop-apps.git "$work/$r"
    git -C "$work/$r" fetch -q origin "$da_ref" && git -C "$work/$r" checkout -q --detach "$da_ref"
  else
    git clone -q --depth 1 -b "$oo_tag" "https://github.com/ONLYOFFICE/$r.git" "$work/$r"
  fi
done
while read -r script rs; do
  echo "::group::$script $rs ($oo_tag)"
  args=(); for r in $rs; do args+=("$work/$r"); done
  python3 "$repo/build/$script" "${args[@]}"
  echo "::endgroup::"
done <<<"$win_linux"
echo "Every patch applies to ONLYOFFICE $oo_tag"
