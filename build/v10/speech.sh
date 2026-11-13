#!/usr/bin/env bash
# Sinhala voice typing, shipped with the app: puts whisper.cpp's whisper-server and the Sinhala speech model
# in <app folder>/speech, next to worksuite-ai (ai-service/src/bundled.ts finds them there). No catalog or
# download at run time.
#   build/v10/speech.sh <path to this repository> <app folder>
# The app folder is the one build/v10/ai-service.sh puts worksuite-ai in.
# - whisper-server: whisper.cpp at a pinned tag (MIT), built for the CPU with no -march=native, so it runs
#   on any x64/arm64 computer, statically linked to ggml.
# - the model: Whisper Small fine-tuned for Sinhala, at a pinned Hugging Face revision (Apache-2.0),
#   converted with whisper.cpp's convert-h5-to-ggml.py and quantised to q5_1. The conversion is
#   deterministic; the result must have the SHA-256 compiled into worksuite-ai (BUNDLED_STT), or the build
#   stops. Needs Python 3 and network access to github.com, huggingface.co and download.pytorch.org.
set -euo pipefail
repo="$1"
dest="$2"
WHISPER_TAG=v1.8.2
MODEL_REPO=seniruk/whisper-small-si
MODEL_REV=fbd37479362cfd32fd99709a8757bb8bad2bd5ed
OPENAI_WHISPER_REV=86098128c0b4f24f0e2aa2994de830614b474227   # mel_filters.npz for the converter
# PyTorch for the converter. Intel macOS has no torch wheel past 2.2.2 (and that one needs numpy 1), so it
# converts with 2.2.2: the result is byte-for-byte the same model (checked against the SHA-256 below;
# reproduced with both versions on Linux). WS_SPEECH_MODEL_URL, when set, fetches a prebuilt model instead.
TORCH=2.5.1; NUMPY=numpy
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "x86_64" ]; then TORCH=2.2.2; NUMPY="numpy<2"; fi
[ -d "$dest" ] || { echo "::error::app folder $dest does not exist"; exit 1; }

expected_sha="$(sed -n 's/.*path: "ggml-small-si-q5_1.bin", size: \([0-9]*\), sha256: "\([0-9a-f]*\)".*/\2/p' "$repo/ai-service/src/bundled.ts")"
expected_size="$(sed -n 's/.*path: "ggml-small-si-q5_1.bin", size: \([0-9]*\), sha256: "\([0-9a-f]*\)".*/\1/p' "$repo/ai-service/src/bundled.ts")"
[ ${#expected_sha} -eq 64 ] || { echo "::error::no SHA-256 for the Sinhala model in ai-service/src/bundled.ts"; exit 1; }

work="${RUNNER_TEMP:-$(mktemp -d)}/ws-speech"
mkdir -p "$work" "$dest/speech"
cd "$work"

# 1. whisper-server
[ -d whisper.cpp ] || git clone -q --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp.git
cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DGGML_METAL=OFF >/dev/null
cmake --build whisper.cpp/build --config Release -j 4 --target whisper-server quantize
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=.exe ;; *) exe= ;; esac
srv="$(find whisper.cpp/build -type f -name "whisper-server$exe" | head -1)"
quant="$(find whisper.cpp/build -type f -name "quantize$exe" -o -type f -name "whisper-quantize$exe" | head -1)"
[ -n "$srv" ] && [ -n "$quant" ] || { echo "::error::whisper-server or quantize was not built"; exit 1; }
cp "$srv" "$dest/speech/whisper-server$exe"
cp whisper.cpp/LICENSE "$dest/speech/LICENSE-whisper.cpp.txt"

# 2. the Sinhala model (q5_1, checked against the SHA-256 compiled into worksuite-ai), converted from the
#    Hugging Face model with PyTorch ($TORCH), or fetched prebuilt from WS_SPEECH_MODEL_URL when that is set.
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mkdir -p ggml
if [ -n "${WS_SPEECH_MODEL_URL:-}" ]; then
  echo "fetching the prebuilt Sinhala model from $WS_SPEECH_MODEL_URL"
  curl -fsSL --retry 3 -o ggml/ggml-small-si-q5_1.bin "$WS_SPEECH_MODEL_URL"
else
  python=python3; command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1 || python=python
  "$python" -m venv venv
  if [ -x venv/bin/python ]; then py=venv/bin/python; else py=venv/Scripts/python.exe; fi
  # a current pip first: the pip a new venv brings (23.0 with Python 3.10) finds no usable wheel of
  # torch's dependencies on the PyTorch index ("No matching distribution found for typing-extensions",
  # Linux run 59) and, without --only-binary, built them from source and failed (flit_core, run 57)
  "$py" -m pip install -q --upgrade pip==26.3
  # wheels only: nothing is built from source, no build scripts run
  "$py" -m pip install -q --only-binary=:all: --index-url https://download.pytorch.org/whl/cpu "torch==$TORCH"
  "$py" -m pip install -q --only-binary=:all: transformers==4.46.3 "$NUMPY" huggingface_hub==0.26.2
  [ -d openai-whisper ] || { git clone -q https://github.com/openai/whisper.git openai-whisper && git -C openai-whisper checkout -q "$OPENAI_WHISPER_REV"; }
  "$py" - "$MODEL_REPO" "$MODEL_REV" hf <<'EOF'
import sys
from huggingface_hub import snapshot_download
snapshot_download(sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3],
                  allow_patterns=["*.json", "*.txt", "model.safetensors"])
EOF
  "$py" whisper.cpp/models/convert-h5-to-ggml.py hf openai-whisper ggml
  "$quant" ggml/ggml-model.bin ggml/ggml-small-si-q5_1.bin q5_1 >/dev/null
fi
got="$(sha256 ggml/ggml-small-si-q5_1.bin)"
size="$(wc -c < ggml/ggml-small-si-q5_1.bin | tr -d ' ')"
if [ "$got" != "$expected_sha" ] || [ "$size" != "$expected_size" ]; then
  echo "::error::the Sinhala model is $got ($size bytes), worksuite-ai expects $expected_sha ($expected_size)"; exit 1
fi
cp ggml/ggml-small-si-q5_1.bin "$dest/speech/"
cp hf/README.md "$dest/speech/README-model.md" 2>/dev/null || true
printf 'Sinhala speech model: %s (revision %s), Apache-2.0. Converted to ggml q5_1 by WorkSuite.\n' "$MODEL_REPO" "$MODEL_REV" > "$dest/speech/NOTICE.txt"

# 3. a smoke test: the server starts with the model and answers /health
port=18765
"$dest/speech/whisper-server$exe" -m "$dest/speech/ggml-small-si-q5_1.bin" --host 127.0.0.1 --port "$port" -ng -t 2 >"$work/server.log" 2>&1 &
pid=$!
ok=
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
kill "$pid" 2>/dev/null || true
[ -n "$ok" ] || { echo "::error::whisper-server did not start with the Sinhala model"; tail -20 "$work/server.log"; exit 1; }
ls -la "$dest/speech"
echo "Sinhala voice typing: whisper-server $WHISPER_TAG and $MODEL_REPO@$MODEL_REV in $dest/speech"
