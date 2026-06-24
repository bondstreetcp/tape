"use client";
import { useMemo, useState } from "react";
import { currencyPrefix } from "@/lib/format";

interface Opt { strike: number; last: number | null; bid: number | null; ask: number | null; vol: number | null; oi: number | null; iv: number | null; itm: boolean }
interface Leg { kind: "stock" | "call" | "put"; side: "buy" | "sell"; strike?: number; premium: number; qty: number }

// Each strike is selectable; `off` is the default index offset from the at-the-money strike.
const STRATS = [
  { key: "long-call", label: "Long Call", outlook: "Bullish", strikes: [{ label: "Strike", off: 0 }] },
  { key: "long-put", label: "Long Put", outlook: "Bearish", strikes: [{ label: "Strike", off: 0 }] },
  { key: "covered-call", label: "Covered Call", outlook: "Neutral · income", strikes: [{ label: "Call", off: 2 }] },
  { key: "csp", label: "Cash-Secured Put", outlook: "Neutral-bullish · income", strikes: [{ label: "Put", off: -2 }] },
  { key: "bull-call", label: "Bull Call Spread", outlook: "Bullish · defined risk", strikes: [{ label: "Long", off: 0 }, { label: "Short", off: 3 }] },
  { key: "bear-put", label: "Bear Put Spread", outlook: "Bearish · defined risk", strikes: [{ label: "Short", off: -3 }, { label: "Long", off: 0 }] },
  { key: "straddle", label: "Long Straddle", outlook: "Big move either way", strikes: [{ label: "Strike", off: 0 }] },
  { key: "strangle", label: "Long Strangle", outlook: "Big move · cheaper", strikes: [{ label: "Put", off: -2 }, { label: "Call", off: 2 }] },
  { key: "short-straddle", label: "Short Straddle", outlook: "Range-bound · sell vol", strikes: [{ label: "Strike", off: 0 }] },
  { key: "short-strangle", label: "Short Strangle", outlook: "Range-bound · income", strikes: [{ label: "Put", off: -2 }, { label: "Call", off: 2 }] },
  { key: "iron-condor", label: "Iron Condor", outlook: "Range-bound · defined risk", strikes: [{ label: "Long put", off: -4 }, { label: "Short put", off: -2 }, { label: "Short call", off: 2 }, { label: "Long call", off: 4 }] },
  { key: "iron-butterfly", label: "Iron Butterfly", outlook: "Pinned · defined risk", strikes: [{ label: "Long put", off: -3 }, { label: "ATM", off: 0 }, { label: "Long call", off: 3 }] },
] as const;
type StratKey = (typeof STRATS)[number]["key"];

const mid = (o: Opt | undefined): number => {
  if (!o) return 0;
  if (o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  return o.last ?? 0;
};
const fmtDollars = (v: number, sym: string) => `${v < 0 ? "−" : ""}${sym}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtPrice2 = (v: number, sym: string) => `${sym}${v.toFixed(2)}`;

// Construct the legs of `strat` from the (ascending) chosen strikes `ks`. Multi-leg neutral
// strategies (condor/butterfly) and the short-vol income strategies sell premium; the rest match
// the classic single/two-leg payoffs.
function buildLegs(key: StratKey, ks: number[], u: number, callBy: Map<number, Opt>, putBy: Map<number, Opt>): Leg[] {
  const c = (k: number) => mid(callBy.get(k));
  const p = (k: number) => mid(putBy.get(k));
  const s = [...ks].sort((a, b) => a - b); // ascending, so leg roles are positional
  switch (key) {
    case "long-call": return [{ kind: "call", side: "buy", strike: ks[0], premium: c(ks[0]), qty: 1 }];
    case "long-put": return [{ kind: "put", side: "buy", strike: ks[0], premium: p(ks[0]), qty: 1 }];
    case "covered-call": return [{ kind: "stock", side: "buy", premium: u, qty: 1 }, { kind: "call", side: "sell", strike: ks[0], premium: c(ks[0]), qty: 1 }];
    case "csp": return [{ kind: "put", side: "sell", strike: ks[0], premium: p(ks[0]), qty: 1 }];
    case "bull-call": return [{ kind: "call", side: "buy", strike: s[0], premium: c(s[0]), qty: 1 }, { kind: "call", side: "sell", strike: s[1], premium: c(s[1]), qty: 1 }];
    case "bear-put": return [{ kind: "put", side: "buy", strike: s[1], premium: p(s[1]), qty: 1 }, { kind: "put", side: "sell", strike: s[0], premium: p(s[0]), qty: 1 }];
    case "straddle": return [{ kind: "call", side: "buy", strike: ks[0], premium: c(ks[0]), qty: 1 }, { kind: "put", side: "buy", strike: ks[0], premium: p(ks[0]), qty: 1 }];
    case "strangle": return [{ kind: "put", side: "buy", strike: s[0], premium: p(s[0]), qty: 1 }, { kind: "call", side: "buy", strike: s[1], premium: c(s[1]), qty: 1 }];
    case "short-straddle": return [{ kind: "call", side: "sell", strike: ks[0], premium: c(ks[0]), qty: 1 }, { kind: "put", side: "sell", strike: ks[0], premium: p(ks[0]), qty: 1 }];
    case "short-strangle": return [{ kind: "put", side: "sell", strike: s[0], premium: p(s[0]), qty: 1 }, { kind: "call", side: "sell", strike: s[1], premium: c(s[1]), qty: 1 }];
    case "iron-condor": return [
      { kind: "put", side: "buy", strike: s[0], premium: p(s[0]), qty: 1 },
      { kind: "put", side: "sell", strike: s[1], premium: p(s[1]), qty: 1 },
      { kind: "call", side: "sell", strike: s[2], premium: c(s[2]), qty: 1 },
      { kind: "call", side: "buy", strike: s[3], premium: c(s[3]), qty: 1 },
    ];
    case "iron-butterfly": return [
      { kind: "put", side: "buy", strike: s[0], premium: p(s[0]), qty: 1 },
      { kind: "put", side: "sell", strike: s[1], premium: p(s[1]), qty: 1 },
      { kind: "call", side: "sell", strike: s[1], premium: c(s[1]), qty: 1 },
      { kind: "call", side: "buy", strike: s[2], premium: c(s[2]), qty: 1 },
    ];
  }
}

const payoffOf = (legs: Leg[]) => (S: number) =>
  legs.reduce((t, l) => {
    const intr = l.kind === "stock" ? S : l.kind === "call" ? Math.max(0, S - l.strike!) : Math.max(0, l.strike! - S);
    return t + (l.side === "buy" ? 1 : -1) * (intr - l.premium) * l.qty;
  }, 0) * 100;

// Probability the position is profitable at expiry, from a lognormal model of the underlying
// (median ≈ spot via the risk-neutral, r≈0 drift; σ = ATM IV, T = DTE). Numerically integrate the
// pdf over the price region where the payoff is positive. Null when IV/DTE are missing.
function probOfProfit(pay: (S: number) => number, u: number, sigma: number | null, T: number | null): number | null {
  if (!sigma || sigma <= 0 || !T || T <= 0 || !u) return null;
  const sd = sigma * Math.sqrt(T);
  const mu = Math.log(u) - 0.5 * sigma * sigma * T;
  const N = 600, Slo = u * 0.1, Shi = u * 5, dS = (Shi - Slo) / N;
  let inProfit = 0, total = 0;
  for (let i = 0; i < N; i++) {
    const S = Slo + (i + 0.5) * dS;
    const z = (Math.log(S) - mu) / sd;
    const w = (Math.exp(-0.5 * z * z) / (S * sd * Math.sqrt(2 * Math.PI))) * dS;
    total += w;
    if (pay(S) > 0) inProfit += w;
  }
  return total > 0 ? inProfit / total : null;
}

const CW = 520, CH = 200, ML = 44, MR = 12, MT = 12, MB = 22;

export default function OptionsStrategy({ calls, puts, underlying, expiry, dte, currency }: { calls: Opt[]; puts: Opt[]; underlying: number | null; expiry: string | null; dte: number | null; currency?: string }) {
  const u = underlying ?? 0;
  const sym = currencyPrefix(currency);
  const dollars = (v: number) => fmtDollars(v, sym);
  const price2 = (v: number) => fmtPrice2(v, sym);
  const callBy = useMemo(() => new Map(calls.map((c) => [c.strike, c])), [calls]);
  const putBy = useMemo(() => new Map(puts.map((p) => [p.strike, p])), [puts]);
  const strikes = useMemo(() => [...new Set([...callBy.keys(), ...putBy.keys()])].sort((a, b) => a - b), [callBy, putBy]);
  const atmIdx = useMemo(() => { let best = Infinity, idx = 0; strikes.forEach((s, i) => { const d = Math.abs(s - u); if (d < best) { best = d; idx = i; } }); return idx; }, [strikes, u]);
  const atmIV = useMemo(() => (strikes.length ? (callBy.get(strikes[atmIdx])?.iv ?? putBy.get(strikes[atmIdx])?.iv ?? null) : null), [strikes, atmIdx, callBy, putBy]);

  const [stratKey, setStratKey] = useState<StratKey>("long-call");
  const [ov, setOv] = useState<(number | null)[]>([]); // per-strike overrides; reset on strategy change
  const strat = STRATS.find((s) => s.key === stratKey)!;

  const at = (off: number) => strikes[Math.min(strikes.length - 1, Math.max(0, atmIdx + off))];

  if (strikes.length < 2 || !u) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">Not enough chain data to model strategies for this expiry.</div>;
  }

  const ks = strat.strikes.map((spec, i) => ov[i] ?? at(spec.off));
  const legs = buildLegs(stratKey, ks, u, callBy, putBy);
  const pay = payoffOf(legs);
  const netCost = legs.reduce((s, l) => s + (l.side === "buy" ? 1 : -1) * l.premium * l.qty, 0) * 100;

  // exact extremes at the kinks (0, strikes, far-OTM) + unbounded-tail checks
  const far = u * 3;
  const kinks = [0, ...strikes, far];
  const kinkVals = kinks.map(pay);
  const slopeUp = pay(far) - pay(far - Math.max(0.01, u * 0.002));
  const upUnbounded = slopeUp > 1e-6; // profit grows without bound up (a naked long call leg)
  const lossUnboundedUp = slopeUp < -1e-6; // loss grows without bound up (a naked short call leg)
  const maxProfit = upUnbounded ? null : Math.max(...kinkVals);
  const maxLoss = lossUnboundedUp ? null : Math.min(...kinkVals);
  const pop = probOfProfit(pay, u, atmIV, dte != null ? dte / 365 : null);

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

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold text-[var(--text-2)]">Strategy payoff</span>
        <select
          value={stratKey}
          onChange={(e) => { setStratKey(e.target.value as StratKey); setOv([]); }}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm outline-none"
        >
          {STRATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--text-3)]">{strat.outlook}</span>
        {strat.strikes.map((spec, i) => (
          <label key={i} className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            {spec.label}
            <select
              value={ks[i]}
              onChange={(e) => setOv((prev) => { const n = [...prev]; n[i] = Number(e.target.value); return n; })}
              className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs outline-none"
            >
              {strikes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        ))}
        {dte != null && <span className="ml-auto text-[11px] text-[var(--text-4)]">{expiry} · {dte}d</span>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric label={netCost >= 0 ? "Net debit" : "Net credit"} value={dollars(Math.abs(netCost))} sub={netCost >= 0 ? "you pay" : "you collect"} />
        <Metric label="Max profit" value={maxProfit == null ? "Unlimited" : dollars(maxProfit)} color="#22c55e" />
        <Metric label="Max loss" value={maxLoss == null ? "Unlimited" : dollars(maxLoss)} color="#ef4444" />
        <Metric label="Break-even" value={breakevens.length ? breakevens.map(price2).join(" / ") : "—"} />
        <Metric label="Prob. of profit" value={pop == null ? "—" : `${Math.round(pop * 100)}%`} sub={pop == null ? undefined : "lognormal · ATM IV"} />
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
        <text x={ML - 6} y={y0 + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">{sym}0</text>
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
