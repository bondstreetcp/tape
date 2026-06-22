"use client";
import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { StockRow } from "@/lib/types";
import { UNIVERSE_BY_ID, currencyOf } from "@/lib/universes";
import { fmtPct, fmtMarketCap, fmtMoney } from "@/lib/format";
import { trendColor } from "@/lib/color";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import UniverseSwitcher from "./UniverseSwitcher";
import CompareOverlay from "./CompareOverlay";

const PALETTE = ["#60a5fa", "#34d399", "#f59e0b", "#a78bfa", "#f472b6"];
const MAX = 5;

type Dir = "hi" | "lo" | "none";
interface MRow { key: string; label: string; get: (s: StockRow) => number | null; fmt: (v: number | null, cur: string) => string; dir: Dir; group: string }

const pf = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);   // fraction → %
const rf = (v: number | null) => (v == null ? "—" : fmtPct(v, 1));                  // already-% returns
const x1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);
const lev = (v: number | null) => (v == null ? "—" : v <= 0 ? "net cash" : `${v.toFixed(1)}×`);

const ROWS: MRow[] = [
  { group: "Valuation", key: "pe", label: "P/E", get: (s) => s.trailingPE ?? null, fmt: x1, dir: "lo" },
  { group: "Valuation", key: "fpe", label: "Fwd P/E", get: (s) => s.forwardPE ?? null, fmt: x1, dir: "lo" },
  { group: "Valuation", key: "pb", label: "P/B", get: (s) => s.priceToBook ?? null, fmt: x1, dir: "lo" },
  { group: "Valuation", key: "yld", label: "Div yield", get: (s) => s.dividendYield ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "roic", label: "ROIC", get: (s) => s.fund?.roic ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "roe", label: "ROE", get: (s) => s.fund?.roe ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "gm", label: "Gross margin", get: (s) => s.fund?.grossMargin ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "om", label: "Operating margin", get: (s) => s.fund?.opMargin ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "fcfy", label: "FCF yield", get: (s) => s.fund?.fcfYield ?? null, fmt: pf, dir: "hi" },
  { group: "Quality", key: "lev", label: "Net debt / EBITDA", get: (s) => s.fund?.netDebtEbitda ?? null, fmt: lev, dir: "lo" },
  { group: "Growth", key: "rg", label: "Revenue growth (YoY)", get: (s) => s.fund?.revGrowth ?? null, fmt: pf, dir: "hi" },
  { group: "Performance", key: "ytd", label: "Return · YTD", get: (s) => s.returns.ytd, fmt: rf, dir: "hi" },
  { group: "Performance", key: "y1", label: "Return · 1Y", get: (s) => s.returns["1y"], fmt: rf, dir: "hi" },
];

export default function StockCompareView({ universe, stocks, initial, generatedAt }: { universe: string; stocks: StockRow[]; initial: string[]; generatedAt: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const currency = currencyOf(universe);
  const bySym = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);

  const [tickers, setTickers] = useState<string[]>(initial.filter((t) => bySym.has(t)).slice(0, MAX));
  const [query, setQuery] = useState("");

  // keep the URL shareable
  useEffect(() => {
    const cur = params.get("tickers") || "";
    if (cur !== tickers.join(",")) router.replace(`/u/${universe}/compare-stocks${tickers.length ? `?tickers=${tickers.join(",")}` : ""}`, { scroll: false });
  }, [tickers]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = tickers.map((t) => bySym.get(t)).filter((s): s is StockRow => !!s);
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stocks
      .filter((s) => !tickers.includes(s.symbol) && (s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.symbol.toLowerCase() === q ? -1 : 0) - (b.symbol.toLowerCase() === q ? -1 : 0) || (b.marketCap || 0) - (a.marketCap || 0))
      .slice(0, 8);
  }, [query, stocks, tickers]);

  const add = (sym: string) => { if (tickers.length < MAX && !tickers.includes(sym)) setTickers((t) => [...t, sym]); setQuery(""); };
  const remove = (sym: string) => setTickers((t) => t.filter((x) => x !== sym));

  // best value per row (for highlighting)
  const best = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const r of ROWS) {
      if (r.dir === "none") { m[r.key] = null; continue; }
      const vals = picked.map((s) => r.get(s)).filter((v): v is number => v != null);
      m[r.key] = vals.length ? (r.dir === "hi" ? Math.max(...vals) : Math.min(...vals)) : null;
    }
    return m;
  }, [picked]);

  const groups = ["Valuation", "Quality", "Growth", "Performance"];

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Compare stocks</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">Head-to-head margins, quality &amp; valuation · {stocks.length} constituents</p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* picker */}
      <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          {picked.map((s, i) => (
            <span key={s.symbol} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium" style={{ borderColor: colorOf(i), color: colorOf(i) }}>
              <span className="font-mono font-semibold">{s.symbol}</span>
              <button onClick={() => remove(s.symbol)} className="text-[var(--text-4)] hover:text-[var(--text)]" aria-label="Remove">×</button>
            </span>
          ))}
          {tickers.length < MAX && (
            <div className="relative">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={picked.length ? "Add ticker…" : "Add a ticker to compare…"}
                className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]" />
              {results.length > 0 && (
                <div className="absolute left-0 top-9 z-20 max-h-72 w-72 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
                  {results.map((s) => (
                    <button key={s.symbol} onClick={() => add(s.symbol)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]">
                      <span><span className="font-mono font-semibold">{s.symbol}</span> <span className="text-[var(--text-3)]">{s.name}</span></span>
                      <span className="shrink-0 text-xs text-[var(--text-4)]">{fmtMarketCap(s.marketCap, currency)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {picked.length < 2 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          Add at least two tickers to compare their margin &amp; growth trajectories, quality and valuation side by side.
        </div>
      ) : (
        <div className="space-y-5">
          {/* header strip */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${picked.length}, minmax(0,1fr))` }}>
            {picked.map((s, i) => (
              <Link key={s.symbol} href={`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`} className="rounded-xl border bg-[var(--surface)] p-3 hover:border-[var(--border-strong)]" style={{ borderColor: colorOf(i) + "66" }}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                  <span className="font-mono text-sm font-bold">{s.symbol}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--text-3)]">{s.name}</div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-base font-semibold tabular-nums">{fmtMoney(s.price, currency)}</span>
                  <span className="text-xs font-medium tabular-nums" style={{ color: trendColor(s.returns.ytd) }}>{fmtPct(s.returns.ytd, 1)} YTD</span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-4)]">{ETF_TO_SECTOR[s.etf]?.name ?? s.sector} · {fmtMarketCap(s.marketCap, currency)}</div>
              </Link>
            ))}
          </div>

          {/* margin / growth overlay */}
          <CompareOverlay tickers={picked.map((s, i) => ({ symbol: s.symbol, color: colorOf(i) }))} />

          {/* metrics table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  {picked.map((s, i) => (
                    <th key={s.symbol} className="px-4 py-2 text-right font-mono font-semibold" style={{ color: colorOf(i) }}>{s.symbol}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g} group={g} picked={picked} best={best} currency={currency} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--text-4)]">Best in each row highlighted (lower P/E·P/B·leverage = better). Valuation from the snapshot; quality/growth from annual fundamentals · as of {new Date(generatedAt).toLocaleDateString()}.</p>
        </div>
      )}
    </main>
  );
}

function GroupRows({ group, picked, best, currency }: { group: string; picked: StockRow[]; best: Record<string, number | null>; currency: string }) {
  return (
    <>
      <tr className="bg-[var(--bg)]"><td colSpan={picked.length + 1} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{group}</td></tr>
      {ROWS.filter((r) => r.group === group).map((r) => (
        <tr key={r.key} className="border-b border-[var(--divider)]">
          <td className="px-4 py-1.5 text-left text-[var(--text-2)]">{r.label}</td>
          {picked.map((s) => {
            const v = r.get(s);
            const isBest = r.dir !== "none" && v != null && best[r.key] != null && v === best[r.key] && picked.length > 1;
            return (
              <td key={s.symbol} className={"px-4 py-1.5 text-right tabular-nums " + (isBest ? "font-semibold text-[#22c55e]" : "text-[var(--text)]")}>
                {r.fmt(v, currency)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
