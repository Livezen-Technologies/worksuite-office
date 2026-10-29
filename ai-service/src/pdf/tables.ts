// Rows and columns from positioned text: the page's lines become rows, and runs of text separated by wide gaps
// become cells, put in columns by where they start (starts within a few points of each other share a column).
// Text that is not in a table lands in the first column, so nothing on the page is lost.
import type { PageText, TextItem } from "./text";

interface Cell { x: number; x2: number; str: string }

function lines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    const ref = last?.[0];
    if (ref && Math.abs(it.y - ref.y) <= Math.max(2, Math.min(it.h, ref.h) * 0.5)) last.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

function cells(line: TextItem[]): Cell[] {
  const out: Cell[] = [];
  for (const it of line) {
    const last = out[out.length - 1];
    // a gap wider than about two spaces starts a new cell
    const gap = last ? it.x - last.x2 : Infinity;
    if (last && gap < Math.max(4, it.h * 0.9)) {
      last.str += (gap > it.h * 0.15 && !/\s$/.test(last.str) ? " " : "") + it.str;
      last.x2 = it.x + it.w;
    } else {
      out.push({ x: it.x, x2: it.x + it.w, str: it.str });
    }
  }
  return out.map((c) => ({ ...c, str: c.str.replace(/\s+/g, " ").trim() }));
}

/** The page as rows of cells. */
export function pageTable(page: PageText, tolerance = 8): string[][] {
  const rows = lines(page.items).map(cells);
  // column starts: cell left edges clustered within the tolerance
  const starts = rows.flat().map((c) => c.x).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of starts) {
    if (!anchors.length || x - anchors[anchors.length - 1] > tolerance) anchors.push(x);
  }
  const column = (x: number) => {
    let best = 0;
    for (let i = 0; i < anchors.length; i++) if (anchors[i] <= x + tolerance) best = i;
    return best;
  };
  return rows.map((r) => {
    const out: string[] = [];
    for (const c of r) {
      let k = column(c.x);
      while (out[k] !== undefined && out[k] !== "") k++;
      while (out.length < k) out.push("");
      out[k] = c.str;
    }
    return out;
  });
}
