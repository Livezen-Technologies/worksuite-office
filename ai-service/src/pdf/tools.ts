// /v1/pdf/*: PDF jobs on files on this computer (merge, split, rotate, protect, unprotect, images to PDF, info).
// Pure JavaScript (@cantoo/pdf-lib, MIT): nothing to download, the same on every platform. Protect writes
// AES-256 (ISO 32000-2) with the permissions asked for. Outputs never overwrite a file: a taken name gets " (2)".
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { degrees, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { ApiError } from "../errors";
import type { JobControl } from "../jobs";

export const PDF_OPS = ["merge", "split", "rotate", "protect", "unprotect", "images-to-pdf"] as const;
export type PdfOp = (typeof PDF_OPS)[number];

export interface PdfResult { file: string; files: string[]; contentType: "application/pdf"; pages: number }

export interface Permissions {
  printing?: "none" | "low" | "high";
  copying?: boolean;
  modifying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  assembling?: boolean;
}

const MAX_BYTES = 1024 * 1024 * 1024;

function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ApiError("bad_request", `"${name}" must be an object`);
  return v as Record<string, unknown>;
}

export function filePath(v: unknown, name: string, ext?: RegExp): string {
  if (typeof v !== "string" || !v || !isAbsolute(v)) throw new ApiError("bad_request", `"${name}" must be an absolute path`);
  if (ext && !ext.test(v)) throw new ApiError("unsupported_media", `"${name}" is not a supported file`, { path: v });
  return v;
}

function input(path: string): Buffer {
  if (!existsSync(path) || !statSync(path).isFile()) throw new ApiError("not_found", "No such file", { path });
  if (statSync(path).size > MAX_BYTES) throw new ApiError("input_too_long", "The file is larger than 1 GB", { path });
  return readFileSync(path);
}

/** `<dir>/<name><suffix>.pdf`, or with " (2)", " (3)"… when that is taken. */
export function freeName(dir: string, name: string): string {
  const stem = name.replace(/\.pdf$/i, "");
  for (let i = 1; ; i++) {
    const p = join(dir, `${stem}${i > 1 ? ` (${i})` : ""}.pdf`);
    if (!existsSync(p)) return p;
  }
}

function outFor(body: Record<string, unknown>, source: string, suffix: string): string {
  if (body.out !== undefined) {
    const out = filePath(body.out, "out", /\.pdf$/i);
    if (!existsSync(dirname(out))) throw new ApiError("not_found", "The output folder does not exist", { path: dirname(out) });
    return existsSync(out) ? freeName(dirname(out), basename(out)) : out;
  }
  return freeName(dirname(source), basename(source, extname(source)) + suffix);
}

async function load(path: string, password?: string): Promise<PDFDocument> {
  const bytes = input(path);
  try {
    const doc = await PDFDocument.load(bytes, password ? { password, ignoreEncryption: false } : { ignoreEncryption: false });
    if (password) dropEncryptDict(doc);
    return doc;
  } catch (e) {
    const msg = (e as Error).message || "";
    if (/encrypted/i.test(msg)) throw new ApiError("bad_request", "This PDF has a password", { path, reason: "password_required" });
    if (/password/i.test(msg)) throw new ApiError("bad_request", "The password is not right", { path, reason: "password_incorrect" });
    throw new ApiError("unsupported_media", "This file is not a PDF that can be read", { path });
  }
}

// A decrypted document keeps the old encryption dictionary as a loose object, which would make the saved
// file look encrypted again to some readers.
function dropEncryptDict(doc: PDFDocument): void {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Filter")) === PDFName.of("Standard")) doc.context.delete(ref);
  }
}

async function write(doc: PDFDocument, out: string): Promise<number> {
  writeFileSync(out, await doc.save(), { flag: "wx" });
  return doc.getPageCount();
}

/** Page numbers (1-based) as written, e.g. [1,2,3,7]; checked against the page count. */
export function pageList(v: unknown, count: number, name = "pages"): number[] {
  if (!Array.isArray(v) || !v.length) throw new ApiError("bad_request", `"${name}" must be a list of page numbers`);
  return v.map((n) => {
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > count) throw new ApiError("bad_request", `Page ${String(n)} is not in this PDF (1–${count})`);
    return n as number;
  });
}

function mapPermissions(p: Permissions | undefined) {
  const allow = (v: boolean | undefined) => v !== false;
  const printing = p?.printing === "none" ? false : p?.printing === "low" ? ("lowResolution" as const) : ("highResolution" as const);
  return {
    printing, copying: allow(p?.copying), modifying: allow(p?.modifying), annotating: allow(p?.annotating),
    fillingForms: allow(p?.fillingForms), contentAccessibility: true, documentAssembly: allow(p?.assembling),
  };
}

function permissions(v: unknown): Permissions | undefined {
  if (v === undefined) return undefined;
  const p = obj(v, "permissions");
  const out: Permissions = {};
  if (p.printing !== undefined) {
    if (!["none", "low", "high"].includes(p.printing as string)) throw new ApiError("bad_request", '"permissions.printing" must be none, low or high');
    out.printing = p.printing as Permissions["printing"];
  }
  for (const k of ["copying", "modifying", "annotating", "fillingForms", "assembling"] as const) {
    if (p[k] === undefined) continue;
    if (typeof p[k] !== "boolean") throw new ApiError("bad_request", `"permissions.${k}" must be true or false`);
    out[k] = p[k] as boolean;
  }
  return out;
}

function password(v: unknown, name: string): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || v.length > 127) throw new ApiError("bad_request", `"${name}" must be text of at most 127 characters`);
  return v;
}

/** Checks a request and returns the job to run, so bad requests fail before a job starts. */
export function pdfJob(op: PdfOp, raw: unknown): (job: JobControl) => Promise<PdfResult> {
  const body = obj(raw, "body");
  const PDF = /\.pdf$/i;
  const pw = password(body.password, "password");
  switch (op) {
    case "merge": {
      if (!Array.isArray(body.paths) || body.paths.length < 2) throw new ApiError("bad_request", '"paths" must list two PDFs or more');
      const paths = body.paths.map((p, i) => filePath(p, `paths[${i}]`, PDF));
      return async (job) => {
        const doc = await PDFDocument.create();
        for (let i = 0; i < paths.length; i++) {
          job.signal.throwIfAborted();
          const src = await load(paths[i]);
          for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
          job.progress((i + 1) / (paths.length + 1), "merging");
        }
        const out = outFor(body, paths[0], " (merged)");
        return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
      };
    }
    case "split": {
      const path = filePath(body.path, "path", PDF);
      const every = body.every;
      if (every !== undefined && (!Number.isInteger(every) || (every as number) < 1)) throw new ApiError("bad_request", '"every" must be a whole number of pages');
      if (every === undefined && (!Array.isArray(body.parts) || !body.parts.length)) throw new ApiError("bad_request", 'Give "parts" (lists of pages) or "every"');
      return async (job) => {
        const src = await load(path, pw);
        const count = src.getPageCount();
        const parts: number[][] = every !== undefined
          ? Array.from({ length: Math.ceil(count / (every as number)) }, (_, k) => Array.from({ length: Math.min(every as number, count - k * (every as number)) }, (_, j) => k * (every as number) + j + 1))
          : (body.parts as unknown[]).map((p, i) => pageList(p, count, `parts[${i}]`));
        const files: string[] = [];
        let pages = 0;
        for (let k = 0; k < parts.length; k++) {
          job.signal.throwIfAborted();
          const doc = await PDFDocument.create();
          for (const page of await doc.copyPages(src, parts[k].map((n) => n - 1))) doc.addPage(page);
          const out = freeName(dirname(path), `${basename(path, extname(path))} (part ${k + 1})`);
          pages += await write(doc, out);
          files.push(out);
          job.progress((k + 1) / parts.length, "splitting");
        }
        return { file: files[0], files, contentType: "application/pdf", pages };
      };
    }
    case "rotate": {
      const path = filePath(body.path, "path", PDF);
      if (![90, 180, 270, -90].includes(body.angle as number)) throw new ApiError("bad_request", '"angle" must be 90, 180 or 270');
      return async () => {
        const doc = await load(path, pw);
        const pages = body.pages === undefined ? doc.getPageIndices().map((i) => i + 1) : pageList(body.pages, doc.getPageCount());
        for (const n of pages) {
          const page = doc.getPage(n - 1);
          page.setRotation(degrees((((page.getRotation().angle + (body.angle as number)) % 360) + 360) % 360));
        }
        const out = outFor(body, path, " (rotated)");
        return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
      };
    }
    case "protect": {
      const path = filePath(body.path, "path", PDF);
      const userPassword = password(body.userPassword, "userPassword");
      const ownerPassword = password(body.ownerPassword, "ownerPassword");
      const perms = permissions(body.permissions);
      if (!userPassword && !ownerPassword) throw new ApiError("bad_request", 'Give "userPassword" (to open) or "ownerPassword" (to change permissions), or both');
      if (perms && !ownerPassword) throw new ApiError("bad_request", 'Permissions need "ownerPassword": without it anyone could lift them');
      if (userPassword && ownerPassword && userPassword === ownerPassword) throw new ApiError("bad_request", "The two passwords must differ");
      return async () => {
        const doc = await load(path, pw);
        // no owner password given: a random one, so the permissions cannot be lifted with an empty password
        doc.encrypt({ userPassword: userPassword || "", ownerPassword: ownerPassword || randomPassword(), permissions: mapPermissions(perms), algorithm: "AES-256" });
        const out = outFor(body, path, " (protected)");
        return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
      };
    }
    case "unprotect": {
      const path = filePath(body.path, "path", PDF);
      if (!pw) throw new ApiError("bad_request", '"password" is required');
      return async () => {
        const doc = await load(path, pw);
        const out = outFor(body, path, " (unlocked)");
        return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
      };
    }
    case "images-to-pdf": {
      if (!Array.isArray(body.paths) || !body.paths.length) throw new ApiError("bad_request", '"paths" must list one image or more');
      const paths = body.paths.map((p, i) => filePath(p, `paths[${i}]`, /\.(png|jpe?g)$/i));
      return async (job) => {
        const doc = await PDFDocument.create();
        for (let i = 0; i < paths.length; i++) {
          job.signal.throwIfAborted();
          const bytes = input(paths[i]);
          let img;
          try { img = /\.png$/i.test(paths[i]) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); } catch { throw new ApiError("unsupported_media", "This image cannot be read", { path: paths[i] }); }
          // one page per image at 72 dpi of its pixels
          doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          job.progress((i + 1) / (paths.length + 1), "adding images");
        }
        const out = outFor(body, paths[0], "");
        return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
      };
    }
  }
}

function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Page count and whether a password is needed, without a job. */
export async function pdfInfo(raw: unknown): Promise<{ pages: number | null; encrypted: boolean; size: number }> {
  const path = filePath(obj(raw, "body").path, "path", /\.pdf$/i);
  const size = input(path).length;
  try {
    const doc = await load(path, password((raw as Record<string, unknown>).password, "password"));
    return { pages: doc.getPageCount(), encrypted: false, size };
  } catch (e) {
    if (e instanceof ApiError && (e.detail as { reason?: string } | undefined)?.reason === "password_required") return { pages: null, encrypted: true, size };
    throw e;
  }
}
