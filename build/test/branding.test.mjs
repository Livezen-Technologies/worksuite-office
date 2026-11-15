// build/patch-branding.py renames what the editors show: here, that their messages name the
// "WorkSuite Document Engine" instead of the upstream's "Document Server" in every editor's locales
// (desktop and mobile), that the licensor notice is kept, and that the patch stops when the phrase is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const patch = join(dirname(fileURLToPath(import.meta.url)), "..", "patch-branding.py");
const python = process.platform === "win32" ? "python" : "python3";
const EDITORS = ["documenteditor", "spreadsheeteditor", "presentationeditor", "pdfeditor", "visioeditor"];
const MSG = "Fonts are not loaded.<br>Please contact your Document Server administrator.";

function fixture(withPhrase = true) {
  const root = mkdtempSync(join(tmpdir(), "ws-branding-"));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const vars = ["SUPPORT_EMAIL", "SUPPORT_URL", "SALES_EMAIL", "PUBLISHER_URL", "COMPANY_NAME", "APP_TITLE_TEXT",
    "HELP_URL", "HELP_CENTER_WEB_DE", "HELP_CENTER_WEB_SSE", "HELP_CENTER_WEB_PE", "SUGGEST_URL"];
  put("build/Gruntfile.js", vars.map((v) => `x = _encode(process.env.${v}) || 'upstream';`).join("\n"));
  put("apps/common/main/lib/view/About.js",
    "publisherurl: '{{PUBLISHER_URL}}',\nsupportemail: '{{SUPPORT_EMAIL}}',\ntxtPoweredBy: 'Powered by'");
  put("apps/documenteditor/main/app/controller/HeaderFooterTab.js",
    "'https://helpcenter.onlyoffice.com/docs/document_editor/InsertFieldCodes.aspx'");
  put("apps/common/main/lib/view/MacrosDialog.js", "'https://api.onlyoffice.com/docs/plugin-and-macros/macros/getting-started/'");
  put("apps/api/documents/index.html.desktop", '<a href="https://helpdesk.onlyoffice.com/?desktop=true">');
  put("apps/documenteditor/main/index.html", "<title>ONLYOFFICE Document Editor</title>");
  for (const e of EDITORS) {
    const text = withPhrase ? MSG : "Fonts are not loaded.";
    put(`apps/${e}/main/locale/en.json`, JSON.stringify({ "Common.Controllers.Main.errorFonts": text }));
    put(`apps/${e}/mobile/locale/en.json`, JSON.stringify({ "Main.errorFonts": text }));
  }
  if (withPhrase) put("apps/documenteditor/main/locale/de.json",
    JSON.stringify({ x: "Bitte wenden Sie sich an Ihren Document Server-Administrator." }));
  return root;
}

const run = (root) => execFileSync(python, [patch, root], { encoding: "utf-8", stdio: "pipe" });

test("every editor locale names the WorkSuite Document Engine", () => {
  const root = fixture();
  try {
    assert.match(run(root), /patched the engine name in 11 locales/);
    for (const e of EDITORS) {
      for (const kind of ["main", "mobile"]) {
        const text = readFileSync(join(root, `apps/${e}/${kind}/locale/en.json`), "utf-8");
        assert.ok(text.includes("contact your WorkSuite Document Engine administrator"), `${e}/${kind}`);
        assert.ok(!text.includes("Document Server"), `${e}/${kind}`);
      }
    }
    assert.ok(readFileSync(join(root, "apps/documenteditor/main/locale/de.json"), "utf-8")
      .includes("WorkSuite Document Engine-Administrator"));
    // the licensor notice stays the upstream's
    assert.ok(readFileSync(join(root, "apps/common/main/lib/view/About.js"), "utf-8").includes("https://www.onlyoffice.com"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the patch stops when no locale names the Document Server", () => {
  const root = fixture(false);
  try {
    assert.throws(() => run(root), (e) => /Document Server/.test(String(e.stderr)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
