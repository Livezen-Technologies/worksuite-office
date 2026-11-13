// build/patch-plugin-guid.py guards the desktop plugin manager so a plugin's folder name must be a real
// guid, not a path. This test applies the patch to a fixture that carries the exact upstream anchors,
// checks it guards all three sinks (AddPlugin / RemovePlugin / RestorePlugin) and is idempotent, then
// compiles the inserted validator with g++ and runs attack vectors through it. The g++ step is skipped
// where no compiler is present, so the structural checks still run everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const patch = join(dirname(fileURLToPath(import.meta.url)), "..", "patch-plugin-guid.py");

// minimal headers carrying the exact text the patch anchors on (tabs as in the sources)
const PERMS = `#ifndef P_H
#define P_H
#include <string>
namespace NSPluginPermissions
{
\tinline bool IsProtectedGuid(const std::wstring& sGuid)
\t{
\t\treturn false;
\t}
}
#endif
`;
const PLUGINS = `#include "plugin_permissions.h"
\tbool AddPlugin(const std::wstring& sFilePlugin)
\t{
\t\tstd::wstring sPluginName = L"{x}";
\t\tif (NSPluginPermissions::IsProtectedGuid(sPluginName))
\t\t\treturn false;

\t\tstd::wstring sNew = m_strUserDirectory + L"/" + sPluginName;
\t}
\tbool RestorePlugin(const std::wstring& sGuid)
\t{
\t\tstd::wstring sAdd = sGuid;
\t\tif (NSPluginPermissions::IsProtectedGuid(sAdd))
\t\t\treturn false;
\t\tstd::wstring sPluginDir = m_strUserDirectory + L"/" + sAdd;
\t}
\tbool RemovePlugin(const std::wstring& sGuid, const bool& bBackup)
\t{
\t\tstd::wstring sAdd = sGuid;
\t\tif (NSPluginPermissions::IsProtectedGuid(sAdd))
\t\t\treturn false;
\t\tstd::wstring sPluginDir = m_strUserDirectory + L"/" + sAdd;
\t}
`;

function applyTo(dir) {
  const src = join(dir, "ChromiumBasedEditors", "lib", "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "plugin_permissions.h"), PERMS);
  writeFileSync(join(src, "plugins.h"), PLUGINS);
  execFileSync("python3", [patch, dir], { stdio: "pipe" });
  return src;
}

test("patch guards AddPlugin, RemovePlugin and RestorePlugin, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "guidpatch-"));
  try {
    const src = applyTo(dir);
    // second run must change nothing
    execFileSync("python3", [patch, dir], { stdio: "pipe" });
    const perms = readFileSync(join(src, "plugin_permissions.h"), "utf8");
    const plugins = readFileSync(join(src, "plugins.h"), "utf8");
    assert.equal((perms.match(/inline bool IsValidPluginGuid/g) || []).length, 1, "one validator");
    assert.equal((plugins.match(/IsValidPluginGuid\(sPluginName\)/g) || []).length, 1, "AddPlugin guard");
    assert.equal((plugins.match(/IsValidPluginGuid\(sAdd\)/g) || []).length, 2, "Remove+Restore guards");
    // each guard sits before its path construction
    assert.ok(plugins.indexOf("IsValidPluginGuid(sPluginName)") < plugins.indexOf('sNew = m_strUserDirectory'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the inserted validator accepts real guids and rejects traversal (g++)", () => {
  const dir = mkdtempSync(join(tmpdir(), "guidc-"));
  try {
    const src = applyTo(dir);
    const perms = readFileSync(join(src, "plugin_permissions.h"), "utf8");
    const m = perms.match(/inline bool IsValidPluginGuid[\s\S]*?\n\t\}/);
    assert.ok(m, "found validator body");
    const main = `#include <string>
#include <cstdio>
${m[0].replace(/^\t/gm, "")}
static const struct { const wchar_t* g; bool want; } T[] = {
  {L"{9DC93CDB-B576-4F0C-B55E-FCC9C48DD777}", true},
  {L"asc.{32e76b9e-0000-0000-0000-000000000001}", true},
  {L"{/../../../../.config/autostart/x}", false},
  {L"{/../../tmp/evil}", false},
  {L"{32E76B9E-0000-0000-0000-00000000000G}", false},
  {L"{32E76B9E-0000-0000-0000-000000000001}/../x", false},
  {L"evil", false}, {L"", false}, {L"{..}", false},
};
int main(){ int bad=0; for (auto&t:T){ if (IsValidPluginGuid(t.g)!=t.want) bad++; } return bad; }
`;
    writeFileSync(join(dir, "m.cpp"), main);
    try {
      execFileSync("g++", ["-std=c++14", "-O1", join(dir, "m.cpp"), "-o", join(dir, "m")], { stdio: "pipe" });
    } catch {
      return; // no compiler here: the structural test above still ran
    }
    execFileSync(join(dir, "m"), { stdio: "pipe" }); // non-zero exit => a vector was wrong
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
