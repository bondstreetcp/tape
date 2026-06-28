"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  MultipleKey,
  MultipleStat,
  ValuationHistoryData,
  ValuationName,
} from "@/lib/valuationHistory";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

const ALL_MULTIPLES: MultipleKey[] = ["pe", "evEbitda", "ps", "pb"];
const MULTIPLE_LABELS: Record<MultipleKey, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };
type SortKey = "ticker" | "current" | "median" | "discount" | "z";

const dt = (s: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

// Cheap (current ≤ median) → green; rich → red. Intensity scales with how far from median.
function discountColor(discountPct: number): string {
  if (discountPct <= -25) return "#22c55e";
  if (discountPct < 0) return "#4ade80";
  if (discountPct >= 25) return "#ef4444";
  if (discountPct > 0) return "#f87171";
  return "var(--text-2)";
}

/** Inline sparkline of a multiple's series with its median band (p25–p75 shaded, median line). */
function Sparkline({ stat }: { stat: MultipleStat }) {
  const w = 132, h = 30, pad = 2;
  const vals = stat.series.map(([, v]) => v);
  if (vals.length < 2) return <span className="text-[var(--text-4)]">—</span>;
  const lo = Math.min(...vals, stat.p25);
  const hi = Math.max(...vals, stat.p75);
  const range = hi - lo || 1;
  const x = (i: number) => pad + (i / (stat.series.length - 1)) * (w - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / range) * (h - 2 * pad);
  const pts = stat.series.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const bandTop = y(stat.p75), bandBot = y(stat.p25), medY = y(stat.median);
  const cheap = stat.discountPct < 0;
  const stroke = cheap ? "#22c55e" : "#ef4444";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      {/* p25–p75 band */}
      <rect x={pad} y={Math.min(bandTop, bandBot)} width={w - 2 * pad} height={Math.abs(bandBot - bandTop)} fill="var(--text-4)" opacity={0.12} />
      {/* median line */}
      <line x1={pad} x2={w - pad} y1={medY} y2={medY} stroke="var(--text-4)" strokeWidth={0.75} strokeDasharray="3 2" opacity={0.6} />
      {/* series */}
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      {/* current marker */}
      <circle cx={x(stat.series.length - 1)} cy={y(vals[vals.length - 1])} r={1.8} fill={stroke} />
    </svg>
  );
}

interface Row {
  ticker: string;
  name: ValuationName;
  stat: MultipleStat;
}

export default function ValuationHistoryView({
  universe,
  data,
  known,
  sectorBy,
}: {
  universe: string;
  data: ValuationHistoryData;
  known: string[];
  sectorBy: Record<string, string>;
}) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [metric, setMetric] = useState<MultipleKey>("pe");
  const [cheapOnly, setCheapOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("discount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // asc discount = most discounted first

  // Which multiples actually exist across the set (to gray out unavailable global toggles).
  const availableMetrics = useMemo(() => {
    const s = new Set<MultipleKey>();
    for (const n of Object.values(data.names)) for (const k of n.eligible) s.add(k);
    return s;
  }, [data.names]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // sensible default direction per column
      setSortDir(key === "ticker" ? "asc" : key === "discount" || key === "z" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const ql = q.trim().toUpperCase();
    const out: Row[] = [];
    for (const [ticker, name] of Object.entries(data.names)) {
      if (!knownSet.has(ticker)) continue; // only this universe's constituents (the data file is global)
      const stat = name.multiples[metric];
      if (!stat) continue; // ineligible for the chosen metric
      if (ql && !ticker.includes(ql)) continue;
      if (cheapOnly && !(stat.z <= -1 || stat.discountPct <= -20)) continue;
      out.push({ ticker, name, stat });
    }
    const val = (r: Row): number | string => {
      switch (sortKey) {
        case "ticker": return r.ticker;
        case "current": return r.stat.current;
        case "median": return r.stat.median;
        case "z": return r.stat.z;
        case "discount": default: return r.stat.discountPct;
      }
    };
    out.sort((a, b) => {
      const va = val(a), vb = val(b);
      let cmp = typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb));
      cmp = sortDir === "desc" ? -cmp : cmp;
      return cmp !== 0 ? cmp : a.ticker.localeCompare(b.ticker);
    });
    return out;
  }, [data.names, knownSet, metric, cheapOnly, q, sortKey, sortDir]);

  const tlink = (ticker: string) =>
    knownSet.has(ticker) ? (
      <Link href={`/u/${universe}/stock/${encodeURIComponent(ticker)}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{ticker}</Link>
    ) : (
      <span className="font-mono font-semibold text-[var(--text-2)]">{ticker}</span>
    );

  const MB = (a: boolean, disabled = false) =>
    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
    (disabled ? "cursor-not-allowed text-[var(--text-4)] opacity-50" : a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  const SortTh = ({ k, children, align = "left" }: { k: SortKey; children: ReactNode; align?: "left" | "right" }) => (
    <th className={"px-3 py-2 font-medium " + (align === "right" ? "text-right" : "text-left")}>
      <button onClick={() => toggleSort(k)} className={"inline-flex items-center gap-0.5 hover:text-[var(--text)] " + (sortKey === k ? "text-[var(--text)]" : "")}>
        {children}{sortKey === k && <span className="text-[9px]">{sortDir === "desc" ? "▼" : "▲"}</span>}
      </button>
    </th>
  );

  const label = MULTIPLE_LABELS[metric];

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Discount to Own History</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            Each name&apos;s current valuation multiple vs its OWN trailing-10yr (≤40 quarter) median, rebuilt point-in-time from SEC EDGAR quarterly fundamentals + split-adjusted prices.
            A multiple well below its own median is &quot;on sale vs history&quot; (green); above is rich (red).
            Financials use P/B + P/E only. {Object.keys(data.names).length} names · as of {dt(data.asOf)}.
            <span className="text-[var(--text-4)]"> Name-relative, not an absolute cheap call — a structurally-derating business can stay below its median for years.</span>
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {ALL_MULTIPLES.map((m) => {
            const dis = !availableMetrics.has(m);
            return (
              <button key={m} disabled={dis} onClick={() => !dis && setMetric(m)} className={MB(metric === m, dis)} title={dis ? "No data for this multiple" : `Show ${MULTIPLE_LABELS[m]}`}>
                {MULTIPLE_LABELS[m]}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setCheapOnly((v) => !v)}
          className={"rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors " + (cheapOnly ? "border-[#22c55e]/60 bg-[#22c55e]/15 text-[#22c55e]" : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-3)] hover:text-[var(--text)]")}
          title="Only names trading at a sizable discount to their own history (z ≤ −1 or discount ≤ −20%)"
        >
          Sizable discount only
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker…" className="w-40 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names · {label}</span>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              <SortTh k="ticker">Ticker</SortTh>
              <th className="px-3 py-2 text-left font-medium">Sector</th>
              <SortTh k="current" align="right">{label} now</SortTh>
              <SortTh k="median" align="right">10yr median</SortTh>
              <SortTh k="discount" align="right">vs history</SortTh>
              <SortTh k="z" align="right">z</SortTh>
              <th className="px-3 py-2 text-left font-medium">History <span className="font-normal text-[var(--text-4)]">(band = p25–p75)</span></th>
              <th className="px-3 py-2 text-right font-medium">n</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 600).map((r) => {
              const s = r.stat;
              const col = discountColor(s.discountPct);
              const otherEligible = r.name.eligible.filter((k) => k !== metric);
              return (
                <tr key={r.ticker} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                  <td className="px-3 py-1.5">{tlink(r.ticker)}</td>
                  <td className="max-w-[12rem] truncate px-3 py-1.5 text-xs text-[var(--text-3)]">
                    {sectorBy[r.ticker] ?? (r.name.sectorClass === "financial" ? "Financials" : "—")}
                    {r.name.sectorClass === "financial" && <span className="ml-1 rounded bg-[#2563eb]/15 px-1 text-[9px] text-[var(--accent)]">FIN</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-[var(--text)]">{s.current.toFixed(2)}×</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-[var(--text-3)]">{s.median.toFixed(2)}×</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: col }}>
                    {s.discountPct > 0 ? "+" : ""}{s.discountPct}%
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" style={{ color: col }}>
                    {s.z > 0 ? "+" : ""}{s.z.toFixed(2)}
                  </td>
                  <td className="px-3 py-1">
                    <span className="flex items-center gap-2">
                      <Sparkline stat={s} />
                      {otherEligible.length > 0 && (
                        <span className="hidden gap-1 lg:flex">
                          {otherEligible.map((k) => (
                            <button key={k} onClick={() => setMetric(k)} className="rounded bg-[var(--bg)] px-1 py-0.5 text-[9px] text-[var(--text-4)] hover:text-[var(--text-2)]" title={`Switch to ${MULTIPLE_LABELS[k]}`}>{MULTIPLE_LABELS[k]}</button>
                          ))}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-4)]">{s.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No names match — try a different multiple or clear the filter.</div>}
        {rows.length > 600 && <div className="border-t border-[var(--border)] px-4 py-2 text-center text-xs text-[var(--text-4)]">Showing the first 600 of {rows.length} — narrow with the filters.</div>}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        TTM revenue / net income / EBITDA (= operating income + D&amp;A) and point-in-time debt / cash / equity / shares at each quarter-end; market cap = split-adjusted close × shares, EV = mcap + total debt − cash.
        Multiples winsorized; ≥8 valid quarters required. P/E and EV/EBITDA use positive denominators only; thin-GAAP names suppress P/E. Built from SEC EDGAR companyfacts — not a recommendation.
      </p>
    </main>
  );
}
