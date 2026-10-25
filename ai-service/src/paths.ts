import { homedir } from "node:os";
import { join } from "node:path";

/** `<app data>/WorkSuite/ai` per OS, or WS_AI_DATA_DIR. */
export function defaultDataDir(env = process.env, platform = process.platform): string {
  if (env.WS_AI_DATA_DIR) return env.WS_AI_DATA_DIR;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "WorkSuite", "ai");
  if (platform === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "WorkSuite", "ai");
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "WorkSuite", "ai");
}

/** Discovery file: ~/.worksuite/ai/endpoint.json (WS_AI_ENDPOINT_FILE overrides, for tests). */
export function defaultEndpointFile(env = process.env): string {
  return env.WS_AI_ENDPOINT_FILE || join(homedir(), ".worksuite", "ai", "endpoint.json");
}

export interface Layout {
  dataDir: string;
  /** models/<id>/<version>/ — may be moved by POST /v1/storage/move */
  modelsDir: string;
  enginesDir: string;
  cacheDir: string;
  dictionariesDir: string;
  recordingsDir: string;
  settingsFile: string;
}

export function layout(dataDir: string, storagePath?: string | null): Layout {
  return {
    dataDir,
    modelsDir: join(storagePath || dataDir, "models"),
    enginesDir: join(dataDir, "engines"),
    cacheDir: join(dataDir, "cache"),
    dictionariesDir: join(dataDir, "dictionaries"),
    recordingsDir: join(dataDir, "recordings"),
    settingsFile: join(dataDir, "settings.json"),
  };
}
