#!/usr/bin/env bash
# Runs the WorkSuite start-page tests of a desktop-apps checkout (NFR-18, G-12):
#   build/test-desktop-apps.sh <desktop-apps checkout>
# - with an "npm test" script in common/loginpage/package.json (the 10.x Vite start page): npm ci/install, npm test
# - otherwise each common/loginpage/test/*.test.js on its own with node and jsdom 24 (the 9.3 start page:
#   worksuite-broker, worksuite-flow and worksuite-ui)
# A checkout with neither gets a warning, not a failure, so an older pin still passes.
set -euo pipefail
lp="$1/common/loginpage"
[ -d "$lp" ] || { echo "::error::no common/loginpage in $1"; exit 1; }
cd "$lp"

if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.test ? 0 : 1)'; then
  npm config set legacy-peer-deps true
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  npm test
  exit 0
fi

shopt -s nullglob
tests=(test/*.test.js)
if [ "${#tests[@]}" -eq 0 ]; then
  echo "::warning::$(git -C "$1" rev-parse --short HEAD 2>/dev/null || echo "$1"): no WorkSuite start-page tests (no npm test script, no test/*.test.js)"
  exit 0
fi
# the 9.3 tests have no package.json of their own: jsdom only, kept out of any package.json
npm install --no-save --no-package-lock --no-audit --no-fund jsdom@24
failed=()
for t in "${tests[@]}"; do
  echo "::group::$t"
  if node "$t"; then echo "ok $t"; else failed+=("$t"); fi
  echo "::endgroup::"
done
[ "${#failed[@]}" -eq 0 ] || { echo "::error::failed: ${failed[*]}"; exit 1; }
echo "${#tests[@]} test files passed"
