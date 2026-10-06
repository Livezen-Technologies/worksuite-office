# WorkSuite Office

WorkSuite Office is the desktop office suite for [WorkSuite](https://worksuite.lk): text, spreadsheet,
presentation and PDF editors for Windows and Linux. It is a rebranded build of
[Euro-Office DesktopEditors](https://github.com/Euro-Office/DesktopEditors), itself a fork of
ONLYOFFICE Desktop Editors, and is distributed under the GNU AGPL v3. See [ATTRIBUTION](./ATTRIBUTION).

Installers are produced by the **Build WorkSuite Office** workflow in the Actions tab.
The branding changes live in the `desktop-apps` submodule and in `build/`; every other
submodule is the unmodified Euro-Office source.

### Updates

**macOS.** The app updates through Sparkle. It reads its feed from the WorkSuite Update Center:
`https://download.worksuitecloud.com/api/v1/apps/lk.worksuite.office/channels/<channel>/appcast.xml?arch=arm64`.
The setup is described in worksite-download's `docs/sparkle.md`.

- **Settings** for **Build WorkSuite Office (macOS arm64)**:
  - the repository variable `SPARKLE_PUBLIC_ED_KEY`, which becomes the app's `SUPublicEDKey`;
  - the secret `SPARKLE_ED_PRIVATE_KEY`, made with Sparkle's `generate_keys -x` from
    `desktop-apps/macos/Vendor/Sparkle/bin`.
- **What each build does:**
  - stamps the chosen channel into the app (`beta` until builds are Developer ID signed and notarised);
  - sets a rising build number as `CFBundleVersion`, which Sparkle compares;
  - signs the DMG into `<dmg>.edsig`.
- **Publishing:** see below.

**Windows and Linux** do not update themselves yet. The Windows update service is not built, and the Windows
installers are not code signed, which the service requires.

### Versions

The version is in `VERSION`. Every change that ships gets a new one, set with `build/set-version.sh`, with its
section in `CHANGELOG.md` and its release notes in `build/release-notes/<version>.md`. `build/check-version.sh`,
which the Check workflow runs, makes sure they agree. See `CLAUDE.md`.

### Publishing

The **Publish to the WorkSuite Update Center** workflow puts finished builds on download.worksuitecloud.com.

- **Inputs:**
  - the run ID of a macOS build, of a Windows/Linux build, or both, built from the same commit;
  - the version and build number. With a Mac build, the build number is its `CFBundleVersion`: 1000 + that
    run's number, unless `build_number` was given.
- **What it uploads:** the DMG, the Windows installer and zip, and the Linux deb and rpm.
- **What it does** with `build/publish-release.mjs`, a copy of worksite-download's `scripts/publish-release.mjs`:
  - creates the release, with the notes in `build/release-notes/<version>.md`;
  - posts the signed CI build attestation;
  - uploads the files and waits for the Update Center's checks;
  - submits the release for testing.
- **After the workflow,** QA, release-manager approval and publishing happen in the Update Center's `/admin`.
- **Dry run:** downloads and lists the installers only.
- **Settings:**
  - the secret `UC_CI_TOKEN`: `<client_id>.<secret>` of a CI API client, made with `php spark uc:create-ci-client`;
  - the secret `UC_CI_KEY`: the base64 libsodium Ed25519 secret key whose public half is pinned in the Update
    Center as a CI attestation key;
  - the variable `UC_CI_KEY_ID`, if that key's ID is not `ws-ci-1`.

---

[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)](https://www.gnu.org/licenses/agpl-3.0.en.html)
![Platforms Windows | macOS | Linux](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat)

## Welcome to the Desktop Editors repo!

[Desktop Editors](https://github.com/Euro-Office/DesktopEditors) is a free office suite that combines text, spreadsheet, presentation, and PDF editors & Diagram Viewer. The application allows creating, viewing and editing documents stored on your Windows/Linux PC or Mac without an Internet connection. It is fully compatible with Office Open XML formats: .docx, .xlsx, .pptx.

## Features you'll love ✨

Take advantage of the powerful editors included in Desktop Editors.

* Document Editor
* Spreadsheet Editor
* Presentation Editor
* Form Creator
* PDF Editor
* Diagram Viewer

The suite empowers you to create, edit, save, and export text documents, spreadsheets, presentations, PDFs, fill out PDF forms, open diagrams, all while offering additional advanced features such as:

* Connection to the cloud (Moodle, Nextcloud, ownCloud, Seafile, Liferay, kDrive) for real-time collaboration ☁️
* AI-powered assistants 🤖
* Digital signatures ✍️🔏
* Password protection 🔒🔑
* Scalable UI options (including dark mode 🌓)

## Localization 🌐

Constantly improving localization of the editors to make the suite accessible to all users, all over the world.

* Interface available in 46 languages
* RTL support
* Hieroglyph support 🈴

## Plugins 🧩

Desktop Editors offer support for plugins allowing developers to add specific features to the editors that are not directly related to the OOXML format.

## Components 📦

Desktop Editors contain the following components:

* [desktop-apps](https://github.com/Euro-Office/desktop-apps) - the frontend for Desktop Editors which is used to build the program interface for the operating system selected.
* [desktop-sdk](https://github.com/Euro-Office/desktop-sdk) - SDK which is a core part of Desktop Editors.
* [core](https://github.com/Euro-Office/core) - server core components for [Document Server][1] which is a part of Desktop Editors and is used to enable the conversion between the most popular office document formats (DOC, DOCX, ODT, RTF, TXT, PDF, HTML, EPUB, XPS, DjVu, XLS, XLSX, ODS, CSV, PPT, PPTX, ODP).
* [sdkjs](https://github.com/Euro-Office/sdkjs) - JavaScript SDK for the [Document Server][1] which is a part of Desktop Editors and contains API for all the included components client-side interaction.
* [web-apps](https://github.com/Euro-Office/web-apps) - the frontend for [Document Server][1] which is a part of Desktop Editors that allows the user to create, edit, save and export text, spreadsheet and presentation documents using the common interface of a document editor.
* [dictionaries](https://github.com/Euro-Office/dictionaries) - the dictionaries of various languages used for spellchecking in Desktop Editors.

## Build it yourself 🛠️

You can build Desktop Editors from source on **Windows** and **Linux**. This is a
super-repository, so the first step is always to check out the submodules:

```sh
git clone https://github.com/Euro-Office/DesktopEditors.git
cd DesktopEditors
git submodule update --init --recursive
```

Then head to the build docs:

* **[build/](./build/README.md)** — start here for the overall build model (the
  shared CMake definition, the common editors payload, vcpkg, and caching).
* **[build/windows/](./build/windows/README.md)** — the Windows build (`build.ps1`, MSVC + CMake).
* **[build/linux/](./build/linux/README.md)** — the Linux build (Docker / `docker buildx bake`).

## Get involved 🤝

Contributions are welcome! Whether it's a bug report, a feature idea, a
translation, or a pull request, here's how to take part:

* **Found a bug or have an idea?** Open an [issue](https://github.com/Euro-Office/DesktopEditors/issues)
  and describe what you ran into or what you'd like to see.
* **Want to contribute code?** Fork the relevant [component](#components-) repo,
  make your change, and open a pull request. For build changes, see the
  [build docs](./build/README.md) above.
* **Want to help translate?** Localization improvements are always appreciated —
  see 
  the editors' interface translations.

Please keep contributions compatible with the project's AGPL v3 license.

## License 📄

Desktop Editors is licensed under the GNU Affero Public License, version 3.0, ensuring its transparency and commitment to the open-source community.

  [1]: https://github.com/Euro-Office/DocumentServer