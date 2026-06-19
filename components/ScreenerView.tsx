"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { TIMEFRAMES, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { fmtPct, fmtMarketCap, fmtPrice, fmtDateTime } from "@/lib/format";
import { trendColor } from "@/lib/color";
import { SECTORS, ETF_TO_SECTOR } from "@/lib/sectors";
import { isNearHigh, isNearLow } from "@/lib/compute";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { useWatchlist } from "@/lib/watchlist";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";

interface Col {
  key: string;
  label: string;
  num: boolean;
  get: (s: StockRow) => number | string | null;
  fmt: (v: any) => string;
  color?: (v: any) => string | undefined;
  align: "left" | "right";
}

const CAP_OPTIONS = [
  { label: "Any cap", v: 0 },
  { label: "> $1B", v: 1e9 },
  { label: "> $10B", v: 1e10 },
  { label: "> $100B", v: 1e11 },
];

const LIMIT = 250;

export default function ScreenerView({
  universe,
  stocks,
  generatedAt,
}: {
  universe: string;
  stocks: StockRow[];
  generatedAt: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { has, toggle } = useWatchlist();

  const [tf, setTf] = usePersistedTimeframe(searchParams.get("tf"), "1d");
  const initFilter = searchParams.get("filter");
  const [hl, setHl] = useState<"all" | "high" | "low">(
    initFilter === "high" || initFilter === "low" ? initFilter : "all",
  );
  const [threshold, setThreshold] = useState(5);
  const [sectorEtf, setSectorEtf] = useState("all");
  const [capMin, setCapMin] = useState(0);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(
    initFilter === "high" ? "fromHigh" : initFilter === "low" ? "fromLow" : "cap",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    initFilter === "low" ? "asc" : "desc",
  );

  const columns: Col[] = useMemo(
    () => [
      { key: "symbol", label: "Symbol", num: false, get: (s) => s.symbol, fmt: (v) => v, align: "left" },
      { key: "name", label: "Name", num: false, get: (s) => s.name, fmt: (v) => v, align: "left" },
      { key: "etf", label: "Sector", num: false, get: (s) => ETF_TO_SECTOR[s.etf]?.name ?? s.sector, fmt: (v) => v, align: "left" },
      { key: "price", label: "Price", num: true, get: (s) => s.price, fmt: (v) => (v == null ? "—" : `$${fmtPrice(v)}`), align: "right" },
      { key: "ret", label: TIMEFRAMES.find((t) => t.key === tf)?.label ?? "Ret", num: true, get: (s) => s.returns[tf], fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "fromHigh", label: "% fr High", num: true, get: (s) => s.pctFromHigh, fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "fromLow", label: "% fr Low", num: true, get: (s) => s.pctFromLow, fmt: (v) => (v == null ? "—" : `+${v.toFixed(1)}%`), align: "right" },
      { key: "cap", label: "Mkt Cap", num: true, get: (s) => s.marketCap, fmt: (v) => fmtMarketCap(v), align: "right" },
      { key: "pe", label: "P/E", num: true, get: (s) => s.trailingPE ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "fpe", label: "Fwd P/E", num: true, get: (s) => s.forwardPE ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "pb", label: "P/B", num: true, get: (s) => s.priceToBook ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "yld", label: "Div Yld", num: true, get: (s) => s.dividendYield ?? null, fmt: (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`), align: "right" },
    ],
    [tf],
  );

  const filtered = useMemo(() => {
    let r = stocks;
    if (query) {
      const q = query.toLowerCase();
      r = r.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    if (sectorEtf !== "all") r = r.filter((s) => s.etf === sectorEtf);
    if (capMin > 0) r = r.filter((s) => (s.marketCap || 0) >= capMin);
    if (hl === "high") r = r.filter((s) => isNearHigh(s, threshold));
    else if (hl === "low") r = r.filter((s) => isNearLow(s, threshold));

    const col = columns.find((c) => c.key === sortKey) ?? columns[0];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (col.num) {
        const na = va as number | null;
        const nb = vb as number | null;
        if (na == null && nb == null) return 0;
        if (na == null) return 1;
        if (nb == null) return -1;
        return (na - nb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [stocks, query, sectorEtf, capMin, hl, threshold, columns, sortKey, sortDir]);

  const onSort = (key: string, num: boolean) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(num ? "desc" : "asc");
    }
  };

  const shown = filtered.slice(0, LIMIT);

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[#8b93a7] hover:text-[#e6e9f0]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Screener</h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {stocks.length} constituents · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by symbol or name…"
          className="w-48 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2 text-sm outline-none placeholder:text-[#5b6478] focus:border-[#3a4256]"
        />
        <select
          value={sectorEtf}
          onChange={(e) => setSectorEtf(e.target.value)}
          className="cursor-pointer rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2 text-sm outline-none"
        >
          <option value="all">All sectors</option>
          {SECTORS.map((s) => (
            <option key={s.etf} value={s.etf}>{s.name}</option>
          ))}
        </select>
        <select
          value={capMin}
          onChange={(e) => setCapMin(Number(e.target.value))}
          className="cursor-pointer rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2 text-sm outline-none"
        >
          {CAP_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-[#2a2e39] bg-[#131722] p-1">
          {([["all", "All"], ["high", "Near 52w high"], ["low", "Near 52w low"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setHl(k)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (hl === k ? "bg-[#2563eb] text-white" : "text-[#8b93a7] hover:text-[#e6e9f0]")}
            >
              {label}
            </button>
          ))}
        </div>
        {hl !== "all" && (
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="cursor-pointer rounded-lg border border-[#2a2e39] bg-[#131722] px-2 py-2 text-xs outline-none"
          >
            {[1, 2, 5, 10].map((t) => (
              <option key={t} value={t}>within {t}%</option>
            ))}
          </select>
        )}
        <div className="ml-auto">
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      <div className="mb-2 text-xs text-[#8b93a7]">
        Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
        {filtered.length > LIMIT && ` (first ${LIMIT} — refine filters or sort)`} · click a row to open
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#2a2e39] bg-[#131722]">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-[#2a2e39] text-[#8b93a7]">
              <th className="w-8 px-2 py-2"></th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key, c.num)}
                  className={
                    "cursor-pointer select-none px-3 py-2 font-medium whitespace-nowrap hover:text-[#e6e9f0] " +
                    (c.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-[#60a5fa]">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr
                key={s.symbol}
                onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
                className="cursor-pointer border-b border-[#1f2430] transition-colors hover:bg-[#1a1f2e]"
              >
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(s.symbol); }}
                    title={has(s.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                    className="align-middle"
                    style={{ color: has(s.symbol) ? "#fbbf24" : "#3a4150" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={has(s.symbol) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeLinejoin="round" />
                    </svg>
                  </button>
                </td>
                {columns.map((c) => {
                  const v = c.get(s);
                  return (
                    <td
                      key={c.key}
                      className={
                        "px-3 py-1.5 whitespace-nowrap " +
                        (c.align === "right" ? "text-right tabular-nums " : "text-left ") +
                        (c.key === "symbol" ? "font-mono font-semibold" : c.key === "name" ? "max-w-[16rem] truncate text-[#aab2c5]" : c.key === "etf" ? "text-[#8b93a7]" : "")
                      }
                      style={c.color ? { color: c.color(v) } : undefined}
                    >
                      {c.fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
