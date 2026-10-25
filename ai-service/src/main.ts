// worksuite-ai entry point: one instance per user, 127.0.0.1 on a random port, a per-boot token in
// ~/.worksuite/ai/endpoint.json (0600; Windows: ACL to the user), exits after 30 minutes idle.
//   worksuite-ai [serve] [--port N] [--foreground]   start (or report the running instance)
//   worksuite-ai --version
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { defaultDataDir, defaultEndpointFile } from "./paths";
import { API_VERSION, SERVICE_VERSION, Service } from "./server";

export interface Endpoint { port: number; token: string; pid: number; apiVersion: string; serviceVersion?: string; startedAt?: string }

export function writeEndpoint(file: string, ep: Endpoint): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(ep, null, 2), { mode: 0o600 });
  if (process.platform === "win32") {
    try { execFileSync("icacls", [tmp, "/inheritance:r", "/grant:r", `${userInfo().username}:F`], { windowsHide: true, stdio: "ignore" }); } catch { /* best effort */ }
  } else chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function runningInstance(file: string): Promise<Endpoint | null> {
  if (!existsSync(file)) return null;
  try {
    const ep = JSON.parse(readFileSync(file, "utf8")) as Endpoint;
    if (!ep.pid || !alive(ep.pid)) return null;
    const r = await fetch(`http://127.0.0.1:${ep.port}/v1/health`, { headers: { authorization: `Bearer ${ep.token}` }, signal: AbortSignal.timeout(2000) });
    return r.ok ? ep : null;
  } catch {
    return null;
  }
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--version")) { console.log(`worksuite-ai ${SERVICE_VERSION} (API ${API_VERSION})`); return; }
  const endpointFile = defaultEndpointFile();
  const existing = await runningInstance(endpointFile);
  if (existing) { console.log(JSON.stringify({ running: true, port: existing.port, pid: existing.pid })); return; }
  const pi = argv.indexOf("--port");
  const port = pi >= 0 ? Number(argv[pi + 1]) : 0;
  let service: Service;
  const shutdown = async (code = 0) => {
    try {
      const cur = existsSync(endpointFile) ? (JSON.parse(readFileSync(endpointFile, "utf8")) as Endpoint) : null;
      if (cur?.pid === process.pid) rmSync(endpointFile, { force: true });
    } catch { /* gone */ }
    await service?.close().catch(() => undefined);
    process.exit(code);
  };
  service = new Service({ dataDir: defaultDataDir(), idleExitMs: Number(process.env.WS_AI_IDLE_EXIT_MS) || 30 * 60 * 1000, onIdle: () => void shutdown(0) });
  await service.init();
  const actual = await service.listen(port);
  writeEndpoint(endpointFile, { port: actual, token: service.token, pid: process.pid, apiVersion: API_VERSION, serviceVersion: SERVICE_VERSION, startedAt: new Date().toISOString() });
  console.log(JSON.stringify({ running: true, port: actual, pid: process.pid, endpoint: endpointFile }));
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, () => void shutdown(0));
}

