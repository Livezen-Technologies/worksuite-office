# Building Euro-Office DesktopEditors

This directory holds everything needed to build **Euro-Office DesktopEditors**
(a fork of ONLYOFFICE DesktopEditors) from source, on Linux and Windows.

If you just want to build, go straight to your platform:

- **[Linux](./linux/README.md)** — a Docker-based build (`docker buildx bake`)
- **[Windows](./windows/README.md)** — a PowerShell-driven MSVC build (`build.ps1`)

The rest of this page explains the model both platforms share. Read it once and
the platform guides will make a lot more sense.

## Prerequisites (all platforms)

This is a *super-repository*: almost none of the source lives here directly. The
real code is in submodules — `core`, `core-fonts`, `desktop-apps`, `desktop-sdk`,
`dictionaries`, `document-templates`, `sdkjs`, `sdkjs-forms`, `web-apps`. You
**must** check them out before building:

```sh
git clone https://github.com/Euro-Office/DesktopEditors.git
cd DesktopEditors
git submodule update --init --recursive
```

Every command in these guides assumes you are running from the **repository
root** (the directory that contains this `build/` folder), not from inside
`build/` itself.

## The big picture: three jobs, two platforms, one definition

A full release is produced by three jobs in the **"Build (Windows/Linux)"** CI
workflow:

| Job             | Runs on          | Produces                                                                       |
| --------------- | ---------------- | ------------------------------------------------------------------------------ |
| `build-common`  | Linux / Docker   | the JS + WASM **editors web payload** ("common"), published as `common-files`  |
| `build-linux`   | Linux / Docker   | the desktop app + Linux packages                                               |
| `build-windows` | Windows / MSVC   | the desktop app + ZIP and Inno installer (optionally an MSI)                   |

The single most important thing to understand:

> **Both `build-linux` and `build-windows` consume the output of `build-common`.**

`build-common` compiles the web editors (HTML/JS) and the core WASM once, on
Linux, because that part is platform-independent. The two desktop builds then
overlay that payload onto the native application they compile. So when you build
the desktop app, you don't rebuild the editors — you **supply** them. How you
supply them differs per platform and is covered in each guide.

## Build *definition* vs. build *orchestration*

The build is split into two layers, and keeping them straight is the key to
understanding why there are two very different-looking build systems here:

- **The build definition** — *what* to compile and how to link it — lives in
  **`desktop-apps/win-linux/CMakeLists.txt`**. This is a single, shared,
  cross-platform CMake project. It is the same on Linux and Windows.

- **The orchestration** — provision a toolchain, fetch dependencies, invoke
  CMake, run post-build steps, package — is **per-platform**:
  - Linux: a Dockerfile driven by `docker-bake.hcl` (see [linux/](./linux/README.md))
  - Windows: `windows/build.ps1` (see [windows/](./windows/README.md))

Both orchestrators do essentially the same sequence — configure CMake with the
vcpkg toolchain and a compiler cache, build, install, overlay the common payload,
generate fonts and theme thumbnails, package — just with platform-appropriate
tooling.

### Why not just use Docker for both?

The native Windows toolchain (MSVC, Qt, CEF, the v8 engine, the Windows SDK)
cannot be hermetically containerized on the standard hosted runners the way the
Linux toolchain can, and a Linux container obviously can't emit Windows binaries.
So the Linux build is a clean, reproducible Docker build, while the Windows build
is a script that provisions and runs against the host. The asymmetry is
deliberate, not an oversight.

## Shared concepts

These apply to both platforms; the platform guides won't repeat them.

### Dependencies via vcpkg (manifest mode)

Native third-party libraries are resolved by **vcpkg in manifest mode**. The
manifest and its version pins live in **`core/vcpkg.json`** (`VCPKG_MANIFEST_DIR`
points CMake at `core`). The exact dependency versions are pinned through the
manifest's `builtin-baseline`, so a fresh checkout of vcpkg still resolves the
same versions. If a bleeding-edge vcpkg HEAD ever misbehaves, check out the
baseline commit referenced in `core/vcpkg.json`.

### Compiler caching + the Ninja generator

Both builds use a compiler cache to avoid recompiling unchanged translation
units — **ccache** on Linux, **sccache** on Windows — wired in through
`CMAKE_C_COMPILER_LAUNCHER` / `CMAKE_CXX_COMPILER_LAUNCHER`. Because of that,
**both builds use the Ninja generator**: MSBuild ignores the compiler-launcher
variables, Ninja honours them. The cache is optional locally (the build just runs
slower without it) but strongly recommended in CI.

### Versioning and branding

These come from the workflow's top-level environment and can be overridden
locally:

| Variable                          | Meaning                                  | Default                |
| --------------------------------- | ---------------------------------------- | ---------------------- |
| `PRODUCT_VERSION`                 | marketing version                        | `10.1.12`                |
| `BUILD_NUMBER`                    | build identifier                         | `dev.1`                |
| `COMPANY_NAME` / `PRODUCT_NAME`   | shown in the app's About page            | `Euro-Office` / `DesktopEditors` |

## Text recognition in the PDF Editor (the 10.x builds)

The Convert tab's **Recognise text** runs Tesseract on the computer. `v10/ocr.sh` (called by
`v10/prepare.sh` on Linux and Windows, and by a step of `build-mac.yml`) fetches tesseract.js 6.0.1, its
LSTM WebAssembly core 6.0.0 and the `eng`, `sin` and `tam` models of tessdata_fast 4.1.0, each pinned by
URL and sha256, adds `ocr/worker.js`, and has the desktop deploy copy them to `editors/ocr`. Nothing is
fetched when the app runs.

## Sinhala Tools (the 10.x builds)

The 10.x builds (`build-mac.yml`, `build-linux-v10.yml`, `build-windows-v10.yml`) add two inputs
before ONLYOFFICE's build_tools runs, through `v10/sinhala.sh` (`v10/prepare.sh` calls it on Linux and
Windows):

| Input                      | From                                                                 | Ends up in                                                  |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sinhala Tools plugin       | `sinhala/` (`npm run build:plugin`, into `sinhala/plugin/dist`)      | `editors/sdkjs-plugins/{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}` |
| Noto Sans / Serif Sinhala, Malithi Web | `sinhala/fonts/manifest.json` (pinned URLs, sha256-checked) | `fonts/worksuite-sinhala`, read by allfontsgen               |
| Legacy fonts (Thara, Kandy, DL-Sarala, …) | `sinhala/fonts/manifest.json` `legacy` entries with a `url` (sha256-checked) | `fonts/worksuite-sinhala/legacy`                     |

No font files are kept in git, and FM Abhaya, DL Manel and Kaputa are never shipped. The other legacy fonts
and Malithi Web are fetched from `download.worksuitecloud.com/fonts/legacy/`; one that is not there yet is a
warning, not a build failure, and the editor then uses the copy installed on the user's computer. The Check
workflow runs the Sinhala tests (`cd sinhala && npm ci && npm test`). The 9.3 builds described above do
not have Sinhala Tools.

## Local AI service (the 10.x builds)

`ai-service/` is `worksuite-ai`, the Local AI service (docs/local-ai/spec.md). Each 10.x build runs
`build/v10/ai-service.sh`, which type-checks and tests it, builds a Node 22 single executable (Node SEA) for the
runner's platform and copies it next to the app: `WorkSuite Office.app/Contents/MacOS/worksuite-ai` (signed with
the app's identity and `ai-service/packaging/macos/worksuite-ai.entitlements`, then the app is re-sealed), the
Windows install dir (`worksuite-ai.exe`, Authenticode-signed with the other executables) and the Linux app folder
(packaged to `/opt/…`; the job checks each .deb holds it). Any failure stops the build. Engines and models are not
bundled: the service downloads them as signed packages from the Update Center catalog.

## WorkSuite Local AI (the 10.x builds)

`ai-plugin/` is the editors' side of the local AI service (`worksuite-ai`, its `/v1` API): the
`asc.ws-ai` plugin, WorkSuite Local AI, with voice typing, file transcription, read aloud, the AI tab's
writing commands with a review panel, and inline suggestions. `v10/ai.sh` (called by `v10/prepare.sh` on
Linux and Windows, and by a step of `build-mac.yml`) builds it and has build_tools deploy it:

| Input                      | From                                                                 | Ends up in                                                  |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| WorkSuite Local AI plugin  | `ai-plugin/` (`npm run build:plugin`, into `ai-plugin/plugin/dist`)  | `editors/sdkjs-plugins/{7A1E5C0D-3B2F-4D6A-9E81-5C4F2B7D0A11}` |

The plugin has no dependencies. Its toolbar icons are drawn in `ai-plugin/plugin/src/resources/svg` and
rendered to the committed PNGs by `npm run icons` (Playwright). The Check workflow runs its tests
(`cd ai-plugin && npm test`). `npm run screenshots` renders the voice typing dock, the review panel and
the read-aloud bar against a mocked service.

The plugin finds the service through the desktop shell: the `ws-ai:endpoint` command (desktop-apps
`docs/local-ai-bridge.md`; `ai-plugin/plugin/src/lib/discovery.js`), which also starts it on demand.
It shares the endpoint with Sinhala Tools as `window.WSAiEndpoint`.

## The 10.x builds: one upstream for all three platforms (NFR-19)

On `office-v10` all three 10.x builds take their sources from **ONLYOFFICE**, at the one tag `OO_TAG`
(`v10.0.0.176`) in `build-mac.yml`, `build-linux-v10.yml` and `build-windows-v10.yml`, built with
ONLYOFFICE's public `build_tools` (9.4, adapted by `v10/prepare.sh` on Windows and Linux and by the same
edits inline in `build-mac.yml`). Euro-Office is the upstream of the **9.3** builds only (`build.yml`, the
submodules of this repository); it has no macOS build and no v10 release yet. So the split is:

| Builds | Upstream | Editor patches applied by |
| ------ | -------- | ------------------------- |
| 10.x macOS, Windows, Linux | ONLYOFFICE `OO_TAG` | `build-mac.yml` (macOS), `v10/prepare.sh` (Windows, Linux) |
| 9.3 Windows, Linux (`build.yml`) | Euro-Office (submodule pins) | `build.yml`, plus `patch-upstream.py` |

The Check workflow's `patches` job (`v10/check-patches.sh`) keeps the 10.x side honest: it fails when the three
workflows name different `OO_TAG`s, when `build-mac.yml` and `v10/prepare.sh` apply different
`build/patch-*.py` scripts, or when any of them no longer applies to ONLYOFFICE's sources at `OO_TAG`. The
patches change only platform-independent sources (web-apps, sdkjs), so that one checkout is what every platform
patches; there is nothing platform-specific to test separately. The `build_tools`/`core` edits in `prepare.sh`
and `build-mac.yml` are not run by Check (they need the full sources, several GB): each asserts the text it
replaces, so drift stops the build in its first minutes. The 9.3 patches are not checked against Euro-Office
by Check either; the 9.3 line takes no new upstream. The desktop-apps commit may differ by platform
(`DESKTOP_APPS_REF` in each workflow); Check runs the start-page tests of each one.

## Signing and updates (UPD-04…07, NFR-08)

Every signing step is skipped, with a warning, when its secrets are missing; such a build may only go to
the **beta** channel (the `stable` channel input stops an unsigned build). Settings are repository secrets
unless marked *variable*.

| Name | Used by | What |
| ---- | ------- | ---- |
| `SPARKLE_PUBLIC_ED_KEY` (*variable*) | mac, Windows, publish | base64 Ed25519 public key; `SUPublicEDKey` (Sparkle) and `WS_UPDATE_EDDSA_PUBLIC_KEY` (WinSparkle) |
| `SPARKLE_ED_PRIVATE_KEY` | mac, Windows | its private half, as `generate_keys -x` exports it (32-byte seed, base64); signs the DMG and the Windows installer into `<file>.edsig` |
| `MACOS_CERTIFICATE_P12` | mac | base64 `.p12` with the **Developer ID Application** certificate and its key |
| `MACOS_CERTIFICATE_PASSWORD` | mac | the `.p12`'s password |
| `MACOS_NOTARY_KEY` | mac | base64 App Store Connect API key (`AuthKey_XXXX.p8`) for `notarytool` |
| `MACOS_NOTARY_KEY_ID` | mac | that key's ID |
| `MACOS_NOTARY_ISSUER` | mac | the issuer ID of the App Store Connect team |
| `WINDOWS_CERTIFICATE_PFX` | Windows | base64 `.pfx` code-signing (OV/EV) certificate, for `signtool` (`v10/sign-windows.ps1`) |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | the `.pfx`'s password |
| `WINDOWS_TIMESTAMP_URL` (*env*, optional) | Windows | RFC 3161 server, default `http://timestamp.digicert.com` |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Windows | instead of a PFX: an Entra app allowed to sign with Azure Trusted Signing |
| `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` (*variables*) | Windows | the Trusted Signing endpoint, account and certificate profile |
| `LINUX_REPO_GPG_PRIVATE_KEY` | Linux repos | armoured GPG secret key that signs the APT and RPM repositories (use RSA 4096: RHEL 8's rpm cannot check Ed25519) |
| `LINUX_REPO_GPG_PASSPHRASE` | Linux repos | its passphrase, if it has one |
| `LINUX_REPO_SSH_KEY`, `LINUX_REPO_SSH_KNOWN_HOSTS` | Linux repos | deploy key and `known_hosts` lines of the download host |
| `LINUX_REPO_SSH_TARGET` (*variable*) | Linux repos | `user@host:/path` served as `https://download.worksuitecloud.com/linux/` |
| `UC_CI_TOKEN`, `UC_CI_KEY`, `UC_CI_KEY_ID` (*variable*) | publish | as before (Update Center CI client and attestation key) |

Order matters, because each signature covers the bytes before it: macOS builds the app with the Developer ID
identity and hardened runtime (CEF keeps its JIT entitlements; `get-task-allow` is removed), signs the DMG,
notarises it with `notarytool`, staples it, and only then makes the Sparkle `.edsig`. Windows signs the app's
`.exe`/`.dll` files that carry no signature yet, packages, signs the installer, and then makes the WinSparkle
`.edsig`.

**macOS architectures (UPD-07).** `build-mac.yml` builds two DMGs, `WorkSuite-Office-<version>-arm64.dmg`
(macos-14) and `WorkSuite-Office-<version>-x64.dmg` (macos-15-intel, build_tools `mac_64`, the
`ONLYOFFICE-x86_64` scheme), each with its own feed (`appcast.xml?arch=arm64|x64`). Both carry the same
`CFBundleVersion`; publish uploads both into one release.

**Windows updates (UPD-04).** WinSparkle (pinned version and sha256 in `build-windows-v10.yml`) ships beside
the app and reads
`https://download.worksuitecloud.com/api/v1/apps/lk.worksuite.office/channels/<channel>/appcast.xml?platform=windows&arch=x64&type=exe`.
The build passes `WS_UPDATE_APPCAST_URL`, `WS_UPDATE_EDDSA_PUBLIC_KEY` and `WINSPARKLE_DIR` to build_tools'
qmake through the environment; desktop-apps wires WinSparkle in from them.

## Linux repositories (UPD-05)

`publish-linux-repos.yml` (run after the release is approved in the Update Center) adds a 10.x Linux build's
`.deb` and `.rpm` to signed repositories, made by `linux/make-repos.sh`, under
`https://download.worksuitecloud.com/linux/`:

| URL | What |
| --- | ---- |
| `/linux/worksuite-office.gpg`, `/linux/worksuite-office.asc` | the signing key (binary keyring, armoured) |
| `/linux/apt` with suites `stable`, `beta`, component `main`, `amd64` | APT (`dists/<channel>/InRelease`, `pool/<channel>/…`) |
| `/linux/rpm/<channel>/x86_64` | RPM (`repodata/repomd.xml.asc`; the packages are rpm-signed too) |
| `/linux/rpm/worksuite-office-<channel>.repo` | the dnf/zypper repository file |

Users (or the package's own setup) add them with:

```sh
# Debian, Ubuntu
curl -fsSL https://download.worksuitecloud.com/linux/worksuite-office.gpg | sudo tee /usr/share/keyrings/worksuite-office.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/worksuite-office.gpg] https://download.worksuitecloud.com/linux/apt stable main" | sudo tee /etc/apt/sources.list.d/worksuite-office.list
# Fedora, RHEL, openSUSE
sudo curl -fsSLo /etc/yum.repos.d/worksuite-office.repo https://download.worksuitecloud.com/linux/rpm/worksuite-office-stable.repo
```

## CI checks

The Check workflow runs the version check, the Sinhala tests, the WorkSuite start-page tests of every
desktop-apps commit a build takes (`test-desktop-apps.sh`, NFR-18), the patch check above, `bash -n` and
shellcheck over the build scripts, markdownlint and the spellchecker.

## Where to go next

- Building on **[Linux](./linux/README.md)**
- Building on **[Windows](./windows/README.md)**