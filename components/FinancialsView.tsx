"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { FinPeriod, Financials } from "@/lib/financials";
import type { CompanyStats as CompanyStatsData } from "@/lib/companyStats";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import CompanyStats from "./CompanyStats";

type Kind = "cur" | "eps" | "shares" | "pct";
interface RowSpec {
  label: string;
  field?: string | string[];
  kind: Kind;
  bold?: boolean;
  derived?: (p: FinPeriod) => number | null;
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
  { label: "Total Revenue", field: "totalRevenue", kind: "cur", bold: true },
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
  { label: "Net Income", field: ["netIncome", "netIncomeCommonStockholders"], kind: "cur", bold: true },
  { label: "Net Margin", kind: "pct", derived: (p) => ratio(netInc(p), fld(p, "totalRevenue")) },
  { label: "Diluted EPS", field: "dilutedEPS", kind: "eps", bold: true },
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
}: {
  universe: string;
  symbol: string;
  name: string;
  etf: string | null;
  sectorName: string | null;
  financials: Financials;
  stats: CompanyStatsData | null;
}) {
  const [view, setView] = useState<"statements" | "stats">("statements");
  const [type, setType] = useState<"annual" | "quarterly">("annual");
  const [stmt, setStmt] = useState<StmtKey>("income");

  const chrono = financials[type]; // oldest → newest
  const periods = useMemo(() => [...chrono].reverse(), [chrono]); // newest → oldest for columns
  const rows = STATEMENTS[stmt].rows;
  const hasData = financials.annual.length > 0 || financials.quarterly.length > 0;

  const cell = (p: FinPeriod, r: RowSpec): number | null =>
    r.derived ? r.derived(p) : fld(p, r.field);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#8b93a7]">
          <Link href={`/u/${universe}`} className="hover:text-[#e6e9f0]">
            {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          {etf && (
            <>
              <span>/</span>
              <Link href={`/u/${universe}/sector/${etf.toLowerCase()}`} className="hover:text-[#e6e9f0]">
                {etf} {sectorName}
              </Link>
            </>
          )}
          <span>/</span>
          <Link href={`/u/${universe}/stock/${encodeURIComponent(symbol)}`} className="hover:text-[#e6e9f0]">
            {symbol}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold">
            <span className="font-mono">{symbol}</span>{" "}
            <span className="text-lg font-normal text-[#aab2c5]">{name} — Financials</span>
          </h1>
          <Link
            href={`/u/${universe}/stock/${encodeURIComponent(symbol)}`}
            className="text-sm text-[#60a5fa] hover:underline"
          >
            ← price chart & indicators
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <Segmented
          options={[
            { key: "statements", label: "Statements" },
            { key: "stats", label: "Estimates & Stats" },
          ]}
          value={view}
          onChange={(v) => setView(v as "statements" | "stats")}
        />
      </div>

      {view === "stats" ? (
        <CompanyStats stats={stats} />
      ) : !hasData ? (
        <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
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
            <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-6 text-sm text-[#8b93a7]">
              No {type} data.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#2a2e39] bg-[#131722]">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#2a2e39] text-[#8b93a7]">
                    <th className="sticky left-0 z-10 bg-[#131722] px-4 py-3 text-left font-medium">
                      {STATEMENTS[stmt].label}
                    </th>
                    {periods.map((p) => (
                      <th key={p.date} className="px-4 py-3 text-right font-medium tabular-nums">
                        {periodLabel(p.date, type)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.label}
                      className={
                        "border-b border-[#1f2430] " +
                        (r.kind === "pct" ? "text-[#8b93a7]" : "")
                      }
                    >
                      <td
                        className={
                          "sticky left-0 z-10 bg-[#131722] px-4 py-2 text-left " +
                          (r.bold ? "font-semibold text-[#e6e9f0]" : "text-[#aab2c5]") +
                          (r.kind === "pct" ? " pl-7 text-xs italic" : "")
                        }
                      >
                        {r.label}
                      </td>
                      {periods.map((p) => {
                        const v = cell(p, r);
                        const neg = v != null && v < 0 && r.kind !== "pct";
                        return (
                          <td
                            key={p.date}
                            className={
                              "px-4 py-2 text-right tabular-nums " +
                              (r.bold ? "font-semibold " : "") +
                              (neg ? "text-[#ef4444]" : "")
                            }
                          >
                            {fmtCell(v, r.kind)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-[#8b93a7]">
            Source: Yahoo Finance fundamentals · {type} · most recent period on the
            left · fetched live and cached for 24h.
          </p>
        </>
      )}
    </main>
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
    <div className="inline-flex rounded-lg border border-[#2a2e39] bg-[#131722] p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
            (o.key === value ? "bg-[#2563eb] text-white" : "text-[#8b93a7] hover:text-[#e6e9f0]")
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
    <div className="mb-4 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
      <div className="mb-3 flex items-center gap-4 text-xs text-[#8b93a7]">
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
            <div className="text-[10px] tabular-nums text-[#8b93a7]">
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
            <div className="text-[10px] tabular-nums text-[#aab2c5]">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
