// multipart/form-data uploads (.wsmodel imports, audio files) streamed to disk with busboy.
import Busboy from "busboy";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ApiError } from "./errors";

export interface Upload { field: string; path: string; filename: string; mime: string; size: number }

export function parseMultipart(req: IncomingMessage, dir: string, maxBytes: number): Promise<{ files: Upload[]; fields: Record<string, string> }> {
  if (!/^multipart\/form-data/i.test(req.headers["content-type"] || "")) return Promise.reject(new ApiError("unsupported_media", "Expected multipart/form-data"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    const files: Upload[] = [];
    const fields: Record<string, string> = {};
    const pending: Promise<void>[] = [];
    let failed: ApiError | null = null;
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 2, fields: 20, fieldSize: 1 << 20 } });
    } catch {
      reject(new ApiError("bad_request", "Malformed multipart body"));
      return;
    }
    bb.on("file", (field, stream, info) => {
      const path = join(dir, `${randomUUID()}-${(info.filename || "upload").replace(/[^A-Za-z0-9._-]/g, "_").slice(-60)}`);
      const up: Upload = { field, path, filename: info.filename || "", mime: info.mimeType || "", size: 0 };
      files.push(up);
      const ws = createWriteStream(path, { mode: 0o600 });
      stream.on("data", (d: Buffer) => { up.size += d.length; });
      stream.on("limit", () => { failed = new ApiError("input_too_long", "The file is too large", { maxBytes }); });
      pending.push(new Promise((r, j) => { ws.on("finish", () => r()); ws.on("error", j); }));
      stream.pipe(ws);
    });
    bb.on("field", (name, value) => { fields[name] = value; });
    bb.on("error", () => reject(new ApiError("bad_request", "Malformed multipart body")));
    bb.on("close", () => {
      Promise.all(pending).then(() => {
        if (failed) { for (const f of files) rmSync(f.path, { force: true }); reject(failed); } else resolve({ files, fields });
      }, reject);
    });
    req.pipe(bb);
  });
}
