// The user's own settings (not policy): defaults per task, privacy switches, storage path.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const TASKS = ["stt", "correction", "suggestions", "translation", "tts", "assistant"] as const;
export type Task = (typeof TASKS)[number];
export type DefaultChoice = string; // a model id, "auto" or "cloud"

export interface Settings {
  defaults: Record<Task, DefaultChoice>;
  privacy: { learning: boolean; keepRecordings: boolean };
  storagePath: string | null;
}

export function emptySettings(): Settings {
  return {
    defaults: { stt: "auto", correction: "auto", suggestions: "auto", translation: "auto", tts: "auto", assistant: "auto" },
    privacy: { learning: false, keepRecordings: false },
    storagePath: null,
  };
}

export class SettingsStore {
  data: Settings;
  constructor(readonly file: string) {
    this.data = emptySettings();
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>;
        this.data = { ...this.data, ...raw, defaults: { ...this.data.defaults, ...(raw.defaults || {}) }, privacy: { ...this.data.privacy, ...(raw.privacy || {}) } };
      }
    } catch { /* a broken settings file is replaced on the next save */ }
  }
  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
