import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import S from "../../core/dist/src/index.js";

test("sha256 matches node:crypto", () => {
  for (const s of ["", "abc", "ශ්‍රී ලංකා", "x".repeat(1000), "😀 emoji"]) {
    assert.equal(S.sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("built-in profiles load with their sha256", () => {
  assert.deepEqual(S.builtinProfiles.map((p) => p.id), ["fm-abhaya", "dl-manel", "kaputa", "lastech", "kandy"]);
  for (const p of S.builtinProfiles) {
    assert.match(p.version, /^\d+\.\d+\.\d+$/);
    assert.equal(S.profileHash(p), p.sha256);
  }
});

test("every legacy family is offered once, with its profile", () => {
  const fonts = S.legacyFonts();
  assert.equal(new Set(fonts.map((f) => f.family)).size, fonts.length);
  for (const f of fonts) assert.ok(S.profileForFont(f.family), f.family);
  assert.deepEqual(fonts.filter((f) => f.profile === "lastech").map((f) => f.family), ["Thara", "Padma"]);
  assert.equal(fonts.filter((f) => f.profile === "dl-manel").length, 9);
});

test("a tampered profile is refused", () => {
  const p = structuredClone(S.getProfile("fm-abhaya"));
  p.map[0] = [p.map[0][0], "ඛ"];
  assert.throws(() => S.verifyProfile(p), /sha256/);
  const dup = structuredClone(S.getProfile("fm-abhaya"));
  dup.map.push([dup.map[0][0], "ක"]);
  dup.sha256 = S.profileHash(dup);
  assert.throws(() => S.verifyProfile(dup), /mapped twice/);
});

test("profiles are found by the run's font", () => {
  const id = (f) => S.profileForFont(f)?.id ?? null;
  assert.equal(id("FMAbhaya"), "fm-abhaya");
  assert.equal(id("FM Abhaya"), "fm-abhaya");
  assert.equal(id("FM-Abhaya Bold"), "fm-abhaya");
  assert.equal(id("DL-Manel-bold"), "dl-manel");
  assert.equal(id(["Calibri", "DL Manel"]), "dl-manel");
  assert.equal(id("Kaputa"), "kaputa");
  // the uploaded legacy fonts, by the family names their name tables carry
  for (const f of ["DL-Sarala.", "Dl-Nisansala.", "FS-Kapila.", "FS-Dilrukshi.", "Sinhala - Kumudu Bold", "Ranaviru- PC", "Hemawathy", "Anuradha"]) {
    assert.equal(id(f), "dl-manel", f);
  }
  assert.equal(id("Thara"), "lastech");
  assert.equal(id("Padma"), "lastech");
  for (const f of ["Kandy", "Lankanatha", "Lankapura"]) assert.equal(id(f), "kandy", f);
  assert.equal(id("FM Abhaya-x"), null, "other font versions are not assumed to share the map");
  assert.equal(id("Calibri"), null);
  assert.equal(id(undefined), null);
});
