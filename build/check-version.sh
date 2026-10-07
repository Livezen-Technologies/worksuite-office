#!/usr/bin/env bash
# Checks that every place the WorkSuite Office version is written down says what VERSION.txt says, and that
# the version has its CHANGELOG.md section (the first one) and release notes. build/set-version.sh sets it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

version="$(tr -d '[:space:]' < VERSION.txt)"
status=0
# No top-level file may be named "version" in any case: Windows' case-insensitive includes take it for
# the C++ <version> header and the Windows build fails ("version(1): error C2059").
if git ls-files | grep -qix 'version'; then
  echo "A top-level file named like 'version' breaks the Windows build; the version lives in VERSION.txt"
  status=1
fi
expect() { # what, found
  if [ "$2" != "$version" ]; then
    echo "$1 says '${2:-nothing}', VERSION.txt says '$version'"
    status=1
  fi
}

expect ".github/workflows/build.yml PRODUCT_VERSION" "$(sed -n -E 's/^  PRODUCT_VERSION: (.*)$/\1/p' .github/workflows/build.yml)"
expect ".github/workflows/build-mac.yml PRODUCT_VERSION" "$(sed -n -E 's/^  PRODUCT_VERSION: (.*)$/\1/p' .github/workflows/build-mac.yml)"
expect ".github/workflows/publish.yml default version" "$(sed -n -E '/^      version:$/,/^        default:/ s/^        default: (.*)$/\1/p' .github/workflows/publish.yml)"
for f in build/docker-bake.hcl build/linux/docker-bake.hcl; do
  expect "$f PRODUCT_VERSION" "$(sed -n -E '/^variable "PRODUCT_VERSION"/,/^\}/ s/^ *default = "(.*)"$/\1/p' "$f")"
done
expect "build/windows/build.ps1 ProductVersion" "$(sed -n -E "s/.*\[string\]\\\$ProductVersion = '([^']*)'.*/\1/p" build/windows/build.ps1)"
# shellcheck disable=SC2016  # the backticks are Markdown, not command substitution
expect "build/README.md PRODUCT_VERSION" "$(sed -n -E '/^\| `PRODUCT_VERSION`/ s/.*`([0-9][0-9.]*)` *\|$/\1/p' build/README.md)"
expect "CHANGELOG.md's first section" "$(sed -n -E 's/^## ([0-9][0-9.]*)$/\1/p' CHANGELOG.md | head -1)"
if [ ! -s "build/release-notes/$version.md" ]; then
  echo "build/release-notes/$version.md is missing: the notes the Update Center shows for $version"
  status=1
fi

[ "$status" -ne 0 ] || echo "Version $version everywhere, with its changelog and release notes."
exit "$status"
