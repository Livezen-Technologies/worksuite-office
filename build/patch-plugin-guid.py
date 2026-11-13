#!/usr/bin/env python3
"""A plugin's folder name must be a real guid. Applied in CI to desktop-sdk before the editors build.

The desktop plugin manager (desktop-sdk ChromiumBasedEditors/lib/src/plugins.h) names a plugin's
folder after the guid it reads, and uses it straight as a path under the plugins directory:
  AddPlugin:     m_strUserDirectory + L"/" + sPluginName   (sPluginName = the {...} from config.json)
  RemovePlugin:  m_strUserDirectory + L"/" + sAdd           (sAdd = the guid passed to it)
  RestorePlugin: m_strUserDirectory + L"/" + sAdd
Nothing checked the guid was a guid. A crafted config.json ("guid":"{/../../../../.config/autostart/x}")
made AddPlugin copy the package's own files outside the plugins directory (CopyDirectory), to a place
the user can write - an autostart entry, say - when a .plugin file is merely opened. The zip itself is
extracted safely (ExtractToDirectory checkEscapePath), but the folder name was not.

This adds NSPluginPermissions::IsValidPluginGuid (strict {8-4-4-4-12 hex}) and makes all three return
false for anything else. The guid of every real plugin, the AI panel's and the macros guid included,
is of this form, so nothing legitimate changes.

Usage: patch-plugin-guid.py path/to/desktop-sdk
Running it again changes nothing.
"""
from pathlib import Path
import sys

VALIDATOR = """	// A plugin's folder name is its guid, used as a path under the plugins directory. Only a real guid
	// {8-4-4-4-12 hex} is allowed here, so a crafted guid (\"{/../../x}\") cannot make install, remove or
	// restore touch a path outside that directory (WorkSuite, build/patch-plugin-guid.py).
	inline bool IsValidPluginGuid(const std::wstring& sGuid)
	{
		std::wstring sValue = sGuid;
		std::wstring::size_type nPos = sValue.find(L'{');
		if (std::wstring::npos == nPos)
			return false;
		if (0 != nPos)
			sValue = sValue.substr(nPos);

		// {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
		if (38 != sValue.length() || L'{' != sValue[0] || L'}' != sValue[37])
			return false;
		for (std::wstring::size_type i = 1; i < 37; ++i)
		{
			wchar_t c = sValue[i];
			if (9 == i || 14 == i || 19 == i || 24 == i)
			{
				if (L'-' != c)
					return false;
			}
			else if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') || (c >= L'A' && c <= L'F')))
				return false;
		}
		return true;
	}

	inline bool IsProtectedGuid(const std::wstring& sGuid)
"""

ADD_OLD = """		if (NSPluginPermissions::IsProtectedGuid(sPluginName))
			return false;

		std::wstring sNew = m_strUserDirectory + L"/" + sPluginName;"""
ADD_NEW = """		if (NSPluginPermissions::IsProtectedGuid(sPluginName))
			return false;

		// WorkSuite (build/patch-plugin-guid.py): the folder name must be a real guid, not a path
		if (!NSPluginPermissions::IsValidPluginGuid(sPluginName))
			return false;

		std::wstring sNew = m_strUserDirectory + L"/" + sPluginName;"""

# RemovePlugin and RestorePlugin share this exact block (both guard sAdd).
GUID_OLD = """		if (NSPluginPermissions::IsProtectedGuid(sAdd))
			return false;
"""
GUID_NEW = """		if (NSPluginPermissions::IsProtectedGuid(sAdd))
			return false;

		// WorkSuite (build/patch-plugin-guid.py): the folder name must be a real guid, not a path
		if (!NSPluginPermissions::IsValidPluginGuid(sAdd))
			return false;
"""


def edit(path, old, new, count, marker):
    text = open(path, encoding="utf-8", newline="").read()
    if marker in text:
        return  # already patched
    crlf = "\r\n" in text
    o, n = (old.replace("\n", "\r\n"), new.replace("\n", "\r\n")) if crlf else (old, new)
    if text.count(o) != count:
        sys.exit(f"patch-plugin-guid: expected {count} of a block in {path}, found {text.count(o)}")
    open(path, "w", encoding="utf-8", newline="").write(text.replace(o, n))


root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-plugin-guid.py path/to/desktop-sdk")
src = root / "ChromiumBasedEditors" / "lib" / "src"
perms = src / "plugin_permissions.h"
plugins = src / "plugins.h"
for p in (perms, plugins):
    if not p.is_file():
        sys.exit(f"patch-plugin-guid: {p} not found")

edit(perms, "\tinline bool IsProtectedGuid(const std::wstring& sGuid)\n", VALIDATOR, 1, "IsValidPluginGuid")
edit(plugins, ADD_OLD, ADD_NEW, 1, "IsValidPluginGuid(sPluginName)")
edit(plugins, GUID_OLD, GUID_NEW, 2, "IsValidPluginGuid(sAdd)")
print(f"patched {perms}")
print(f"patched {plugins}")
