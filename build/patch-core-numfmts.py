#!/usr/bin/env python3
"""ODS -> XLSX: a valid <numFmts> element. Applied in CI before core is built.

ONLYOFFICE's ODF reader (OdfFile/Reader/Converter/xlsx_numFmts.cpp) wrote the format count in an
attribute named formatCode, counting the built-in formats too, which get no <numFmt>: a spreadsheet
whose formats were all built in came out as <numFmts formatCode="1"/>, which ECMA-376 does not allow
(the attribute is count, and it counts the <numFmt> children). Strict readers refused the file
(openpyxl: "unexpected keyword argument 'formatCode'"). Now the attribute is count, it counts the
<numFmt> elements written, and with none the element is left out (it is optional in styles.xml).

Two more ODS -> XLSX number format losses, the same reader:
- xlsx_numFmts.cpp mapped a format to a built-in one when it merely contained the built-in code
  ("0.0%" contains "0%", so it became 0%; likewise 0.00E+00, ?/? and ??/??) and dropped its own code.
  Now only the exact built-in code maps to the built-in format.
- Format/table_xlsx.cpp dropped a cell's date, time or currency format when the cell's value type was
  another one. WorkSuite (and others) store dates as numbers with a date style (office:value-type
  "float"), which LibreOffice and Excel show as dates; so every date of an ODS that WorkSuite saved
  came back as a serial number (46024). A number cell now keeps its style's numeric format; a text
  or boolean cell still takes its own type, as before.

Usage: patch-core-numfmts.py path/to/core
Running it again changes nothing.
"""
from pathlib import Path
import sys

OLD = """void xlsx_num_fmts::Impl::serialize(std::wostream & strm) const
{
    CP_XML_WRITER(strm)
    {
        CP_XML_NODE (L"numFmts")
        {
            CP_XML_ATTR (L"formatCode", arrFormats.size());"""
NEW = """void xlsx_num_fmts::Impl::serialize(std::wostream & strm) const
{
    // WorkSuite (build/patch-core-numfmts.py): count the <numFmt> written; none, no element
    size_t custom = 0;
    for (size_t i = 0; i < arrFormats.size(); ++i)
        if (false == arrFormats[i].code.empty()) custom++;
    if (custom == 0)
        return;
    CP_XML_WRITER(strm)
    {
        CP_XML_NODE (L"numFmts")
        {
            CP_XML_ATTR (L"count", custom);"""

EXACT = [  # (old, new) in xlsx_numFmts.cpp: whole built-in codes only
    ('format_code.find(L"0.00E+00"))', 'format_code.find(L"0.00E+00") && format_code == L"0.00E+00")'),
    ('format_code.find(L"??/??"))', 'format_code.find(L"??/??") && (format_code == L"??/??" || format_code == L"# ??/??"))'),
    ('format_code.find(L"?/?"))', 'format_code.find(L"?/?") && (format_code == L"?/?" || format_code == L"# ?/?"))'),
    ('format_code.find(L"0.00%"))', 'format_code.find(L"0.00%") && format_code == L"0.00%")'),
    ('format_code.find(L"0%"))', 'format_code.find(L"0%") && format_code == L"0%")'),
]
CELL_OLD = """				if (attr.office_value_type_.get() != cell_num_format_type && cell_num_format_type != office_value_type::Custom)
				{// reset from cell"""
CELL_NEW = """				// WorkSuite (build/patch-core-numfmts.py): a number keeps its style's date, time, currency, ... format
				const bool number_kept = attr.office_value_type_.get() == office_value_type::Float &&
					cell_num_format_type != office_value_type::Boolean && cell_num_format_type != office_value_type::String;
				if (attr.office_value_type_.get() != cell_num_format_type && cell_num_format_type != office_value_type::Custom && !number_kept)
				{// reset from cell"""

root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-core-numfmts.py path/to/core")
path = root / "OdfFile" / "Reader" / "Converter" / "xlsx_numFmts.cpp"
if not path.is_file():
    sys.exit(f"patch-core-numfmts: {path} not found")
text = path.read_text(encoding="utf-8")
if NEW not in text:
    if text.count(OLD) != 1:
        sys.exit(f"patch-core-numfmts: the expected text is in {path} {text.count(OLD)} times, not once")
    text = text.replace(OLD, NEW)
    path.write_text(text, encoding="utf-8", newline="\n")
print(f"patched {path}")

text = path.read_text(encoding="utf-8")
for old, new in EXACT:
    if new not in text:
        if text.count(old) != 1:
            sys.exit(f"patch-core-numfmts: {old} is in {path} {text.count(old)} times, not once")
        text = text.replace(old, new)
path.write_text(text, encoding="utf-8", newline="\n")
print(f"patched {path} (built-in formats)")

cell = root / "OdfFile" / "Reader" / "Format" / "table_xlsx.cpp"
if not cell.is_file():
    sys.exit(f"patch-core-numfmts: {cell} not found")
raw = cell.read_text(encoding="utf-8", newline="")
crlf = "\r\n" in raw
old, new = (CELL_OLD.replace("\n", "\r\n"), CELL_NEW.replace("\n", "\r\n")) if crlf else (CELL_OLD, CELL_NEW)
if new not in raw:
    if raw.count(old) != 1:
        sys.exit(f"patch-core-numfmts: the expected text is in {cell} {raw.count(old)} times, not once")
    cell.write_text(raw.replace(old, new), encoding="utf-8", newline="")
print(f"patched {cell}")
