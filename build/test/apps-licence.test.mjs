// build/apps/common/licence.js: free viewing, Pro editing for WorkSuite Project and Diagram (#73). The decision
// from the service's licence status, the read-only bar's words, and the whole check through a fake desktop shell
// (ws-ai:endpoint) and a fake service (GET /v1/license).
import { test } from "node:test";
import assert from "node:assert/strict";
import { canEdit, reasonText, checkEdit, UPGRADE_URL, openUpgrade } from "../apps/common/licence.js";

const PRO = ["ocr", "pdf.sign", "convert", "assistant", "project.edit", "diagram.edit"];

test("the decision from the licence status", () => {
  assert.deepEqual(canEdit({ plan: "free", active: true, features: [], proFeatures: PRO }, "project.edit"), { edit: false, reason: "no_license" });
  assert.deepEqual(canEdit({ plan: "pro", active: true, features: ["*"], proFeatures: PRO }, "diagram.edit"), { edit: true, reason: "pro" });
  assert.deepEqual(canEdit({ plan: "pro", active: true, features: ["project.edit"], proFeatures: PRO }, "diagram.edit"), { edit: false, reason: "not_in_license" });
  assert.deepEqual(canEdit({ plan: "pro", active: false, reason: "expired", features: ["*"], proFeatures: PRO }, "project.edit"), { edit: false, reason: "expired" });
  assert.deepEqual(canEdit({ plan: "free", active: true, features: [], proFeatures: ["ocr"] }, "project.edit"), { edit: true, reason: "free" }); // a policy that keeps editing free
  assert.deepEqual(canEdit(null, "project.edit"), { edit: false, reason: "unknown" });
});

test("every reason has words, and an unknown one still says read-only", () => {
  for (const r of ["no_license", "not_in_license", "expired", "revoked", "grace_expired", "wrong_device", "unavailable"]) assert.match(reasonText(r), /^Read-only · /, r);
  assert.equal(reasonText("something-new"), "Read-only");
});

function fakeWindow({ shell = true, answer, license, status = 200 }) {
  const win = { calls: [], opened: [], on_native_message: null };
  if (shell) win.AscDesktopEditor = {
    execCommand(cmd, param) {
      win.calls.push([cmd, JSON.parse(param)]);
      const { req } = JSON.parse(param);
      setTimeout(() => win.on_native_message("ws-ai:endpoint", JSON.stringify({ req, ...answer })), 1);
    },
  };
  win.XMLHttpRequest = class {
    open(method, url) { this.method = method; this.url = url; this.headers = {}; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send() { win.request = this; setTimeout(() => { this.status = status; this.responseText = JSON.stringify(license); this.onload(); }, 1); }
  };
  win.open = (url, target) => win.opened.push([url, target]);
  return win;
}

test("checkEdit asks the shell for the service, then the service for the licence", async () => {
  const win = fakeWindow({ answer: { ok: true, port: 41234, token: "tok" }, license: { plan: "pro", active: true, features: ["*"], proFeatures: PRO } });
  assert.deepEqual(await checkEdit("project.edit", win), { edit: true, reason: "pro" });
  assert.equal(win.calls[0][0], "ws-ai:endpoint");
  assert.equal(win.calls[0][1].start, true);
  assert.equal(win.request.url, "http://127.0.0.1:41234/v1/license");
  assert.equal(win.request.headers.Authorization, "Bearer tok");
  assert.equal(win.on_native_message, null, "the shell listener is removed afterwards");
});

test("no licence: read-only; service unreachable or refused by policy: read-only, never a crash", async () => {
  assert.deepEqual(await checkEdit("diagram.edit", fakeWindow({ answer: { ok: true, port: 1, token: "t" }, license: { plan: "free", active: true, features: [], proFeatures: PRO } })), { edit: false, reason: "no_license" });
  assert.deepEqual(await checkEdit("diagram.edit", fakeWindow({ answer: { ok: false, reason: "disabled-by-policy" } })), { edit: false, reason: "unavailable" });
  assert.deepEqual(await checkEdit("diagram.edit", fakeWindow({ answer: { ok: true, port: 1, token: "t" }, license: {}, status: 500 })), { edit: false, reason: "unavailable" });
});

test("outside the desktop app there is no licence to check: editing allowed", async () => {
  assert.deepEqual(await checkEdit("project.edit", fakeWindow({ shell: false })), { edit: true, reason: "standalone" });
});

test("Upgrade opens the same page as the PDF Editor's upsell", () => {
  const win = fakeWindow({ shell: false });
  openUpgrade(win);
  assert.deepEqual(win.opened, [[UPGRADE_URL, "_blank"]]);
  assert.equal(UPGRADE_URL, "https://worksuitecloud.com/pro");
});
