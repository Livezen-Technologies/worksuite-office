// Signing with the computer's own certificates: the Windows certificate store (smart cards and USB tokens included,
// through their Windows drivers) and the macOS keychain (tokens that CryptoTokenKit puts there included). The private
// key never leaves the operating system: it makes the CMS signature itself (Windows: .NET SignedCms in PowerShell;
// macOS: `security cms`), and may ask for a PIN in its own window. Linux: certificate files only.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Signer } from "@signpdf/utils";
import { ApiError } from "../errors";

export interface StoreCertificate { id: string; name: string; issuer: string; notAfter: string | null; source: "windows" | "macos" }

/** Runs a program; stdout as text. A seam for the tests. */
export type Runner = (cmd: string, args: string[], env?: Record<string, string>, timeoutMs?: number) => Promise<string>;

export const defaultRunner: Runner = (cmd, args, env, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout)));
  });

let runner: Runner = defaultRunner;
/** For tests: replace how programs run; null restores it. */
export function useRunner(r: Runner | null): void { runner = r ?? defaultRunner; }

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

// Certificates of the person's store that have a private key and may sign (digital signature or non-repudiation,
// or no key usage at all), newest last date first.
const WIN_LIST = `$ErrorActionPreference='Stop'
$out = @(Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.HasPrivateKey } | Where-Object {
  $ku = $_.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension] }
  -not $ku -or ($ku.KeyUsages -band ([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::NonRepudiation))
} | Sort-Object NotAfter -Descending | ForEach-Object { [pscustomobject]@{
  id = $_.Thumbprint; name = $_.GetNameInfo('SimpleName', $false); issuer = $_.GetNameInfo('SimpleName', $true); notAfter = $_.NotAfter.ToUniversalTime().ToString('o') } })
ConvertTo-Json -InputObject $out -Compress`;

// A detached CMS signature (SHA-256, signing time) over WS_IN, written to WS_OUT, by the certificate WS_THUMB.
// ComputeSignature(signer, $false): not silent, so a smart card or token may ask for its PIN.
const WIN_SIGN = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq $env:WS_THUMB } | Select-Object -First 1
if (-not $c) { throw 'certificate not found' }
$ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo (,[IO.File]::ReadAllBytes($env:WS_IN))
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms ($ci, $true)
$s = New-Object System.Security.Cryptography.Pkcs.CmsSigner ($c)
$s.DigestAlgorithm = New-Object System.Security.Cryptography.Oid '2.16.840.1.101.3.4.2.1'
$s.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
[void]$s.SignedAttributes.Add((New-Object System.Security.Cryptography.Pkcs.Pkcs9SigningTime))
$cms.ComputeSignature($s, $false)
[IO.File]::WriteAllBytes($env:WS_OUT, $cms.Encode())`;

/** `security find-identity -v` lines: `  1) <SHA-1> "Name"`. */
export function parseMacIdentities(text: string): StoreCertificate[] {
  const out: StoreCertificate[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/.exec(line);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], name: m[2], issuer: "", notAfter: null, source: "macos" });
  }
  return out;
}

export function parseWindowsList(text: string): StoreCertificate[] {
  let v: unknown;
  try { v = JSON.parse(text.trim() || "[]"); } catch { throw new ApiError("internal", "The certificate store's list could not be read"); }
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && /^[0-9A-Fa-f]{40}$/.test(String((x as Record<string, unknown>).id)))
    .map((x) => ({ id: String(x.id).toUpperCase(), name: String(x.name || "Unknown"), issuer: String(x.issuer || ""), notAfter: x.notAfter ? String(x.notAfter) : null, source: "windows" as const }));
}

export function storeAvailable(platform = process.platform): boolean {
  return platform === "win32" || platform === "darwin";
}

/** The certificates this computer may sign with. */
export async function listStoreCertificates(platform = process.platform): Promise<StoreCertificate[]> {
  if (platform === "win32") return parseWindowsList(await runner("powershell.exe", [...PS, WIN_LIST]));
  if (platform === "darwin") return parseMacIdentities(await runner("/usr/bin/security", ["find-identity", "-v"]));
  return [];
}

/** A @signpdf signer that has the operating system sign with the certificate `id` (a thumbprint / SHA-1 hash). */
export class StoreSigner extends Signer {
  constructor(private id: string, private name: string, private platform = process.platform) {
    super();
    if (!/^[0-9A-Fa-f]{40}$/.test(id)) throw new ApiError("bad_request", '"certificateId" must be a certificate thumbprint');
    if (!storeAvailable(platform)) throw new ApiError("capability_unavailable", "Signing with this computer's certificates works on Windows and macOS; use a certificate file here", { reason: "no_store" });
  }

  async sign(data: Buffer): Promise<Buffer> {
    const dir = mkdtempSync(join(tmpdir(), "ws-sign-"));
    const input = join(dir, "data.bin"), output = join(dir, "sig.p7s");
    try {
      writeFileSync(input, data, { mode: 0o600 });
      try {
        if (this.platform === "win32") await runner("powershell.exe", [...PS, WIN_SIGN], { WS_THUMB: this.id.toUpperCase(), WS_IN: input, WS_OUT: output }, 300_000);
        else await runner("/usr/bin/security", ["cms", "-S", "-T", "-G", "-H", "SHA256", "-N", this.name, "-i", input, "-o", output], undefined, 300_000);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (/cancel|PIN|denied|user/i.test(msg)) throw new ApiError("cancelled", "Signing was cancelled", { reason: "cancelled" });
        if (/not found|could not find|no identity/i.test(msg)) throw new ApiError("not_found", "That certificate is no longer on this computer", { reason: "certificate_missing" });
        throw new ApiError("internal", "This computer could not sign with that certificate", { reason: "store_failed", detail: msg.slice(0, 300) });
      }
      const der = readFileSync(output);
      if (!der.length || der[0] !== 0x30) throw new ApiError("internal", "This computer's signature could not be read", { reason: "store_failed" });
      return der;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
