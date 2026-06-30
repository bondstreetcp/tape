/**
 * Tiny arithmetic-formula engine over price time series — powers the Ratio/Spread chart's "Formula"
 * mode. Lets you plot any linear combination / ratio of tickers, e.g.:
 *   MA / SPY                    relative strength
 *   MDT - 0.19 MMED             implied "stub" value of core Medtronic ex its 0.19-per-share MiniMed stake
 *   0.5 AAPL + 0.5 MSFT         a custom basket
 *   (MDT - 0.19 MMED) / SPY     a stub, indexed to the market
 *
 * Supports + - * / , parentheses, unary minus, and IMPLICIT multiplication (a number next to a ticker
 * → "0.19 MMED" = 0.19 * MMED). Tickers are [A-Za-z][A-Za-z0-9.^]* (Yahoo symbols incl. ^GSPC, BOL.PA).
 * Hyphenated class shares (BRK-B) aren't supported — use the dot form where the data source accepts it.
 *
 * Client-safe: pure, no fs/network. The chart fetches each ticker's series and calls evaluate().
 */

export type Series = Map<string, number>; // dayKey "YYYY-MM-DD" -> value

type Tok =
  | { t: "num"; v: number }
  | { t: "tick"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" };

const NUM_RE = /^\d*\.?\d+(?:[eE][-+]?\d+)?/;
const TICK_RE = /^[A-Za-z][A-Za-z0-9.^]*/;

function tokenize(expr: string): Tok[] {
  const raw: Tok[] = [];
  let s = expr;
  while (s.length) {
    s = s.replace(/^\s+/, "");
    if (!s) break;
    const c = s[0];
    if (c === "(") { raw.push({ t: "lp" }); s = s.slice(1); continue; }
    if (c === ")") { raw.push({ t: "rp" }); s = s.slice(1); continue; }
    if ("+-*/".includes(c)) { raw.push({ t: "op", v: c }); s = s.slice(1); continue; }
    let m = s.match(NUM_RE);
    if (m) { raw.push({ t: "num", v: parseFloat(m[0]) }); s = s.slice(m[0].length); continue; }
    m = s.match(TICK_RE);
    if (m) { raw.push({ t: "tick", v: m[0].toUpperCase() }); s = s.slice(m[0].length); continue; }
    throw new Error(`Unexpected character '${c}'`);
  }
  // Insert implicit multiplication: an operand (num/ticker/`)`) immediately followed by the start of
  // another operand (num/ticker/`(`) means multiply — so "0.19 MMED" and "2(AAPL)" work.
  const out: Tok[] = [];
  for (let i = 0; i < raw.length; i++) {
    out.push(raw[i]);
    const a = raw[i], b = raw[i + 1];
    if (!b) continue;
    const aEnd = a.t === "num" || a.t === "tick" || a.t === "rp";
    const bStart = b.t === "num" || b.t === "tick" || b.t === "lp";
    if (aEnd && bStart) out.push({ t: "op", v: "*" });
  }
  return out;
}

export type Node =
  | { k: "num"; v: number }
  | { k: "tick"; v: string }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node };

// Recursive-descent: expr → term (('+'|'-') term)* ; term → factor (('*'|'/') factor)* ;
// factor → number | ticker | '(' expr ')' | ('-'|'+') factor
function parse(expr: string): Node {
  const toks = tokenize(expr);
  let i = 0;
  const peek = () => toks[i];
  const expectOp = (vs: string[]) => { const tk = peek(); return tk && tk.t === "op" && vs.includes(tk.v); };

  function parseExpr(): Node {
    let n = parseTerm();
    while (expectOp(["+", "-"])) { const op = (toks[i++] as any).v; n = { k: "bin", op, l: n, r: parseTerm() }; }
    return n;
  }
  function parseTerm(): Node {
    let n = parseFactor();
    while (expectOp(["*", "/"])) { const op = (toks[i++] as any).v; n = { k: "bin", op, l: n, r: parseFactor() }; }
    return n;
  }
  function parseFactor(): Node {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end of formula");
    if (tk.t === "op" && tk.v === "-") { i++; return { k: "neg", e: parseFactor() }; }
    if (tk.t === "op" && tk.v === "+") { i++; return parseFactor(); }
    if (tk.t === "num") { i++; return { k: "num", v: tk.v }; }
    if (tk.t === "tick") { i++; return { k: "tick", v: tk.v }; }
    if (tk.t === "lp") { i++; const n = parseExpr(); if (!peek() || peek().t !== "rp") throw new Error("Missing ')'"); i++; return n; }
    throw new Error("Unexpected token in formula");
  }

  const node = parseExpr();
  if (i < toks.length) throw new Error("Unexpected trailing tokens");
  return node;
}

const mapSeries = (s: Series, f: (x: number) => number): Series => {
  const out: Series = new Map();
  for (const [k, x] of s) out.set(k, f(x));
  return out;
};
const zip = (a: Series, b: Series, f: (x: number, y: number) => number): Series => {
  const out: Series = new Map();
  // iterate the smaller for speed
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const flip = small !== a;
  for (const [k, sv] of small) {
    const bv = big.get(k);
    if (bv == null) continue;
    out.set(k, flip ? f(bv, sv) : f(sv, bv));
  }
  return out;
};

type Val = number | Series;
const isNum = (v: Val): v is number => typeof v === "number";

function evalNode(n: Node, data: Map<string, Series>): Val {
  if (n.k === "num") return n.v;
  if (n.k === "tick") {
    const s = data.get(n.v);
    if (!s) throw new Error(`No price data for ${n.v}`);
    return s;
  }
  if (n.k === "neg") { const e = evalNode(n.e, data); return isNum(e) ? -e : mapSeries(e, (x) => -x); }
  const l = evalNode(n.l, data), r = evalNode(n.r, data);
  const fn = n.op === "+" ? (x: number, y: number) => x + y
    : n.op === "-" ? (x: number, y: number) => x - y
    : n.op === "*" ? (x: number, y: number) => x * y
    : (x: number, y: number) => (y === 0 ? NaN : x / y);
  if (isNum(l) && isNum(r)) return fn(l, r);
  if (isNum(l)) return mapSeries(r as Series, (y) => fn(l, y));
  if (isNum(r)) return mapSeries(l as Series, (x) => fn(x, r));
  return zip(l as Series, r as Series, fn);
}

export interface CompiledFormula {
  tickers: string[];
  evaluate: (data: Map<string, Series>) => Series;
}

/** Parse a formula → its referenced tickers + an evaluator. Throws on a syntax error or a constant
 *  (ticker-free) expression. */
export function compileFormula(expr: string): CompiledFormula {
  const ast = parse(expr);
  const tickers = new Set<string>();
  (function walk(n: Node) {
    if (n.k === "tick") tickers.add(n.v);
    else if (n.k === "neg") walk(n.e);
    else if (n.k === "bin") { walk(n.l); walk(n.r); }
  })(ast);
  if (!tickers.size) throw new Error("Formula must reference at least one ticker");
  return {
    tickers: [...tickers],
    evaluate: (data) => {
      const v = evalNode(ast, data);
      if (isNum(v)) throw new Error("Formula evaluates to a constant");
      return v;
    },
  };
}
