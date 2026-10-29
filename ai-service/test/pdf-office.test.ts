// /v1/pdf/to-xlsx, to-pptx, form-export, form-fill and flatten on real files in a temporary folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { Harness, start } from "./helpers/harness";
import { parseData, formatData } from "../src/pdf/forms";
import { pageTable } from "../src/pdf/tables";

let h: Harness;
let dir: string;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** The entries of a ZIP file written by office.ts (local headers in order). */
function unzip(b: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  for (let o = 0; b.readUInt32LE(o) === 0x04034b50;) {
    const method = b.readUInt16LE(o + 8), size = b.readUInt32LE(o + 18), nameLen = b.readUInt16LE(o + 26), extra = b.readUInt16LE(o + 28);
    const name = b.subarray(o + 30, o + 30 + nameLen).toString(), data = b.subarray(o + 30 + nameLen + extra, o + 30 + nameLen + extra + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("latin1"));
    o += 30 + nameLen + extra + size;
  }
  return out;
}

async function run(op: string, body: unknown) {
  const r = await h.call("POST", `/v1/pdf/${op}`, body);
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  return h.svc.jobs.wait(r.json.jobId);
}

async function formPdf(name: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 20, y: 300, width: 200, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 20, y: 260, width: 15, height: 15 });
  const dd = form.createDropdown("city");
  dd.addOptions(["Colombo", "Kandy"]);
  dd.addToPage(page, { x: 20, y: 220, width: 100, height: 20 });
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

beforeAll(async () => { h = await start(); dir = mkdtempSync(join(tmpdir(), "ws-pdf-office-")); });
afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe("pdf to Excel", () => {
  it("puts a table's columns in cells, numbers as numbers", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 400]);
    const rows = [["Item", "Qty", "Price"], ["Tea", "2", "1,250.00"], ["Rice bag", "10", "300"]];
    rows.forEach((r, y) => r.forEach((v, x) => page.drawText(v, { x: 50 + x * 150, y: 350 - y * 20, size: 11, font })));
    const p = join(dir, "table.pdf");
    writeFileSync(p, await doc.save());
    const j = await run("to-xlsx", { path: p });
    expect(j.state, JSON.stringify(j.error)).toBe("done");
    const files = unzip(readFileSync((j.result as { file: string }).file));
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Tea</t></is></c>');
    expect(sheet).toContain('<c r="C2"><v>1250</v></c>');
    expect(sheet).toContain('<c r="B3"><v>10</v></c>');
    expect(files.get("xl/workbook.xml")).toContain('name="Page 1"');
  });

  it("refuses a PDF with no text", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const p = join(dir, "blank.pdf");
    writeFileSync(p, await doc.save());
    expect((await run("to-xlsx", { path: p })).error).toEqual(expect.objectContaining({ code: "capability_unavailable", detail: expect.objectContaining({ reason: "no_text" }) }));
  });

  it("keeps words of one cell together and splits at wide gaps", () => {
    const item = (str: string, x: number, y = 10) => ({ str, x, y, w: str.length * 5, h: 10 });
    expect(pageTable({ width: 600, height: 800, items: [item("Total", 50), item("due", 78), item("99", 300), item("Notes", 50, 40)] }))
      .toEqual([["Total due", "99"], ["Notes"]]);
  });
});

describe("pdf to PowerPoint", () => {
  it("makes one slide per picture", async () => {
    const p = join(dir, "deck.pdf");
    writeFileSync(p, await (await PDFDocument.create()).save());
    const fd = new FormData();
    fd.set("options", JSON.stringify({ path: p, pages: [{ widthPt: 720, heightPt: 540 }, { widthPt: 540, heightPt: 720 }] }));
    fd.append("page", new Blob([PNG_1PX], { type: "image/png" }), "1.png");
    fd.append("page", new Blob([PNG_1PX], { type: "image/png" }), "2.png");
    const res = await fetch(`http://127.0.0.1:${h.port}/v1/pdf/to-pptx`, { method: "POST", body: fd, headers: { authorization: `Bearer ${h.token}` } });
    expect(res.status).toBe(202);
    const j = await h.svc.jobs.wait(((await res.json()) as { jobId: string }).jobId);
    expect(j.state, JSON.stringify(j.error)).toBe("done");
    const files = unzip(readFileSync((j.result as { file: string }).file));
    expect(files.get("ppt/presentation.xml")).toContain('<p:sldSz cx="9144000" cy="6858000"/>');
    expect(files.has("ppt/slides/slide2.xml")).toBe(true);
    expect(files.has("ppt/media/page2.png")).toBe(true);
    // the portrait page is fitted inside the landscape slide, centred
    expect(files.get("ppt/slides/slide2.xml")).toMatch(/<a:ext cx="5143500" cy="6858000"\/>/);
  });
});

describe("pdf forms", () => {
  it("exports, fills from each format and flattens", async () => {
    const p = await formPdf("form.pdf");
    const e = await run("form-export", { path: p, format: "json" });
    expect(JSON.parse(readFileSync((e.result as { file: string }).file, "utf8"))).toEqual({ name: "", agree: false, city: "" });
    for (const [ext, text] of [["json", '{"name":"Nimal","agree":true,"city":"Kandy","nope":"x"}'], ["csv", 'field,value\r\nname,"Nimal, Jr."\r\nagree,Yes\r\ncity,Kandy\r\n'],
      ["xfdf", '<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields><field name="name"><value>Nimal &amp; Co</value></field><field name="agree"><value>Yes</value></field><field name="city"><value>Kandy</value></field></fields></xfdf>']]) {
      const data = join(dir, `data.${ext}`);
      writeFileSync(data, text);
      const f = await run("form-fill", { path: p, dataPath: data });
      expect(f.state, JSON.stringify(f.error)).toBe("done");
      const filled = await PDFDocument.load(readFileSync((f.result as { file: string }).file));
      expect(filled.getForm().getCheckBox("agree").isChecked()).toBe(true);
      expect(filled.getForm().getDropdown("city").getSelected()).toEqual(["Kandy"]);
      expect(filled.getForm().getTextField("name").getText()).toBe({ json: "Nimal", csv: "Nimal, Jr.", xfdf: "Nimal & Co" }[ext]);
      if (ext === "json") expect((f.result as { unknown: string[] }).unknown).toEqual(["nope"]);
    }
    const flat = await run("flatten", { path: p });
    expect((await PDFDocument.load(readFileSync((flat.result as { file: string }).file))).getForm().getFields()).toHaveLength(0);
  });

  it("round-trips CSV and XFDF text", () => {
    const data = { "a,b": 'say "hi"', box: true, multi: ["x", "y"] };
    expect(parseData(formatData(data, "csv"), "csv")).toEqual({ "a,b": 'say "hi"', box: "Yes", multi: "x; y" });
    expect(parseData(formatData(data, "xfdf"), "xfdf")).toEqual({ "a,b": 'say "hi"', box: "Yes", multi: ["x", "y"] });
  });

  it("says when a PDF has no fields, and refuses a bad choice", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const plain = join(dir, "plain.pdf");
    writeFileSync(plain, await doc.save());
    expect((await run("form-export", { path: plain })).error?.detail).toEqual(expect.objectContaining({ reason: "no_fields" }));
    const p = await formPdf("form2.pdf");
    const data = join(dir, "bad.json");
    writeFileSync(data, '{"city":"Galle"}');
    expect((await run("form-fill", { path: p, dataPath: data })).error?.code).toBe("bad_request");
  });
});
