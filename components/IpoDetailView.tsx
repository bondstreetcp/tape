"use client";
import Link from "next/link";
import type { IpoEvent } from "@/lib/ipoMonitor";
import { fmtSize, perfColor } from "@/lib/ipoMonitor";
import { fmtUsd, valueTagColor } from "@/lib/ipoFinancials";

// UTC-pinned: a bare YYYY-MM-DD parsed as UTC midnight but formatted in a US browser zone shows one day early.
const dateLabel = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const pctStr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`);

export default function IpoDetailView({ universe, event }: { universe: string; event: IpoEvent }) {
  const e = event;
  const kindLabel = e.kind === "upcoming" ? "Upcoming IPO" : e.kind === "ipo" ? "Recent IPO" : "IPO · lockup approaching";
  const kindColor = e.kind === "upcoming" ? "#a78bfa" : e.kind === "ipo" ? "#22c55e" : "#f59e0b";
  const s = e.summary;

  const Fact = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-[15px] font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</div>
      {children}
    </section>
  );

  return (
    <main className="mx-auto max-w-[52rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}/ipos`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← IPOs &amp; Lockups</Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <h1 className="text-2xl font-bold">{e.company}</h1>
        {e.ticker && <span className="font-mono text-lg text-[var(--accent)]">{e.ticker}</span>}
        <span className="rounded px-2 py-0.5 text-[12px] font-semibold" style={{ background: `color-mix(in oklab, ${kindColor} 16%, transparent)`, color: kindColor }}>{kindLabel}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-4">
        <Fact label={e.kind === "upcoming" ? "Filed" : "IPO date"} value={dateLabel(e.ipoDate)} />
        <Fact label={e.kind === "upcoming" ? "Proposed price" : "Offer price"} value={e.priceUsd != null ? `$${e.priceUsd}` : "—"} />
        <Fact label="Deal size" value={fmtSize(e.sizeUsdM)} />
        <Fact label="Exchange" value={e.exchange || "—"} />
        {e.kind !== "upcoming" && <Fact label="Since IPO" value={e.sinceIpoPct == null ? "—" : `${e.sinceIpoPct >= 0 ? "+" : ""}${e.sinceIpoPct.toFixed(1)}%`} color={perfColor(e.sinceIpoPct)} />}
        {e.kind !== "upcoming" && e.lockupDate && <Fact label="Lockup expiry" value={`${dateLabel(e.lockupDate)}${e.daysToLockup != null ? ` (${e.daysToLockup >= 0 ? "in " + e.daysToLockup + "d" : -e.daysToLockup + "d ago"})` : ""}`} />}
        {s?.sector && <Fact label="Sector" value={s.sector} />}
      </div>

      {s?.underwriters && s.underwriters.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Underwriters / book-runners</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.underwriters.map((u, i) => (
              <span key={i} className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[12.5px] text-[var(--text-2)]">{u}</span>
            ))}
          </div>
        </div>
      )}

      {/* Structured S-1 financials + valuation — pulled from the SEC XBRL facts, with a grounded AI read. */}
      {e.financials && (e.financials.revenue != null || e.financials.years.some((y) => y.revenue != null || y.netIncome != null)) && (() => {
        const f = e.financials!;
        return (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Financials &amp; valuation <span className="normal-case text-[var(--text-4)]">· from the S-1 (SEC XBRL)</span></div>
              {f.valueTag !== "unclear" && <span className="rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: `color-mix(in oklab, ${valueTagColor(f.valueTag)} 16%, transparent)`, color: valueTagColor(f.valueTag) }}>{f.valueTag}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-left text-[13px]">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">
                  <tr><th className="pb-1 font-medium">Fiscal year</th>{f.years.map((y) => <th key={y.year} className="pb-1 pl-3 text-right font-medium">{y.year}</th>)}</tr>
                </thead>
                <tbody className="font-mono tabular-nums text-[var(--text-2)]">
                  <tr><td className="py-0.5 font-sans text-[var(--text-3)]">Revenue</td>{f.years.map((y) => <td key={y.year} className="py-0.5 pl-3 text-right">{fmtUsd(y.revenue)}</td>)}</tr>
                  <tr><td className="py-0.5 font-sans text-[var(--text-3)]">Gross profit</td>{f.years.map((y) => <td key={y.year} className="py-0.5 pl-3 text-right">{fmtUsd(y.grossProfit)}</td>)}</tr>
                  <tr><td className="py-0.5 font-sans text-[var(--text-3)]">Net income</td>{f.years.map((y) => <td key={y.year} className="py-0.5 pl-3 text-right" style={{ color: y.netIncome == null ? undefined : y.netIncome >= 0 ? "#22c55e" : "#ef4444" }}>{fmtUsd(y.netIncome)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-[var(--divider)] pt-3 sm:grid-cols-4">
              <Fact label="Rev. growth" value={pctStr(f.revenueGrowthPct)} color={f.revenueGrowthPct == null ? undefined : f.revenueGrowthPct >= 0 ? "#22c55e" : "#ef4444"} />
              <Fact label="Gross margin" value={f.grossMarginPct == null ? "—" : `${f.grossMarginPct.toFixed(0)}%`} />
              <Fact label="Net margin" value={f.netMarginPct == null ? "—" : `${f.netMarginPct.toFixed(0)}%`} color={f.netMarginPct == null ? undefined : f.netMarginPct >= 0 ? "#22c55e" : "#ef4444"} />
              <Fact label="Price / sales" value={f.priceToSales == null ? "—" : `${f.priceToSales.toFixed(1)}×`} />
              <Fact label="Market cap" value={fmtUsd(f.marketCap)} />
              <Fact label="Cash" value={fmtUsd(f.cash)} />
              <Fact label="Debt" value={f.debt ? fmtUsd(f.debt) : "—"} />
            </div>
            {f.valueRead && <p className="mt-3 border-t border-[var(--divider)] pt-2.5 text-[13px] leading-relaxed text-[var(--text-2)]"><span className="font-semibold text-[var(--text)]">Value read:</span> {f.valueRead}</p>}
            <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Figures from the company&apos;s SEC XBRL filings; market cap = shares × current price. The value read is AI-written from these numbers only — a starting point, not advice.</p>
          </div>
        );
      })()}

      {s ? (
        <div className="mt-4 space-y-3">
          <Section title="What the company does"><p className="text-[14px] leading-relaxed text-[var(--text-2)]">{s.business}</p></Section>
          {s.financials && <Section title="Financials"><p className="text-[13px] leading-relaxed text-[var(--text-2)]">{s.financials}</p></Section>}
          {s.useOfProceeds && <Section title="Use of proceeds"><p className="text-[13px] leading-relaxed text-[var(--text-2)]">{s.useOfProceeds}</p></Section>}
          {s.risks.length > 0 && (
            <Section title="Key risks">
              <ul className="space-y-1">{s.risks.map((r, i) => <li key={i} className="flex gap-1.5 text-[13px] text-[var(--text-3)]"><span className="text-[#ef4444]">▸</span>{r}</li>)}</ul>
            </Section>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-[13px] text-[var(--text-3)]">No prospectus summary on file yet — it&apos;s generated on the nightly run.</div>
      )}

      <div className="mt-4 text-[12px] text-[var(--text-4)]">
        {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">Read the SEC prospectus ↗</a>}
        <span> · AI summary of the S-1 / 424B4 prospectus — decision support, not advice.</span>
      </div>
    </main>
  );
}
