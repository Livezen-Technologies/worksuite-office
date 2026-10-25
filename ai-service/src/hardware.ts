// GET /v1/hardware: {os, arch, cpu:{model, cores}, ramMB, freeRamMB, gpus:[{name, vramMB, backend}], appleSilicon,
// recommendedProfile}. GPUs: nvidia-smi (CUDA), system_profiler (macOS; Metal on Apple silicon), Windows
// CIM (Win32_VideoController; DirectML on any DX12 GPU), Vulkan loader presence (vulkaninfo / libvulkan).
import { existsSync } from "node:fs";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import { run } from "./exec";

export type Backend = "cuda" | "metal" | "vulkan" | "directml";
export interface Gpu { name: string; vramMB: number; backend: Backend }
export type Profile = "lite" | "standard" | "advanced";
export interface Hardware {
  os: string;
  arch: string;
  cpu: { model: string; cores: number };
  ramMB: number;
  freeRamMB: number;
  gpus: Gpu[];
  appleSilicon: boolean;
  recommendedProfile: Profile;
  /** additive: does a Vulkan loader exist on this machine */
  vulkan?: boolean;
}

export type Runner = (cmd: string, args: string[], timeoutMs?: number) => Promise<string | null>;

export function parseNvidiaSmi(out: string): Gpu[] {
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, mem] = l.split(",").map((s) => s.trim());
    return { name, vramMB: parseInt(mem, 10) || 0, backend: "cuda" as const };
  });
}

export function parseSystemProfiler(json: string, appleSilicon: boolean, ramMB: number): Gpu[] {
  try {
    const data = JSON.parse(json) as { SPDisplaysDataType?: Record<string, string>[] };
    return (data.SPDisplaysDataType || []).map((g) => {
      const vramText = g.spdisplays_vram || g.spdisplays_vram_shared || "";
      let vramMB = parseInt(vramText, 10) || 0;
      if (/GB/i.test(vramText)) vramMB *= 1024;
      // unified memory: Metal can use about 2/3 of RAM by default
      if (appleSilicon && !vramMB) vramMB = Math.round(ramMB * 0.66);
      const metal = appleSilicon || /metal/i.test(JSON.stringify(g));
      return { name: g.sppci_model || g._name || "GPU", vramMB, backend: metal ? ("metal" as const) : ("vulkan" as const) };
    });
  } catch {
    return [];
  }
}

export function parseWindowsVideo(json: string): Gpu[] {
  try {
    let rows = JSON.parse(json) as { Name: string; AdapterRAM?: number } | { Name: string; AdapterRAM?: number }[];
    if (!Array.isArray(rows)) rows = [rows];
    return rows.filter((r) => r && r.Name && !/basic display|remote/i.test(r.Name))
      .map((r) => ({ name: r.Name, vramMB: Math.round((Number(r.AdapterRAM) || 0) / 1048576), backend: "directml" as const }));
  } catch {
    return [];
  }
}

export function recommend(ramMB: number, gpus: Gpu[], appleSilicon: boolean): Profile {
  const vram = Math.max(0, ...gpus.map((g) => g.vramMB));
  if ((appleSilicon && ramMB >= 16000) || (vram >= 8000 && ramMB >= 16000)) return "advanced";
  if (ramMB >= 7500) return "standard";
  return "lite";
}

export async function detectHardware(exec: Runner = run, os = platform()): Promise<Hardware> {
  const c = cpus();
  const ramMB = Math.round(totalmem() / 1048576);
  const a = arch();
  const appleSilicon = os === "darwin" && a === "arm64";
  const gpus: Gpu[] = [];

  const smi = await exec("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (smi) gpus.push(...parseNvidiaSmi(smi));

  if (os === "darwin") {
    const sp = await exec("system_profiler", ["SPDisplaysDataType", "-json"], 10000);
    if (sp) gpus.push(...parseSystemProfiler(sp, appleSilicon, ramMB));
  } else if (os === "win32") {
    const ps = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"], 10000);
    let win = ps ? parseWindowsVideo(ps) : [];
    if (!win.length) {
      const wmic = await exec("wmic", ["path", "win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"]);
      if (wmic) {
        win = wmic.split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((p) => p.length >= 3 && p[2])
          .map((p) => ({ name: p[2].trim(), vramMB: Math.round((Number(p[1]) || 0) / 1048576), backend: "directml" as const }));
      }
    }
    // the NVIDIA cards nvidia-smi found are reported once, as CUDA
    for (const g of win) if (!gpus.some((x) => x.name === g.name)) gpus.push(g);
  }

  let vulkan = false;
  if (os === "linux") vulkan = ["/usr/lib/x86_64-linux-gnu/libvulkan.so.1", "/usr/lib64/libvulkan.so.1", "/usr/lib/libvulkan.so.1"].some(existsSync);
  else if (os === "win32") vulkan = existsSync(`${process.env.SystemRoot || "C:\\Windows"}\\System32\\vulkan-1.dll`);
  if (!vulkan && os !== "darwin") vulkan = (await exec("vulkaninfo", ["--summary"], 5000)) !== null;
  if (os === "linux" && vulkan && !gpus.length) {
    const vi = await exec("vulkaninfo", ["--summary"], 5000);
    const names = vi ? [...vi.matchAll(/deviceName\s*=\s*(.+)/g)].map((m) => m[1].trim()).filter((n) => !/llvmpipe/i.test(n)) : [];
    for (const n of names) gpus.push({ name: n, vramMB: 0, backend: "vulkan" });
  }

  return {
    os: os === "win32" ? "windows" : os === "darwin" ? "macos" : os,
    arch: a,
    cpu: { model: c[0]?.model?.trim() || "unknown", cores: c.length },
    ramMB,
    freeRamMB: Math.round(freemem() / 1048576),
    gpus,
    appleSilicon,
    recommendedProfile: recommend(ramMB, gpus, appleSilicon),
    vulkan,
  };
}

/** Fits this computer: "yes" with headroom, "tight" when it needs most of free-ish RAM, "no" above it. */
export function fits(ramNeededMB: number, hw: Pick<Hardware, "ramMB" | "gpus" | "appleSilicon">): "yes" | "tight" | "no" {
  const budget = Math.max(hw.ramMB * 0.6, ...hw.gpus.map((g) => g.vramMB * 0.9));
  if (ramNeededMB <= budget * 0.7) return "yes";
  if (ramNeededMB <= budget) return "tight";
  return "no";
}
