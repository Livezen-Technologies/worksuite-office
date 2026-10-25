#!/usr/bin/env python3
"""Fetches the fonts in manifest.json into a folder: each one from its pinned URL, its sha256 (and, for an
archive, every extracted file's sha256) checked. Only the listed files are written, flat, with the Noto
licence as OFL.txt; legacy fonts go into <destination>/legacy. Standard library only (it runs on the macOS,
Linux and Windows builders).

A font marked optional (and every legacy font) that cannot be downloaded is a warning, not a failure: the
build goes on without it and the editor uses the user's installed copy. A font file with the wrong sha256 always fails.
--strict makes a missing optional font fail too.

    python fetch-fonts.py <destination folder> [--strict]
"""
import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
strict = "--strict" in sys.argv[1:]
dest = args[0] if args else sys.exit("usage: fetch-fonts.py <destination folder> [--strict]")
manifest = json.load(open(os.path.join(here, "manifest.json"), encoding="utf-8"))
os.makedirs(dest, exist_ok=True)
missing = []
FONT_MAGIC = (b"\x00\x01\x00\x00", b"true", b"OTTO", b"ttcf")


def download(font, optional):
    try:
        with urllib.request.urlopen(font["url"], timeout=120) as response:
            data = response.read()
    except (urllib.error.URLError, OSError) as e:
        if optional and not strict:
            missing.append(font["family"])
            print(f"warning: {font['family']}: {font['url']} could not be fetched ({e}); not bundled", file=sys.stderr)
            return None
        sys.exit(f"{font['url']}: {e}")
    got = hashlib.sha256(data).hexdigest()
    if got != font["sha256"]:
        # the download server answers a file not uploaded yet with an HTML page (status 200)
        if optional and not strict and "file" in font and data[:4] not in FONT_MAGIC:
            missing.append(font["family"])
            print(f"warning: {font['family']}: {font['url']} is not a font yet (not uploaded?); not bundled", file=sys.stderr)
            return None
        sys.exit(f"{font['url']}: sha256 {got}, expected {font['sha256']}")
    return data


def write(folder, name, content):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as f:
        f.write(content)


for font in manifest["unicode"]:
    data = download(font, font.get("optional", False))
    if data is None:
        continue
    if "file" in font:
        write(dest, font["file"], data)
        print(f"{font['family']}: {font['file']}")
        continue
    archive = zipfile.ZipFile(io.BytesIO(data))
    for member, sha in sorted(font["files"].items()):
        content = archive.read(member)
        got = hashlib.sha256(content).hexdigest()
        if got != sha:
            sys.exit(f"{member}: sha256 {got}, expected {sha}")
        name = os.path.basename(member)
        write(dest, name, content)
        print(f"{font['family']} {font['version']}: {name}")

for font in manifest["legacy"]:
    if "url" not in font:
        continue  # FM Abhaya, DL Manel, Kaputa: never shipped, only their maps
    data = download(font, True)
    if data is not None:
        write(os.path.join(dest, "legacy"), font["file"], data)
        print(f"{font['family']} (legacy): {font['file']}")

if missing:
    print(f"warning: {len(missing)} optional font(s) not bundled: {', '.join(missing)}", file=sys.stderr)
