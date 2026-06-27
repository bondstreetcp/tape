"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { combinedScreenSymbols, SCREEN_LABEL, SCREEN_SHORT, SCREEN_ORDER, type ScreenKey } from "@/lib/screens";
import { TIMEFRAMES, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { fmtPct, fmtMarketCap, fmtMoney, fmtDateTime } from "@/lib/format";
import { trendColor } from "@/lib/color";
import { SECTORS, ETF_TO_SECTOR } from "@/lib/sectors";
import { isNearHigh, isNearLow } from "@/lib/compute";
import { UNIVERSE_BY_ID, currencyOf } from "@/lib/universes";
import NlScreener from "./NlScreener";
import StrategyTip from "./StrategyTip";
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

// The signature column a screen adds to the table when active (Magic has none — it's a pure
// rank). When screens are stacked, each active screen's column shows, de-duplicated by key.
function stratColFor(key: ScreenKey): Col | null {
  switch (key) {
    case "erp5": return { key: "fcfYld", label: "FCF Yld", num: true, get: (s) => s.fund?.fcfYield ?? null, fmt: pctFrac, color: (v) => trendColor(v), align: "right" };
    case "moat":
    case "qualval": return { key: "roic", label: "ROIC", num: true, get: (s) => s.fund?.roic ?? null, fmt: pctFrac, color: (v) => (v == null ? undefined : v >= 0.2 ? "#22c55e" : undefined), align: "right" };
    case "netnet": return { key: "mktncav", label: "Mkt / NCAV", num: true, get: (s) => { const n = s.fund?.ncav; return n != null && n > 0 ? s.marketCap / n : null; }, fmt: (v) => (v == null ? "—" : `${v.toFixed(2)}×`), color: (v) => (v == null ? undefined : v < 0.67 ? "#22c55e" : v < 1 ? "#fbbf24" : undefined), align: "right" };
    case "piotroski": return { key: "fscore", label: "F-Score", num: true, get: (s) => s.fund?.fScore ?? null, fmt: (v) => (v == null ? "—" : `${v} / 9`), color: (v) => (v == null ? undefined : v >= 8 ? "#22c55e" : v <= 3 ? "#ef4444" : undefined), align: "right" };
    case "shyield": return { key: "shyield", label: "Sh. Yield", num: true, get: (s) => s.fund?.shareholderYield ?? null, fmt: pctFrac, color: (v) => trendColor(v), align: "right" };
    case "rule40": return { key: "rule40", label: "Rule 40", num: true, get: (s) => (s.fund?.revGrowth != null && s.fund?.fcfMargin != null ? s.fund.revGrowth + s.fund.fcfMargin : null), fmt: pctFrac, color: (v) => (v == null ? undefined : v >= 0.4 ? "#22c55e" : undefined), align: "right" };
    case "mna": return { key: "ndebt", label: "Nd/EBITDA", num: true, get: (s) => s.fund?.netDebtEbitda ?? null, fmt: (v) => (v == null ? "net cash" : `${v.toFixed(1)}×`), color: (v) => (v == null || v <= 0 ? "#22c55e" : v <= 1 ? "#fbbf24" : undefined), align: "right" };
    default: return null; // magic — pure rank, no signature column
  }
}

// Rule of 40 also breaks out its two components as their own columns (you want to see the split —
// is this name growing or earning its way to 40?) — shown next to the combined "Rule 40" score.
const RULE40_COLS: Col[] = [
  { key: "revgr", label: "Rev gr", num: true, get: (s) => s.fund?.revGrowth ?? null, fmt: pctFrac, color: (v) => trendColor(v), align: "right" },
  { key: "fcfmgn", label: "FCF mgn", num: true, get: (s) => s.fund?.fcfMargin ?? null, fmt: pctFrac, color: (v) => trendColor(v), align: "right" },
];

// One-line description for a single active screen (the stacked case is handled inline).
function screenBlurb(key: ScreenKey, n: number, pioMin: number): string {
  switch (key) {
    case "magic": return `top ${n} by earnings yield + return on capital (best first)`;
    case "erp5": return `top ${n} by the 4-factor ERP5 rank — earnings yield + return on capital + price-to-book + cash-flow yield (best first)`;
    case "qualval": return `top ${n} by the quality + value composite — value & quality factors blended equally (best first)`;
    case "netnet": return `${n} trading below net current asset value (deep value — rare outside small caps)`;
    case "piotroski": return `${n} with F-Score ≥ ${pioMin} (of 9)`;
    case "shyield": return `top ${n} by shareholder yield`;
    case "moat": return `${n} wide-moat names — ROIC ≥ 15%, operating margin ≥ 20%, low debt (best first)`;
    case "rule40": return `${n} clearing the Rule of 40 — revenue growth + FCF margin ≥ 40% (best first)`;
    case "mna": return `top ${n} takeout candidates — clean, cash-generative mid-caps at an undemanding multiple (best first)`;
  }
}

// Screens that produce a ranked Top-N (so the Top-N selector applies); the rest are pure filters.
const RANKED_SCREENS: ScreenKey[] = ["magic", "erp5", "qualval", "shyield", "moat", "rule40", "mna"];

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
  const [activeScreens, setActiveScreens] = useState<ScreenKey[]>([]); // stacked preset screens (hard AND)
  const [topN, setTopN] = useState(30); // names shown for ranked screens / the stacked intersection
  const [pioMin, setPioMin] = useState(7); // minimum Piotroski F-score

  // Preset screens stack with a hard AND: a name must pass every active screen, and the
  // survivors are ranked by their combined position across all of them (combinedScreenSymbols,
  // shared with the backtester so screen and backtest hold identical names). With one screen
  // this is just that screen; with none, manual filters only. `set` filters the table; `rank`
  // carries the combined best-first order.
  const screenResult = useMemo(() => {
    if (activeScreens.length === 0) return null;
    const syms = combinedScreenSymbols(activeScreens, stocks, { topN, pioMin });
    return { set: new Set(syms), rank: new Map(syms.map((s, i) => [s, i] as const)) };
  }, [activeScreens, stocks, topN, pioMin]);

  const currency = currencyOf(universe);
  const columns: Col[] = useMemo(() => {
    const base: Col[] = [
      { key: "symbol", label: "Symbol", num: false, get: (s) => s.symbol, fmt: (v) => v, align: "left" },
      { key: "name", label: "Name", num: false, get: (s) => s.name, fmt: (v) => v, align: "left" },
      { key: "etf", label: "Sector", num: false, get: (s) => ETF_TO_SECTOR[s.etf]?.name ?? s.sector, fmt: (v) => v, align: "left" },
      { key: "price", label: "Price", num: true, get: (s) => s.price, fmt: (v) => (v == null ? "—" : fmtMoney(v, currency)), align: "right" },
      { key: "ret", label: TIMEFRAMES.find((t) => t.key === tf)?.label ?? "Ret", num: true, get: (s) => s.returns[tf], fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "ret3y", label: "3Y", num: true, get: (s) => s.returns["3y"], fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "ret5y", label: "5Y", num: true, get: (s) => s.returns["5y"], fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "cap", label: "Mkt Cap", num: true, get: (s) => s.marketCap, fmt: (v) => fmtMarketCap(v, currency), align: "right" },
    ];
    const valuation: Col[] = [
      { key: "fromHigh", label: "% fr High", num: true, get: (s) => s.pctFromHigh, fmt: (v) => fmtPct(v, 1), color: (v) => trendColor(v), align: "right" },
      { key: "fromLow", label: "% fr Low", num: true, get: (s) => s.pctFromLow, fmt: (v) => fmtPct(v, 1), align: "right" },
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
    // one signature column per active screen, de-duplicated by key (e.g. Moat + Quality+Value
    // both want ROIC → show it once).
    const stratCols: Col[] = [];
    const seen = new Set<string>();
    for (const k of activeScreens) {
      const c = stratColFor(k);
      if (c && !seen.has(c.key)) { seen.add(c.key); stratCols.push(c); }
      if (k === "rule40") for (const rc of RULE40_COLS) if (!seen.has(rc.key)) { seen.add(rc.key); stratCols.push(rc); }
    }
    return [...base, ...stratCols, ...(colSet === "fundamentals" ? fund : valuation)];
  }, [tf, colSet, currency, activeScreens]);

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
    if (screenResult) r = r.filter((s) => screenResult.set.has(s.symbol));

    // With screens active, order by the combined screen rank (best first) by default — until the
    // user clicks a column header, which switches sortKey to that column (overriding the rank order
    // while keeping the intersection). "screen" is the synthetic sort key for that rank order.
    if (screenResult && sortKey === "screen") return [...r].sort((a, b) => (screenResult.rank.get(a.symbol) ?? 1e9) - (screenResult.rank.get(b.symbol) ?? 1e9));

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
  }, [stocks, query, sectorEtf, capMin, hl, threshold, minRevG, expanding, dsoRising, profitable, maxPE, minYld, minRoe, aboveMA, activeScreens, screenResult, columns, sortKey, sortDir]);

  const onSort = (key: string, num: boolean) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(num ? "desc" : "asc");
    }
  };

  // Functional update so rapid/batched toggles don't clobber each other (each sees the latest set).
  const toggleScreen = (k: ScreenKey) => setActiveScreens((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const showTopN = activeScreens.length >= 2 || activeScreens.some((k) => RANKED_SCREENS.includes(k));

  // When screens switch on/off, default the sort to the combined rank (or back to cap). Keyed on the
  // active/inactive boundary so it doesn't fire on every added chip, nor clobber a URL-driven initial sort.
  const screensActive = activeScreens.length > 0;
  const prevScreensActive = useRef(screensActive);
  useEffect(() => {
    if (screensActive !== prevScreensActive.current) {
      prevScreensActive.current = screensActive;
      setSortKey(screensActive ? "screen" : "cap");
      setSortDir(screensActive ? "asc" : "desc");
    }
  }, [screensActive]);

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

      <NlScreener universe={universe} stocks={stocks} currency={currency} />

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
        <span className="ml-1 text-xs font-medium text-[var(--text-3)]">Screens:</span>
        <div className="inline-flex flex-wrap rounded-lg border border-[#a855f7]/40 bg-[var(--surface)] p-0.5" title="Toggle one or more screens. Stacking two or more requires a name to pass ALL of them (intersection), ranked by combined factor rank.">
          {SCREEN_ORDER.map((k) => {
            const on = activeScreens.includes(k);
            return (
              <button
                key={k}
                onClick={() => toggleScreen(k)}
                title={SCREEN_LABEL[k]}
                className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (on ? "bg-[#a855f7] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
              >
                {SCREEN_SHORT[k]}
              </button>
            );
          })}
        </div>
        <StrategyTip />
        {showTopN && (
          <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} title="How many names the list shows" className="cursor-pointer rounded-lg border border-[#a855f7] bg-[var(--surface)] px-2 py-1.5 text-xs font-medium text-[#d8b4fe]">
            {[20, 30, 40, 50, 75, 100, 150, 200].map((n) => (<option key={n} value={n}>Top {n}</option>))}
          </select>
        )}
        {activeScreens.includes("piotroski") && (
          <select value={pioMin} onChange={(e) => setPioMin(Number(e.target.value))} title="Minimum Piotroski F-score (0–9)" className="cursor-pointer rounded-lg border border-[#a855f7] bg-[var(--surface)] px-2 py-1.5 text-xs font-medium text-[#d8b4fe]">
            {[9, 8, 7, 6, 5].map((n) => (<option key={n} value={n}>F-Score ≥ {n}</option>))}
          </select>
        )}
        {activeScreens.length > 0 && (
          <button onClick={() => setActiveScreens([])} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text)]" title="Clear all screens">
            Clear
          </button>
        )}
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
        {activeScreens.length > 0 && (
          <span><span className="font-semibold text-[#d8b4fe]">{activeScreens.map((k) => SCREEN_SHORT[k]).join(" ∩ ")}</span> — {
            activeScreens.length > 1
              ? `${filtered.length} name${filtered.length === 1 ? "" : "s"} passing all ${activeScreens.length} screens, ranked by combined factor rank (best first)`
              : screenBlurb(activeScreens[0], filtered.length, pioMin)
          }{sectorEtf !== "all" ? " in this sector" : ""}. </span>
        )}
        Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
        {filtered.length > LIMIT && ` (first ${LIMIT} — refine filters or sort)`} · click a row to open
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              <th className="sticky left-0 z-10 w-8 bg-[var(--surface)] px-2 py-2"></th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key, c.num)}
                  className={
                    "cursor-pointer select-none px-3 py-2 font-medium whitespace-nowrap hover:text-[var(--text)] " +
                    (c.key === "symbol" ? "sticky left-8 z-10 bg-[var(--surface)] " : "") +
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
                className="group cursor-pointer border-b border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                <td className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-center transition-colors group-hover:bg-[var(--surface-hover)]">
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
                        (c.key === "symbol" ? "sticky left-8 z-10 bg-[var(--surface)] font-mono font-semibold transition-colors group-hover:bg-[var(--surface-hover)]" : c.key === "name" ? "max-w-[16rem] truncate text-[var(--text-2)]" : c.key === "etf" ? "text-[var(--text-3)]" : "")
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
