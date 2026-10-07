#!/usr/bin/env bash
# Sets the WorkSuite Office version everywhere it is written down: VERSION, VERSION.txt, the build and publish
# workflows, the Linux bake files, the Windows build script and the build README.
#
#   build/set-version.sh 9.3.3
#
# Then add the version's section to CHANGELOG.md and its notes to build/release-notes/<version>.md;
# build/check-version.sh tells what is still missing.
set -euo pipefail

version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 <major.minor.patch>" >&2; exit 1; }
cd "$(dirname "$0")/.."

printf '%s\n' "$version" > VERSION
printf '%s' "$version" > VERSION.txt   # read by build/linux/build.sh
sed -i -E "s/^  PRODUCT_VERSION: .*/  PRODUCT_VERSION: $version/" .github/workflows/build.yml .github/workflows/build-mac.yml
sed -i -E "/^      version:$/,/^        default:/ s/^        default: .*/        default: $version/" .github/workflows/publish.yml
sed -i -E "/^variable \"PRODUCT_VERSION\"/,/^\}/ s/default = \".*\"/default = \"$version\"/" build/docker-bake.hcl build/linux/docker-bake.hcl
sed -i -E "s/(\[string\]\\\$ProductVersion = ')[^']*'/\1$version'/" build/windows/build.ps1
sed -i -E "/^\| \`PRODUCT_VERSION\`/ s/\`[0-9][0-9.]*\`( *\|)\$/\`$version\`\1/" build/README.md

echo "Version $version. Add its CHANGELOG.md section and build/release-notes/$version.md, then run build/check-version.sh."
