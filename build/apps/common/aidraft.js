/*
 * WorkSuite Project and Diagram: drafts from the local AI (#88). worksuite-ai's POST /v1/apps/draft writes an
 * outline (kind "plan") or a table ("org", "flow") from a description; the editor then shows it in its paste
 * dialog to check and change before it becomes a plan or a diagram. Nothing leaves the computer.
 */
import { discover } from "./licence.js";

/** Plain words for the service's error codes. */
export function draftError(code, message) {
  return {
    model_not_installed: "No AI model is installed yet. Open WorkSuite AI settings and install the assistant model.",
    capability_unavailable: "The AI assistant is not available on this computer yet.",
    forbidden_by_policy: "Your organization has turned the AI assistant off.",
    payment_required: "AI drafts are part of WorkSuite Office Pro.",
    no_shell: "AI drafts need the WorkSuite Office desktop app with Local AI.",
  }[code] || message || "The AI draft did not work. Try again, or describe it differently.";
}

/** Resolves the draft text; rejects with an Error whose message is ready to show. */
export async function aiDraft(kind, prompt, win = globalThis.window, host = win) {
  let ep;
  try { ep = await discover(win, true, 25000, host); } catch { throw new Error(draftError("no_shell")); }
  return new Promise((resolve, reject) => {
    const xhr = new win.XMLHttpRequest(); // the editors' frame replaces window.fetch (see licence.js)
    xhr.open("POST", ep.base + "/apps/draft", true);
    xhr.setRequestHeader("Authorization", "Bearer " + ep.token);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 180000; // a first draft can load the model
    xhr.onload = () => {
      let j = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && j && typeof j.text === "string") resolve(j.text);
      else reject(new Error(draftError(j?.error?.code, j?.error?.message)));
    };
    xhr.onerror = () => reject(new Error(draftError("no_shell")));
    xhr.ontimeout = () => reject(new Error("The AI took too long. Try a shorter description."));
    xhr.send(JSON.stringify({ kind, prompt }));
  });
}
