// build/apps/common/zip.js: the .wsproj / .wsdiagram containers and XLSX export (#77, #82). Our zips are checked
// against Python's zipfile (an independent reader), saves are byte-stable, damaged or compressed entries are
// refused clearly, and an XLSX has the parts an office suite needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zip, unzip, packDocument, unpackDocument, MIME, xlsx } from "../apps/common/zip.js";

const py = process.platform === "win32" ? "python" : "python3";
const dec = new TextDecoder();
function withFile(bytes, fn) {
  const dir = mkdtempSync(join(tmpdir(), "wszip-"));
  try { const f = join(dir, "x.zip"); writeFileSync(f, bytes); return fn(f, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32("123456789").toString(16), "cbf43926");
  assert.equal(crc32(""), 0);
});

test("zip round-trips, including UTF-8 names and Sinhala text, and Python's zipfile reads it", () => {
  const files = [{ name: "a.txt", data: "hello" }, { name: "සිංහල/b.json", data: '{"x":"ආයුබෝවන්"}' }, { name: "empty", data: "" }];
  const z = zip(files);
  const back = unzip(z);
  assert.deepEqual(Object.keys(back), ["a.txt", "සිංහල/b.json", "empty"]);
  assert.equal(dec.decode(back["සිංහල/b.json"]), '{"x":"ආයුබෝවන්"}');
  withFile(z, (f) => {
    const out = execFileSync(py, ["-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:z.read(n).decode() for n in z.namelist()},ensure_ascii=False))", f], { encoding: "utf-8" });
    assert.deepEqual(JSON.parse(out), { "a.txt": "hello", "සිංහල/b.json": '{"x":"ආයුබෝවන්"}', empty: "" });
  });
});

test("the same content always gives the same bytes", () => {
  const a = zip([{ name: "x", data: "1" }]), b = zip([{ name: "x", data: "1" }]);
  assert.deepEqual(a, b);
});

test("damaged and compressed entries are refused clearly", () => {
  const z = zip([{ name: "a.txt", data: "hello world" }]);
  const bad = z.slice();
  bad[30 + 5 + 2] ^= 0xff; // flip a byte of the data
  assert.throws(() => unzip(bad), /damaged/);
  assert.throws(() => unzip(new Uint8Array([1, 2, 3])), /not a zip/);
  withFile(new Uint8Array(0), (f, dir) => {
    const deflated = join(dir, "d.zip");
    execFileSync(py, ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);z.writestr('a.txt','x'*500);z.close()", deflated]);
    assert.throws(() => unzip(readFileSync(deflated)), /compressed/);
  });
});

test(".wsproj / .wsdiagram: mimetype first, the document inside, the kind checked", () => {
  const json = JSON.stringify({ app: "worksuite.project", v: 1, name: "P" });
  const file = packDocument("worksuite.project", json);
  assert.equal(dec.decode(file.subarray(30, 38)), "mimetype");
  assert.equal(unpackDocument(file, "worksuite.project"), json);
  assert.throws(() => unpackDocument(file, "worksuite.diagram"), /different kind/);
  assert.throws(() => unpackDocument(zip([{ name: "a", data: "b" }]), "worksuite.project"), /not a WorkSuite file/);
  assert.equal(unpackDocument(new TextEncoder().encode(json), "worksuite.project"), json); // early builds saved plain JSON
  assert.ok(MIME["worksuite.diagram"].endsWith("+zip"));
});

test("XLSX: the parts an office suite needs, numbers as numbers, text escaped", () => {
  const book = xlsx([["Task", "Days"], ["Sign <lease> & pay", 3], ["ලියාපදිංචිය", 2.5]], "Office move");
  const parts = unzip(book);
  for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(parts[p], p);
  const sheet = dec.decode(parts["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<c r="B2"><v>3<\/v><\/c>/);
  assert.match(sheet, /Sign &lt;lease&gt; &amp; pay/);
  assert.match(sheet, /ලියාපදිංචිය/);
  assert.match(dec.decode(parts["xl/workbook.xml"]), /name="Office move"/);
  withFile(book, (f) => {
    // every part is well-formed XML
    execFileSync(py, ["-c", "import sys,zipfile,xml.dom.minidom as m;z=zipfile.ZipFile(sys.argv[1]);[m.parseString(z.read(n)) for n in z.namelist()]", f]);
  });
});
