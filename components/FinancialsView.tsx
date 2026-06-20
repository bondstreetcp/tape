"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FinPeriod, Financials } from "@/lib/financials";
import type { CompanyStats as CompanyStatsData } from "@/lib/companyStats";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { StockRow } from "@/lib/types";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import CompanyStats from "./CompanyStats";
import { OwnershipPanel, ProfilePanel } from "./CompanyProfile";
import PeerComparison from "./PeerComparison";
import FilingsView from "./FilingsView";
import DocSearch from "./DocSearch";
import ValuationBands from "./ValuationBands";
import EarningsMultipleChart from "./EarningsMultipleChart";
import SegmentsPanel from "./Segments";
import OptionsChain from "./OptionsChain";
import DcfPanel from "./DcfPanel";
import StockOverview from "./StockOverview";
import KeyStatsStrip from "./KeyStatsStrip";
import WatchStar from "./WatchStar";
import UniverseSwitcher from "./UniverseSwitcher";
import type { SeriesPoint } from "@/lib/types";
import { fmtPrice, fmtPct } from "@/lib/format";
import { trendColor } from "@/lib/color";

type Kind = "cur" | "eps" | "shares" | "pct";
interface RowSpec {
  label: string;
  field?: string | string[];
  kind: Kind;
  bold?: boolean;
  derived?: (p: FinPeriod) => number | null;
  growth?: boolean; // show YoY % change under the value
}

const fld = (p: FinPeriod, f?: string | string[]): number | null => {
  if (!f) return null;
  const keys = Array.isArray(f) ? f : [f];
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "number") return v;
  }
  return null;
};
const ratio = (a: number | null, b: number | null) =>
  a != null && b != null && b !== 0 ? (a / b) * 100 : null;
const netInc = (p: FinPeriod) => fld(p, ["netIncome", "netIncomeCommonStockholders"]);

const INCOME: RowSpec[] = [
  { label: "Total Revenue", field: "totalRevenue", kind: "cur", bold: true, growth: true },
  { label: "Cost of Revenue", field: "costOfRevenue", kind: "cur" },
  { label: "Gross Profit", field: "grossProfit", kind: "cur", bold: true },
  { label: "Gross Margin", kind: "pct", derived: (p) => ratio(fld(p, "grossProfit"), fld(p, "totalRevenue")) },
  { label: "Research & Development", field: "researchAndDevelopment", kind: "cur" },
  { label: "SG&A", field: "sellingGeneralAndAdministration", kind: "cur" },
  { label: "Operating Income", field: "operatingIncome", kind: "cur", bold: true },
  { label: "Operating Margin", kind: "pct", derived: (p) => ratio(fld(p, "operatingIncome"), fld(p, "totalRevenue")) },
  { label: "EBITDA", field: "EBITDA", kind: "cur" },
  { label: "Pretax Income", field: "pretaxIncome", kind: "cur" },
  { label: "Tax Provision", field: "taxProvision", kind: "cur" },
  { label: "Net Income", field: ["netIncome", "netIncomeCommonStockholders"], kind: "cur", bold: true, growth: true },
  { label: "Net Margin", kind: "pct", derived: (p) => ratio(netInc(p), fld(p, "totalRevenue")) },
  { label: "Diluted EPS", field: "dilutedEPS", kind: "eps", bold: true, growth: true },
  { label: "Diluted Shares", field: "dilutedAverageShares", kind: "shares" },
];

const BALANCE: RowSpec[] = [
  { label: "Cash & Equivalents", field: ["cashAndCashEquivalents", "cashEquivalents", "cashCashEquivalentsAndShortTermInvestments"], kind: "cur" },
  { label: "Total Current Assets", field: "currentAssets", kind: "cur" },
  { label: "Total Assets", field: "totalAssets", kind: "cur", bold: true },
  { label: "Total Current Liabilities", field: "currentLiabilities", kind: "cur" },
  { label: "Total Debt", field: "totalDebt", kind: "cur" },
  { label: "Total Liabilities", field: "totalLiabilitiesNetMinorityInterest", kind: "cur" },
  { label: "Total Equity", field: ["stockholdersEquity", "commonStockEquity"], kind: "cur", bold: true },
  { label: "Retained Earnings", field: "retainedEarnings", kind: "cur" },
  { label: "Working Capital", field: "workingCapital", kind: "cur" },
];

const CASHFLOW: RowSpec[] = [
  { label: "Operating Cash Flow", field: "operatingCashFlow", kind: "cur", bold: true },
  { label: "Capital Expenditure", field: "capitalExpenditure", kind: "cur" },
  { label: "Free Cash Flow", field: "freeCashFlow", kind: "cur", bold: true },
  { label: "FCF Margin", kind: "pct", derived: (p) => ratio(fld(p, "freeCashFlow"), fld(p, "totalRevenue")) },
  { label: "Investing Cash Flow", field: "investingCashFlow", kind: "cur" },
  { label: "Financing Cash Flow", field: "financingCashFlow", kind: "cur" },
  { label: "Dividends Paid", field: "cashDividendsPaid", kind: "cur" },
  { label: "Stock Buybacks", field: "repurchaseOfCapitalStock", kind: "cur" },
  { label: "Stock-Based Comp", field: "stockBasedCompensation", kind: "cur" },
  { label: "Depreciation & Amort.", field: "depreciationAndAmortization", kind: "cur" },
  { label: "End Cash Position", field: "endCashPosition", kind: "cur" },
];

const STATEMENTS = {
  income: { label: "Income Statement", rows: INCOME },
  balance: { label: "Balance Sheet", rows: BALANCE },
  cashflow: { label: "Cash Flow", rows: CASHFLOW },
} as const;
type StmtKey = keyof typeof STATEMENTS;

function fmtBig(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function fmtCell(v: number | null, kind: Kind): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (kind === "pct") return `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(1)}%`;
  if (kind === "eps") return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  if (kind === "shares") {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return `${v.toFixed(0)}`;
  }
  return fmtBig(v);
}
function periodLabel(date: string, type: "annual" | "quarterly"): string {
  const d = new Date(date);
  if (type === "annual") return `FY${String(d.getFullYear()).slice(2)}`;
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export default function FinancialsView({
  universe,
  symbol,
  name,
  etf,
  sectorName,
  financials,
  stats,
  profile,
  peers,
  peerGroup,
  row,
  daily,
  intraday,
  generatedAt,
}: {
  universe: string;
  symbol: string;
  name: string;
  etf: string | null;
  sectorName: string | null;
  financials: Financials;
  stats: CompanyStatsData | null;
  profile: CompanyProfile | null;
  peers: StockRow[];
  peerGroup: string | null;
  row: StockRow | null;
  daily: SeriesPoint[];
  intraday: SeriesPoint[];
  generatedAt: string;
}) {
  type View = "overview" | "statements" | "stats" | "ownership" | "profile" | "peers" | "filings" | "options" | "docsearch";
  const [view, setView] = useState<View>("overview");
  const [type, setType] = useState<"annual" | "quarterly">("annual");
  const [stmt, setStmt] = useState<StmtKey>("income");

  // Active tab: ?tab= deep-link wins, else the last tab you used (so switching
  // companies keeps you on the same view — e.g. compare Statements across names).
  useEffect(() => {
    const valid = ["overview", "statements", "stats", "peers", "ownership", "profile", "filings", "options", "docsearch"];
    const t = new URLSearchParams(window.location.search).get("tab");
    let next = t && valid.includes(t) ? t : null;
    if (!next) {
      try {
        const saved = localStorage.getItem("fin.tab");
        if (saved && valid.includes(saved)) next = saved;
      } catch {}
    }
    if (next && next !== "overview") setView(next as View);
  }, []);
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("fin.tab", v);
    } catch {}
    const u = new URL(window.location.href);
    u.searchParams.set("tab", v);
    window.history.replaceState(null, "", u);
  };

  const chrono = financials[type]; // oldest → newest
  const periods = useMemo(() => [...chrono].reverse(), [chrono]); // newest → oldest for columns
  const rows = STATEMENTS[stmt].rows;
  const hasData = financials.annual.length > 0 || financials.quarterly.length > 0;

  const cell = (p: FinPeriod, r: RowSpec): number | null =>
    r.derived ? r.derived(p) : fld(p, r.field);

  // Forward-year consensus estimates (FY+1, FY+2) for the annual income statement.
  // Yahoo's earningsTrend gives 0y/+1y, so when the last reported year is the
  // prior FY both forward years are real consensus; otherwise the later year is
  // derived from consensus growth.
  const estPeriods = useMemo<FinPeriod[]>(() => {
    if (stmt !== "income" || type !== "annual" || !stats) return [];
    const lastActual = chrono[chrono.length - 1];
    if (!lastActual) return [];
    const lastYear = new Date(lastActual.date).getFullYear();
    const lastShares = fld(lastActual, "dilutedAverageShares");
    const revG = stats.revenueGrowth;
    const epsG = stats.earningsGrowth;

    const findTrend = (year: number) =>
      stats.estimates.find((e) => e.endDate && new Date(e.endDate).getFullYear() === year) ?? null;

    const out: FinPeriod[] = [];
    let prevRev = fld(lastActual, "totalRevenue");
    let prevEps: number | null = stats.trailingEps;
    // earningsTrend often has null endDates, so map by period: 0y → FY+1, +1y → FY+2.
    const cap = (g: number | null) => (g == null ? null : Math.max(-0.5, Math.min(g, 0.35)));
    for (let k = 1; k <= 2; k++) {
      const year = lastYear + k;
      const periodKey = k === 1 ? "0y" : "+1y";
      const tr = findTrend(year) ?? stats.estimates.find((e) => e.period === periodKey) ?? null;
      const revEst =
        tr?.revAvg ?? (prevRev != null && revG != null ? prevRev * (1 + (cap(revG) ?? 0)) : null);
      const epsEst =
        tr?.epsAvg ??
        (k === 1
          ? stats.forwardEps
          : prevEps != null && epsG != null
            ? prevEps * (1 + (cap(epsG) ?? 0))
            : null);
      const derived = tr?.revAvg == null && tr?.epsAvg == null;
      const niEst = epsEst != null && lastShares != null ? epsEst * lastShares : null;
      if (revEst == null && epsEst == null) break;
      out.push({
        date: `${year}-12-31`,
        __est: 1,
        __derived: derived ? 1 : 0,
        totalRevenue: revEst,
        netIncome: niEst,
        netIncomeCommonStockholders: niEst,
        dilutedEPS: epsEst,
        dilutedAverageShares: lastShares,
      } as FinPeriod);
      prevRev = revEst;
      prevEps = epsEst;
    }
    return out; // [FY+1, FY+2]
  }, [stmt, type, stats, chrono]);

  const anyDerived = estPeriods.some((p) => p.__derived);
  const displayPeriods = useMemo(
    () => [...[...estPeriods].reverse(), ...periods], // FY+2, FY+1, then actuals
    [estPeriods, periods],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-3)]">
          <Link href={`/u/${universe}`} className="hover:text-[var(--text)]">
            {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          {etf && (
            <>
              <span>/</span>
              <Link href={`/u/${universe}/sector/${etf.toLowerCase()}`} className="hover:text-[var(--text)]">
                {etf} {sectorName}
              </Link>
            </>
          )}
          <span>/</span>
          <Link href={`/u/${universe}/stock/${encodeURIComponent(symbol)}`} className="hover:text-[var(--text)]">
            {symbol}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-mono text-2xl font-bold">{symbol}</h1>
            <span className="text-lg text-[var(--text-2)]">{name}</span>
            {row && <span className="font-mono text-xl tabular-nums">${fmtPrice(row.price)}</span>}
            {row && (
              <span className="text-sm font-semibold tabular-nums" style={{ color: trendColor(row.returns["1d"]) }}>
                {fmtPct(row.returns["1d"])} <span className="font-normal text-[var(--text-3)]">1D</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <WatchStar symbol={symbol} withLabel />
            {etf && <UniverseSwitcher current={universe} etf={etf} />}
          </div>
        </div>
        {row && <div className="mt-3"><KeyStatsStrip stats={stats} row={row} /></div>}
      </div>

      <div className="mb-4">
        <Segmented
          options={[
            { key: "overview", label: "Overview" },
            { key: "statements", label: "Statements" },
            { key: "stats", label: "Estimates & Stats" },
            { key: "peers", label: "Peers" },
            { key: "ownership", label: "Ownership" },
            { key: "filings", label: "Filings & Calls" },
            { key: "docsearch", label: "Doc Search" },
            { key: "options", label: "Options" },
            { key: "profile", label: "Profile" },
          ]}
          value={view}
          onChange={(v) => changeView(v as View)}
        />
      </div>

      {view === "overview" ? (
        row ? (
          <StockOverview row={row} daily={daily} intraday={intraday} generatedAt={generatedAt} />
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">No overview data for {symbol}.</div>
        )
      ) : view === "stats" ? (
        <div className="space-y-4">
          <CompanyStats stats={stats} />
          <DcfPanel financials={financials} stats={stats} price={row?.price ?? stats?.price ?? null} />
          <EarningsMultipleChart symbol={symbol} />
          <ValuationBands symbol={symbol} />
        </div>
      ) : view === "peers" ? (
        <PeerComparison universe={universe} symbol={symbol} peers={peers} peerGroup={peerGroup} />
      ) : view === "ownership" ? (
        <OwnershipPanel profile={profile} symbol={symbol} />
      ) : view === "filings" ? (
        <FilingsView symbol={symbol} name={name} />
      ) : view === "docsearch" ? (
        <DocSearch ticker={symbol} name={name} />
      ) : view === "options" ? (
        <OptionsChain symbol={symbol} />
      ) : view === "profile" ? (
        <ProfilePanel profile={profile} />
      ) : !hasData ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
          No financial data available for {symbol}.
        </div>
      ) : (
        <>
          {/* controls */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              options={[
                { key: "annual", label: "Annual" },
                { key: "quarterly", label: "Quarterly" },
              ]}
              value={type}
              onChange={(v) => setType(v as "annual" | "quarterly")}
            />
            <Segmented
              options={(Object.keys(STATEMENTS) as StmtKey[]).map((k) => ({
                key: k,
                label: STATEMENTS[k].label,
              }))}
              value={stmt}
              onChange={(v) => setStmt(v as StmtKey)}
            />
          </div>

          {/* revenue + net income trend */}
          <TrendBars periods={chrono} type={type} />

          {/* statement table */}
          {periods.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-3)]">
              No {type} data.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                    <th className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 text-left font-medium">
                      {STATEMENTS[stmt].label}
                    </th>
                    {displayPeriods.map((p) => (
                      <th
                        key={p.date}
                        className={
                          "px-4 py-3 text-right font-medium tabular-nums " +
                          (p.__est ? "text-[#60a5fa]" : "")
                        }
                        title={p.__derived ? "Derived from consensus growth (Yahoo provides only one forward year)" : undefined}
                      >
                        {p.__est
                          ? `${periodLabel(p.date, type)}E${p.__derived ? "*" : ""}`
                          : periodLabel(p.date, type)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.label}
                      className={
                        "border-b border-[var(--divider)] " +
                        (r.kind === "pct" ? "text-[var(--text-3)]" : "")
                      }
                    >
                      <td
                        className={
                          "sticky left-0 z-10 bg-[var(--surface)] px-4 py-2 text-left " +
                          (r.bold ? "font-semibold text-[var(--text)]" : "text-[var(--text-2)]") +
                          (r.kind === "pct" ? " pl-7 text-xs italic" : "")
                        }
                      >
                        {r.label}
                      </td>
                      {displayPeriods.map((p, i) => {
                        const v = cell(p, r);
                        const neg = v != null && v < 0 && r.kind !== "pct";
                        const prior = r.growth && i + 1 < displayPeriods.length ? cell(displayPeriods[i + 1], r) : null;
                        const yoy = r.growth && v != null && prior != null && prior > 0 ? (v / prior - 1) * 100 : null;
                        return (
                          <td
                            key={p.date}
                            className={
                              "px-4 py-2 text-right tabular-nums " +
                              (r.bold ? "font-semibold " : "") +
                              (p.__est ? "bg-[var(--surface-3)] text-[#93c5fd] " : "") +
                              (neg && !p.__est ? "text-[#ef4444]" : "")
                            }
                          >
                            {fmtCell(v, r.kind)}
                            {yoy != null && (
                              <div className="text-[10px] font-normal tabular-nums" style={{ color: yoy >= 0 ? "#22c55e" : "#ef4444" }}>
                                {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-[var(--text-3)]">
            Source: Yahoo Finance fundamentals · {type} · most recent period on the
            left · fetched live and cached for 24h.
            {estPeriods.length > 0 && (
              <>
                {" · "}
                <span className="text-[#60a5fa]">FY…E</span> = forward consensus
                (EPS &amp; revenue from analyst estimates; net income ≈ EPS ×
                shares); other lines aren&apos;t estimated.
                {anyDerived && " *later year derived from consensus growth."}
              </>
            )}
          </p>
          <DuPontPanel periods={financials.annual} />
          <SegmentsPanel symbol={symbol} />
        </>
      )}
    </main>
  );
}

function DuPontPanel({ periods }: { periods: FinPeriod[] }) {
  const rows = [...periods]
    .reverse() // newest → oldest
    .map((p) => {
      const rev = fld(p, "totalRevenue");
      const ni = netInc(p);
      const assets = fld(p, "totalAssets");
      const equity = fld(p, "stockholdersEquity") ?? fld(p, "commonStockEquity");
      if (rev == null || ni == null || assets == null || equity == null || rev <= 0 || assets <= 0 || equity <= 0) return null;
      const netMargin = ni / rev;
      const turnover = rev / assets;
      const leverage = assets / equity;
      return { date: p.date, netMargin, turnover, leverage, roe: netMargin * turnover * leverage };
    })
    .filter((r): r is { date: string; netMargin: number; turnover: number; leverage: number; roe: number } => !!r)
    .slice(0, 5);
  if (rows.length < 2) return null;

  // Attribute the latest ROE change to its biggest DuPont driver.
  const [cur, prev] = rows;
  const contrib = {
    margin: (cur.netMargin - prev.netMargin) * prev.turnover * prev.leverage,
    turnover: cur.netMargin * (cur.turnover - prev.turnover) * prev.leverage,
    leverage: cur.netMargin * cur.turnover * (cur.leverage - prev.leverage),
  };
  const top = (Object.entries(contrib).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] || ["", 0]) as [string, number];
  const label = ({ margin: "net margin", turnover: "asset turnover", leverage: "leverage" } as Record<string, string>)[top[0]] || "";
  const dRoe = cur.roe - prev.roe;
  const driver = label ? `ROE ${dRoe >= 0 ? "rose" : "fell"} ${Math.abs(dRoe * 100).toFixed(1)} pts vs. the prior year — mostly ${top[1] >= 0 ? "higher" : "lower"} ${label}.` : "";

  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-1 text-sm font-semibold text-[var(--text-2)]">ROE decomposition (DuPont) · annual</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        ROE = <span className="text-[var(--text-3)]">net margin</span> × <span className="text-[var(--text-3)]">asset turnover</span> ×{" "}
        <span className="text-[var(--text-3)]">equity multiplier</span> — shows whether returns come from profitability, efficiency, or leverage.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-[var(--text-3)]">
              <th className="py-1 text-left font-medium">Year</th>
              <th className="py-1 text-right font-medium">Net margin</th>
              <th className="py-1 text-right font-medium">× Asset turnover</th>
              <th className="py-1 text-right font-medium">× Equity mult.</th>
              <th className="py-1 text-right font-medium">= ROE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-[var(--divider)]">
                <td className="py-1 text-left text-[var(--text-2)]">{new Date(r.date).getFullYear()}</td>
                <td className="py-1 text-right tabular-nums">{(r.netMargin * 100).toFixed(1)}%</td>
                <td className="py-1 text-right tabular-nums">{r.turnover.toFixed(2)}×</td>
                <td className="py-1 text-right tabular-nums">{r.leverage.toFixed(2)}×</td>
                <td className="py-1 text-right font-semibold tabular-nums text-[var(--text)]">{(r.roe * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {driver && <p className="mt-2 text-[11px] text-[var(--text-3)]">{driver}</p>}
    </section>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
            (o.key === value ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TrendBars({
  periods,
  type,
}: {
  periods: FinPeriod[];
  type: "annual" | "quarterly";
}) {
  const data = periods.map((p) => ({
    label: periodLabel(p.date, type),
    rev: fld(p, "totalRevenue"),
    ni: netInc(p),
  }));
  const maxRev = Math.max(1, ...data.map((d) => (d.rev ? Math.abs(d.rev) : 0)));
  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-4 text-xs text-[var(--text-3)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#60a5fa]" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#22c55e]" /> Net Income
        </span>
      </div>
      <div className="flex h-40 items-end gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div className="text-[10px] tabular-nums text-[var(--text-3)]">
              {d.rev ? fmtBig(d.rev) : ""}
            </div>
            <div className="flex h-28 w-full items-end justify-center gap-1">
              <div
                className="w-1/2 rounded-t bg-[#60a5fa]"
                style={{ height: `${d.rev ? (Math.abs(d.rev) / maxRev) * 100 : 0}%` }}
                title={`Revenue ${fmtBig(d.rev)}`}
              />
              <div
                className={"w-1/3 rounded-t " + ((d.ni ?? 0) < 0 ? "bg-[#ef4444]" : "bg-[#22c55e]")}
                style={{ height: `${d.ni ? (Math.abs(d.ni) / maxRev) * 100 : 0}%` }}
                title={`Net Income ${fmtBig(d.ni)}`}
              />
            </div>
            <div className="text-[10px] tabular-nums text-[var(--text-2)]">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
