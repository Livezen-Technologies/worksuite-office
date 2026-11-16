/*
 * WorkSuite Project and WorkSuite Diagram: may this person edit? (#73; decision in docs/project-diagram/roadmap.md)
 * Viewing is free; creating and editing need the Pro keys project.edit / diagram.edit.
 *
 * The editors ask the local AI service (worksuite-ai) the same way the PDF Editor does: the desktop shell
 * answers execCommand("ws-ai:endpoint", {req, start}) through on_native_message with {req, ok, port, token};
 * then GET /v1/license gives the licence status and the list of Pro features (ai-service/src/license.ts).
 *
 * Outside the desktop app (a plain browser, the tests) there is no licence to check and editing is allowed.
 * In the app, when the licence cannot be checked, the file opens read-only and says why, with a way to retry:
 * a file is never lost or locked away, only edits wait.
 */

export const UPGRADE_URL = "https://worksuitecloud.com/pro"; // the PDF Editor's upgrade page too (ProUpgrade.js)
const COMMAND = "ws-ai:endpoint";

/**
 * The decision from the service's licence status: { edit, reason }.
 * reason: "free" (not a Pro feature) | "pro" | "no_license" | "expired" | "revoked" | "grace_expired" | …
 */
export function canEdit(status, feature) {
  if (!status || typeof status !== "object") return { edit: false, reason: "unknown" };
  const pro = Array.isArray(status.proFeatures) ? status.proFeatures : [];
  if (!pro.includes(feature)) return { edit: true, reason: "free" };
  const granted = Array.isArray(status.features) && (status.features.includes("*") || status.features.includes(feature));
  if (status.plan === "pro" && status.active && granted) return { edit: true, reason: "pro" };
  if (status.plan === "pro" && !status.active) return { edit: false, reason: status.reason || "inactive" };
  if (status.plan === "pro" && !granted) return { edit: false, reason: "not_in_license" };
  return { edit: false, reason: "no_license" };
}

/** What the read-only bar says for a reason. */
export function reasonText(reason) {
  return {
    no_license: "Read-only · editing needs WorkSuite Office Pro",
    not_in_license: "Read-only · your licence does not include editing these files",
    expired: "Read-only · your Pro licence has expired",
    revoked: "Read-only · your Pro licence is no longer valid",
    grace_expired: "Read-only · connect to the internet to confirm your Pro licence",
    wrong_device: "Read-only · your Pro licence is for another computer",
    unavailable: "Read-only · the licence could not be checked",
    unknown: "Read-only · the licence could not be checked",
  }[reason] || "Read-only";
}

/** The service's address from the desktop shell: { base, token }; rejects when it cannot be reached. */
export function discover(win = globalThis.window, start = true, timeoutMs = 25000) {
  const native = win && win.AscDesktopEditor;
  if (!native || typeof native.execCommand !== "function") return Promise.reject(new Error("no desktop shell"));
  const req = "ws-app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  return new Promise((resolve, reject) => {
    const previous = win.on_native_message;
    let timer = null;
    const done = () => { clearTimeout(timer); if (win.on_native_message === listener) win.on_native_message = previous; };
    function listener(cmd, param) {
      if (cmd === COMMAND) {
        let a = null;
        try { a = typeof param === "string" ? JSON.parse(param) : param; } catch { a = null; }
        if (a && a.req === req) {
          done();
          if (!a.ok || !(Number(a.port) > 0)) return reject(new Error(a.reason || "unavailable"));
          return resolve({ base: `http://127.0.0.1:${Number(a.port)}/v1`, token: String(a.token || "") });
        }
      }
      if (typeof previous === "function") return previous.apply(this, arguments);
    }
    win.on_native_message = listener;
    timer = setTimeout(() => { done(); reject(new Error("unavailable")); }, timeoutMs);
    native.execCommand(COMMAND, JSON.stringify({ req, start }));
  });
}

/* GET with XMLHttpRequest: in the editors' frame window.fetch is replaced by a file loader (LocalPdf.js) */
function getJson(win, url, token) {
  return new Promise((resolve, reject) => {
    const xhr = new win.XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.timeout = 15000;
    xhr.onload = () => { try { xhr.status === 200 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error("HTTP " + xhr.status)); } catch (e) { reject(e); } };
    xhr.onerror = xhr.ontimeout = () => reject(new Error("unavailable"));
    xhr.send();
  });
}

/**
 * May this person edit files of `feature` ("project.edit" or "diagram.edit")? Resolves { edit, reason }; never
 * rejects. No desktop shell: editing allowed (reason "standalone").
 */
export async function checkEdit(feature, win = globalThis.window) {
  if (!win || !win.AscDesktopEditor) return { edit: true, reason: "standalone" };
  try {
    const { base, token } = await discover(win);
    return canEdit(await getJson(win, base + "/license", token), feature);
  } catch {
    return { edit: false, reason: "unavailable" };
  }
}

/** Opens the upgrade page in the browser. */
export function openUpgrade(win = globalThis.window) {
  try { win.open(UPGRADE_URL, "_blank"); } catch { /* nothing more we can do from here */ }
}
