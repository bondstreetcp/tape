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

const REV_OPTS = [
  { label: "Rev growth: any", v: null as number | null },
  { label: "Rev growth ≥ 0%", v: 0 },
  { label: "Rev growth ≥ 10%", v: 0.1 },
  { label: "Rev growth ≥ 20%", v: 0.2 },
];

const pctFrac = (v: any) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const ppFrac = (v: any) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`);
const daysFmt = (v: any) => (v == null ? "—" : `${v.toFixed(0)}d`);
const daysSigned = (v: any) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}d`);
// rising DSO (receivables outrunning revenue) is a red flag → red; falling → green
const dsoColor = (v: any) => (v == null ? undefined : v > 0.5 ? "#ef4444" : v < -0.5 ? "#22c55e" : undefined);

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
  const [colSet, setColSet] = useState<"valuation" | "fundamentals">("valuation");
  const [minRevG, setMinRevG] = useState<number | null>(null);
  const [expanding, setExpanding] = useState(false); // operating margin expanding YoY
  const [dsoRising, setDsoRising] = useState(false); // ballooning DSO
  const [profitable, setProfitable] = useState(false);
  const [maxPE, setMaxPE] = useState<number | null>(null);
  const [minYld, setMinYld] = useState<number | null>(null);
  const [minRoe, setMinRoe] = useState<number | null>(null);
  const [aboveMA, setAboveMA] = useState(false); // price above 200-day average
  const [magic, setMagic] = useState(false); // Greenblatt magic formula

  // Magic Formula (Greenblatt): rank every name by earnings yield and by return
  // on capital, sum the two ranks, take the best ~30 — good companies at cheap
  // prices. He excludes financials & utilities (the EBIT/capital math doesn't fit)
  // and tiny caps. The free snapshot has P/E + ROE, so we proxy earnings yield with
  // 1/(P/E) and return-on-capital with ROE. Returns symbol → magic rank (0 = best).
  const magicRank = useMemo(() => {
    if (!magic) return null;
    const valid = stocks.filter(
      (s) => (s.trailingPE ?? 0) > 0 && s.fund?.roe != null && s.etf !== "XLF" && s.etf !== "XLU" && (s.marketCap || 0) >= 5e8,
    );
    if (valid.length < 20) return new Map<string, number>();
    const ey = new Map<string, number>(); // earnings-yield rank (high = better)
    [...valid].sort((a, b) => 1 / b.trailingPE! - 1 / a.trailingPE!).forEach((s, i) => ey.set(s.symbol, i));
    const roc = new Map<string, number>(); // return-on-capital rank (high = better)
    [...valid].sort((a, b) => b.fund!.roe! - a.fund!.roe!).forEach((s, i) => roc.set(s.symbol, i));
    const ranked = valid
      .map((s) => ({ sym: s.symbol, score: ey.get(s.symbol)! + roc.get(s.symbol)! }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);
    return new Map(ranked.map((r, i) => [r.sym, i]));
  }, [magic, stocks]);

  const columns: Col[] = useMemo(() => {
    const base: Col[] = [
      { key: "symbol", label: "Symbol", num: false, get: (s) => s.symbol, fmt: (v) => v, align: "left" },
      { key: "name", label: "Name", num: false, get: (s) => s.name, fmt: (v) => v, align: "left" },
      { key: "etf", label: "Sector", num: false, get: (s) => ETF_TO_SECTOR[s.etf]?.name ?? s.sector, fmt: (v) => v, align: "left" },
      { key: "price", label: "Price", num: true, get: (s) => s.price, fmt: (v) => (v == null ? "—" : `$${fmtPrice(v)}`), align: "right" },
      { key: "ret", label: TIMEFRAMES.find((t) => t.key === tf)?.label ?? "Ret", num: true, get: (s) => s.returns[tf], fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "cap", label: "Mkt Cap", num: true, get: (s) => s.marketCap, fmt: (v) => fmtMarketCap(v), align: "right" },
    ];
    const valuation: Col[] = [
      { key: "fromHigh", label: "% fr High", num: true, get: (s) => s.pctFromHigh, fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "fromLow", label: "% fr Low", num: true, get: (s) => s.pctFromLow, fmt: (v) => (v == null ? "—" : `+${v.toFixed(1)}%`), align: "right" },
      { key: "pe", label: "P/E", num: true, get: (s) => s.trailingPE ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "fpe", label: "Fwd P/E", num: true, get: (s) => s.forwardPE ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "pb", label: "P/B", num: true, get: (s) => s.priceToBook ?? null, fmt: (v) => (v == null ? "—" : v.toFixed(1)), align: "right" },
      { key: "yld", label: "Div Yld", num: true, get: (s) => s.dividendYield ?? null, fmt: (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`), align: "right" },
    ];
    const fund: Col[] = [
      { key: "revG", label: "Rev Gr", num: true, get: (s) => s.fund?.revGrowth ?? null, fmt: pctFrac, color: (v) => trendColor(v), align: "right" },
      { key: "opM", label: "Op Mgn", num: true, get: (s) => s.fund?.opMargin ?? null, fmt: pctFrac, align: "right" },
      { key: "opMChg", label: "Δ Op Mgn", num: true, get: (s) => s.fund?.opMarginChg ?? null, fmt: ppFrac, color: (v) => trendColor(v), align: "right" },
      { key: "netM", label: "Net Mgn", num: true, get: (s) => s.fund?.netMargin ?? null, fmt: pctFrac, align: "right" },
      { key: "dso", label: "DSO", num: true, get: (s) => s.fund?.dso ?? null, fmt: daysFmt, align: "right" },
      { key: "dsoChg", label: "Δ DSO", num: true, get: (s) => s.fund?.dsoChg ?? null, fmt: daysSigned, color: dsoColor, align: "right" },
      { key: "fcfM", label: "FCF Mgn", num: true, get: (s) => s.fund?.fcfMargin ?? null, fmt: pctFrac, align: "right" },
      { key: "roe", label: "ROE", num: true, get: (s) => s.fund?.roe ?? null, fmt: pctFrac, align: "right" },
    ];
    return [...base, ...(colSet === "fundamentals" ? fund : valuation)];
  }, [tf, colSet]);

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
    if (minRevG != null) r = r.filter((s) => (s.fund?.revGrowth ?? -Infinity) >= minRevG);
    if (expanding) r = r.filter((s) => (s.fund?.opMarginChg ?? -Infinity) > 0);
    if (dsoRising) r = r.filter((s) => (s.fund?.dsoChg ?? -Infinity) > 0);
    if (profitable) r = r.filter((s) => (s.fund?.netMargin ?? -Infinity) > 0);
    if (maxPE != null) r = r.filter((s) => s.trailingPE != null && s.trailingPE > 0 && s.trailingPE <= maxPE);
    if (minYld != null) r = r.filter((s) => (s.dividendYield ?? 0) >= minYld);
    if (minRoe != null) r = r.filter((s) => (s.fund?.roe ?? -Infinity) >= minRoe);
    if (aboveMA) r = r.filter((s) => s.twoHundredDayAverage != null && s.price > s.twoHundredDayAverage);
    if (magicRank) r = r.filter((s) => magicRank.has(s.symbol));

    // When Magic Formula is on, order by the magic rank (best first) by default —
    // but only until the user clicks a column header (which sets sortKey to that
    // column, overriding the magic order while keeping the top-30 filter).
    if (magicRank && sortKey === "magic") return [...r].sort((a, b) => (magicRank.get(a.symbol) ?? 999) - (magicRank.get(b.symbol) ?? 999));

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
  }, [stocks, query, sectorEtf, capMin, hl, threshold, minRevG, expanding, dsoRising, profitable, maxPE, minYld, minRoe, aboveMA, magicRank, columns, sortKey, sortDir]);

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
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Screener</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
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
          className="w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
        />
        <select
          value={sectorEtf}
          onChange={(e) => setSectorEtf(e.target.value)}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
        >
          <option value="all">All sectors</option>
          {SECTORS.map((s) => (
            <option key={s.etf} value={s.etf}>{s.name}</option>
          ))}
        </select>
        <select
          value={capMin}
          onChange={(e) => setCapMin(Number(e.target.value))}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
        >
          {CAP_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {([["all", "All"], ["high", "Near 52w high"], ["low", "Near 52w low"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setHl(k)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (hl === k ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {label}
            </button>
          ))}
        </div>
        {hl !== "all" && (
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs outline-none"
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

      {/* valuation & quality filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-3)]">Valuation &amp; quality:</span>
        <select value={maxPE == null ? "" : String(maxPE)} onChange={(e) => setMaxPE(e.target.value === "" ? null : Number(e.target.value))} className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none">
          <option value="">P/E: any</option>
          <option value="15">P/E ≤ 15</option>
          <option value="25">P/E ≤ 25</option>
          <option value="40">P/E ≤ 40</option>
        </select>
        <select value={minYld == null ? "" : String(minYld)} onChange={(e) => setMinYld(e.target.value === "" ? null : Number(e.target.value))} className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none">
          <option value="">Div yield: any</option>
          <option value="0.0001">Yield &gt; 0%</option>
          <option value="0.02">Yield ≥ 2%</option>
          <option value="0.04">Yield ≥ 4%</option>
        </select>
        <select value={minRoe == null ? "" : String(minRoe)} onChange={(e) => setMinRoe(e.target.value === "" ? null : Number(e.target.value))} className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none">
          <option value="">ROE: any</option>
          <option value="0.15">ROE ≥ 15%</option>
          <option value="0.25">ROE ≥ 25%</option>
        </select>
        <button onClick={() => setAboveMA((v) => !v)} className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " + (aboveMA ? "border-[#2563eb] bg-[#2563eb]/20 text-[#93c5fd]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Price above its 200-day moving average (uptrend)">
          Above 200-day avg
        </button>
        <button
          onClick={() => {
            const next = !magic;
            setMagic(next);
            // Default to the magic-rank order when turning it on; restore a normal
            // column sort when turning it off (or if magic sort was active).
            if (next) { setSortKey("magic"); setSortDir("asc"); }
            else if (sortKey === "magic") { setSortKey("cap"); setSortDir("desc"); }
          }}
          title="Greenblatt Magic Formula: every name ranked by earnings yield + return on capital, the two ranks summed, top 30 shown best-first (ex-financials & utilities, ≥$500M cap). Good companies at cheap prices. Proxies earnings yield with 1/(P/E) and return-on-capital with ROE; needs fundamentals (US universes). Click a column header to re-sort the 30 names."
          className={"rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors " + (magic ? "border-[#a855f7] bg-[#a855f7]/20 text-[#d8b4fe]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")}
        >
          ✦ Magic Formula
        </button>
      </div>

      {/* fundamentals filters + column set */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-3)]">Fundamentals:</span>
        <select
          value={minRevG == null ? "" : String(minRevG)}
          onChange={(e) => setMinRevG(e.target.value === "" ? null : Number(e.target.value))}
          className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none"
        >
          {REV_OPTS.map((o) => (
            <option key={o.label} value={o.v == null ? "" : String(o.v)}>{o.label}</option>
          ))}
        </select>
        <button onClick={() => setExpanding((v) => !v)} className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " + (expanding ? "border-[#2563eb] bg-[#2563eb]/20 text-[#93c5fd]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")}>
          Margins expanding
        </button>
        <button onClick={() => setDsoRising((v) => !v)} className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " + (dsoRising ? "border-[#ef4444] bg-[#ef4444]/15 text-[#fca5a5]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Days sales outstanding rising YoY — receivables outrunning revenue">
          DSO rising 🚩
        </button>
        <button onClick={() => setProfitable((v) => !v)} className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " + (profitable ? "border-[#2563eb] bg-[#2563eb]/20 text-[#93c5fd]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")}>
          Profitable
        </button>
        <div className="ml-auto inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {(["valuation", "fundamentals"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setColSet(k)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors " + (colSet === k ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {k} cols
            </button>
          ))}
        </div>
      </div>

      {colSet === "fundamentals" && (
        <p className="-mt-1 mb-3 text-[11px] leading-relaxed text-[var(--text-4)]">
          Fundamentals are <span className="text-[var(--text-3)]">annual — most recently reported fiscal year vs. the year before</span>.{" "}
          <span className="font-medium text-[var(--text-3)]">Rev Gr</span> is that 1-year revenue growth;{" "}
          <span className="font-medium text-[var(--text-3)]">Δ Op Mgn</span> / <span className="font-medium text-[var(--text-3)]">Δ DSO</span> are the
          year-over-year change (margins in points, DSO in days). The “Margins expanding / DSO rising” filters use the same basis.
        </p>
      )}

      <div className="mb-2 text-xs text-[var(--text-3)]">
        {magic ? (
          <span><span className="font-semibold text-[#d8b4fe]">✦ Magic Formula</span> — top {filtered.length} ranked by earnings yield + return on capital (best first){sectorEtf !== "all" ? " in this sector" : ""}. </span>
        ) : null}
        Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
        {filtered.length > LIMIT && ` (first ${LIMIT} — refine filters or sort)`} · click a row to open
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              <th className="w-8 px-2 py-2"></th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key, c.num)}
                  className={
                    "cursor-pointer select-none px-3 py-2 font-medium whitespace-nowrap hover:text-[var(--text)] " +
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
                className="cursor-pointer border-b border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(s.symbol); }}
                    title={has(s.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                    className="align-middle"
                    style={{ color: has(s.symbol) ? "#fbbf24" : "var(--border-strong)" }}
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
                        (c.key === "symbol" ? "font-mono font-semibold" : c.key === "name" ? "max-w-[16rem] truncate text-[var(--text-2)]" : c.key === "etf" ? "text-[var(--text-3)]" : "")
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
