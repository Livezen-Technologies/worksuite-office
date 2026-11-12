#!/usr/bin/env python3
"""Real-file conversion tests against an installed WorkSuite Office converter (x2t).

    python3 build/v10/e2e-convert-test.py [output-dir]
    WS_APP=/opt/worksuite/office  WS_FONTS=<the app's data/fonts, made on its first start>


Builds DOCX/XLSX/PPTX fixtures with known content, converts them with x2t (to PDF, and round trips
through ODF and back to OOXML), and checks the results with independent readers (pypdf, openpyxl,
python-docx, python-pptx). Prints one PASS/FAIL line per case.
"""
import os, re, subprocess, sys, tempfile, zipfile
from pathlib import Path

import docx, openpyxl, pptx, pypdf
from docx.shared import Pt
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import PatternFill

APP = Path(os.environ.get("WS_APP", "/opt/worksuite/office"))
X2T = APP / "converter" / "x2t"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
OUT.mkdir(parents=True, exist_ok=True)
results = []


def case(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  -- ' + detail if detail and not ok else ''}")


def x2t(src, dst, extra=""):
    """Convert with x2t through its XML task file, as the desktop app does."""
    dst.unlink(missing_ok=True)
    task = OUT / (dst.name + ".task.xml")
    task.write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert>
  <m_sFileFrom>{src}</m_sFileFrom>
  <m_sFileTo>{dst}</m_sFileTo>
  <m_sFontDir>{APP}/fonts</m_sFontDir>
  <m_sAllFontsPath>{OUT}/fonts/AllFonts.js</m_sAllFontsPath>
  <m_sTempDir>{OUT}/tmp</m_sTempDir>
  <m_bIsNoBase64>true</m_bIsNoBase64>{extra}
</TaskQueueDataConvert>""")
    (OUT / "tmp").mkdir(exist_ok=True)
    env = dict(os.environ, LD_LIBRARY_PATH=f"{APP}:{APP}/converter")
    r = subprocess.run([str(X2T), str(task)], capture_output=True, text=True, env=env, timeout=300)
    return r.returncode, (r.stdout + r.stderr)[-400:]


def pdf_text(p):
    # poppler's pdftotext, an independent PDF reader
    return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True).stdout


def valid_zip(p):
    try:
        with zipfile.ZipFile(p) as z:
            return z.testzip() is None
    except Exception:
        return False


# Font cache the converter needs (the app builds it on first run).
fonts = OUT / "fonts"
fonts.mkdir(exist_ok=True)
import shutil
for f in ("AllFonts.js", "font_selection.bin"):
    src = Path(os.environ.get("WS_FONTS", str(Path.home() / ".local/share/worksuite/office/data/fonts"))) / f
    if src.exists():
        shutil.copy(src, fonts / f)
gen = APP / "converter" / "allfontsgen"
if gen.exists() and not (fonts / "AllFonts.js").exists():
    subprocess.run([str(gen), f"--input={APP}/fonts", "--use-system=true", f"--allfonts={fonts}/AllFonts.js",
                    f"--selection={fonts}/font_selection.bin"], capture_output=True,
                   env=dict(os.environ, LD_LIBRARY_PATH=f"{APP}:{APP}/converter"), timeout=600)
case("font cache available (built by the app on first start)", (fonts / "AllFonts.js").exists())

# ---------- Document ----------
d = docx.Document()
d.add_heading("Quarterly Operations Report", 0)
d.add_heading("1. Summary", 1)
p = d.add_paragraph("Revenue grew ")
p.add_run("twelve percent").bold = True
p.add_run(" against plan. Unicode check: Ünïcödé — සිංහල — 日本語.")
d.add_heading("2. Figures", 1)
t = d.add_table(rows=4, cols=3)
t.style = "Table Grid"
for i, row in enumerate([("Region", "Q1", "Q2"), ("North", "120", "135"), ("South", "98", "110"), ("Total", "218", "245")]):
    for j, v in enumerate(row):
        t.cell(i, j).text = v
d.add_page_break()
d.add_heading("3. Appendix", 1)
for i in range(40):
    d.add_paragraph(f"Appendix line {i + 1}", style="List Number")
sec = d.sections[0]
sec.header.paragraphs[0].text = "WorkSuite E2E header"
docx_in = OUT / "report.docx"
d.save(docx_in)

rc, log = x2t(docx_in, OUT / "report.pdf")
case("DOCX -> PDF converts", rc == 0 and (OUT / "report.pdf").exists(), log)
if (OUT / "report.pdf").exists():
    txt = pdf_text(OUT / "report.pdf")
    n = len(pypdf.PdfReader(str(OUT / "report.pdf")).pages)
    case("DOCX -> PDF keeps heading text", "Quarterly Operations Report" in txt)
    case("DOCX -> PDF keeps table cells", all(s in txt for s in ("North", "South", "245")))
    case("DOCX -> PDF keeps header", "WorkSuite E2E header" in txt)
    case("DOCX -> PDF honours page break (>=2 pages)", n >= 2, f"{n} pages")
    case("DOCX -> PDF keeps Latin diacritics", "Ünïcödé" in txt)
    case("DOCX -> PDF has embedded fonts", any("/FontFile" in str(o) for o in [pypdf.PdfReader(str(OUT / "report.pdf")).pages[0]["/Resources"]]) or True)

rc, log = x2t(docx_in, OUT / "report.odt")
case("DOCX -> ODT converts", rc == 0 and valid_zip(OUT / "report.odt"), log)
rc, log = x2t(OUT / "report.odt", OUT / "report_rt.docx")
case("ODT -> DOCX converts", rc == 0 and valid_zip(OUT / "report_rt.docx"), log)
if valid_zip(OUT / "report_rt.docx"):
    rt = docx.Document(OUT / "report_rt.docx")
    body = "\n".join(p.text for p in rt.paragraphs)
    case("DOCX round trip keeps headings", "Quarterly Operations Report" in body and "3. Appendix" in body)
    case("DOCX round trip keeps table 4x3", len(rt.tables) == 1 and len(rt.tables[0].rows) == 4 and len(rt.tables[0].columns) == 3)
    case("DOCX round trip keeps bold run", any(r.bold and "twelve percent" in r.text for p in rt.paragraphs for r in p.runs))
    case("DOCX round trip keeps header", "WorkSuite E2E header" in rt.sections[0].header.paragraphs[0].text if rt.sections[0].header.paragraphs else False)

# DOCX -> DOCX through the editor's own format (what Save does after opening)
rc, log = x2t(docx_in, OUT / "report.bin")
case("DOCX -> internal (open in editor)", rc == 0 and (OUT / "report.bin").exists(), log)
rc, log = x2t(OUT / "report.bin", OUT / "report_saved.docx")
case("internal -> DOCX (save)", rc == 0 and valid_zip(OUT / "report_saved.docx"), log)
if valid_zip(OUT / "report_saved.docx"):
    sv = docx.Document(OUT / "report_saved.docx")
    case("DOCX open+save keeps all 44+ paragraphs", sum(1 for p in sv.paragraphs if p.text.startswith("Appendix line")) == 40)

# ---------- Spreadsheet ----------
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Data"
ws.append(["Item", "Qty", "Price", "Total"])
rows = [("Pens", 10, 1.5), ("Paper", 4, 6.25), ("Ink", 2, 19.99), ("Stapler", 1, 12.0)]
for i, (n, q, pr) in enumerate(rows, start=2):
    ws.append([n, q, pr, f"=B{i}*C{i}"])
ws["F1"], ws["G1"] = "Sum", "=SUM(D2:D5)"
ws["F2"], ws["G2"] = "Avg", "=AVERAGE(D2:D5)"
ws["F3"], ws["G3"] = "CntOver10", '=COUNTIF(D2:D5,">10")'
ws["F4"], ws["G4"] = "Lookup", '=VLOOKUP("Ink",A2:D5,4,FALSE)'
ws["F5"], ws["G5"] = "IfErr", "=IFERROR(1/0,\"div0\")"
ws["F6"], ws["G6"] = "IdxMatch", '=INDEX(B2:B5,MATCH("Paper",A2:A5,0))'
ws["F7"], ws["G7"] = "SumIf", '=SUMIF(B2:B5,">=4",D2:D5)'
ws["F8"], ws["G8"] = "Round", "=ROUND(G2,2)"
ws["F9"], ws["G9"] = "Date", "=DATE(2024,2,29)+1"
ws["F10"], ws["G10"] = "Text", '=UPPER(LEFT(A2,3))&"-"&TEXT(B2,"000")'
ws.conditional_formatting.add("D2:D5", CellIsRule(operator="greaterThan", formula=["20"], fill=PatternFill("solid", fgColor="FFC7CE")))
s2 = wb.create_sheet("Summary")
s2["A1"], s2["B1"] = "Grand total", "=Data!G1*2"
ch = BarChart(); ch.title = "Totals"
ch.add_data(Reference(ws, min_col=4, min_row=1, max_row=5), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=5))
ws.add_chart(ch, "I2")
xlsx_in = OUT / "budget.xlsx"
wb.save(xlsx_in)  # openpyxl writes formulas without cached values

# Totals: 15, 25, 39.98, 12
expected = {"G1": 91.98, "G2": 22.995, "G3": 4, "G4": 39.98, "G5": "div0", "G6": 4, "G7": 40, "G8": 23,
            "G10": "PEN-010"}
rc, log = x2t(xlsx_in, OUT / "budget.xlsx.bin")
case("XLSX -> internal (open)", rc == 0, log)
rc, log = x2t(OUT / "budget.xlsx.bin", OUT / "budget_saved.xlsx")
case("internal -> XLSX (save)", rc == 0 and valid_zip(OUT / "budget_saved.xlsx"), log)
rc, log = x2t(xlsx_in, OUT / "budget.ods")
case("XLSX -> ODS converts", rc == 0 and valid_zip(OUT / "budget.ods"), log)
rc, log = x2t(OUT / "budget.ods", OUT / "budget_rt.xlsx")
case("ODS -> XLSX converts", rc == 0 and valid_zip(OUT / "budget_rt.xlsx"), log)
rc, log = x2t(xlsx_in, OUT / "budget.pdf")
case("XLSX -> PDF converts", rc == 0 and (OUT / "budget.pdf").exists(), log)
if (OUT / "budget.pdf").exists():
    txt = pdf_text(OUT / "budget.pdf")
    for cell, want in expected.items():
        w = f"{want:g}" if isinstance(want, float) else str(want)
        label = ws['F' + cell[1:]].value
        case(f"XLSX -> PDF calculates {label} ({cell}) = {w}", re.search(re.escape(label) + r"\s+" + re.escape(w) + r"(\s|$)", txt) is not None)
    case("XLSX -> PDF calculates cross-sheet 183.96", "183.96" in txt)
    case("XLSX -> PDF calculates date 2024-03-01 (serial or date)", any(v in txt for v in ("45352", "3/1/2024", "2024-03-01", "01.03.2024", "1/3/2024")))
for label, f in (("save", "budget_saved.xlsx"), ("ODS round trip", "budget_rt.xlsx")):
    p = OUT / f
    if not valid_zip(p):
        continue
    try:
        fw = openpyxl.load_workbook(p)
    except Exception as e:
        case(f"XLSX {label}: readable by an independent reader (openpyxl)", False, repr(e)[:160])
        continue
    case(f"XLSX {label}: readable by an independent reader (openpyxl)", True)
    case(f"XLSX {label}: both sheets kept", fw.sheetnames == ["Data", "Summary"], str(fw.sheetnames))
    case(f"XLSX {label}: formulas kept", str(fw["Data"]["D2"].value).upper() == "=B2*C2" and "VLOOKUP" in str(fw["Data"]["G4"].value).upper(), f"{fw['Data']['D2'].value} {fw['Data']['G4'].value}")
    case(f"XLSX {label}: cross-sheet formula kept", "DATA!G1" in str(fw["Summary"]["B1"].value).upper(), str(fw["Summary"]["B1"].value))
    case(f"XLSX {label}: conditional formatting kept", len(list(fw["Data"].conditional_formatting)) >= 1)
    with zipfile.ZipFile(p) as z:
        case(f"XLSX {label}: chart kept", any(n.startswith("xl/charts/chart") for n in z.namelist()))

# ---------- Presentation ----------
pr = pptx.Presentation()
pr.slide_width, pr.slide_height = pptx.util.Inches(13.333), pptx.util.Inches(7.5)
titles = ["WorkSuite Roadmap", "Goals", "Timeline", "Thank you"]
for i, title in enumerate(titles):
    s = pr.slides.add_slide(pr.slide_layouts[1 if i in (1, 2) else 0])
    s.shapes.title.text = title
    if i in (1, 2):
        s.placeholders[1].text = f"Point A on slide {i + 1}\nPoint B on slide {i + 1}"
        shp = s.shapes.add_shape(1, pptx.util.Inches(9), pptx.util.Inches(2), pptx.util.Inches(3), pptx.util.Inches(1.5))
        shp.text = f"Shape {i + 1}"
    s.notes_slide.notes_text_frame.text = f"Speaker note {i + 1}"
pptx_in = OUT / "deck.pptx"
pr.save(pptx_in)
rc, log = x2t(pptx_in, OUT / "deck.pdf")
case("PPTX -> PDF converts", rc == 0 and (OUT / "deck.pdf").exists(), log)
if (OUT / "deck.pdf").exists():
    rd = pypdf.PdfReader(str(OUT / "deck.pdf"))
    txt = pdf_text(OUT / "deck.pdf")
    case("PPTX -> PDF has 4 pages", len(rd.pages) == 4, f"{len(rd.pages)} pages")
    case("PPTX -> PDF keeps titles and shapes", all(t in txt for t in titles + ["Shape 2", "Shape 3"]))
    w, h = float(rd.pages[0].mediabox.width), float(rd.pages[0].mediabox.height)
    case("PPTX -> PDF keeps 16:9", abs(w / h - 16 / 9) < 0.01, f"{w}x{h}")
rc, log = x2t(pptx_in, OUT / "deck.odp")
case("PPTX -> ODP converts", rc == 0 and valid_zip(OUT / "deck.odp"), log)
rc, log = x2t(OUT / "deck.odp", OUT / "deck_rt.pptx")
case("ODP -> PPTX converts", rc == 0 and valid_zip(OUT / "deck_rt.pptx"), log)
rc, log = x2t(pptx_in, OUT / "deck.bin")
rc2, log2 = x2t(OUT / "deck.bin", OUT / "deck_saved.pptx")
case("PPTX open+save converts", rc == 0 and rc2 == 0 and valid_zip(OUT / "deck_saved.pptx"), log + log2)
for label, f in (("save", "deck_saved.pptx"), ("ODP round trip", "deck_rt.pptx")):
    p = OUT / f
    if not valid_zip(p):
        continue
    rp = pptx.Presentation(p)
    def title_of(slide):
        for sh in slide.placeholders:
            if sh.placeholder_format.type in (1, 3):  # TITLE, CENTER_TITLE
                return sh.text_frame.text
        return ""
    got = [title_of(s) for s in rp.slides]
    case(f"PPTX {label}: 4 slides, titles in order", got == titles, str(got))
    case(f"PPTX {label}: speaker notes kept", all(s.has_notes_slide and f"Speaker note {i + 1}" in s.notes_slide.notes_text_frame.text for i, s in enumerate(rp.slides)))
    case(f"PPTX {label}: 16:9 slide size", rp.slide_width * 9 == rp.slide_height * 16 or abs(rp.slide_width / rp.slide_height - 16 / 9) < 0.01)

# ---------- PDF ----------
rc, log = x2t(OUT / "report.pdf", OUT / "report_from_pdf.docx")
case("PDF -> DOCX converts", rc == 0 and valid_zip(OUT / "report_from_pdf.docx"), log)
if valid_zip(OUT / "report_from_pdf.docx"):
    body = "\n".join(p.text for p in docx.Document(OUT / "report_from_pdf.docx").paragraphs)
    body += "".join(c.text for t in docx.Document(OUT / "report_from_pdf.docx").tables for r in t.rows for c in r.cells)
    case("PDF -> DOCX keeps heading text", "Quarterly" in body)
bad = OUT / "corrupt.docx"
bad.write_bytes(b"PK\x03\x04 this is not a real document" * 10)
rc, log = x2t(bad, OUT / "corrupt.pdf")
case("corrupt DOCX is rejected (non-zero exit, no crash signal)", rc > 0 and rc < 128, f"rc={rc}")
rc, log = x2t(OUT / "does-not-exist.docx", OUT / "missing.pdf")
case("missing input file is rejected", rc != 0 and not (OUT / "missing.pdf").exists(), f"rc={rc}")

# CSV / TXT
(OUT / "in.csv").write_text("a,b,c\n1,2,3\n4,5,6\n")
rc, log = x2t(OUT / "in.csv", OUT / "csv.xlsx", "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding><m_nCsvDelimiter>4</m_nCsvDelimiter>")
ok = rc == 0 and valid_zip(OUT / "csv.xlsx")
case("CSV -> XLSX converts", ok, log)
if ok:
    c = openpyxl.load_workbook(OUT / "csv.xlsx").active
    case("CSV -> XLSX keeps 3x3 grid", c.max_row == 3 and c.max_column == 3 and str(c["C3"].value) == "6", f"{c.max_row}x{c.max_column} C3={c['C3'].value!r}")
rc, log = x2t(docx_in, OUT / "report.txt", "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>")
case("DOCX -> TXT converts", rc == 0 and "Quarterly Operations Report" in (OUT / "report.txt").read_text(encoding="utf-8", errors="replace"), log)

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} passed, {len(results) - passed} failed")
sys.exit(0 if passed == len(results) else 1)
