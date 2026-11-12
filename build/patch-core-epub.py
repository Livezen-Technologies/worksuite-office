#!/usr/bin/env python3
"""EPUB: pictures as files of the book, and a valid language. Applied in CI before core is built.

core's EPUB writer (EpubFile/src/CEpubFile.cpp, FromHtml) moves each picture of the HTML it gets out
of the page and into OEBPS/images. It looked for "data:image/png;base64, " with a space after the
comma; the HTML the editors make now has none ("data:image/png;base64,iVBOR..."), so no picture was
found and every one stayed in the page as a data: URI, which EPUB 2 does not allow (many readers
show nothing, epubcheck refuses the book). Only PNG was looked for at all, and every image was listed
in the manifest as image/png. Now every <img src="data:image/...;base64,..."> becomes a file with the
extension of its type, listed with that type; a picture without alt gets an empty one. A book whose
document gives no language said en-EN, which is not a language tag; it now says en.

Usage: patch-core-epub.py path/to/core
Running it again changes nothing.
"""
from pathlib import Path
import sys

LOOP_OLD = """    size_t nImage = sIndexHtml.find(L"data:image/png;base64, ");
    int nNumImage = 1;
    while (nImage != std::wstring::npos)
    {
        size_t nImageBegin = sIndexHtml.find(L' ', nImage) + 1;
        size_t nImageEnd = sIndexHtml.find(L'\\"', nImageBegin);
        std::wstring sImage = sIndexHtml.substr(nImageBegin, nImageEnd - nImageBegin);
        NSFile::CFileBinary oImageWriter;
        if (oImageWriter.CreateFileW(m_sTempDir + L"/OEBPS/images/img" + std::to_wstring(nNumImage) + L".png"))
        {
            int nSrcLen = (int)sImage.length();
            int nDecodeLen = NSBase64::Base64DecodeGetRequiredLength(nSrcLen);
            BYTE* pImageData = new BYTE[nDecodeLen];
            if (TRUE == NSBase64::Base64Decode(U_TO_UTF8(sImage).c_str(), nSrcLen, pImageData, &nDecodeLen))
                oImageWriter.WriteFile(pImageData, (DWORD)nDecodeLen);
            RELEASEARRAYOBJECTS(pImageData);
            oImageWriter.CloseFile();
        }
        sIndexHtml.insert(sIndexHtml.find(L"/>", nImage), L" alt=\\"NO\\"");
        sIndexHtml.replace(nImage, nImageEnd - nImage, L"images/img" + std::to_wstring(nNumImage++) + L".png");
        nImage = sIndexHtml.find(L"data:image/png;base64, ", nImage);
    }"""
LOOP_NEW = """    // WorkSuite (build/patch-core-epub.py): every <img src="data:image/<type>;base64,..."> becomes
    // OEBPS/images/img<n>.<ext>; the HTML has no space after the comma, and pictures are not only PNG
    const std::wstring sDataSrc = L"src=\\"data:image/";
    size_t nImage = sIndexHtml.find(sDataSrc);
    int nNumImage = 1;
    while (nImage != std::wstring::npos)
    {
        size_t nUri = nImage + 5; // after src="
        size_t nQuote = sIndexHtml.find(L'\\"', nUri);
        size_t nComma = sIndexHtml.find(L";base64,", nUri);
        if (nQuote == std::wstring::npos || nComma == std::wstring::npos || nComma > nQuote)
        {
            nImage = sIndexHtml.find(sDataSrc, nUri);
            continue;
        }
        std::wstring sType = sIndexHtml.substr(nUri + 11, nComma - nUri - 11); // after data:image/
        std::wstring sExt = (sType == L"jpeg" || sType == L"jpg") ? L"jpg" : (sType == L"gif") ? L"gif" :
                            (sType == L"svg+xml") ? L"svg" : (sType == L"bmp") ? L"bmp" : L"png";
        size_t nImageBegin = nComma + 8;
        while (nImageBegin < nQuote && sIndexHtml[nImageBegin] == L' ')
            ++nImageBegin;
        std::wstring sImage = sIndexHtml.substr(nImageBegin, nQuote - nImageBegin);
        std::wstring sFile = L"images/img" + std::to_wstring(nNumImage++) + L"." + sExt;
        NSFile::CFileBinary oImageWriter;
        if (oImageWriter.CreateFileW(m_sTempDir + L"/OEBPS/" + sFile))
        {
            std::string sImageA = U_TO_UTF8(sImage);
            int nSrcLen = (int)sImageA.length();
            int nDecodeLen = NSBase64::Base64DecodeGetRequiredLength(nSrcLen);
            BYTE* pImageData = new BYTE[nDecodeLen];
            if (TRUE == NSBase64::Base64Decode(sImageA.c_str(), nSrcLen, pImageData, &nDecodeLen))
                oImageWriter.WriteFile(pImageData, (DWORD)nDecodeLen);
            RELEASEARRAYOBJECTS(pImageData);
            oImageWriter.CloseFile();
        }
        size_t nTagBegin = sIndexHtml.rfind(L'<', nImage);
        size_t nTagEnd = sIndexHtml.find(L'>', nQuote);
        if (nTagEnd != std::wstring::npos && sIndexHtml.substr(nTagBegin, nTagEnd - nTagBegin).find(L" alt=") == std::wstring::npos)
            sIndexHtml.insert((sIndexHtml[nTagEnd - 1] == L'/') ? nTagEnd - 1 : nTagEnd, L" alt=\\"\\"");
        sIndexHtml.replace(nUri, nQuote - nUri, sFile);
        nImage = sIndexHtml.find(sDataSrc, nUri + sFile.length());
    }"""

MANIFEST_OLD = """            oContentOpf.WriteStringUTF8(L"<item id=\\"" + sName + L"\\" href=\\"images/" + sName + L"\\" media-type=\\"image/png\\"/>");"""
MANIFEST_NEW = """            std::wstring sExt = NSFile::GetFileExtention(sName); // WorkSuite: the image's own type
            std::wstring sMedia = (sExt == L"jpg") ? L"image/jpeg" : (sExt == L"gif") ? L"image/gif" :
                                  (sExt == L"svg") ? L"image/svg+xml" : (sExt == L"bmp") ? L"image/bmp" : L"image/png";
            oContentOpf.WriteStringUTF8(L"<item id=\\"" + sName + L"\\" href=\\"images/" + sName + L"\\" media-type=\\"" + sMedia + L"\\"/>");"""

LANG_OLD = """            oContentOpf.WriteStringUTF8(L"<dc:language>en-EN</dc:language>");"""
LANG_NEW = """            oContentOpf.WriteStringUTF8(L"<dc:language>en</dc:language>"); // WorkSuite: en-EN is not a language tag"""

root = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("usage: patch-core-epub.py path/to/core")
path = root / "EpubFile" / "src" / "CEpubFile.cpp"
if not path.is_file():
    sys.exit(f"patch-core-epub: {path} not found")
text = open(path, encoding="utf-8", newline="").read()  # keeps the line endings and a BOM
crlf = "\r\n" in text
for old, new in ((LOOP_OLD, LOOP_NEW), (MANIFEST_OLD, MANIFEST_NEW), (LANG_OLD, LANG_NEW)):
    if crlf:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    if new in text:
        continue
    if text.count(old) != 1:
        sys.exit(f"patch-core-epub: the expected text is in {path} {text.count(old)} times, not once")
    text = text.replace(old, new)
path.write_text(text, encoding="utf-8", newline="")
print(f"patched {path}")
