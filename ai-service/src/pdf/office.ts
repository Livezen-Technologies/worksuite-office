// Minimal Office Open XML writers: a ZIP container, a workbook (one sheet per PDF page with tables) and a
// presentation (one picture per slide). Enough for Excel, PowerPoint, LibreOffice and the WorkSuite editors.
import { deflateRawSync } from "node:zlib";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP file (deflate; PNG/JPEG stored) of the given entries, in order. */
export function zip(entries: { name: string; data: Uint8Array | string }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const store = /\.(png|jpe?g)$/i.test(e.name);
    const body = store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(raw), method = store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(0x00210000, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  // characters XML 1.0 does not allow
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function col(n: number): string {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

/** An .xlsx with one sheet per entry; cells that read as plain numbers are stored as numbers. */
export function xlsx(sheets: { name: string; rows: string[][] }[]): Buffer {
  const names = new Set<string>();
  const sheetName = (s: string, i: number) => {
    let n = s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`;
    while (names.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`;
    names.add(n.toLowerCase());
    return n;
  };
  const files: { name: string; data: string }[] = [];
  const list = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  list.forEach((sh, i) => {
    const rows = sh.rows.map((r, y) => `<row r="${y + 1}">` + r.map((v, x) => {
      if (v === "") return "";
      const ref = col(x) + (y + 1);
      return NUMBER.test(v.trim()) ? `<c r="${ref}"><v>${Number(v.trim().replace(/,/g, ""))}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join("") + "</row>").join("");
    // each column as wide as its longest text (a line of prose in column A is left to overflow)
    const widths: number[] = [];
    for (const r of sh.rows) r.forEach((v, x) => { if (r.length > 1 || x > 0) widths[x] = Math.max(widths[x] || 8, Math.min(60, v.length + 2)); });
    const cols = widths.length ? "<cols>" + widths.map((w, x) => `<col min="${x + 1}" max="${x + 1}" width="${w || 8}" customWidth="1"/>`).join("") + "</cols>" : "";
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: XML + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>` });
  });
  const sheetEls = list.map((sh, i) => `<sheet name="${esc(sheetName(sh.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return zip([
    { name: "[Content_Types].xml", data: XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + `</Types>` },
    { name: "_rels/.rels", data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: XML + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets>${sheetEls}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: XML + `<Relationships xmlns="${NS_PKG}">` + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `</Relationships>` },
    ...files,
  ]);
}

const EMU_PER_PT = 12700;
const A = "http://schemas.openxmlformats.org/drawingml/2006/main", P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const THEME = XML + `<a:theme xmlns:a="${A}" name="WorkSuite"><a:themeElements><a:clrScheme name="WorkSuite"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="WorkSuite"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="WorkSuite"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const EMPTY_TREE = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>`;

/** A .pptx with one slide per picture, the picture filling the slide; the slide size is the first page's. */
export function pptx(slides: { image: Uint8Array; type: "png" | "jpeg"; widthPt: number; heightPt: number }[]): Buffer {
  const W = Math.round((slides[0]?.widthPt || 720) * EMU_PER_PT), H = Math.round((slides[0]?.heightPt || 540) * EMU_PER_PT);
  const entries: { name: string; data: Uint8Array | string }[] = [
    { name: "[Content_Types].xml", data: XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") + `</Types>` },
    { name: "_rels/.rels", data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: "ppt/presentation.xml", data: XML + `<p:presentation xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` +
      slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("") + `</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${NS_R}/theme" Target="theme/theme1.xml"/>` +
      slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${NS_R}/slide" Target="slides/slide${i + 1}.xml"/>`).join("") + `</Relationships>` },
    { name: "ppt/theme/theme1.xml", data: THEME },
    { name: "ppt/slideMasters/slideMaster1.xml", data: XML + `<p:sldMaster xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}">${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${NS_R}/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: XML + `<p:sldLayout xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}" type="blank">${EMPTY_TREE}</p:sldLayout>` },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
  ];
  slides.forEach((s, i) => {
    // each picture fits the slide, centred, keeping its own proportions
    const scale = Math.min(W / (s.widthPt * EMU_PER_PT), H / (s.heightPt * EMU_PER_PT));
    const cx = Math.round(s.widthPt * EMU_PER_PT * scale), cy = Math.round(s.heightPt * EMU_PER_PT * scale);
    entries.push(
      { name: `ppt/slides/slide${i + 1}.xml`, data: XML + `<p:sld xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
        `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="${Math.round((W - cx) / 2)}" y="${Math.round((H - cy) / 2)}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>` },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: XML + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${NS_R}/image" Target="../media/page${i + 1}.${s.type}"/></Relationships>` },
      { name: `ppt/media/page${i + 1}.${s.type}`, data: s.image },
    );
  });
  return zip(entries);
}
