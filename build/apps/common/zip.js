/*
 * The files WorkSuite Project and WorkSuite Diagram save (#77, #82): small zip containers, and XLSX export.
 * Pure ES module, no DOM, no dependencies.
 *
 * zip() writes stored (uncompressed) entries with a fixed timestamp, so the same content always gives the same
 * bytes. unzip() reads stored entries, ours and other tools' "store" archives; a compressed entry is refused
 * with a clear message rather than misread. unzipAsync() also reads deflated entries (Visio's .vsdx, Office
 * files), through the platform's DecompressionStream.
 *
 * A .wsproj / .wsdiagram file is a zip whose first entry is "mimetype" (stored, as ODF does), then
 * "document.json" (the canonical JSON of the document) and "meta.json" ({ app, v, savedBy }).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesOf = (d) => (typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

let table = null;
export function crc32(data) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const b of bytesOf(data)) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00, fixed so saves are byte-stable

/** files: [{ name, data: string | Uint8Array }] → the zip's bytes */
export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = bytesOf(f.data), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(8, 0, true); head.setUint16(10, DOS_TIME, true); head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, DOS_TIME, true); cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** The zip's entries: { name: Uint8Array }, from its central directory. */
export function unzip(input) {
  const b = bytesOf(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip file");
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true), name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`${name} is compressed; this version reads uncompressed files only`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = b.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`${name} is damaged`);
    out[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Like unzip(), and also inflates deflated entries (method 8), checking every CRC. */
export async function unzipAsync(input) {
  const b = bytesOf(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip file");
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true), name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      if (typeof DecompressionStream !== "function") throw new Error("this system cannot read compressed files");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`${name} uses a compression this version cannot read`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${name} is damaged`);
    out[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ---- .wsproj / .wsdiagram ---- */
export const MIME = { "worksuite.project": "application/vnd.worksuite.project+zip", "worksuite.diagram": "application/vnd.worksuite.diagram+zip" };

/** The file's bytes for a document (its canonical JSON text and app key). */
export function packDocument(app, json, savedBy = "WorkSuite Office") {
  const doc = JSON.parse(json);
  return zip([
    { name: "mimetype", data: MIME[app] },
    { name: "document.json", data: json },
    { name: "meta.json", data: JSON.stringify({ app, v: doc.v, savedBy }) + "\n" },
  ]);
}

/** The document's JSON text from a file: our zip, or (from early builds) plain JSON. */
export function unpackDocument(input, app) {
  const b = bytesOf(input);
  if (b[0] === 0x7b) return dec.decode(b); // "{": plain JSON
  const files = unzip(b);
  const mime = files.mimetype && dec.decode(files.mimetype);
  if (mime !== MIME[app]) throw new Error(mime ? "this is a different kind of WorkSuite file" : "not a WorkSuite file");
  if (!files["document.json"]) throw new Error("the file has no document");
  return dec.decode(files["document.json"]);
}

/* ---- XLSX: one sheet of rows (strings and numbers), the minimum SpreadsheetML that office suites open ---- */
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

export function xlsx(rows, sheetName = "Sheet1") {
  const cells = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`, bold = ri === 0 ? ' s="1"' : "";
    if (v === null || v === undefined || v === "") return "";
    return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"${bold}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${bold}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const name = xmlEsc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>` },
  ]);
}
