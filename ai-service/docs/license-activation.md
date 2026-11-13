# WorkSuite Office — license activation API (Update Center / download center)

This is the contract the desktop client (`worksuite-ai`, `src/license.ts`) speaks to the Update Center
("download center", `download.worksuitecloud.com`). The client half is implemented and tested; the
**server half is to be built in `Livezen-Technologies/worksite-download`** to this spec.

## Trust model

- A **license** is a small JSON document **signed with WorkSuite's Ed25519 release key** — the same key
  that signs the AI catalog and model manifests (`ai-service/src/signing.ts`, `ed25519:<base64 64 bytes>`
  over canonical JSON with the `signature` field removed). The public half is pinned in the client
  (`signing.ts BUILTIN_KEYS` / `WS_AI_TRUSTED_KEYS`).
- The client verifies the signature **offline**, so Pro works with no network and a key cannot be forged
  or edited. The server's job is **issuing** signed licenses and **revocation / seat** enforcement.
- The online check is advisory: if the download center is unreachable, the last successful online
  validation holds for a **30‑day grace** window, after which Pro suspends until the next success.

## License document (what the server signs)

```json
{
  "v": 1,
  "licenseId": "WSO-PRO-8F2A-...",
  "plan": "pro",
  "features": ["*"],                     // "*" = all Pro features, or explicit keys e.g. ["pdf.sign","ocr"]
  "issuedTo": "Acme Ltd",                // shown in the app
  "issuedAt": "2026-11-13T00:00:00Z",
  "expiresAt": "2027-11-13T00:00:00Z",   // or null for perpetual
  "device": "e3b0c44298fc1c14...",       // optional: bind to one device id (see below); omit for portable
  "seats": 5,                            // informational
  "signature": "ed25519:...."
}
```

`device` is `sha256(hostname \0 username)` truncated to 32 hex chars, computed by the client
(`deviceId()`), never the raw host/user. The client sends it so the server can bind a seat and return a
device‑locked license.

## Endpoints (all `POST`, JSON, under `/api/v1/license`)

The client sends `{ licenseId, device, product: "office", version }` and expects `{ status, license? }`.
`status` ∈ `active | revoked | expired` (anything else → the client treats it as `unknown` and relies on
grace). HTTPS only; **no credential/token is sent** beyond the license id (the client never attaches an
Authorization header to these calls — see `download.ts`), so there is nothing to leak to a redirect.

### `POST /api/v1/license/activate`
Claim a seat for this device the first time a key is entered.
- Request: `{ "licenseId": "...", "device": "...", "product": "office", "version": "10.1.32" }`
- 200: `{ "status": "active", "license": "<signed LicenseDoc JSON, optionally device-bound>" , "seatsUsed": 3, "seatsTotal": 5 }`
  - The returned `license` (if present and signature-valid) **replaces** the stored one, so the server may
    hand back a device‑bound copy.
- 200: `{ "status": "revoked" }` → client refuses and stores nothing.
- 409 `{ "status": "seat_exhausted", "seatsUsed": 5, "seatsTotal": 5 }` → all seats taken.
- The client treats any transport error / non‑200 as **offline**: the offline‑verified key still grants
  Pro within grace.

### `POST /api/v1/license/validate`
Background re‑check (the client calls it ~daily and on launch).
- Request: same shape.
- 200: `{ "status": "active" | "revoked" | "expired", "checkedAt": "ISO", "nextCheckAfter": "ISO" }`
- `active` resets the 30‑day grace clock; `revoked` downgrades to Free immediately.

### `POST /api/v1/license/deactivate`
Release this device's seat (user signs out of Pro / moves machines).
- Request: same shape. 200: `{ "status": "ok" }`. The client clears the local license regardless.

## Client behaviour (already implemented)

| Situation | Result |
| --- | --- |
| No license | Free; non‑Pro features allowed, Pro features refused with HTTP 402 `payment_required` |
| Valid signed key, UC reachable, `active` | Pro; grace clock set |
| Valid signed key, UC unreachable | Pro within 30‑day grace of the last `active`; then suspended |
| `revoked` (at activate or validate) | Free |
| Expired (`expiresAt` past) or wrong `device` | Free (refused at activation) |
| Bad/forged signature | Refused (`bad_request`) |

## Local client API (for the app UI)

`worksuite-ai` exposes, on its token‑authed 127.0.0.1 socket:
- `GET  /v1/license` → `{ plan, active, licenseId?, issuedTo?, expiresAt?, features, online?, lastOnlineOk?, reason?, proFeatures[] }`
- `POST /v1/license/activate` `{ key }` (pasted key or `.wslicense` text) → status
- `POST /v1/license/refresh` → status (forces an online validate)
- `POST /v1/license/deactivate` → status

## Which features are Pro

`PRO_FEATURES` in `src/license.ts` lists the gated keys: **`ocr`, `pdf.sign`, `convert`, `assistant`**
(OCR, PDF signing, format conversion to xlsx/pptx, and the AI assistant). Everything else — viewing,
stamps, merge, form-fill, redaction, and the rest of the editors — is Free. The set is extendable by
policy or `WS_AI_PRO_FEATURES`, and `WS_AI_LICENSE_ALL=1` is a managed-config "all features on"
override (off by default). To make a feature Pro, add its key there and call `license.require("<key>")`
at that feature's entry point; `GET /v1/license` reports the active set in `proFeatures`.
