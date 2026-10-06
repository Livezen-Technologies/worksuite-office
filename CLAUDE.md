# WorkSuite Office

## Versions

Every change that ships gets a new version, in the same pull request:

1. Run `build/set-version.sh <major.minor.patch>`. It writes the version to `VERSION`, the build and publish
   workflows, the Linux bake files, the Windows build script and the build README.
   - WorkSuite changes on the same upstream base take the next patch version: 9.3.2, 9.3.3, …
   - On a move to a new Euro-Office / ONLYOFFICE release, take that release's version (say 9.4.0) and go on
     with patch versions above it. `OO_TAG` in `build-mac.yml` is the upstream source tag, not our version.
2. Add the version's section at the top of `CHANGELOG.md`, in its style: `### New features` and `### Fixes`,
   with `####` areas. Words the spellchecker does not know go into `.aspell.en.pws`.
3. Write `build/release-notes/<version>.md`, the notes the Update Center shows, in its sections:
   `## New Features`, `## Improvements`, `## Bug Fixes`, `## Known Issues`, and so on.
4. `build/check-version.sh` must pass. The Check workflow runs it.

Build numbers are separate. A Mac build's `CFBundleVersion`, which Sparkle compares, is 1000 + its run number
unless `build_number` is given; it must only rise.

The `desktop-apps` submodule (Livezen-Technologies/worksuite-office-desktop-apps) has no version of its own.
A change there ships through a pin bump here, with the version, changelog and release notes here.
