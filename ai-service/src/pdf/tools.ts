// /v1/pdf/*: PDF jobs on files on this computer (merge, split, rotate, protect, unprotect, images to PDF, info).
// Pure JavaScript (@cantoo/pdf-lib, MIT): nothing to download, the same on every platform. Protect writes
// AES-256 (ISO 32000-2) with the permissions asked for. Outputs never overwrite a file: a taken name gets " (2)".
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { degrees, PDFDict, PDFDocument, PDFName, rgb, StandardFonts } from "@cantoo/pdf-lib";
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

// ---- stamp: headers, footers, page numbers, Bates numbers and watermarks ---------------------------------

export interface StampSlots { left?: string; center?: string; right?: string }

const POSITIONS = ["left", "center", "right"] as const;

/** {n} page, {total} pages, {bates} Bates number, {date} today, {file} file name. */
export function fillTokens(text: string, v: { n: number; total: number; bates: string; date: string; file: string }): string {
  return text.replace(/\{(n|total|bates|date|file)\}/g, (_, k: keyof typeof v) => String(v[k]));
}

function slots(v: unknown, name: string): StampSlots | undefined {
  if (v === undefined) return undefined;
  const o = obj(v, name);
  const out: StampSlots = {};
  for (const k of POSITIONS) {
    if (o[k] === undefined || o[k] === "") continue;
    if (typeof o[k] !== "string" || (o[k] as string).length > 200) throw new ApiError("bad_request", `"${name}.${k}" must be text of at most 200 characters`);
    out[k] = o[k] as string;
  }
  return Object.keys(out).length ? out : undefined;
}

function numberIn(v: unknown, name: string, min: number, max: number, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ApiError("bad_request", `"${name}" must be a number from ${min} to ${max}`);
  return v;
}

export function stampJob(raw: unknown): (job: JobControl) => Promise<PdfResult> {
  const body = obj(raw, "body");
  const path = filePath(body.path, "path", /\.pdf$/i);
  const pw = password(body.password, "password");
  const header = slots(body.header, "header");
  const footer = slots(body.footer, "footer");
  const fontSize = numberIn(body.fontSize, "fontSize", 6, 72, 10);
  const margin = numberIn(body.margin, "margin", 6, 144, 28);
  const bates = body.bates === undefined ? undefined : obj(body.bates, "bates");
  const batesPrefix = bates?.prefix === undefined ? "" : String(bates.prefix).slice(0, 40);
  const batesStart = Math.floor(numberIn(bates?.start, "bates.start", 0, 1e12, 1));
  const batesDigits = Math.floor(numberIn(bates?.digits, "bates.digits", 1, 12, 6));
  const wm = body.watermark === undefined ? undefined : obj(body.watermark, "watermark");
  const wmText = wm?.text === undefined ? undefined : String(wm.text).slice(0, 100);
  const wmImage = wm?.image === undefined ? undefined : filePath(wm.image, "watermark.image", /\.(png|jpe?g)$/i);
  const wmOpacity = numberIn(wm?.opacity, "watermark.opacity", 0.02, 1, 0.15);
  const wmRotation = numberIn(wm?.rotation, "watermark.rotation", -90, 90, 45);
  const wmSize = numberIn(wm?.size, "watermark.size", 8, 300, 0);
  if (!header && !footer && !wmText && !wmImage) throw new ApiError("bad_request", 'Give "header", "footer" or "watermark"');
  return async (job) => {
    const doc = await load(path, pw);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    const pages = body.pages === undefined ? doc.getPageIndices().map((i) => i + 1) : pageList(body.pages, total);
    const date = new Date().toISOString().slice(0, 10);
    const file = basename(path);
    const image = wmImage ? (/\.png$/i.test(wmImage) ? await doc.embedPng(input(wmImage)) : await doc.embedJpg(input(wmImage))) : undefined;
    // the standard font has Latin letters only; anything else would print as "?"
    const charset = new Set(font.getCharacterSet());
    const width = (t: string, size: number) => {
      for (const ch of t) if (!charset.has(ch.codePointAt(0)!)) throw new ApiError("bad_request", "Headers, footers and watermarks can use Latin letters only for now", { text: t, char: ch });
      return font.widthOfTextAtSize(t, size);
    };
    const color = rgb(0.2, 0.2, 0.2);
    pages.forEach((n, k) => {
      job.signal.throwIfAborted();
      const page = doc.getPage(n - 1);
      const { width: W, height: H } = page.getSize();
      const tokens = { n, total, bates: batesPrefix + String(batesStart + k).padStart(batesDigits, "0"), date, file };
      const row = (s: StampSlots | undefined, y: number) => {
        if (!s) return;
        for (const pos of POSITIONS) {
          if (!s[pos]) continue;
          const t = fillTokens(s[pos]!, tokens);
          const w = width(t, fontSize);
          const x = pos === "left" ? margin : pos === "right" ? W - margin - w : (W - w) / 2;
          page.drawText(t, { x, y, size: fontSize, font, color });
        }
      };
      row(header, H - margin - fontSize);
      row(footer, margin);
      if (wmText) {
        const t = fillTokens(wmText, tokens);
        // auto size: the text spans about 70 % of the line it runs along
        const a = (wmRotation * Math.PI) / 180;
        const run = Math.min(Math.abs(W / Math.cos(a)) || Infinity, Math.abs(H / Math.sin(a)) || Infinity);
        const size = wmSize || Math.min(160, (run * 0.7) / width(t, 1));
        const w = width(t, size), h = size * 0.7;
        // the text's middle on the page's middle: the origin is its bottom-left corner, rotated with it
        const x = W / 2 - (Math.cos(a) * w) / 2 + (Math.sin(a) * h) / 2;
        const y = H / 2 - (Math.sin(a) * w) / 2 - (Math.cos(a) * h) / 2;
        page.drawText(t, { x, y, size, font, color: rgb(0.5, 0.5, 0.5), opacity: wmOpacity, rotate: degrees(wmRotation) });
      }
      if (image) {
        const scale = Math.min((W * 0.6) / image.width, (H * 0.6) / image.height);
        const w = image.width * scale, h = image.height * scale;
        page.drawImage(image, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h, opacity: wmOpacity });
      }
      job.progress((k + 1) / pages.length, "stamping");
    });
    const out = outFor(body, path, " (stamped)");
    return { file: out, files: [out], contentType: "application/pdf", pages: await write(doc, out) };
  };
}
