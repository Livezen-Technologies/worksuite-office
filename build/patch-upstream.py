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
#  - CMake exports CC/CXX as full paths containing a space ("C:/Program Files/...").
#    OpenSSL's Configure copies CC into its makefile unquoted and nmake then fails
#    (U1073: don't know how to make '"apps\\apps.c"'). Let Configure pick plain "cl".
#  - Cygwin's bin is on PATH for other steps; its /usr/bin/link must not shadow
#    MSVC's link.exe.
edit("core/Common/3dParty/openssl/nc-build.py", [
    ('        ossl_target = openssl_windows_target()\n',
     '        ossl_target = openssl_windows_target()\n'
     '        for var in ( "CC", "CXX" ):\n'
     '            os.environ.pop( var, None )\n'
     '        os.environ[ "PATH" ] = os.pathsep.join(\n'
     '            p for p in os.environ[ "PATH" ].split( os.pathsep ) if "cygwin" not in p.lower() )\n'),
])


# Diagnostic mode (probe workflow only): build just OpenSSL and print what nmake sees.
import os
if os.environ.get("WS_PROBE_OPENSSL") == "1":
    edit("core/common.cmake", [
        ('"--except=openssl-hash,icu-wasm${NO_DESKTOP_EXCLUDE}" # cef and qt need old build environment, cannot be built here',
         '"--only=openssl"'),
    ])
    edit("core/Common/3dParty/openssl/nc-build.py", [
        ('        nc.run_command(\n            [ "nmake" ],\n',
         '        import subprocess\n'
         '        def _diag( cmd ):\n'
         '            r = subprocess.run( cmd, cwd = nc.work_dir, capture_output = True, text = True, shell = isinstance( cmd, str ) )\n'
         '            print( f"DIAG $ {cmd}\\n{r.stdout[-6000:]}\\n{r.stderr[-1500:]}", flush = True )\n'
         '        print( "DIAG python", sys.version, "cwd", os.getcwd(), "work_dir", repr( str( nc.work_dir ) ) )\n'
         '        print( "DIAG exists", ( nc.work_dir / "apps" / "apps.c" ).exists(), sorted( os.listdir( nc.work_dir ) )[:60] )\n'
         '        _names = sorted( os.environ.keys() )\n'
         '        for _i in range( 0, len( _names ), 12 ):\n'
         '            print( "DIAG envnames", " ".join( _names[ _i:_i + 12 ] ) )\n'
         '        for k in ( "MAKEFLAGS", "CL", "_CL_", "LINK", "PLATFORM", "CC", "CXX", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "RC", "RCFLAGS", "CPP", "AS", "MT", "AR", "APPS", "PASSWD", "VCPKG_KEEP_ENV_VARS", "PATHEXT" ):\n'
         '            print( "DIAG env", k, "=", os.environ.get( k ) )\n'
         '        _diag( "dir apps\\\\apps.c" )\n'
         '        _diag( "findstr /n /c:apps\\\\apps.c makefile" )\n'
         '        _diag( [ "nmake", "/N", "apps\\\\apps.obj" ] )\n'
         '        _diag( [ "nmake", "build_generated" ] )\n'
         '        _diag( [ "nmake", "/D", "/N", "_all" ] )\n'
         '        _diag( "findstr /n /c:passwd makefile" )\n'
         '        nc.run_command(\n            [ "nmake" ],\n'),
    ])
