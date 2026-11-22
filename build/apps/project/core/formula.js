/*
 * WorkSuite Project: custom field formulas and graphical indicators (roadmap stage 5). Pure ES module, no DOM.
 *
 * A formula is parsed here, never run as code. It reads a task's fields by name in brackets and combines them:
 *   [Cost] * 1.15     IIf([% Complete] = 100, "Done", "Open")     Days([Start], [Deadline])     [Name] & " (" & [Owner] & ")"
 * Values are numbers, text, dates (as "YYYY-MM-DD" text, which compares in date order) and true/false.
 * Operators, loosest first: Or; And; Not; = <> < > <= >=; &; + -; * /; unary -. Functions: IIf, Abs, Round, Min, Max,
 * Len, Left, Right, Upper, Lower, Days (from one date to another, in calendar days), Today.
 * An indicator shows an icon by the field's value: "red if > 5; yellow if > 0; green" — the first rule that holds wins;
 * a rule without a condition always holds.
 */

const FUNCS = {
  iif: [3, 3], abs: [1, 1], round: [1, 2], min: [1, 99], max: [1, 99], len: [1, 1], left: [2, 2], right: [2, 2],
  upper: [1, 1], lower: [1, 1], days: [2, 2], today: [0, 0],
};

function tokens(src) {
  const out = [];
  let i = 0;
  const err = (m) => { throw new Error(`${m} at character ${i + 1}`); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "[") { const j = src.indexOf("]", i); if (j < 0) err("a field name is not closed with ]"); out.push({ t: "field", v: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (c === '"') { let j = i + 1, s = ""; while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) { if (src[j] === '"') j++; s += src[j++]; } if (j >= src.length) err("text is not closed with \""); out.push({ t: "str", v: s }); i = j + 1; continue; }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/&=<>(),])/.exec(src.slice(i));
    if (op) { out.push({ t: "op", v: op[0] }); i += op[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i));
    if (word) { out.push({ t: "word", v: word[0] }); i += word[0].length; continue; }
    err(`"${c}" is not understood`);
  }
  return out;
}

/** Parses a formula into a tree; throws a readable error when it is not well formed. */
export function parseFormula(src) {
  const ts = tokens(String(src ?? ""));
  if (!ts.length) throw new Error("the formula is empty");
  let p = 0;
  const peek = () => ts[p], next = () => ts[p++];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const isWord = (v) => peek() && peek().t === "word" && peek().v.toLowerCase() === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`"${v}" was expected`); p++; };
  const bin = (sub, ops, test = isOp) => () => { let l = sub(); for (;;) { const o = ops.find((x) => test(x)); if (!o) return l; p++; l = { k: "bin", o, l, r: sub() }; } };
  const primary = () => {
    const t = next();
    if (!t) throw new Error("the formula ends too soon");
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "field") return { k: "field", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = or(); expect(")"); return e; }
    if (t.t === "op" && t.v === "-") return { k: "neg", e: primary() };
    if (t.t === "word") {
      const w = t.v.toLowerCase();
      if (w === "true" || w === "false") return { k: "lit", v: w === "true" };
      if (!FUNCS[w]) throw new Error(`${t.v} is not a function here`);
      expect("(");
      const args = [];
      if (!isOp(")")) { args.push(or()); while (isOp(",")) { p++; args.push(or()); } }
      expect(")");
      const [lo, hi] = FUNCS[w];
      if (args.length < lo || args.length > hi) throw new Error(`${t.v} takes ${lo === hi ? lo : `${lo} to ${hi}`} values`);
      return { k: "call", f: w, args };
    }
    throw new Error(`"${t.v}" is out of place`);
  };
  const mul = bin(primary, ["*", "/"]);
  const add = bin(mul, ["+", "-"]);
  const cat = bin(add, ["&"]);
  const cmp = bin(cat, ["<>", "<=", ">=", "=", "<", ">"]);
  const not = () => (isWord("not") ? (p++, { k: "not", e: not() }) : cmp());
  const and = bin(not, ["and"], isWord);
  const or = bin(and, ["or"], isWord);
  const tree = or();
  if (p < ts.length) throw new Error(`"${ts[p].v}" is out of place`);
  return tree;
}

/** The field names a formula reads. */
export function fieldsUsed(tree, out = new Set()) {
  if (!tree) return out;
  if (tree.k === "field") out.add(tree.v);
  for (const c of [tree.l, tree.r, tree.e, ...(tree.args || [])]) fieldsUsed(c, out);
  return out;
}

const DAY = 86400000;
const dayOf = (s) => Math.round(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / DAY);

/** Evaluates a parsed formula; `get(name)` gives a field's value (or throws for an unknown field). */
export function evaluate(tree, get, today = new Date().toISOString().slice(0, 10)) {
  const ev = (n) => {
    switch (n.k) {
      case "lit": return n.v;
      case "field": return get(n.v);
      case "neg": return -num(ev(n.e));
      case "not": return !ev(n.e);
      case "call": return call(n.f, n.args);
      case "bin": {
        if (n.o === "and") return !!(ev(n.l) && ev(n.r));
        if (n.o === "or") return !!(ev(n.l) || ev(n.r));
        const a = ev(n.l), b = ev(n.r);
        switch (n.o) {
          case "+": return num(a) + num(b);
          case "-": return num(a) - num(b);
          case "*": return num(a) * num(b);
          case "/": { if (num(b) === 0) throw new Error("division by zero"); return num(a) / num(b); }
          case "&": return str(a) + str(b);
          default: return compare(n.o, a, b);
        }
      }
    }
    throw new Error("bad formula");
  };
  const call = (f, args) => {
    if (f === "iif") return ev(args[0]) ? ev(args[1]) : ev(args[2]);
    const v = args.map(ev);
    switch (f) {
      case "abs": return Math.abs(num(v[0]));
      case "round": { const k = 10 ** (v[1] === undefined ? 0 : num(v[1])); return Math.round(num(v[0]) * k) / k; }
      case "min": return Math.min(...v.map(num));
      case "max": return Math.max(...v.map(num));
      case "len": return str(v[0]).length;
      case "left": return str(v[0]).slice(0, num(v[1]));
      case "right": return num(v[1]) > 0 ? str(v[0]).slice(-num(v[1])) : "";
      case "upper": return str(v[0]).toUpperCase();
      case "lower": return str(v[0]).toLowerCase();
      case "days": { if (!v[0] || !v[1]) return null; return dayOf(v[1]) - dayOf(v[0]); }
      case "today": return today;
    }
    throw new Error(`${f} is not a function`);
  };
  return ev(tree);
}
const num = (v) => { if (v === null || v === undefined || v === "") return 0; if (typeof v === "boolean") return v ? 1 : 0; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`); return n; };
const str = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v));
function compare(o, a, b) {
  const bothNum = typeof a === "number" && typeof b === "number";
  const x = bothNum ? a : str(a), y = bothNum ? b : str(b);
  switch (o) { case "=": return x === y; case "<>": return x !== y; case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y; }
  return false;
}

/* ---- graphical indicators ---- */
export const ICONS = { red: "🔴", yellow: "🟡", green: "🟢", blue: "🔵", flag: "🚩", check: "✔️", warn: "⚠️", cross: "❌", star: "⭐" };

/** Parses indicator rules: "red if > 5; yellow if > 0; green" → [{ icon, op, value }] (op null: always). */
export function parseIndicators(src) {
  const rules = String(src ?? "").split(";").map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = /^([a-z]+)\s*(?:if\s*(<>|<=|>=|=|<|>)\s*(.+))?$/i.exec(part);
    if (!m) throw new Error(`"${part}" is not a rule: write an icon, then "if", a comparison and a value, like red if > 5`);
    const icon = m[1].toLowerCase();
    if (!ICONS[icon]) throw new Error(`${m[1]} is not an icon: use ${Object.keys(ICONS).join(", ")}`);
    if (!m[2]) return { icon, op: null, value: null };
    let value = m[3].trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    else if (/^(yes|true)$/i.test(value)) value = true;
    else if (/^(no|false)$/i.test(value)) value = false;
    return { icon, op: m[2], value };
  });
  if (!rules.length) throw new Error("no indicator rules");
  return rules;
}

/** The icon for a value by its rules, or null. */
export function indicatorFor(rules, v) {
  if (v === undefined || v === null || v === "") return null;
  for (const r of rules) if (!r.op || compare(r.op, typeof r.value === "number" && typeof v !== "number" ? Number(v) : v, r.value)) return r.icon;
  return null;
}
