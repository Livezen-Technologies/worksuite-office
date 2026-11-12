#!/usr/bin/env python3
"""DOCX -> RTF: the default paragraph style is style 0, and styles are not marked as e-mail styles.
Applied in CI before core is built.

core's DOCX -> RTF writer (RtfFile/OOXml/Reader/OOXStyleReader.cpp) numbered the styles from 1 and
never used the style's w:default: Normal became \\s1. In RTF a paragraph without \\sN is in style 0,
so there was no default paragraph style, and the RTF read back (by WorkSuite, Word, LibreOffice)
lost the Normal formatting of every plain paragraph; the DOCX made from it had no w:default style.
The default paragraph style is now \\s0.

The same reader stored a style's w:uiPriority in its "personal compose" (e-mail) flag, so nearly
every style came back from RTF marked <w:personalCompose/>. The priority now goes to the priority.

Usage: patch-core-rtfstyles.py path/to/core
Running it again changes nothing.
"""
from pathlib import Path
import sys

FIXES = [
    (
        """	oNewStyle->m_nID = oParam.oRtf->m_oStyleTable.GetCount() + 1;

	oNewStyle->m_sID = m_ooxStyle->m_sStyleId.get_value_or(L"");""",
        """	oNewStyle->m_nID = oParam.oRtf->m_oStyleTable.GetCount() + 1;
	// WorkSuite (build/patch-core-rtfstyles.py): the default paragraph style is \\s0, as RTF expects
	RtfStylePtr oStyle0;
	if (bDefault && RtfStyle::stParagraph == eStyleType && false == oParam.oRtf->m_oStyleTable.GetStyle(0, oStyle0))
		oNewStyle->m_nID = 0;

	oNewStyle->m_sID = m_ooxStyle->m_sStyleId.get_value_or(L"");""",
    ),
    (
        """		oNewStyle->m_bCompose = *m_ooxStyle->m_oUiPriority->m_oVal;""",
        """		oNewStyle->m_nPriority = *m_ooxStyle->m_oUiPriority->m_oVal; // WorkSuite: was m_bCompose""",
    ),
]

root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-core-rtfstyles.py path/to/core")
path = root / "RtfFile" / "OOXml" / "Reader" / "OOXStyleReader.cpp"
if not path.is_file():
    sys.exit(f"patch-core-rtfstyles: {path} not found")
text = open(path, encoding="utf-8", newline="").read()  # keeps the line endings and a BOM
crlf = "\r\n" in text
for old, new in FIXES:
    if crlf:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    if new in text:
        continue
    if text.count(old) != 1:
        sys.exit(f"patch-core-rtfstyles: the expected text is in {path} {text.count(old)} times, not once")
    text = text.replace(old, new)
path.write_text(text, encoding="utf-8", newline="")
print(f"patched {path}")
