"use client";
import { useMemo, useState } from "react";
import { currencyPrefix } from "@/lib/format";

interface Opt { strike: number; last: number | null; bid: number | null; ask: number | null; vol: number | null; oi: number | null; iv: number | null; itm: boolean }
// dte/iv let a leg be valued before expiry (the scenario grid) and let a calendar hold a longer-dated leg.
interface Leg { kind: "stock" | "call" | "put"; side: "buy" | "sell"; strike?: number; premium: number; qty: number; iv?: number | null; dte?: number }

// Each strike is selectable; `off` is the default index offset from the at-the-money strike.
const STRATS = [
  { key: "long-call", label: "Long Call", outlook: "Bullish", strikes: [{ label: "Strike", off: 0 }] },
  { key: "long-put", label: "Long Put", outlook: "Bearish", strikes: [{ label: "Strike", off: 0 }] },
  { key: "covered-call", label: "Covered Call", outlook: "Neutral · income", strikes: [{ label: "Call", off: 2 }] },
  { key: "csp", label: "Cash-Secured Put", outlook: "Neutral-bullish · income", strikes: [{ label: "Put", off: -2 }] },
  { key: "collar", label: "Collar", outlook: "Protect a holding", strikes: [{ label: "Put", off: -2 }, { label: "Call", off: 2 }] },
  { key: "bull-call", label: "Bull Call Spread", outlook: "Bullish · defined risk", strikes: [{ label: "Long", off: 0 }, { label: "Short", off: 3 }] },
  { key: "bear-put", label: "Bear Put Spread", outlook: "Bearish · defined risk", strikes: [{ label: "Short", off: -3 }, { label: "Long", off: 0 }] },
  { key: "call-ratio", label: "Call Ratio (1×2)", outlook: "Mildly bullish · skew", strikes: [{ label: "Long", off: 0 }, { label: "Short ×2", off: 3 }] },
  { key: "butterfly", label: "Long Butterfly", outlook: "Pinned · defined risk", strikes: [{ label: "Low", off: -2 }, { label: "Body", off: 0 }, { label: "High", off: 2 }] },
  { key: "straddle", label: "Long Straddle", outlook: "Big move either way", strikes: [{ label: "Strike", off: 0 }] },
  { key: "strangle", label: "Long Strangle", outlook: "Big move · cheaper", strikes: [{ label: "Put", off: -2 }, { label: "Call", off: 2 }] },
  { key: "short-straddle", label: "Short Straddle", outlook: "Range-bound · sell vol", strikes: [{ label: "Strike", off: 0 }] },
  { key: "short-strangle", label: "Short Strangle", outlook: "Range-bound · income", strikes: [{ label: "Put", off: -2 }, { label: "Call", off: 2 }] },
  { key: "iron-condor", label: "Iron Condor", outlook: "Range-bound · defined risk", strikes: [{ label: "Long put", off: -4 }, { label: "Short put", off: -2 }, { label: "Short call", off: 2 }, { label: "Long call", off: 4 }] },
  { key: "iron-butterfly", label: "Iron Butterfly", outlook: "Pinned · defined risk", strikes: [{ label: "Long put", off: -3 }, { label: "ATM", off: 0 }, { label: "Long call", off: 3 }] },
  { key: "calendar", label: "Call Calendar", outlook: "Range-bound · sell time", strikes: [{ label: "Strike", off: 0 }] },
] as const;
type StratKey = (typeof STRATS)[number]["key"];

const mid = (o: Opt | undefined): number => {
  if (!o) return 0;
  if (o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  return o.last ?? 0;
};
const fmtDollars = (v: number, sym: string) => `${v < 0 ? "−" : ""}${sym}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtPrice2 = (v: number, sym: string) => `${sym}${v.toFixed(2)}`;

// --- Black-Scholes (for pre-expiry valuation in the scenario grid + the calendar's longer-dated leg).
const normCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
};
const bsPrice = (kind: "call" | "put", S: number, K: number, T: number, sigma: number, r = 0.04): number => {
  if (T <= 0 || sigma <= 0) return kind === "call" ? Math.max(0, S - K) : Math.max(0, K - S); // intrinsic at/after expiry
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / v;
  const d2 = d1 - v;
  return kind === "call" ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
};
// Per-share Black-Scholes Greeks for one leg (stock = pure delta). Theta is per DAY, vega per 1 vol point.
const normPdf = (x: number): number => 0.3989422804014327 * Math.exp(-x * x / 2);
const legGreeks = (kind: "stock" | "call" | "put", S: number, K: number, T: number, sigma: number, r = 0.04) => {
  if (kind === "stock") return { delta: 1, gamma: 0, theta: 0, vega: 0 };
  if (T <= 0 || sigma <= 0) {
    const d = kind === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0); // at expiry: pure intrinsic delta
    return { delta: d, gamma: 0, theta: 0, vega: 0 };
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / v;
  const d2 = d1 - v;
  const pdf = normPdf(d1);
  const delta = kind === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * v);
  const vega = (S * pdf * Math.sqrt(T)) / 100; // per +1 vol point
  const theta =
    (kind === "call"
      ? -(S * pdf * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2)
      : -(S * pdf * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365; // per day
  return { delta, gamma, theta, vega };
};

interface Ctx { u: number; callBy: Map<number, Opt>; putBy: Map<number, Opt>; stratDte: number; atmIV: number; nextDte: number | null; nextIV: number | null }

// Build a strategy's legs from the (ascending) chosen strikes. Multi-leg neutral + short-vol income
// strategies sell premium; the calendar's long leg is the *next* expiry, priced by Black-Scholes.
function buildLegs(key: StratKey, ks: number[], ctx: Ctx): Leg[] {
  const { u, callBy, putBy, stratDte, atmIV, nextDte, nextIV } = ctx;
  const cP = (k: number) => mid(callBy.get(k)), pP = (k: number) => mid(putBy.get(k));
  const cIV = (k: number) => callBy.get(k)?.iv ?? atmIV, pIV = (k: number) => putBy.get(k)?.iv ?? atmIV;
  const C = (side: "buy" | "sell", k: number, qty = 1): Leg => ({ kind: "call", side, strike: k, premium: cP(k), qty, iv: cIV(k), dte: stratDte });
  const P = (side: "buy" | "sell", k: number, qty = 1): Leg => ({ kind: "put", side, strike: k, premium: pP(k), qty, iv: pIV(k), dte: stratDte });
  const s = [...ks].sort((a, b) => a - b); // ascending, so leg roles are positional
  switch (key) {
    case "long-call": return [C("buy", ks[0])];
    case "long-put": return [P("buy", ks[0])];
    case "covered-call": return [{ kind: "stock", side: "buy", premium: u, qty: 1 }, C("sell", ks[0])];
    case "csp": return [P("sell", ks[0])];
    case "collar": return [{ kind: "stock", side: "buy", premium: u, qty: 1 }, P("buy", s[0]), C("sell", s[1])];
    case "bull-call": return [C("buy", s[0]), C("sell", s[1])];
    case "bear-put": return [P("buy", s[1]), P("sell", s[0])];
    case "call-ratio": return [C("buy", s[0]), C("sell", s[1], 2)];
    case "butterfly": return [C("buy", s[0]), C("sell", s[1], 2), C("buy", s[2])];
    case "straddle": return [C("buy", ks[0]), P("buy", ks[0])];
    case "strangle": return [P("buy", s[0]), C("buy", s[1])];
    case "short-straddle": return [C("sell", ks[0]), P("sell", ks[0])];
    case "short-strangle": return [P("sell", s[0]), C("sell", s[1])];
    case "iron-condor": return [P("buy", s[0]), P("sell", s[1]), C("sell", s[2]), C("buy", s[3])];
    case "iron-butterfly": return [P("buy", s[0]), P("sell", s[1]), C("sell", s[1]), C("buy", s[2])];
    case "calendar": {
      const k = ks[0];
      if (nextDte == null) return [C("sell", k)]; // no later expiry to roll into
      const far: Leg = { kind: "call", side: "buy", strike: k, premium: bsPrice("call", u, k, nextDte / 365, nextIV || atmIV), qty: 1, iv: nextIV || atmIV, dte: nextDte };
      return [C("sell", k), far];
    }
  }
}

// Position value at a future date `tDays` from now, across price S — Black-Scholes for any leg with
// time left, intrinsic at/after expiry. At tDays = the near expiry this is the classic payoff diagram.
const valueAt = (legs: Leg[], tDays: number, stratDte: number, atmIV: number, ivMult = 1) => (S: number) =>
  legs.reduce((acc, l) => {
    const remT = Math.max(0, ((l.dte ?? stratDte) - tDays) / 365);
    const val = l.kind === "stock" ? S : bsPrice(l.kind, S, l.strike!, remT, (l.iv || atmIV || 0.3) * ivMult);
    return acc + (l.side === "buy" ? 1 : -1) * (val - l.premium) * l.qty;
  }, 0) * 100;

const CW = 520, CH = 200, ML = 44, MR = 12, MT = 12, MB = 22;

export default function OptionsStrategy({ calls, puts, underlying, expiry, dte, currency, nextExpiry, nextIV }: { calls: Opt[]; puts: Opt[]; underlying: number | null; expiry: string | null; dte: number | null; currency?: string; nextExpiry?: string | null; nextIV?: number | null }) {
  const u = underlying ?? 0;
  const sym = currencyPrefix(currency);
  const dollars = (v: number) => fmtDollars(v, sym);
  const price2 = (v: number) => fmtPrice2(v, sym);
  const callBy = useMemo(() => new Map(calls.map((c) => [c.strike, c])), [calls]);
  const putBy = useMemo(() => new Map(puts.map((p) => [p.strike, p])), [puts]);
  const strikes = useMemo(() => [...new Set([...callBy.keys(), ...putBy.keys()])].sort((a, b) => a - b), [callBy, putBy]);
  const atmIdx = useMemo(() => { let best = Infinity, idx = 0; strikes.forEach((s, i) => { const d = Math.abs(s - u); if (d < best) { best = d; idx = i; } }); return idx; }, [strikes, u]);
  const atmIV = useMemo(() => (strikes.length ? (callBy.get(strikes[atmIdx])?.iv ?? putBy.get(strikes[atmIdx])?.iv ?? 0.3) : 0.3), [strikes, atmIdx, callBy, putBy]);
  const nextDte = useMemo(() => (nextExpiry ? Math.round((new Date(nextExpiry + "T00:00:00Z").getTime() - Date.now()) / 86_400_000) : null), [nextExpiry]);

  const strats = useMemo(() => (nextDte != null ? STRATS : STRATS.filter((s) => s.key !== "calendar")), [nextDte]);
  const [stratKey, setStratKey] = useState<StratKey>("long-call");
  const [ov, setOv] = useState<(number | null)[]>([]); // per-strike overrides; reset on strategy change
  const [showGrid, setShowGrid] = useState(true);
  const [ivShift, setIvShift] = useState(0); // ± IV %, applied to the scenario-grid valuation only
  const [cmpKey, setCmpKey] = useState<StratKey | "">(""); // optional 2nd structure to overlay
  const strat = STRATS.find((s) => s.key === stratKey)!;

  const at = (off: number) => strikes[Math.min(strikes.length - 1, Math.max(0, atmIdx + off))];

  if (strikes.length < 2 || !u) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">Not enough chain data to model strategies for this expiry.</div>;
  }

  const stratDte = dte ?? 30;
  const ks = strat.strikes.map((spec, i) => ov[i] ?? at(spec.off));
  const legs = buildLegs(stratKey, ks, { u, callBy, putBy, stratDte, atmIV, nextDte, nextIV: nextIV ?? null });
  const pay = valueAt(legs, stratDte, stratDte, atmIV); // P/L at the near expiry
  const netCost = legs.reduce((s, l) => s + (l.side === "buy" ? 1 : -1) * l.premium * l.qty, 0) * 100;

  // Net position Greeks at spot, ×100 shares/contract: share-equivalent delta, gamma, $/day theta, $/vol-pt vega.
  const greeks = legs.reduce(
    (acc, l) => {
      const g = legGreeks(l.kind, u, l.strike ?? u, (l.dte ?? stratDte) / 365, l.iv || atmIV || 0.3);
      const sgn = (l.side === "buy" ? 1 : -1) * l.qty * 100;
      return { delta: acc.delta + sgn * g.delta, gamma: acc.gamma + sgn * g.gamma, theta: acc.theta + sgn * g.theta, vega: acc.vega + sgn * g.vega };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );

  // exact extremes at the kinks (0, strikes, far-OTM) + unbounded-tail checks
  const far = u * 3;
  const kinks = [0, ...strikes, far];
  const kinkVals = kinks.map(pay);
  const slopeUp = pay(far) - pay(far - Math.max(0.01, u * 0.002));
  const upUnbounded = slopeUp > 1e-6; // profit grows without bound up (a naked long call leg)
  const lossUnboundedUp = slopeUp < -1e-6; // loss grows without bound up (a naked short call leg)
  const maxProfit = upUnbounded ? null : Math.max(...kinkVals);
  const maxLoss = lossUnboundedUp ? null : Math.min(...kinkVals);

  // Optional 2nd structure overlaid on the payoff chart (at default strikes), with its own quick stats.
  const cmp = cmpKey ? (() => {
    const cs = STRATS.find((s) => s.key === cmpKey)!;
    const clegs = buildLegs(cmpKey, cs.strikes.map((spec) => at(spec.off)), { u, callBy, putBy, stratDte, atmIV, nextDte, nextIV: nextIV ?? null });
    const cpay = valueAt(clegs, stratDte, stratDte, atmIV);
    const ck = [0, ...strikes, far].map(cpay);
    const cslope = cpay(far) - cpay(far - Math.max(0.01, u * 0.002));
    const cnet = clegs.reduce((s, l) => s + (l.side === "buy" ? 1 : -1) * l.premium * l.qty, 0) * 100;
    return { label: cs.label, pay: cpay, maxP: cslope > 1e-6 ? null : Math.max(...ck), maxL: cslope < -1e-6 ? null : Math.min(...ck), net: cnet };
  })() : null;

  // probability of profit at the near expiry: lognormal (median ≈ spot, risk-neutral r≈0), σ = ATM IV
  const pop = useMemo(() => {
    const T = stratDte / 365;
    if (!atmIV || atmIV <= 0 || T <= 0) return null;
    const sd = atmIV * Math.sqrt(T), mu = Math.log(u) - 0.5 * atmIV * atmIV * T;
    const N = 600, Slo = u * 0.1, Shi = u * 5, dS = (Shi - Slo) / N;
    let inP = 0, tot = 0;
    for (let i = 0; i < N; i++) { const S = Slo + (i + 0.5) * dS; const z = (Math.log(S) - mu) / sd; const w = (Math.exp(-0.5 * z * z) / (S * sd * 2.5066282746310002)) * dS; tot += w; if (pay(S) > 0) inP += w; }
    return tot > 0 ? inP / tot : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, u, atmIV, stratDte]);

  // chart grid + break-evens
  const lo = Math.max(0, u * 0.55), hi = u * 1.5;
  const N = 130;
  const grid = Array.from({ length: N + 1 }, (_, i) => { const S = lo + (i / N) * (hi - lo); return { S, y: pay(S) }; });
  const cmpYs = cmp ? grid.map((g) => cmp.pay(g.S)) : [];
  const breakevens: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1], b = grid[i];
    if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0)) { const t = a.y / (a.y - b.y); breakevens.push(a.S + t * (b.S - a.S)); }
  }

  const yMinRaw = Math.min(0, ...grid.map((g) => g.y), ...cmpYs);
  const yMaxRaw = Math.max(0, ...grid.map((g) => g.y), ...cmpYs);
  const padY = (yMaxRaw - yMinRaw) * 0.08 || 50;
  const yMin = yMinRaw - padY, yMax = yMaxRaw + padY;
  const X = (S: number) => ML + ((S - lo) / (hi - lo)) * (CW - ML - MR);
  const Y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin)) * (CH - MT - MB);
  const path = grid.map((g, i) => `${i ? "L" : "M"}${X(g.S).toFixed(1)} ${Y(g.y).toFixed(1)}`).join("");
  const cmpPath = cmp ? grid.map((g, i) => `${i ? "L" : "M"}${X(g.S).toFixed(1)} ${Y(cmpYs[i]).toFixed(1)}`).join("") : "";
  const y0 = Y(0);
  const frac = Math.max(0, Math.min(1, (y0 - MT) / (CH - MB - MT)));

  // --- Scenario grid: P/L across price (rows, high→low) × date (cols, now→expiry), Black-Scholes valued.
  const scenario = useMemo(() => {
    if (stratDte < 2) return null; // a same-day / expired contract has no meaningful intermediate-date grid
    const legStrikes = legs.map((l) => l.strike).filter((x): x is number => x != null);
    const pLo = Math.min(u, ...legStrikes) * 0.88, pHi = Math.max(u, ...legStrikes) * 1.12;
    const ROWS = 9, COLS = 5;
    const prices = Array.from({ length: ROWS }, (_, i) => pHi - (i / (ROWS - 1)) * (pHi - pLo)); // top = highest price
    const days = Array.from({ length: COLS }, (_, j) => Math.round((j / (COLS - 1)) * stratDte));
    const cells = prices.map((S) => days.map((d) => valueAt(legs, d, stratDte, atmIV, 1 + ivShift / 100)(S)));
    const mag = Math.max(1, ...cells.flat().map(Math.abs));
    return { prices, days, cells, mag };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, u, atmIV, stratDte, ivShift]);

  const cellColor = (v: number) => {
    const a = Math.min(0.42, Math.abs(v) / (scenario?.mag ?? 1) * 0.42);
    return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold text-[var(--text-2)]">Strategy payoff</span>
        <select
          value={stratKey}
          onChange={(e) => { setStratKey(e.target.value as StratKey); setOv([]); }}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm outline-none"
        >
          {strats.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
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
        <label className="flex items-center gap-1 text-xs text-[var(--text-3)]">
          <span className="text-[var(--text-4)]">vs</span>
          <select value={cmpKey} onChange={(e) => setCmpKey(e.target.value as StratKey | "")} className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs outline-none">
            <option value="">compare…</option>
            {strats.filter((s) => s.key !== stratKey).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {dte != null && <span className="ml-auto text-[11px] text-[var(--text-4)]">{expiry} · {dte}d{stratKey === "calendar" && nextExpiry ? ` → ${nextExpiry}` : ""}</span>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric label={netCost >= 0 ? "Net debit" : "Net credit"} value={dollars(Math.abs(netCost))} sub={netCost >= 0 ? "you pay" : "you collect"} />
        <Metric label="Max profit" value={maxProfit == null ? "Unlimited" : dollars(maxProfit)} color="#22c55e" />
        <Metric label="Max loss" value={maxLoss == null ? "Unlimited" : dollars(maxLoss)} color="#ef4444" />
        <Metric label="Break-even" value={breakevens.length ? breakevens.map(price2).join(" / ") : "—"} />
        <Metric label="Prob. of profit" value={pop == null ? "—" : `${Math.round(pop * 100)}%`} sub={pop == null ? undefined : "lognormal · ATM IV"} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px]">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Net Greeks</span>
        <GreekStat label="Δ" value={(greeks.delta >= 0 ? "+" : "") + greeks.delta.toFixed(0)} sub="≈ shares" color={greeks.delta >= 0 ? "#22c55e" : "#ef4444"} title="Delta — share-equivalent: the position moves like this many shares for a $1 stock move." />
        <GreekStat label="Γ" value={(greeks.gamma >= 0 ? "+" : "") + greeks.gamma.toFixed(1)} sub="Δ/$1" title="Gamma — how much the net delta itself changes per $1 move in the stock." />
        <GreekStat label="Θ" value={dollars(greeks.theta)} sub="per day" color={greeks.theta >= 0 ? "#22c55e" : "#ef4444"} title="Theta — P/L from one day of time passing, all else equal. Negative = you pay decay; positive = you collect it." />
        <GreekStat label="V" value={dollars(greeks.vega)} sub="per +1% IV" color={greeks.vega >= 0 ? "#22c55e" : "#ef4444"} title="Vega — P/L for a 1-point rise in implied vol. Long vega gains when IV rises; short vega gains when it falls." />
        <span className="ml-auto text-[10px] text-[var(--text-4)]">at spot {price2(u)} · {stratDte}d · ATM IV {Math.round(atmIV * 100)}%</span>
      </div>

      {cmp && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px]">
          <span className="font-semibold text-[var(--accent)]">{cmp.label}</span>
          <span className="text-[var(--text-3)]">net {cmp.net >= 0 ? "debit" : "credit"} <span className="font-mono text-[var(--text-2)]">{dollars(Math.abs(cmp.net))}</span></span>
          <span className="text-[var(--text-3)]">max profit <span className="font-mono text-[#22c55e]">{cmp.maxP == null ? "Unlimited" : dollars(cmp.maxP)}</span></span>
          <span className="text-[var(--text-3)]">max loss <span className="font-mono text-[#ef4444]">{cmp.maxL == null ? "Unlimited" : dollars(cmp.maxL)}</span></span>
          <span className="ml-auto text-[var(--text-4)]">overlaid in blue · default strikes</span>
        </div>
      )}

      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ height: "auto" }}>
        <defs>
          <linearGradient id="plgrad" gradientUnits="userSpaceOnUse" x1="0" y1={MT} x2="0" y2={CH - MB}>
            <stop offset="0" stopColor="#22c55e" />
            <stop offset={frac} stopColor="#22c55e" />
            <stop offset={frac} stopColor="#ef4444" />
            <stop offset="1" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <line x1={ML} x2={CW - MR} y1={y0} y2={y0} stroke="var(--border-strong)" strokeWidth={1} />
        <text x={ML - 6} y={y0 + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">{sym}0</text>
        {[yMax, (yMax + yMin) / 2, yMin].map((v, i) => (
          <text key={i} x={ML - 6} y={Y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">{dollars(v)}</text>
        ))}
        <line x1={X(u)} x2={X(u)} y1={MT} y2={CH - MB} stroke="var(--text-4)" strokeDasharray="3 3" />
        <text x={X(u)} y={MT + 8} textAnchor="middle" fontSize={9} fill="var(--text-3)">now {price2(u)}</text>
        {breakevens.map((b, i) => (
          <g key={i}>
            <line x1={X(b)} x2={X(b)} y1={MT} y2={CH - MB} stroke="#a855f7" strokeWidth={0.8} strokeDasharray="2 2" />
            <text x={X(b)} y={CH - MB - 3} textAnchor="middle" fontSize={8} fill="#c4b5fd">{price2(b)}</text>
          </g>
        ))}
        {cmp && <path d={cmpPath} fill="none" stroke="#60a5fa" strokeWidth={1.6} strokeDasharray="4 3" />}
        <path d={path} fill="none" stroke="url(#plgrad)" strokeWidth={2} />
        {cmp && (
          <g>
            <line x1={ML + 2} x2={ML + 16} y1={MT + 6} y2={MT + 6} stroke="var(--text-3)" strokeWidth={2} />
            <text x={ML + 20} y={MT + 9} fontSize={8.5} fill="var(--text-3)">{strat.label}</text>
            <line x1={ML + 2} x2={ML + 16} y1={MT + 17} y2={MT + 17} stroke="#60a5fa" strokeWidth={1.6} strokeDasharray="4 3" />
            <text x={ML + 20} y={MT + 20} fontSize={8.5} fill="#60a5fa">{cmp.label}</text>
          </g>
        )}
        <text x={CW - MR} y={CH - 5} textAnchor="end" fontSize={9} fill="var(--text-4)">price at {stratKey === "calendar" ? "near exp." : "expiry"} →</text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-4)]">
        {legs.map((l, i) => (
          <span key={i}>
            <span className={l.side === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}>{l.side === "buy" ? "Buy" : "Sell"}</span>{" "}
            {l.kind === "stock" ? `100 sh @ ${price2(l.premium)}` : `${l.qty > 1 ? `${l.qty}× ` : ""}${l.strike} ${l.kind}${l.dte && l.dte !== stratDte ? ` (${l.dte}d)` : ""} @ ${price2(l.premium)}`}
          </span>
        ))}
        <span className="ml-auto">P&amp;L per 1 contract (×100 sh); premiums at mid.</span>
      </div>

      {/* Scenario grid — P/L at intermediate dates, not just expiry (Black-Scholes). */}
      <div className="mt-4 border-t border-[var(--divider)] pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button onClick={() => setShowGrid((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text)]">
            <span className="text-[10px]">{showGrid ? "▾" : "▸"}</span> Scenario grid · P/L by price &amp; date
          </button>
          {showGrid && scenario && (
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]" title="Shift every leg's implied vol — re-prices the grid only (an IV pop/crush what-if)">
              IV shift
              <input type="range" min={-50} max={50} step={5} value={ivShift} onChange={(e) => setIvShift(Number(e.target.value))} className="w-24 accent-[#a855f7]" />
              <span className="w-9 font-mono tabular-nums text-[var(--text-2)]">{ivShift > 0 ? "+" : ""}{ivShift}%</span>
              {ivShift !== 0 && <button onClick={() => setIvShift(0)} className="text-[var(--text-4)] underline hover:text-[var(--text)]">reset</button>}
            </label>
          )}
        </div>
        {showGrid && (scenario ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-right text-[11px] tabular-nums">
                <thead>
                  <tr className="text-[10px] text-[var(--text-4)]">
                    <th className="px-2 py-1 text-left font-medium">Price \ days</th>
                    {scenario.days.map((d, j) => (
                      <th key={j} className="px-2 py-1 font-medium">{d === 0 ? "Now" : d === stratDte ? `Exp (${d}d)` : `${d}d`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scenario.prices.map((S, r) => (
                    <tr key={r} className={Math.abs(S - u) / u < 0.03 ? "font-semibold" : ""}>
                      <td className="px-2 py-1 text-left text-[var(--text-3)]">{price2(S)}{Math.abs(S - u) / u < 0.03 ? " ·now" : ""}</td>
                      {scenario.cells[r].map((v, c) => (
                        <td key={c} className="px-2 py-1" style={{ backgroundColor: cellColor(v), color: v >= 0 ? "#16a34a" : "#dc2626" }}>{dollars(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Each cell = position P/L if the stock is at that price on that date, Black-Scholes valued at the legs&apos; implied vol (held constant). Expiry column matches the payoff curve above.</p>
          </>
        ) : (
          <p className="text-xs text-[var(--text-4)]">Pick an expiry at least a few days out to model intermediate dates.</p>
        ))}
      </div>
    </div>
  );
}

function GreekStat({ label, value, sub, color, title }: { label: string; value: string; sub?: string; color?: string; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
      <span className="font-mono text-[var(--text-4)]">{label}</span>
      <span className="font-mono font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</span>
      {sub && <span className="text-[10px] text-[var(--text-4)]">{sub}</span>}
    </span>
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
