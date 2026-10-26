// Who may call: a Bearer token from endpoint.json, and an Origin that is a WorkSuite app (or none: native
// callers send no Origin). Browsers' web origins are refused, so a web page cannot reach the service even
// if it guessed the port.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const APP_SCHEMES = ["asc:", "worksuite:", "file:", "app:"];

export function originAllowed(origin: string | undefined, extra: string[] = []): boolean {
  if (origin === undefined || origin === "") return true;
  // sandboxed iframes and file:// pages send the literal "null"
  if (origin === "null") return true;
  if (extra.includes(origin)) return true;
  const lower = origin.toLowerCase();
  return APP_SCHEMES.some((s) => lower.startsWith(s));
}

export function tokenFrom(req: IncomingMessage, url: URL): string | null {
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
  // WebSocket clients in a browser engine cannot set headers: the token may come as a subprotocol
  // ("bearer.<token>") or, last, as ?token= (additive to the contract; never logged)
  const proto = req.headers["sec-websocket-protocol"];
  if (typeof proto === "string") {
    for (const p of proto.split(",").map((s) => s.trim())) if (p.startsWith("bearer.")) return p.slice(7);
  }
  return url.searchParams.get("token");
}

export function tokenMatches(given: string | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
