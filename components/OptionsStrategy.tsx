"use client";
import { useMemo, useState } from "react";

interface Opt { strike: number; last: number | null; bid: number | null; ask: number | null; vol: number | null; oi: number | null; iv: number | null; itm: boolean }
interface Leg { kind: "stock" | "call" | "put"; side: "buy" | "sell"; strike?: number; premium: number; qty: number }

const STRATS = [
  { key: "long-call", label: "Long Call", outlook: "Bullish", strikes: 1 },
  { key: "long-put", label: "Long Put", outlook: "Bearish", strikes: 1 },
  { key: "covered-call", label: "Covered Call", outlook: "Neutral · income", strikes: 1 },
  { key: "csp", label: "Cash-Secured Put", outlook: "Neutral-bullish · income", strikes: 1 },
  { key: "bull-call", label: "Bull Call Spread", outlook: "Bullish · defined risk", strikes: 2 },
  { key: "bear-put", label: "Bear Put Spread", outlook: "Bearish · defined risk", strikes: 2 },
  { key: "straddle", label: "Long Straddle", outlook: "Big move either way", strikes: 1 },
  { key: "strangle", label: "Long Strangle", outlook: "Big move · cheaper", strikes: 2 },
] as const;
type StratKey = (typeof STRATS)[number]["key"];

const mid = (o: Opt | undefined): number => {
  if (!o) return 0;
  if (o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  return o.last ?? 0;
};
const dollars = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const price2 = (v: number) => `$${v.toFixed(2)}`;

function buildLegs(strat: StratKey, kA: number, kB: number, u: number, callBy: Map<number, Opt>, putBy: Map<number, Opt>): Leg[] {
  const c = (k: number) => mid(callBy.get(k));
  const p = (k: number) => mid(putBy.get(k));
  switch (strat) {
    case "long-call": return [{ kind: "call", side: "buy", strike: kA, premium: c(kA), qty: 1 }];
    case "long-put": return [{ kind: "put", side: "buy", strike: kA, premium: p(kA), qty: 1 }];
    case "covered-call": return [{ kind: "stock", side: "buy", premium: u, qty: 1 }, { kind: "call", side: "sell", strike: kA, premium: c(kA), qty: 1 }];
    case "csp": return [{ kind: "put", side: "sell", strike: kA, premium: p(kA), qty: 1 }];
    case "bull-call": { const lo = Math.min(kA, kB), hi = Math.max(kA, kB); return [{ kind: "call", side: "buy", strike: lo, premium: c(lo), qty: 1 }, { kind: "call", side: "sell", strike: hi, premium: c(hi), qty: 1 }]; }
    case "bear-put": { const lo = Math.min(kA, kB), hi = Math.max(kA, kB); return [{ kind: "put", side: "buy", strike: hi, premium: p(hi), qty: 1 }, { kind: "put", side: "sell", strike: lo, premium: p(lo), qty: 1 }]; }
    case "straddle": return [{ kind: "call", side: "buy", strike: kA, premium: c(kA), qty: 1 }, { kind: "put", side: "buy", strike: kA, premium: p(kA), qty: 1 }];
    case "strangle": { const lo = Math.min(kA, kB), hi = Math.max(kA, kB); return [{ kind: "put", side: "buy", strike: lo, premium: p(lo), qty: 1 }, { kind: "call", side: "buy", strike: hi, premium: c(hi), qty: 1 }]; }
  }
}

const payoffOf = (legs: Leg[]) => (S: number) =>
  legs.reduce((t, l) => {
    const intr = l.kind === "stock" ? S : l.kind === "call" ? Math.max(0, S - l.strike!) : Math.max(0, l.strike! - S);
    return t + (l.side === "buy" ? 1 : -1) * (intr - l.premium) * l.qty;
  }, 0) * 100;

const CW = 520, CH = 200, ML = 44, MR = 12, MT = 12, MB = 22;

export default function OptionsStrategy({ calls, puts, underlying, expiry, dte }: { calls: Opt[]; puts: Opt[]; underlying: number | null; expiry: string | null; dte: number | null }) {
  const u = underlying ?? 0;
  const callBy = useMemo(() => new Map(calls.map((c) => [c.strike, c])), [calls]);
  const putBy = useMemo(() => new Map(puts.map((p) => [p.strike, p])), [puts]);
  const strikes = useMemo(() => [...new Set([...callBy.keys(), ...putBy.keys()])].sort((a, b) => a - b), [callBy, putBy]);
  const atmIdx = useMemo(() => { let best = Infinity, idx = 0; strikes.forEach((s, i) => { const d = Math.abs(s - u); if (d < best) { best = d; idx = i; } }); return idx; }, [strikes, u]);

  const [stratKey, setStratKey] = useState<StratKey>("long-call");
  const [aOv, setAOv] = useState<number | null>(null);
  const [bOv, setBOv] = useState<number | null>(null);
  const strat = STRATS.find((s) => s.key === stratKey)!;

  const at = (off: number) => strikes[Math.min(strikes.length - 1, Math.max(0, atmIdx + off))];
  const defaults = useMemo(() => {
    switch (stratKey) {
      case "covered-call": return { a: at(2), b: at(2) };
      case "csp": return { a: at(-2), b: at(-2) };
      case "bull-call": return { a: at(0), b: at(3) };
      case "bear-put": return { a: at(-3), b: at(0) };
      case "strangle": return { a: at(-2), b: at(2) };
      default: return { a: at(0), b: at(0) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stratKey, strikes, atmIdx]);

  if (strikes.length < 2 || !u) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">Not enough chain data to model strategies for this expiry.</div>;
  }

  const kA = aOv ?? defaults.a;
  const kB = bOv ?? defaults.b;
  const legs = buildLegs(stratKey, kA, kB, u, callBy, putBy);
  const pay = payoffOf(legs);

  const netCost = legs.reduce((s, l) => s + (l.side === "buy" ? 1 : -1) * l.premium * l.qty, 0) * 100;

  // exact extremes at the kinks (0, strikes, far-OTM) + unbounded-upside check
  const far = u * 3;
  const kinks = [0, ...strikes, far];
  const kinkVals = kinks.map(pay);
  const slopeUp = pay(far) - pay(far - Math.max(0.01, u * 0.002));
  const upUnbounded = slopeUp > 1e-6;
  const maxProfit = upUnbounded ? null : Math.max(...kinkVals);
  const maxLoss = Math.min(...kinkVals);

  // chart grid + break-evens
  const lo = Math.max(0, u * 0.55), hi = u * 1.5;
  const N = 130;
  const grid = Array.from({ length: N + 1 }, (_, i) => { const S = lo + (i / N) * (hi - lo); return { S, y: pay(S) }; });
  const breakevens: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1], b = grid[i];
    if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0)) {
      const t = a.y / (a.y - b.y);
      breakevens.push(a.S + t * (b.S - a.S));
    }
  }

  const yMinRaw = Math.min(0, ...grid.map((g) => g.y));
  const yMaxRaw = Math.max(0, ...grid.map((g) => g.y));
  const padY = (yMaxRaw - yMinRaw) * 0.08 || 50;
  const yMin = yMinRaw - padY, yMax = yMaxRaw + padY;
  const X = (S: number) => ML + ((S - lo) / (hi - lo)) * (CW - ML - MR);
  const Y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin)) * (CH - MT - MB);
  const path = grid.map((g, i) => `${i ? "L" : "M"}${X(g.S).toFixed(1)} ${Y(g.y).toFixed(1)}`).join("");
  const y0 = Y(0);
  const frac = Math.max(0, Math.min(1, (y0 - MT) / (CH - MB - MT)));

  const strikeOpts = strikes;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold text-[var(--text-2)]">Strategy payoff</span>
        <select
          value={stratKey}
          onChange={(e) => { setStratKey(e.target.value as StratKey); setAOv(null); setBOv(null); }}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm outline-none"
        >
          {STRATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--text-3)]">{strat.outlook}</span>
        <label className="flex items-center gap-1 text-xs text-[var(--text-3)]">
          {strat.strikes === 2 ? "Lower" : "Strike"}
          <select value={kA} onChange={(e) => setAOv(Number(e.target.value))} className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs outline-none">
            {strikeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {strat.strikes === 2 && (
          <label className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            Upper
            <select value={kB} onChange={(e) => setBOv(Number(e.target.value))} className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs outline-none">
              {strikeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {dte != null && <span className="ml-auto text-[11px] text-[var(--text-4)]">{expiry} · {dte}d</span>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={netCost >= 0 ? "Net debit" : "Net credit"} value={dollars(Math.abs(netCost))} sub={netCost >= 0 ? "you pay" : "you collect"} />
        <Metric label="Max profit" value={maxProfit == null ? "Unlimited" : dollars(maxProfit)} color="#22c55e" />
        <Metric label="Max loss" value={dollars(maxLoss)} color="#ef4444" />
        <Metric label="Break-even" value={breakevens.length ? breakevens.map(price2).join(" / ") : "—"} />
      </div>

      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ height: "auto" }}>
        <defs>
          <linearGradient id="plgrad" gradientUnits="userSpaceOnUse" x1="0" y1={MT} x2="0" y2={CH - MB}>
            <stop offset="0" stopColor="#22c55e" />
            <stop offset={frac} stopColor="#22c55e" />
            <stop offset={frac} stopColor="#ef4444" />
            <stop offset="1" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {/* zero line */}
        <line x1={ML} x2={CW - MR} y1={y0} y2={y0} stroke="var(--border-strong)" strokeWidth={1} />
        <text x={ML - 6} y={y0 + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">$0</text>
        {/* y labels */}
        {[yMax, (yMax + yMin) / 2, yMin].map((v, i) => (
          <text key={i} x={ML - 6} y={Y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">{dollars(v)}</text>
        ))}
        {/* current price */}
        <line x1={X(u)} x2={X(u)} y1={MT} y2={CH - MB} stroke="var(--text-4)" strokeDasharray="3 3" />
        <text x={X(u)} y={MT + 8} textAnchor="middle" fontSize={9} fill="var(--text-3)">now {price2(u)}</text>
        {/* break-evens */}
        {breakevens.map((b, i) => (
          <g key={i}>
            <line x1={X(b)} x2={X(b)} y1={MT} y2={CH - MB} stroke="#a855f7" strokeWidth={0.8} strokeDasharray="2 2" />
            <text x={X(b)} y={CH - MB - 3} textAnchor="middle" fontSize={8} fill="#c4b5fd">{price2(b)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="url(#plgrad)" strokeWidth={2} />
        <text x={CW - MR} y={CH - 5} textAnchor="end" fontSize={9} fill="var(--text-4)">price at expiry →</text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-4)]">
        {legs.map((l, i) => (
          <span key={i}>
            <span className={l.side === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}>{l.side === "buy" ? "Buy" : "Sell"}</span>{" "}
            {l.kind === "stock" ? `100 sh @ ${price2(l.premium)}` : `${l.strike} ${l.kind} @ ${price2(l.premium)}`}
          </span>
        ))}
        <span className="ml-auto">P&amp;L per 1 contract at expiry (×100 shares); premiums at mid.</span>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-4)]">{sub}</div>}
    </div>
  );
}
