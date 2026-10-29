# WorkSuite Office – Local AI Language Engine: Workflows & Service API

Oct 25, 2026 · @Hasarinda

## Scope and ground rules

This spec turns the Local AI blueprint into buildable work: one local service, `worksuite-ai`, that every WorkSuite app calls over a versioned localhost API, plus the user workflows it must support. The blueprint's feature list stands; this adds how each flow behaves and the exact contracts.

- **Offline-first.** Every feature marked *core* works with no network once its model is installed. Cloud AI is an explicit, per-request opt-in and can be switched off by policy.
- **Nothing is replaced without review.** Corrections, rewrites and translations come back as proposals; the editor applies them only after Accept, as one undo step.
- **Deterministic first, model second.** Sinhala normalization, transliteration, legacy-font conversion, validation and dictionary spelling stay rule-based (the existing `@worksuite/sinhala-core`). Models add ranking, grammar and generation on top.
- **Evaluation gates.** Sinhala speech-to-text, Sinhala grammar/rewrite and Sinhala text-to-speech ship behind a capability flag that turns on only when a model passes the acceptance set for that task (see Delivery plan). Until then the UI says the feature is unavailable for Sinhala rather than producing poor output.
- **One engine, many apps.** Office is the first client. Mail, Chat, Meet and Drive use the same API; nothing in the service is Office-specific.

**Builds on what exists:** the Sinhala Tools plugin (Singlish input, word suggestions, Unicode/legacy conversion, validation), the AI agent panel and AI ribbon (today cloud providers such as WorkSuite AI's OpenAI-compatible endpoint), and the start page Settings. The service becomes one more provider for the AI agent (OpenAI-compatible endpoint on localhost), so existing AI ribbon commands work against local models with no editor changes.

## Functional user workflows

Each workflow lists its steps, the states the UI shows, the failures it must handle and how it is accepted. API calls named here are defined in the API section.

### W1. Install a model (Settings › AI Models)

1. User opens **Settings › AI Models**. The page calls `GET /v1/hardware` and `GET /v1/catalog` and shows a recommended profile (Lite, Standard or Advanced) for this computer.
2. User picks a model card (name, version, languages, tasks, download size, RAM needed, *Fits this computer* / *Too large* badge) and clicks **Install**.
3. `POST /v1/models/{id}/install` returns a job; progress streams over `/v1/events` (downloading %, verifying, unpacking, ready).
4. On *ready*, the model appears under **Installed** and, if no default exists for its task, becomes the default.

- **States:** Available · Downloading (pause, resume, cancel) · Verifying · Installed · Active (loaded in memory) · Update available · Failed.
- **Failures:** not enough disk → blocked before download with the space needed; checksum or signature mismatch → file deleted, *Failed: integrity check* with Retry; network lost → paused, resumes from the last byte; blocked by policy → card shows *Not approved by your organization*.
- **Accept when:** a 75 MB Whisper model installs, survives an app restart, and uninstall frees its disk space.

### W2. Choose default models and storage

1. **Settings › AI Models › Defaults** shows one picker per task: Speech to text, Correction, Suggestions, Translation, Read aloud, Assistant.
2. Each picker lists installed models that declare that task, plus *Automatic* (service picks by hardware) and, if allowed, *Cloud*.
3. **Storage** shows the folder, used space and a **Move** action (`POST /v1/storage/move`, a job with progress).
4. **Import / Export** takes or produces a `.wsmodel` package (model files + signed manifest) for offline machines.

### W3. Voice typing in a document

1. User clicks **Voice typing** (Home, Sinhala Tools or AI ribbon) or presses Ctrl+Shift+V (Cmd+Shift+V on macOS).
2. First use: the OS microphone permission prompt, then a WorkSuite consent note that audio stays on this computer.
3. A small dock appears at the cursor: language (Auto, Sinhala, English), level meter, Pause, Stop.
4. The editor opens `WS /v1/speech/stream`; partial text shows greyed at the cursor and is replaced by final text per segment.
5. **Stop** commits the text as one undo step. **Esc** discards everything not yet committed.

- **States:** Starting (model loading) · Listening · Paused · Processing tail · Done · Error.
- **Failures:** no speech model → dock offers **Install Whisper small** (W1); mic denied → link to OS settings; model too slow (real-time factor > 1) → switch to *record then transcribe* with a notice; Sinhala gated off → language list shows Sinhala as *Not available yet*.
- **Accept when:** English dictation at the Standard profile shows partial text within 1.5 s and final text within 3 s of a pause.

### W4. Transcribe an audio or video file

1. **AI › Transcribe file** → pick MP3, WAV, M4A or MP4.
2. Options: language, punctuation on/off, timestamps, speaker labels (only if a diarization model is installed).
3. `POST /v1/speech/transcribe` returns a job; progress and partial segments stream.
4. A review pane shows segments with time and speaker; user edits, then **Insert** (as text, or a two-column table of time · text).

- **Accept when:** a 10-minute English WAV transcribes offline and inserts with timestamps.

### W5. Inline suggestions while typing

1. While the user types, the editor plugin debounces 150 ms after a keystroke and sends the paragraph text and caret offset to `POST /v1/text/complete`.
2. Word completions appear in the existing Sinhala Tools list; a next-phrase suggestion appears as grey ghost text.
3. **Tab** accepts, **Esc** dismisses, typing on ignores it. Accepted words feed the personal dictionary only if learning is on.

- **Rules:** never blocks typing (requests are cancelled when the next key arrives); off in password fields, tables of numbers and when the document language is unknown; respects *Suggestions: off* per user and per policy.
- **Accept when:** dictionary completions return in under 50 ms and model ghost text in under 400 ms on the Standard profile.

### W6. Review corrections and rewrites

1. User selects text (or nothing = current paragraph) and chooses an AI ribbon command: Correct spelling, Correct grammar, Improve, Rewrite, Simplify, Formal, Professional, Expand, Shorten, Summarize, Translate, Explain, Change tone, Correct punctuation, Detect language, Validate Sinhala.
2. `POST /v1/text/transform` (or `/v1/text/check` for spelling/grammar) returns a list of edits with offsets and reasons.
3. A review panel shows original and suggested side by side with each change marked. Buttons: **Accept**, **Reject**, **Accept all**, **Undo**.
4. Accepted edits are applied through the editor (see Editor integration), keeping formatting, as one undo step per Accept / Accept all. With Track Changes on, they land as tracked changes.

- **Failures:** selection changed while waiting → result discarded with *Text changed, run again*; model unavailable → falls back to dictionary spelling for Correct spelling, other commands disabled with the reason.

### W7. Sinhala conversion and validation

Unicode → legacy, legacy → Unicode, Singlish ↔ Sinhala, normalization and validation run in `/v1/sinhala/*` with the same engine the plugin bundles, so they work even if the service is not installed. Convert to legacy opens the dialog with font picker and live preview; both directions apply the target font and are one undo step.

### W8. Read aloud

1. **Review › Read aloud** (selection or whole document).
2. Player bar: play/pause, speed 0.5–2×, voice, volume, **Export audio**.
3. `POST /v1/tts/synthesize` streams audio chunks with word or sentence timings; the editor highlights the current sentence when timings exist.

- Sinhala voices appear only when a validated Sinhala voice model is installed.

### W9. Assistant panel with local models

1. In the AI agent panel, the model picker lists **Local · \<model>** entries from `GET /v1/models?task=assistant` next to cloud providers.
2. Chat goes to the OpenAI-compatible `POST /v1/openai/chat/completions`, streaming. Document context (selection, current section, or whole document within the context limit) is attached by the panel.
3. **Insert** puts the answer at the cursor; tables in the answer insert as tables.

### W10. Organization policy

1. Admin sets policy in the WorkSuite Admin Center (or MDM): AI on/off per feature, approved model IDs, cloud allowed, max memory, GPU allowed, shared dictionary URL.
2. WorkSuite Desktop delivers the policy; the service reads it from the managed-configuration location and exposes it at `GET /v1/policy`.
3. Disallowed actions are hidden or locked with *Managed by your organization*.

## Local service architecture

One background service per user, `worksuite-ai`, owns every model; apps never load models themselves, so memory is shared and one policy applies.

&#91;embedded content: local AI architecture · clients, service, engines\]

- **Process:** installed with WorkSuite Office (and later Desktop); started on first request by the app (launch on demand, exits after 30 min idle). macOS LaunchAgent, Windows per-user process, Linux systemd user unit.
- **Discovery:** `~/.worksuite/ai/endpoint.json` (`{port, token, pid, apiVersion}`, user-only permissions). Apps start the service if the file is missing or the pid is gone.
- **Storage:** `<app data>/WorkSuite/ai/models/<id>/<version>/` + `manifest.json`; `cache/`, `dictionaries/`, `recordings/` (only if kept).
- **Scheduler:** speech streams get priority over text jobs; one heavy job per GPU; models unload after 10 minutes unused or when the memory cap is reached (least recently used first).
- **Backends:** whisper.cpp (speech), llama.cpp GGUF (text and chat), the existing Sinhala core compiled in (rules, no model), ONNX Runtime for translation, Piper for speech synthesis.

## Local service API contracts

API version 1, base `http://127.0.0.1:{port}/v1`, JSON over HTTP plus one WebSocket per stream. Every request carries `Authorization: Bearer <app token>` (Architecture section). Text offsets are UTF-16 code units, matching the editor.

### Conventions

| Item | Contract |
| --- | --- |
| Versioning | Path `/v1`; additive fields only within v1; `GET /v1/info` returns `{apiVersion:"1.4", serviceVersion, capabilities[]}` |
| Jobs | Long work returns `202 {jobId}`; `GET /v1/jobs/{id}` → \`{state: queued |
| Events | `WS /v1/events` pushes `{type, jobId?, data}` for job progress, model state, policy change |
| Errors | `{error:{code, message, detail?, retryable:boolean}}` with HTTP 4xx/5xx |
| Cancellation | Any request may send `X-Request-Id`; `DELETE /v1/requests/{id}` aborts it (used by suggestions on each keystroke) |
| Privacy flag | Every content request may set \`allowCloud:false |

**Error codes:** `unauthorized`, `forbidden_by_policy`, `model_not_installed`, `model_loading`, `capability_unavailable` (e.g. Sinhala STT gated), `insufficient_memory`, `insufficient_disk`, `integrity_failed`, `unsupported_media`, `input_too_long`, `busy` (retryable), `cancelled`, `internal`.

### Service and hardware

- `GET /v1/info` → `{apiVersion, serviceVersion, capabilities:["speech.stt","speech.stt.si","text.complete","text.check","text.transform","translate","tts","tts.si","assistant"], profile:"lite|standard|advanced"}`
- `GET /v1/hardware` → `{os, arch, cpu:{model, cores}, ramMB, freeRamMB, gpus:[{name, vramMB, backend:"cuda|metal|vulkan|directml"}], appleSilicon:boolean, recommendedProfile}`
- `GET /v1/health` → `{ok, loadedModels:[{id, task, memMB}], queueDepth}`

### Catalog and models

- `GET /v1/catalog?task=&lang=` → `[{id:"whisper-small-q5", name, version, tasks:["stt"], languages:["en","si"], sizeMB, ramMB, backends:["cpu","metal","cuda"], license, fits:"yes|tight|no", approved:boolean, evaluated:{si:{wer:0.31}}}]`
- `GET /v1/models?task=` → installed: `[{id, version, tasks, state:"installed|active|updating|failed", sizeMB, path, isDefaultFor:["stt"], lastUsed}]`
- `POST /v1/models/{id}/install` `{version?}` → `202 {jobId}`; `POST .../pause|resume`; `DELETE /v1/models/{id}` uninstalls
- `POST /v1/models/{id}/activate` / `deactivate` → loads or unloads it
- `PUT /v1/defaults` `{stt, correction, suggestions, translation, tts, assistant}` (each a model id, `"auto"` or `"cloud"`)
- `POST /v1/models/import` (multipart `.wsmodel`) → job; `GET /v1/models/{id}/export` → `.wsmodel` stream
- `POST /v1/storage/move` `{path}` → job

### Speech

- `WS /v1/speech/stream?lang=auto|si|en&model=&punctuate=true` — client sends binary PCM 16 kHz mono s16le frames (20–100 ms) and text frames `{type:"pause"|"resume"|"end"}`; server sends `{type:"partial", text, segmentId}`, `{type:"final", segmentId, text, lang, start, end, confidence}`, `{type:"error", code}`, `{type:"closed"}`.
- `POST /v1/speech/transcribe` multipart `file` + JSON `{lang, punctuate, timestamps, diarize, model?}` → job; result `{lang, durationSec, segments:[{start, end, speaker?, text, confidence}]}`
- Supported media: wav, mp3, m4a, mp4 (audio track), max 4 h per file.

### Text

- `POST /v1/text/complete` `{text, caret, lang:"si|en|mixed|auto", mode:"word|phrase", singlish?:boolean, max:5}` → `{words:[{text, source:"dictionary|personal|org|model", score}], ghost?:{text, score}}`
- `POST /v1/text/check` `{text, lang, kinds:["spelling","grammar","punctuation"]}` → `{lang, issues:[{start, end, kind, message, replacements:[string], confidence}]}`
- `POST /v1/text/transform` `{text, lang, op:"improve|rewrite|simplify|formal|professional|expand|shorten|summarize|explain|tone", tone?, targetLength?, context?}` → `{result, edits:[{start, end, replacement, reason}], model, allowCloud:false}` (edits are a diff of `text` → `result`; `summarize` and `explain` return `result` only)
- `POST /v1/text/detect-language` `{text}` → `{spans:[{start, end, lang, confidence}]}`

### Sinhala engine

- `POST /v1/sinhala/transliterate` `{text, from:"singlish|si", to:"si|singlish"}` → `{text}`
- `POST /v1/sinhala/normalize` `{text}` → `{text, changes:[{start, end, before, after, rule}]}`
- `POST /v1/sinhala/validate` `{text}` → `{valid, issues:[{start, end, code, message}]}`
- `POST /v1/sinhala/legacy/encode` `{text, font:"FMAbhaya"}` → `{text, font, unmapped:[{start, end, char}]}`; `/legacy/decode` `{text, font}` → `{text, suggestedFont:"Noto Sans Sinhala"}`; `GET /v1/sinhala/legacy/fonts` → `[{id, family, encoding:"fm|dl|..."}]`
- `POST /v1/sinhala/segment` `{text}` → `{words:[{start, end}]}`
- `POST /v1/pdf/merge|split|rotate|protect|unprotect|images-to-pdf` (API 1.4) → 202 `{jobId}`; the job's result is `{file, files, contentType:"application/pdf", pages}` and `GET /v1/jobs/{id}/file` serves `file`. Bodies take absolute paths on this computer; outputs go next to the first input (or to `out`) and never overwrite a file (" (2)"). `merge` `{paths[≥2], out?}`; `split` `{path, parts:[[pages]] | every:N, password?}` (files " (part N).pdf"); `rotate` `{path, angle:90|180|270, pages?, out?, password?}`; `protect` `{path, userPassword?, ownerPassword?, permissions?:{printing:"none|low|high", copying, modifying, annotating, fillingForms, assembling}, out?, password?}` writes AES-256, permissions need `ownerPassword`; `unprotect` `{path, password, out?}`; `images-to-pdf` `{paths:[png|jpg], out?}`. A PDF with a password that was not given fails `bad_request` with `detail.reason` `password_required` or `password_incorrect`. `POST /v1/pdf/info` `{path, password?}` → `{pages|null, encrypted, size}`. Capability `pdf`; pure JavaScript (pdf-lib), nothing to download
- Dictionaries: `GET/POST/DELETE /v1/dictionaries/personal/words`, `GET /v1/dictionaries` (personal, organization, built-in with versions)

### Translation and speech synthesis

- `POST /v1/translate` `{text, from:"auto|si|en|ta", to, preserveFormatting:true}` → `{text, from, model}`
- `GET /v1/tts/voices` → `[{id, lang, gender?, quality, modelId}]`
- `POST /v1/tts/synthesize` `{text, voice, rate:0.5..2, format:"wav|mp3|opus", timings:"none|word|sentence"}` → streamed audio (`audio/*`) with timings as a trailing JSON part, or a job when `export:true`

### Assistant (OpenAI-compatible)

- `GET /v1/openai/models` and `POST /v1/openai/chat/completions` follow the OpenAI chat schema (messages, stream, temperature, max\_tokens, tools omitted in v1). This is how the AI agent panel and AI ribbon use local models with no changes.

### Policy, privacy and diagnostics

- `GET /v1/policy` → `{managed:boolean, features:{stt, suggestions, correction, translate, tts, assistant}, cloudAllowed, approvedModels:[id], maxMemMB, gpuAllowed, orgDictionaryUrl}`
- `GET /v1/privacy` / `PUT /v1/privacy` `{learning:boolean, keepRecordings:boolean}`; `POST /v1/privacy/clear` `{what:["cache","recordings","learned"]}`
- `GET /v1/diagnostics` → versions, hardware, model states, last 50 error codes and timings; never document text or audio.

## Editor integration contracts

The editor never talks to models directly: a WorkSuite plugin (`asc.ws-ai`, alongside Sinhala Tools) calls the service and changes the document only through the ONLYOFFICE plugin API.

| Editor action | Plugin API used | Rule |
| --- | --- | --- |
| Read selection / paragraph | `executeMethod("GetSelectedText")`, `callCommand` with `Api.GetDocument().GetRangeBySelect()` | Send text plus a selection fingerprint (text hash + start/end paragraph ids) |
| Insert at cursor (voice, assistant, transcript) | `executeMethod("PasteText")` for plain text; `callCommand` building `ApiParagraph`/`ApiTable` for structure | One `callCommand` = one undo step |
| Apply accepted edits | `callCommand` that re-reads the range, checks the fingerprint, then replaces each edited span through `ApiRange` keeping run properties | Fingerprint mismatch → abort with *Text changed, run again* |
| Track changes | `Api.GetDocument().IsTrackRevisions()`; edits go through the same calls so they are tracked when it is on | Never turn track changes on or off for the user |
| Ghost text | Rendered by the plugin as an overlay at the caret (`executeMethod("GetCurrentContentControl")`/cursor position events), never written into the document until Tab | Esc or any other key removes it |
| Fonts after Sinhala conversion | Same `callCommand` sets `ApiTextPr.SetFontFamily` on the replaced runs | Text and font in one undo step |
| Highlight while reading aloud | `executeMethod("SelectRange")`-style selection of the current sentence | Restores the user's selection on stop |

Limits: requests send at most 8,000 characters of context; longer documents are chunked by paragraph for check/transform and summarized hierarchically for the assistant.

## Security, privacy and model integrity

The service accepts calls only from WorkSuite apps on the same machine, never sends content off it unless a request allows cloud and policy permits, and runs only signed models.

- **Transport:** binds to `127.0.0.1` only, random port written with a per-boot token to a user-only file (`0600`; Windows ACL to the user). Apps read token + port from that file. Origin header must be a WorkSuite app scheme (`asc://`, `worksuite://`, file origins of the installed apps); browsers' web origins are refused.
- **Isolation:** runs as the user, one instance per user session; models and caches in the user's app-data folder (or the configured storage path), not world-readable.
- **Audio:** kept in memory; written to disk only during file transcription (deleted on completion) or when *Keep recordings* is on.
- **Learning:** personal dictionary and usage learning are off until the user turns them on; **Clear learned data** removes them.
- **Cloud:** `allowCloud` defaults false; when policy sets `cloudAllowed:false` the service rejects with `forbidden_by_policy` even if a client asks.
- **Logs and diagnostics:** error codes, timings, model ids and hardware only; never text or audio.

**Model package (`.wsmodel`) manifest**, signed with the WorkSuite model key (Ed25519) and checked on install, import and every load:

```
{
  "id": "whisper-small-q5", "version": "1.0.0", "tasks": ["stt"],
  "languages": ["en", "si"], "engine": "whisper.cpp", "engineMin": "1.7.0",
  "files": [{"path": "ggml-small-q5_1.bin", "size": 190085487, "sha256": "..."}],
  "ramMB": 600, "backends": ["cpu", "metal", "cuda", "vulkan"],
  "license": "MIT", "source": "https://...",
  "evaluation": {"si": {"wer": 0.31, "set": "ws-si-stt-v1"}},
  "signature": "ed25519:..."
}
```

The catalog itself is served by the WorkSuite Update Center (`/api/v1/ai/catalog`), signed the same way, so organizations can mirror it and approve models by id.

## Delivery plan

Ship Phase 1 as English voice typing plus the model manager first; Sinhala speech, grammar and voices turn on only after they pass their evaluation sets.

| Phase | Delivers | Repos | Exit test |
| --- | --- | --- | --- |
| 1 Foundation | `worksuite-ai` service (Rust or Go host, whisper.cpp + llama.cpp backends), catalog, install/verify, hardware detection, Settings › AI Models, voice typing + file transcription (English), local provider in the AI agent panel | new `worksuite-ai`, worksuite-office (plugin + packaging), worksuite-office-desktop-apps (Settings), worksite-download (catalog) | W1–W4 and W9 pass offline on Windows, macOS (arm64, x64) and Linux |
| 2 Writing tools | `/text/complete`, `/text/check`, `/text/transform`, review panel, ghost text, personal and org dictionaries, Sinhala engine moved behind `/sinhala/*` | worksuite-ai, worksuite-office, worksuite (org dictionaries API) | W5–W7; editor stays under 16 ms per keystroke with suggestions on |
| 3 Advanced | Translation, read aloud, assistant document context, batch transcription, diarization | worksuite-ai, worksuite-office | W8; Sinhala STT and TTS enabled only if gates pass |
| 4 Enterprise | Policy, approved models, mirrored catalog, deployment via WorkSuite Desktop, diagnostics | worksuite (Admin Center), worksuite-desktop, worksuite-ai | W10 with MDM and Admin Center policies on all three OSes |

**Evaluation gates (Sinhala):**

- Speech to text: word error rate at or below 25% on a 2-hour WorkSuite Sinhala test set (read and conversational speech, 20+ speakers).
- Grammar and rewrite: at least 80% of model edits rated correct by two native reviewers on 300 sentences; zero meaning-changing edits accepted.
- Text to speech: mean opinion score of 3.5 or higher from 10 native listeners.

**Open questions:**

- [ ] Service language: Rust (smaller, safer) or Go (faster to build)? Recommendation: Rust.
- [ ] Which Sinhala speech data can we license or record for the evaluation set?
- [ ] Is a GPU build per OS acceptable for download size, or do we ship CPU-only and fetch GPU backends on demand?
- [ ] Does the organization Admin Center already store dictionaries, or is that new server work?
- [ ] Licences for each model in the first catalog (Whisper MIT; Qwen and IndicTrans2 terms to confirm before listing).

## API notes (additive, worksuite-ai 1.0.0)

Implementation notes for API v1 as `ai-service/` serves it. Everything here is additive to the contract above; nothing above changes.

**Auth and transport**

- HTTP: `Authorization: Bearer <token>` from `~/.worksuite/ai/endpoint.json` (`{port, token, pid, apiVersion, serviceVersion, startedAt}`, 0600; Windows: ACL to the user).
- WebSockets (`/v1/events`, `/v1/speech/stream`) also take the token as `?token=<token>`, or as subprotocols `Sec-WebSocket-Protocol: ws-ai.v1, bearer.<token>` (the server echoes `ws-ai.v1`).
- Origin: none (native callers), `asc://`, `worksuite://`, `app://`, `file://` and `null` (the editors load from file) are allowed; http(s) web origins are refused with 403 `unauthorized`, on HTTP and WebSocket alike. CORS preflight answers allowed origins.

**Jobs and events**

- `GET /v1/jobs/{id}` → `{id, type, state: queued|running|paused|done|failed|cancelled, progress: 0..1, stage?, modelId?, result?, error?, createdAt, updatedAt}`. Stages of an install: `engine`, `downloading`, `verifying`, `unpacking`, `ready`. `GET /v1/jobs` lists them.
- `DELETE /v1/jobs/{id}` cancels any job; for an install it also deletes the partial download. `POST /v1/models/{id}/cancel` does the same by model.
- A dropped connection pauses an install (`state: paused`, `error.retryable: true`); `POST /v1/models/{id}/resume` continues with an HTTP Range request from the last byte (also after a restart).
- `WS /v1/events` sends `{type:"hello"}` first. Every event is sent under its base type and then a finer one: `job` then `job.progress` | `job.done` | `job.failed` | `job.paused` | `job.cancelled`; `model` then `model.state` (`data.state`: installed, active, failed, uninstalled); `policy` then `policy.changed`. Also `job.partial` (transcription segments), `defaults`, `privacy`, `storage`, `engine`.
- `GET /v1/jobs/{id}/file` downloads a job's file (TTS export: `result.url`).

**Added routes**

- `GET /v1/defaults` → the `PUT /v1/defaults` shape.
- `GET /v1/storage` → `{path, usedMB, freeMB, managed?}`; `POST /v1/storage/move` is `forbidden_by_policy` when `aiStoragePath` is managed.
- `GET /v1/engines` → engine availability (`whisper.cpp`, `llama.cpp`, `piper`, `ffmpeg`) and installed engine packages.
- `POST /v1/models/{id}/cancel`; `POST /v1/dictionaries/personal/learn {latin, word}` (only while learning is on); `GET /v1/catalog?refresh=1`, `GET /v1/hardware?refresh=1`, `GET /v1/policy?refresh=1`.

**Added fields**

- Catalog entries: `engine, source, description, approvedByOrganization, signed, voice?`. `approved` is WorkSuite's listing approval and the organisation's (`approvedModels`) together.
- Installed models: `name, languages, engine, updateAvailable, approvedByOrganization, evaluation`; failed installs are listed with `state:"failed"` and `error`.
- Policy: `modelsRestricted` (`approvedModels: []` means no restriction), `organization`, `source`, `catalogUrl`, `storagePath`. `maxMemMB: 0` means the service's own cap (70% of RAM).
- `/v1/text/check` adds `skipped: [{kind, reason}]` when a kind could not be served (no model, Sinhala gate, invalid model output); spelling still answers.
- `/v1/sinhala/legacy/encode|decode` add `profile`, `profileVersion`, `unmapped`; `/v1/sinhala/validate` issues add `fixable`; legacy fonts add `fontNames, status, version`.
- Speech stream sends `{type:"state", state:"starting"|"listening"|"paused"}`; per-segment errors carry `segmentId`.
- Capabilities add `speech.diarization`, `text.grammar`, `text.grammar.si` (Sinhala grammar/rewrite gate: `evaluation.si.grammar >= 0.8`) and `sinhala`.
- Error codes add `bad_request` (400/405) and `not_found` (404).

**TTS response**

- `timings:"none"` streams plain `audio/*`. Otherwise `multipart/mixed`: the audio part (WAV streams sentence by sentence), then an `application/json` part `{timings:[{kind, start, end, textStart, textEnd}], durationSec, sampleRate, voice}`. Word timings are estimated within each sentence (Piper reports none). mp3/opus need the ffmpeg engine package.

**Managed policy**

Read from the same location as the other Office keys (desktop-apps docs/managed-configuration.md, "Local AI"): `aiSpeechToText, aiSuggestions, aiCorrection, aiTranslation, aiReadAloud, aiAssistant, aiCloudAllowed, aiApprovedModels, aiMaxMemoryMB, aiGpuAllowed, aiDictionaryUrl, aiCatalogUrl, aiStoragePath`, and `aiFunctions=off` turns all of it off. The spec's own names (`stt`, `cloudAllowed`, …) are also read from `HKLM\Software\Policies\WorkSuite\Office\AI`, the macOS domain's `ai` dictionary and `/etc/worksuite/office/policy.json`. Re-read every 60 s; changes go out as `policy` events.

**Process**

`worksuite-ai` sits next to the app binary (macOS `Contents/MacOS/worksuite-ai`, Windows install dir, Linux the app's `/opt/…` folder). Launching it while an instance answers `GET /v1/health` prints that instance and exits. It exits after 30 minutes with no requests, sockets or jobs (`WS_AI_IDLE_EXIT_MS`).
