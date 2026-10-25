// Word-level diff (Myers O(ND)) from text -> result, as edits on the original's UTF-16 offsets.
export interface Edit { start: number; end: number; replacement: string; reason: string }

/** Words, runs of whitespace and single punctuation marks, with their offsets. */
export function tokenize(s: string): { t: string; start: number }[] {
  const out: { t: string; start: number }[] = [];
  const re = /\s+|[\p{L}\p{M}\p{N}‌‍'’_-]+|./gsu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ t: m[0], start: m.index });
  return out;
}

type Op = { kind: "eq" | "del" | "ins"; a?: number; b?: number };

export function myers(a: string[], b: string[]): Op[] {
  const n = a.length; const m = b.length; const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) { trace.push(new Map(v)); break outer; }
    }
  }
  // backtrack
  const ops: Op[] = [];
  let x = n; let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ kind: "eq", a: x - 1, b: y - 1 }); x--; y--; }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: "ins", b: y - 1 }); else ops.push({ kind: "del", a: x - 1 });
    }
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push({ kind: "eq", a: x - 1, b: y - 1 }); x--; y--; }
  return ops.reverse();
}

/** Edits that turn `text` into `result`: each a span of the original and what replaces it. */
export function wordDiff(text: string, result: string, reason: string): Edit[] {
  if (text === result) return [];
  const A = tokenize(text); const B = tokenize(result);
  const ops = myers(A.map((t) => t.t), B.map((t) => t.t));
  const edits: Edit[] = [];
  let cur: { start: number; end: number; rep: string } | null = null;
  let aPos = 0;
  const flush = () => { if (cur) edits.push({ start: cur.start, end: cur.end, replacement: cur.rep, reason }); cur = null; };
  for (const op of ops) {
    if (op.kind === "eq") { flush(); aPos = A[op.a!].start + A[op.a!].t.length; continue; }
    if (!cur) cur = { start: op.kind === "del" ? A[op.a!].start : aPos, end: op.kind === "del" ? A[op.a!].start : aPos, rep: "" };
    if (op.kind === "del") { cur.end = A[op.a!].start + A[op.a!].t.length; aPos = cur.end; }
    else cur.rep += B[op.b!].t;
  }
  flush();
  // a whitespace-only gap between two edits joins them: one reviewable change, not three
  const merged: Edit[] = [];
  for (const e of edits) {
    const last = merged[merged.length - 1];
    if (last && /^\s*$/.test(text.slice(last.end, e.start)) && e.start - last.end <= 2) {
      last.replacement += text.slice(last.end, e.start) + e.replacement;
      last.end = e.end;
    } else merged.push({ ...e });
  }
  return merged;
}

export function applyEdits(text: string, edits: { start: number; end: number; replacement: string }[]): string {
  let out = ""; let pos = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) { out += text.slice(pos, e.start) + e.replacement; pos = e.end; }
  return out + text.slice(pos);
}
