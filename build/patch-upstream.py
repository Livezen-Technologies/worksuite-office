#!/usr/bin/env python3
"""Fixes to the unmodified Euro-Office submodules, applied in CI before a build.

Euro-Office's own builds download prebuilt third-party libraries from a private
cache, so their build-from-source path is not exercised and has drifted. We have
no such cache, so we repair that path here instead of forking the submodules.
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent


def edit(rel, pairs):
    path = root / rel
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in text:
            sys.exit(f"patch-upstream: expected text not found in {rel}:\n{old}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"patched {rel}")


# V8: gclient_paths.patch only strips @functools.lru_cache from depot_tools'
# gclient_paths.py, but depot_tools is cloned at its moving HEAD and the patch
# context no longer matches. Strip the decorators directly instead.
edit("core/Common/3dParty/v8/nc-build.py", [
    ('        { "name": "gclient_paths.patch", "dir": depot_tools_path },\n', ""),
    ('def apply_patches():\n',
     'def apply_patches():\n'
     '    gclient_paths = depot_tools_path / "gclient_paths.py"\n'
     '    if gclient_paths.is_file():\n'
     '        kept = [ l for l in gclient_paths.read_text().splitlines( keepends = True )\n'
     '                 if l.strip() != "@functools.lru_cache" ]\n'
     '        gclient_paths.write_text( "".join( kept ) )\n'
     '\n'),
])


# OpenSSL on Windows, two problems in the desktop build's environment:
#  - CMake exports CC, CXX and RC as full paths containing a space ("C:/Program Files/...").
#    OpenSSL's Configure copies CC into its makefile unquoted and nmake then fails
#    (U1073: don't know how to make '"apps\\apps.c"'). Let Configure pick the plain tool names.
#  - Cygwin's bin is on PATH for other steps; its /usr/bin/link must not shadow
#    MSVC's link.exe.
edit("core/Common/3dParty/openssl/nc-build.py", [
    ('        ossl_target = openssl_windows_target()\n',
     '        ossl_target = openssl_windows_target()\n'
     '        for var in ( "CC", "CXX", "RC", "AS", "AR", "LD", "MT" ):\n'
     '            os.environ.pop( var, None )\n'
     '        os.environ[ "PATH" ] = os.pathsep.join(\n'
     '            p for p in os.environ[ "PATH" ].split( os.pathsep ) if "cygwin" not in p.lower() )\n'),
])
