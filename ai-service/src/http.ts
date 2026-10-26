// A small router over node:http: method + path pattern (":id" segments), JSON bodies, the error envelope.
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** aborted when the client goes away or DELETE /v1/requests/{X-Request-Id} is called */
  signal: AbortSignal;
  requestId?: string;
  body<T = Record<string, unknown>>(): Promise<T>;
}

/** What a handler returns: a JSON value (200), {status, body}, or RAW when it wrote the response itself. */
export const RAW = Symbol("raw");
export type Result = unknown | { [STATUS]: number; body: unknown } | typeof RAW;
export const STATUS = Symbol("status");
export const withStatus = (status: number, body: unknown) => ({ [STATUS]: status, body });

type Handler = (ctx: Ctx) => Promise<Result> | Result;
interface Route { method: string; parts: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add("GET", p, h); }
  post(p: string, h: Handler) { return this.add("POST", p, h); }
  put(p: string, h: Handler) { return this.add("PUT", p, h); }
  delete(p: string, h: Handler) { return this.add("DELETE", p, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = parts[i];
        else if (r.parts[i] !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (r.method !== method) { methodMismatch = true; continue; }
      return { handler: r.handler, params };
    }
    return methodMismatch ? "method" : null;
  }
}

export const MAX_JSON_BYTES = 4 * 1024 * 1024;

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_JSON_BYTES) throw new ApiError("input_too_long", "The request body is too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {} as T;
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object") throw new Error("not an object");
    return v as T;
  } catch {
    throw new ApiError("bad_request", "The body is not a JSON object");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) { res.end(); return; }
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store" });
  res.end(data);
}

// request-shape helpers: they throw bad_request with the field name
export function str(v: unknown, name: string, opts: { optional?: boolean; allowEmpty?: boolean } = {}): string {
  if (v === undefined || v === null) {
    if (opts.optional) return "";
    throw new ApiError("bad_request", `"${name}" is required`);
  }
  if (typeof v !== "string") throw new ApiError("bad_request", `"${name}" must be a string`);
  if (!v && !opts.allowEmpty && !opts.optional) throw new ApiError("bad_request", `"${name}" must not be empty`);
  return v;
}
export function oneOf<T extends string>(v: unknown, name: string, values: readonly T[], dflt?: T): T {
  if ((v === undefined || v === null) && dflt !== undefined) return dflt;
  if (typeof v !== "string" || !values.includes(v as T)) throw new ApiError("bad_request", `"${name}" must be one of ${values.join(", ")}`);
  return v as T;
}
export function num(v: unknown, name: string, dflt: number, min = -Infinity, max = Infinity): number {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ApiError("bad_request", `"${name}" must be a number in ${min}..${max}`);
  return v;
}
export function bool(v: unknown, name: string, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "boolean") throw new ApiError("bad_request", `"${name}" must be a boolean`);
  return v;
}

/** Text limit for content requests: the editor sends at most 8,000 characters of context; we allow some slack. */
export const MAX_TEXT = 32000;
export function text(v: unknown, name = "text", max = MAX_TEXT): string {
  const s = str(v, name, { allowEmpty: true });
  if (s.length > max) throw new ApiError("input_too_long", `"${name}" is longer than ${max} characters`, { max });
  return s;
}
