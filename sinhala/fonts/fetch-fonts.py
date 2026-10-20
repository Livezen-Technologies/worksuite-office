#!/usr/bin/env python3
"""Fetches the Unicode Sinhala fonts in manifest.json into a folder: each archive from its pinned URL,
its sha256 and every extracted file's sha256 checked. Only the listed files are written, flat, with
the licence as OFL.txt. Standard library only (it runs on the macOS, Linux and Windows builders).

    python fetch-fonts.py <destination folder>
"""
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
dest = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: fetch-fonts.py <destination folder>")
manifest = json.load(open(os.path.join(here, "manifest.json"), encoding="utf-8"))
os.makedirs(dest, exist_ok=True)

for font in manifest["unicode"]:
    with urllib.request.urlopen(font["url"], timeout=120) as response:
        data = response.read()
    got = hashlib.sha256(data).hexdigest()
    if got != font["sha256"]:
        sys.exit(f"{font['url']}: sha256 {got}, expected {font['sha256']}")
    archive = zipfile.ZipFile(io.BytesIO(data))
    for member, sha in sorted(font["files"].items()):
        content = archive.read(member)
        got = hashlib.sha256(content).hexdigest()
        if got != sha:
            sys.exit(f"{member}: sha256 {got}, expected {sha}")
        name = os.path.basename(member)
        with open(os.path.join(dest, name), "wb") as f:
            f.write(content)
        print(f"{font['family']} {font['version']}: {name}")
