// Restoring a kept version writes a new file next to the original and never replaces an existing one:
// not a file that appears at the same name meanwhile, and not the target of a symlink left at that name
// (existsSync() is false for a dangling symlink, and copyFileSync followed it).
import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VersionStore } from "../src/pdf/versions";

describe("VersionStore.restore", () => {
  it("does not write through a symlink at the name it picks", () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-versions-"));
    try {
      const doc = join(dir, "report.pdf");
      writeFileSync(doc, "version one");
      const store = new VersionStore(join(dir, "store"));
      const { version } = store.snapshot(doc, undefined, new Date("2026-11-12T10:00:00Z"));
      writeFileSync(doc, "version two");

      // a dangling symlink at the name restore will pick, pointing somewhere else
      const elsewhere = join(dir, "planted.pdf");
      const stamp = version.savedAt.slice(0, 16).replace("T", " ").replace(":", "-");
      const first = join(dir, `report (version ${stamp}).pdf`);
      symlinkSync(elsewhere, first);

      const out = store.restore(doc, version.id);
      expect(readFileSync(out, "utf8")).toBe("version one");
      expect(out).not.toBe(first);                 // the name with the link was skipped
      expect(existsSync(elsewhere)).toBe(false); // nothing written through the link
      expect(lstatSync(first).isSymbolicLink()).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
