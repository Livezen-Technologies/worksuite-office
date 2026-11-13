#!/usr/bin/env bash
# Checks that a WorkSuite Office Linux .deb can load its own binaries: every shared library that the app's
# programs need must be in the package or on the system. That is every executable (an ELF file with a
# program interpreter: DesktopEditors, converter/x2t, editors_helper, ...) and the Qt plugins the app
# always loads on X11. Libraries are looked up the way the app looks them up at run time: the
# launcher's LD_LIBRARY_PATH (the app directory), then each file's RPATH ($ORIGIN, $ORIGIN/converter,
# ...), then the system. Libraries on their own are not checked: the converter's rely on x2t's RPATH,
# and optional Qt plugins (Wayland, EGLFS) need libraries most systems do not have.
#
# 10.1.20 shipped without the ICU 55 libraries that build_tools' prebuilt Qt 5.9.9 links against, and
# the app could not start anywhere ("libicui18n.so.55: cannot open shared object file"). This is the
# check that would have caught it.
#
#   build/v10/check-linux-package.sh worksuite-office_10.1.32-1060_amd64.deb
set -uo pipefail

deb="${1:-}"
[ -f "$deb" ] || { echo "usage: $0 <package.deb>" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dpkg-deb -x "$deb" "$work" || { echo "cannot extract $deb" >&2; exit 2; }

app="$(dirname "$(find "$work/opt" -type f -name DesktopEditors -print -quit)")"
[ -d "$app" ] && [ "$app" != . ] || { echo "no DesktopEditors under /opt in $deb" >&2; exit 1; }

# The launcher sets LD_LIBRARY_PATH to the app directory; RPATH entries are resolved by ld.so itself.
export LD_LIBRARY_PATH="$app"
status=0
checked=0
while IFS= read -r -d '' f; do
  head -c 4 "$f" 2>/dev/null | grep -q $'^\x7fELF' || continue
  case "${f#"$app"/}" in
    platforms/libqxcb.so|platformthemes/libqgtk3.so) ;;
    *) readelf -l "$f" 2>/dev/null | grep -q 'program interpreter' || continue ;;
  esac
  checked=$((checked + 1))
  missing="$(ldd "$f" 2>/dev/null | awk '/=> not found/ { print $1 }' | sort -u)"
  if [ -n "$missing" ]; then
    echo "${f#"$work"}: missing $(echo "$missing" | tr '\n' ' ')"
    status=1
  fi
done < <(find "$app" -type f \( -name '*.so' -o -name '*.so.*' -o -perm -u+x \) -print0)

# worksuite-ai is a Node single executable: stripping it (dh_strip) destroys the injected app and it
# segfaults at start (10.1.20). It must at least answer --version.
if [ -f "$app/worksuite-ai" ]; then
  if out="$(timeout 30 "$app/worksuite-ai" --version 2>&1)" && [[ "$out" == worksuite-ai* ]]; then
    echo "${app#"$work"}/worksuite-ai runs: $out"
  else
    echo "${app#"$work"}/worksuite-ai does not run (exit $?): ${out:-no output}. Was it stripped?"
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All $checked programs and plugins in $(basename "$deb") find their libraries."
else
  echo "Some programs in $(basename "$deb") cannot load or run (see above)."
fi
exit "$status"
