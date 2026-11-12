#!/usr/bin/env python3
"""Sinhala and Tamil text in the right font. Applied in CI before core is built.

The font scan (DesktopEditor/fontengine/ApplicationFontsWorker.cpp) writes AllFonts.js's
__fonts_ranges: for each code point, the font to draw it in when the text's own font has no glyph.
CFontSymbolsChecker::Apply2 penalises a font on a run of fewer than 10 code points in a row it
covers, so that a font with a few stray glyphs does not take a script over. But the Unicode blocks of
the Indic scripts have unassigned code points every few characters, so a real Sinhala or Tamil font
covers them only in short runs: Noto Sans Sinhala, after U+0DB1, in runs of 9, 1, 7, 1, 6, 1, 8 and 3.
Each was penalised, and a font that covers the holes too (Unifont, any pan-Unicode font) took the
consonants from U+0DB3, every vowel sign and the virama. Exported to PDF, that Sinhala and Tamil text
came out invisible or in a symbol font (Asana Math) although Noto Sans Sinhala is installed.

From Devanagari to Sinhala (U+0900-0DFF) a run is now measured by how much of its 128-code-point
script block the font covers. ONLYOFFICE_FONTS_VERSION goes from 15 to 16, so every installed
AllFonts.js (fonts.log records the version) is made again after the update.

Usage: patch-core-fontranges.py path/to/core
Running it again changes nothing.
"""
from pathlib import Path
import sys

APPLY_OLD = """				nFirstOffset = (int)(tmpFirst - m_pTmpSymbols);

				pSymbols = m_pSymbols + nFirstOffset;"""
APPLY_NEW = """				nFirstOffset = (int)(tmpFirst - m_pTmpSymbols);

				// WorkSuite (build/patch-core-fontranges.py): the Indic blocks have unassigned code points
				// every few characters, so a run there counts what the font covers of the whole block
				if (nFirstOffset >= 0x0900 && nFirstOffset <= 0x0DFF)
				{
					int nBlock = nFirstOffset & ~0x7F;
					int nInBlock = 0;
					for (int c = nBlock; c < nBlock + 0x80; ++c)
						if (c >= m_nMin && c <= m_nMax && nMask == m_pTmpSymbols[c])
							nInBlock++;
					if (nInBlock > nCount)
						nCount = nInBlock;
				}

				pSymbols = m_pSymbols + nFirstOffset;"""

VERSION_OLD = "#define ONLYOFFICE_FONTS_VERSION     15"
VERSION_NEW = "#define ONLYOFFICE_FONTS_VERSION     16 // WorkSuite: 15 + build/patch-core-fontranges.py"


def patch(path, old, new):
    if not path.is_file():
        sys.exit(f"patch-core-fontranges: {path} not found")
    text = path.read_text(encoding="utf-8", newline="")  # keep the file's line endings
    if "\r\n" in text:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    if new not in text:
        if text.count(old) != 1:
            sys.exit(f"patch-core-fontranges: the expected text is in {path} {text.count(old)} times, not once")
        path.write_text(text.replace(old, new), encoding="utf-8", newline="")
    print(f"patched {path}")


root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-core-fontranges.py path/to/core")
engine = root / "DesktopEditor" / "fontengine"
patch(engine / "ApplicationFontsWorker.cpp", APPLY_OLD, APPLY_NEW)
patch(engine / "ApplicationFontsWorker.h", VERSION_OLD, VERSION_NEW)
