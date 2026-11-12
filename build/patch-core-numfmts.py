#!/usr/bin/env python3
"""ODS -> XLSX: a valid <numFmts> element. Applied in CI before core is built.

ONLYOFFICE's ODF reader (OdfFile/Reader/Converter/xlsx_numFmts.cpp) wrote the format count in an
attribute named formatCode, counting the built-in formats too, which get no <numFmt>: a spreadsheet
whose formats were all built in came out as <numFmts formatCode="1"/>, which ECMA-376 does not allow
(the attribute is count, and it counts the <numFmt> children). Strict readers refused the file
(openpyxl: "unexpected keyword argument 'formatCode'"). Now the attribute is count, it counts the
<numFmt> elements written, and with none the element is left out (it is optional in styles.xml).

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
