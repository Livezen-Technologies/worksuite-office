// Every issue code worksuite-ai's PDF/A check can report (ai-service/src/pdf/pdfa.ts, plus "encrypted" from
// tools.ts pdfaCheck) has a sentence in the PDF Editor's Convert tab (txtPdfa_<code>), so the result dialog
// never shows a bare code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("every PDF/A issue code has text in the editor", () => {
  const codes = new Set([...read("ai-service/src/pdf/pdfa.ts").matchAll(/add\("([a-z_]+)"/g)].map((m) => m[1]));
  for (const m of read("ai-service/src/pdf/tools.ts").matchAll(/code: "([a-z_]+)", severity/g)) codes.add(m[1]);
  assert.ok(codes.size >= 15, `found ${codes.size} codes`);
  const view = read("build/editors/apps/pdfeditor/main/app/view/ConvertTab.js");
  const missing = [...codes].filter((c) => !view.includes(`txtPdfa_${c}:`));
  assert.deepEqual(missing, []);
});
