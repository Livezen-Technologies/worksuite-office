// Builds the worksuite-ai single executable (Node SEA) for the platform this runs on:
//   dist/<darwin-arm64|darwin-x64|win-x64|linux-x64>/worksuite-ai[.exe]
// Steps: bundle (scripts/bundle.mjs) -> SEA blob (node --experimental-sea-config) -> copy of this Node
// -> postject the blob -> macOS: ad-hoc signature (the app build re-signs it with the Developer ID).
// Fails loudly at every step; the binary is smoke-tested with --version at the end.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plat = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const supported = ["darwin-arm64", "darwin-x64", "win-x64", "linux-x64"];
if (!supported.includes(plat)) throw new Error(`worksuite-ai: ${plat} is not a supported platform (${supported.join(", ")})`);
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) throw new Error(`worksuite-ai: Node 22 or newer is needed for the SEA build, this is ${process.version}`);

const run = (cmd, args) => { console.log("+", cmd, args.join(" ")); execFileSync(cmd, args, { stdio: "inherit", cwd: root }); };
const out = join(root, "dist", plat);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const exe = join(out, process.platform === "win32" ? "worksuite-ai.exe" : "worksuite-ai");
const blob = join(root, "dist", "sea-prep.blob");
writeFileSync(join(root, "dist", "sea-config.json"), JSON.stringify({
  main: join(root, "dist", "worksuite-ai.cjs"), output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
}));
run(process.execPath, ["--experimental-sea-config", join(root, "dist", "sea-config.json")]);
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (process.platform === "darwin") run("codesign", ["--remove-signature", exe]);
const postject = join(root, "node_modules", "postject", "dist", "cli.js");
const args = [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
run(process.execPath, args);
if (process.platform === "darwin") run("codesign", ["--sign", "-", "--force", exe]);
const v = execFileSync(exe, ["--version"], { encoding: "utf8" }).trim();
if (!/^worksuite-ai \d/.test(v)) throw new Error(`worksuite-ai: the built binary answered "${v}"`);
console.log(`${exe}: ${v}`);
