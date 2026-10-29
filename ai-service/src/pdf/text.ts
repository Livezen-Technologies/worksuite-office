// Positioned text of PDF pages through pdf.js (Apache-2.0), run in this process without a worker.
// Loaded on first use. Text needs no drawing: empty DOMMatrix/Path2D keep pdf.js from looking for "canvas".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjs: any = null;
function lib() {
  if (pdfjs) return pdfjs;
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= class DOMMatrix {};
  g.Path2D ??= class Path2D {};
  // the "fake worker": pdf.js runs its worker code in this process when it finds it here
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  g.pdfjsWorker = require("pdfjs-dist/legacy/build/pdf.worker.js");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (pdfjs = require("pdfjs-dist/legacy/build/pdf.js"));
}

export interface TextItem { str: string; x: number; y: number; w: number; h: number }
export interface PageText { width: number; height: number; items: TextItem[] }

/** Text items of each page, with y measured from the top. */
export async function pageTexts(bytes: Uint8Array, password?: string): Promise<PageText[]> {
  const doc = await lib().getDocument({ data: bytes, password, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const out: PageText[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const h = Math.abs(it.height || it.transform[3]);
        items.push({ str: it.str, x, y: y - h, w: it.width, h });
      }
      out.push({ width: vp.width, height: vp.height, items });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
