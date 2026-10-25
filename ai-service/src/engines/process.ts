// Engines run as child processes on 127.0.0.1 ports of their own; the service talks HTTP to them.
import { ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { ApiError } from "../errors";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export interface Command { cmd: string; args: string[]; backend: string; version?: string }

export class ServerProcess {
  proc: ChildProcess | null = null;
  exited = false;
  private stderr = "";
  constructor(readonly name: string, readonly port: number) {}
  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }

  async start(command: Command, args: string[], healthPath: string, timeoutMs = 180000, env: NodeJS.ProcessEnv = {}): Promise<void> {
    this.proc = spawn(command.cmd, [...command.args, ...args], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: { ...process.env, ...env } });
    this.proc.stderr?.on("data", (d: Buffer) => { this.stderr = (this.stderr + d.toString()).slice(-4000); });
    this.proc.on("exit", () => { this.exited = true; });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.exited) throw new ApiError("internal", `${this.name} exited while starting`, { stderr: this.stderr.slice(-800) });
      try {
        const r = await fetch(this.baseUrl + healthPath, { signal: AbortSignal.timeout(1000) });
        if (r.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    this.stop();
    throw new ApiError("model_loading", `${this.name} did not start in time`);
  }

  stop(): void {
    if (this.proc && !this.exited) {
      this.proc.kill();
      const p = this.proc;
      setTimeout(() => { if (!this.exited) p.kill("SIGKILL"); }, 3000).unref();
    }
  }
}
