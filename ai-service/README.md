# worksuite-ai: the WorkSuite Local AI service

One background service per user. It owns every local model, and WorkSuite apps call it over a versioned
localhost API. The contract is `docs/local-ai/spec.md` ("Local service API contracts"), and the additions this
implementation makes are in that file's "API notes" section.

```
apps (editor plugin asc.ws-ai, Settings › AI Models, AI agent panel, Mail/Chat/Meet later)
        │ HTTP + WS on 127.0.0.1:<random>, Bearer token from ~/.worksuite/ai/endpoint.json
        ▼
worksuite-ai (Node 22 SEA) ── router · auth/origin · jobs · events · policy · scheduler/LRU pool
        │                      dictionaries + @worksuite/sinhala-core (in-process, no model)
        ├── whisper-server (whisper.cpp)   speech: stream, transcribe, tinydiarize
        ├── llama-server (llama.cpp)       complete (ghost), check, transform, translate, assistant
        ├── piper                          read aloud
        └── ffmpeg                         mp3/m4a/mp4 → 16 kHz PCM, mp3/opus out
```

## Run it locally

```bash
cd ai-service
npm ci
npm test               # 79 tests; the engines are fake child processes (test/fixtures)
npm run typecheck
npm start              # builds dist/worksuite-ai.cjs and serves; prints {port, pid, endpoint}
npm run sea            # dist/<platform>/worksuite-ai[.exe], a single executable
```

`npm start` writes `~/.worksuite/ai/endpoint.json`. Try it:

```bash
EP=~/.worksuite/ai/endpoint.json
P=$(node -p "require('$EP').port"); T=$(node -p "require('$EP').token")
curl -s -H "Authorization: Bearer $T" localhost:$P/v1/info
curl -s -H "Authorization: Bearer $T" -d '{"text":"kohomadha","caret":9,"singlish":true}' localhost:$P/v1/text/complete
```

To try real engines without engine packages, point the service at your own builds:
`WS_AI_WHISPER_SERVER=/path/whisper-server WS_AI_LLAMA_SERVER=/path/llama-server WS_AI_PIPER=/path/piper
WS_AI_FFMPEG=/path/ffmpeg WS_AI_BACKEND=metal|cuda|vulkan|cpu`. The seed catalog is not signed yet, so to install
from it, set `WS_AI_DEV=1`. That accepts unsigned and unapproved entries and records the hashes it computes for
`"TODO"` ones.

| Variable | Use |
| --- | --- |
| `WS_AI_DATA_DIR` | data folder (default `<app data>/WorkSuite/ai`) |
| `WS_AI_ENDPOINT_FILE` | discovery file (default `~/.worksuite/ai/endpoint.json`) |
| `WS_AI_CATALOG_URL` | catalog (default `https://download.worksuitecloud.com/api/v1/ai/catalog`; policy `aiCatalogUrl` sets a mirror) |
| `WS_AI_TRUSTED_KEYS` | extra Ed25519 public keys (base64, comma-separated) |
| `WS_AI_DEV=1` | development: unsigned/unapproved catalog entries install |
| `WS_AI_POLICY_FILE` | a policy JSON file that replaces the OS's managed configuration |
| `WS_AI_IDLE_EXIT_MS` | idle exit (default 30 min) |
| `WS_AI_GHOST_TIMEOUT_MS` | ghost-text timeout (default 400) |

## Layout

`src/server.ts` holds the routes. Around it:

- `auth`, `http`, `jobs`, `events`, `requests`: the transport.
- `hardware`, `policy`, `catalog`, `signing`, `manifest`, `download`, `tar`, `models`: model management.
- `engines/`: process management and clients.
- `scheduler` and `runtime`: priority queues and the LRU pool.
- `speech/`, `text/`, `tts`, `sinhala/`, `pdf/`.

`catalog/catalog.json` is the built-in fallback catalog. `scripts/` holds the bundle, SEA, word-list and
catalog-signing scripts. `packaging/` holds the macOS entitlements and optional LaunchAgent/systemd templates.
Data lives in `<data>/models/<id>/<version>/{manifest.json, files}`, plus `engines/`, `cache/`, `dictionaries/`,
`recordings/` (only with *Keep recordings*) and `settings.json`.

## Endpoints: what is real and what is stubbed

| Area | Status |
| --- | --- |
| info, hardware, health, diagnostics | Real. GPUs come from nvidia-smi (CUDA), system_profiler (Metal on Apple silicon), Windows CIM/wmic (DirectML) and Vulkan loader presence. Profile: lite < 7.5 GB RAM ≤ standard; advanced from 16 GB on Apple silicon, or 16 GB with an 8 GB GPU. |
| catalog | Real: remote signed catalog → verified offline cache → built-in seed. `fits` and `approved` are computed for each entry. |
| models install / pause / resume / cancel / uninstall | Real: disk precheck, resumable Range download (a network drop pauses the job), sha256 for each file, Ed25519 manifest signature, staging then atomic move, default for its task if there was none. The engine package installs in the same job when the engine is missing. |
| activate / deactivate, scheduler | Real: the engine child process starts on first use. Speech runs before interactive text, which runs before batch work; one heavy job per device; LRU unload at 10 min idle or at the memory cap (policy `maxMemMB`, otherwise 70 % of RAM). |
| defaults, storage move, import/export `.wsmodel` | Real (`.wsmodel` = ustar of `manifest.json` + `files/…`). |
| events WS, jobs, request cancellation | Real. |
| speech stream | Real protocol. Segmentation is energy-based VAD: a final after 700 ms of silence or at 25 s, a partial about once a second (re-transcribing the open segment). Sinhala is gated by `speech.stt.si`. |
| speech transcribe | Real: WAV is decoded in-process, other formats through ffmpeg, in 30 s windows with partial events; 4 h limit. Diarization needs a `diarization` model (whisper.cpp tinydiarize): speakers are labelled by turn (S1/S2), not by voice identity. |
| text complete | Real: dictionary, personal and org words; Singlish through sinhala-core `candidates()`. Ghost text only from an LLM already in memory (a cold model starts loading and the reply carries no ghost), with a 400 ms timeout. |
| text check | Spelling is real (SCOWL English, Sinhala Tools list plus sinhala-core `validate`). Grammar and punctuation come from the LLM with a strict JSON-edits prompt; the service validates the offsets against the input, rejects malformed output and reports it in `skipped`. |
| text transform, translate | Real over llama-server prompts; `edits` are a word-level Myers diff. Translation uses the LLM; IndicTrans2/ONNX Runtime is **not implemented** (later). |
| detect-language | Script spans for si/ta/latin. Latin text that is not English by the dictionary is asked of the LLM, but only when the model is already loaded. |
| tts | Real over Piper, one process per sentence. Sentence timings are measured; word timings are estimated by length. mp3/opus go through ffmpeg. Sinhala voices are gated (MOS ≥ 3.5). |
| assistant | Real OpenAI-compatible proxy with streaming; `tools` is dropped (not in v1). |
| sinhala/*, dictionaries | Real, wrapping `@worksuite/sinhala-core` (si → Singlish is a small romaniser in `src/sinhala/romanize.ts`). The org dictionary is pulled from policy `orgDictionaryUrl` (https only) every 6 h and cached. |
| pdf/* | Real: merge, split, rotate, stamp (headers, footers, page and Bates numbers, watermarks), protect (AES-256 with permissions), unprotect and images to PDF as jobs on local files, through `@cantoo/pdf-lib` (MIT, pure JavaScript, about 1.2 MB of the bundle). Outputs never overwrite a file. The PDF editor's From images, Stamp and Protect buttons use it. Stamp text is Latin-only until a Sinhala/Tamil font is embedded. |
| policy, privacy | Real. Policy is re-read every 60 s and pushed as an event. |
| Cloud | The service never sends content anywhere. `allowCloud:true` is refused when policy turns cloud off; otherwise the work runs locally and the reply says `allowCloud:false`. Cloud stays the editor's existing providers. |

Stubbed or pending:

- **Signing key.** `src/signing.ts` `BUILTIN_KEYS` is empty until release engineering pins WorkSuite's model key. Until then, nothing verifies in production builds unless the key is supplied through `WS_AI_TRUSTED_KEYS`.
- **Seed hashes.** The seed catalog's sha256 values are `"TODO"` and its entries are `approved:false`, because huggingface.co was not reachable when the seed was written. The download URLs and engine-package tarballs (`download.worksuitecloud.com/ai/engines/…`) still have to be produced and published by the Update Center. Sizes are approximate.
- **Licences.** The licences of Qwen2.5-3B (Qwen Research) and the Piper voice dataset have to be confirmed before they are listed.

## Hardware checks still needed (no CI machine can do these)

- whisper-server / llama-server flag compatibility with the pinned engine versions (`/health`, `-ng`, `-ngl`, `-tdrz`, verbose_json fields `avg_logprob` and `speaker_turn_next`).
- W3 latency: partial text ≤ 1.5 s and final ≤ 3 s at the Standard profile. VAD thresholds (`TUNING` in `src/speech/stream.ts`) need tuning on real microphones.
- W5 latency: dictionary completion < 50 ms (about 1–5 ms measured here) and ghost text < 400 ms.
- Metal on Apple silicon, CUDA and Vulkan on Windows/Linux, DirectML detection, and the memory cap under real load.
- The macOS SEA under the hardened runtime and notarisation: the JIT entitlements, re-sealing the app, and Gatekeeper on first launch.
- The Windows ACL on endpoint.json (icacls) and Authenticode signing of the SEA.
- MDM profiles and GPO for the policy on all three OSes (W10).
- A 10-minute WAV offline (W4), and a 75 MB Whisper install surviving a restart (W1, covered by a test with fake files).

## Architecture decisions

**ADR-1: TypeScript on Node 22, shipped as a Node single executable (SEA).** The spec recommended Rust (or Go).
We chose Node so the service reuses `@worksuite/sinhala-core` (sinhala/core) directly, the same engine the plugin
bundles, for `/v1/sinhala/*` and dictionary suggestions, with no port to keep in step. It is also faster to build
with the team we have. There is one executable per platform (darwin-arm64, darwin-x64, win-x64, linux-x64), about
120 MB because it contains Node itself. The cost is a larger binary and a larger runtime than Rust; the heavy work
happens in the engines anyway.

**ADR-2: Engines run as child processes, not linked.** whisper.cpp `whisper-server` handles speech; llama.cpp
`llama-server` handles complete, check, transform, translate and assistant, and its OpenAI-compatible API is also
the assistant's upstream; Piper handles TTS. A crash or out-of-memory error in an engine cannot take the service
down, and backends (cpu/metal/cuda/vulkan) are swapped by choosing a binary. Each loaded model listens on its own
127.0.0.1 port.

**ADR-3: Engine binaries are signed engine packages, downloaded on demand.** Engines come from the catalog like
models, as one package per platform and backend, sha256-pinned and Ed25519-signed, and are unpacked under
`<data>/engines/`. The installer stays small, and GPU builds are fetched only where a GPU exists (this answers the
spec's open question about GPU builds per OS). ffmpeg (LGPL build) is an engine package too, and WAV needs no
ffmpeg.

**ADR-4: Signatures use Ed25519 from node:crypto over canonical JSON.** There is no extra dependency. Each model
manifest (without download URLs, so organisations can mirror the files) and the catalog document are signed;
signatures are checked at install, import and every load. Unsigned entries are refused unless `WS_AI_DEV=1`.

**ADR-5: Transport, auth and discovery follow the spec.** The service listens on 127.0.0.1 on a random port, with a
per-boot 256-bit token in `~/.worksuite/ai/endpoint.json` (0600, Windows ACL). Origins are allow-listed (app
schemes, `file://`, `null`); web origins are refused. The service is launched on demand, is single-instance
(a second launch reports the running one) and exits after 30 minutes idle.

**ADR-6: Small dependency set.** The server is node:http with `ws`, plus `busboy` for multipart; tar, the diff,
resampling and WAV are in-tree. esbuild bundles it, `postject` injects the SEA blob, vitest runs the tests.

**ADR-7: Deterministic first.** Spelling, Sinhala conversion, normalisation and validation are rule-based. Model
output is never trusted as-is: JSON edits are checked against the input text, and rewrites become diffs for
review. Sinhala STT, grammar and TTS stay off until a model's manifest carries a passing evaluation
(WER ≤ 0.25, ≥ 80 % correct, MOS ≥ 3.5).
