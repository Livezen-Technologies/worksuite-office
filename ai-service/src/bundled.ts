// Sinhala voice typing that ships with the app: whisper.cpp's whisper-server and a Sinhala speech model in
// a "speech" folder next to this executable. No catalog, approval list, download or developer mode: the
// expected model file (name, size, SHA-256) and its measured Sinhala accuracy are compiled in here, in
// worksuite-ai, which is code-signed with the app. The file is hashed in full against that before it is
// used (the result is remembered for the same size and modification time, so 190 MB is not read again on
// every start). A model installed from the catalog with the same task can still replace it.
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "./manifest";

/**
 * Whisper Small fine-tuned for Sinhala (seniruk/whisper-small-si, Apache-2.0), converted to
 * ggml with whisper.cpp's convert-h5-to-ggml.py and quantised to q5_1 by build/v10/speech.sh.
 * evaluation.si: word and character error rates measured by build/v10/speech.sh's recipe on held-out
 * native-speaker recordings (OpenSLR 30, CC BY-SA 4.0), see build/speech/EVALUATION.md.
 */
export const BUNDLED_STT: Manifest = {
  id: "worksuite-si-stt",
  name: "Sinhala voice typing",
  version: "1.0.0",
  tasks: ["stt"],
  languages: ["si"],
  engine: "whisper.cpp",
  files: [{ path: "ggml-small-si-q5_1.bin", size: 190085504, sha256: "b670a473ad90b492ee4ca249c7fd19724f5570025ff69242ff7ad611703911dc" }],
  ramMB: 600,
  backends: ["cpu"],
  license: "Apache-2.0",
  source: "https://huggingface.co/seniruk/whisper-small-si@fbd37479362cfd32fd99709a8757bb8bad2bd5ed",
  // as the service runs it (greedy, no timestamps, the window sized to each utterance); build/speech/EVALUATION.md
  evaluation: { si: { wer: 0.231, cer: 0.039, set: "openslr30-si-heldout-60" } },
};

const WHISPER_SERVER = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";

/**
 * The folder the app ships the speech engine and model in: "speech" next to worksuite-ai (Windows, Linux),
 * or the app bundle's Contents/Resources/speech (macOS: data files do not belong in Contents/MacOS).
 * WS_AI_BUNDLED_DIR in tests.
 */
export function bundledDir(env = process.env): string {
  if (env.WS_AI_BUNDLED_DIR) return env.WS_AI_BUNDLED_DIR;
  const beside = join(dirname(process.execPath), "speech");
  const resources = join(dirname(process.execPath), "..", "Resources", "speech");
  return process.platform === "darwin" && !existsSync(beside) && existsSync(resources) ? resources : beside;
}

/** The shipped whisper-server, or null. */
export function bundledWhisperServer(env = process.env): string | null {
  const p = join(bundledDir(env), WHISPER_SERVER);
  return existsSync(p) ? p : null;
}

function sha256Sync(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 22);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally { closeSync(fd); }
  return h.digest("hex");
}

export interface BundledModel { manifest: Manifest; dir: string; sizeBytes: number }
export type BundledCheck = { ok: true; model: BundledModel } | { ok: false; reason: "absent" | "integrity_failed"; detail?: string };

/**
 * The shipped speech model, after its file is checked against BUNDLED_STT. `cacheDir` keeps the
 * verdict for the file's size and modification time.
 */
export function checkBundledStt(cacheDir: string, env = process.env, manifest: Manifest = BUNDLED_STT): BundledCheck {
  const dir = bundledDir(env);
  const f = manifest.files[0];
  const path = join(dir, f.path);
  if (!existsSync(path)) return { ok: false, reason: "absent" };
  const st = statSync(path);
  if (st.size !== f.size) return { ok: false, reason: "integrity_failed", detail: `size ${st.size}, expected ${f.size}` };
  const stamp = { path, size: st.size, mtimeMs: st.mtimeMs, sha256: f.sha256 };
  const cacheFile = join(cacheDir, "bundled-stt.json");
  try {
    const seen = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (seen.path === stamp.path && seen.size === stamp.size && seen.mtimeMs === stamp.mtimeMs && seen.sha256 === stamp.sha256) {
      return { ok: true, model: { manifest, dir, sizeBytes: st.size } };
    }
  } catch { /* not checked yet */ }
  const got = sha256Sync(path);
  if (got !== f.sha256) return { ok: false, reason: "integrity_failed", detail: `sha256 ${got}` };
  try { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cacheFile, JSON.stringify(stamp)); } catch { /* checked again next start */ }
  return { ok: true, model: { manifest, dir, sizeBytes: st.size } };
}
