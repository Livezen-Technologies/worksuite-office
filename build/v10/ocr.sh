#!/usr/bin/env bash
# Adds the PDF Editor's "Recognise text" (OCR) engine to a v10 build, before build_tools' make.py. Run from
# the folder holding build_tools/:
#   build/v10/ocr.sh <path to this repository>
# - fetches tesseract.js, its WebAssembly core and the English, Sinhala and Tamil models (tessdata_fast),
#   all pinned and sha256-checked, into ./worksuite-ocr
# - has build_tools' desktop deploy copy it to editors/ocr, next to editors/web-apps, where the Convert
#   tab (build/editors/.../ConvertTab.js) loads it from. Everything runs on the computer; nothing is fetched
#   when the app runs.
set -euo pipefail
repo="$1"
out="$PWD/worksuite-ocr"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() { # url sha256 file
  curl -fsSL --retry 3 -o "$tmp/$3" "$1"
  # sha256sum on Linux and Windows' Git Bash, shasum on macOS
  local got
  if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$3" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$tmp/$3" | cut -d' ' -f1)"; fi
  [ "$got" = "$2" ] || { echo "ocr.sh: $1 does not match its sha256 ($got)" >&2; exit 1; }
}
fetch https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz \
  4a208f2560a527ea9fc339ba2fdf125c13bca6638c194a149379601a1418d0ed tesseract.js.tgz
fetch https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz \
  197b53b6bc42b7270c99b079e438992096d71a2b9b8237c6349491bd22fbd5a0 tesseract.js-core.tgz
fetch https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata \
  7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 eng.traineddata
fetch https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/sin.traineddata \
  bc75c6df2375a30c9f7e759fa7d4b58ae3ecf9ce72668a702d01acb13e551422 sin.traineddata
fetch https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/tam.traineddata \
  d02fbec24be4b07e32e80d0ccfc3b6b67a3c5d61c9d0a7c8532677990912c6ec tam.traineddata

rm -rf "$out"
mkdir -p "$out/core" "$out/lang" "$tmp/js" "$tmp/core"
tar -xzf "$tmp/tesseract.js.tgz" -C "$tmp/js"
tar -xzf "$tmp/tesseract.js-core.tgz" -C "$tmp/core"
cp "$tmp/js/package/dist/tesseract.min.js" "$tmp/js/package/dist/worker.min.js" "$out/"
cp "$tmp/js/package/LICENSE.md" "$out/LICENSE-tesseract.js.md"
cp "$tmp/core/package/LICENSE" "$out/LICENSE-tesseract.js-core"
# LSTM only (the models are tessdata_fast), with and without SIMD; the wasm is inside the .wasm.js
cp "$tmp/core/package/tesseract-core-lstm.wasm.js" "$tmp/core/package/tesseract-core-simd-lstm.wasm.js" "$out/core/"
cp "$tmp"/{eng,sin,tam}.traineddata "$out/lang/"
cp "$repo/build/ocr/worker.js" "$out/worker.js"

python - <<'PY'
p = "build_tools/scripts/deploy_desktop.py"
s = open(p).read()
old = '    base.copy_sdkjs_plugins(root_dir + "/editors/sdkjs-plugins", True, True, isWindowsXP)\n'
assert old in s, "deploy_desktop.py plugins changed"
new = '    base.copy_dir(git_dir + "/worksuite-ocr", root_dir + "/editors/ocr")\n'
if new not in s:
    s = s.replace(old, old + new, 1)
open(p, "w").write(s)
PY
echo "OCR: engine and models in worksuite-ocr:"
find "$out" -type f -print
