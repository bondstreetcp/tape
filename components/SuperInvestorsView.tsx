"use client";
import { fmtDate } from "@/lib/format";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { SuperInvestorsData, InvestorPortfolio, Holding } from "@/lib/superinvestors";
import type { ThirteenFStory } from "@/lib/thirteenFStory";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

const big = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`);
const MOST = "__most__";

function ChangeBadge({ h }: { h: Holding }) {
  if (h.change === "new") return <span className="rounded bg-[#22c55e]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#22c55e]">NEW</span>;
  if (h.change === "hold" || h.deltaPct == null) return <span className="text-[var(--text-4)]">—</span>;
  const up = h.deltaPct > 0;
  return <span className="text-[11px] font-medium tabular-nums" style={{ color: up ? "#22c55e" : "#ef4444" }}>{up ? "+" : ""}{(h.deltaPct * 100).toFixed(0)}%</span>;
}

export default function SuperInvestorsView({ universe, data, known, story }: { universe: string; data: SuperInvestorsData; known: string[]; story?: ThirteenFStory | null }) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [sel, setSel] = useState<string>(data.investors[0]?.slug ?? MOST);
  const [showAll, setShowAll] = useState(false);

  const tlink = (ticker: string | null, label?: React.ReactNode) => {
    const text = label ?? ticker;
    if (ticker && knownSet.has(ticker)) return <Link href={`/u/${universe}/stock/${encodeURIComponent(ticker)}`} className="text-[var(--accent)] hover:underline">{text}</Link>;
    return <span>{text}</span>;
  };

  const inv: InvestorPortfolio | undefined = data.investors.find((i) => i.slug === sel);
  const nameOf = (slug: string) => data.investors.find((i) => i.slug === slug)?.manager ?? slug;

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Super-Investors</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">What legendary value managers own — from their latest SEC 13F filings (U.S. long equity, filed ~45 days after quarter-end).</p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {story && story.tldr && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text)]">This quarter's story</span>
            {story.asOf && <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--text-3)]">Q ending {story.asOf}</span>}
            <span className="text-[10px] text-[var(--text-4)]">· AI synthesis of the roster's consensus 13F moves</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{story.tldr}</p>
          {story.themes.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {story.themes.map((t, i) => (
                <div key={i} className="rounded-lg border border-[var(--divider)] bg-[var(--bg)] p-2.5">
                  <div className="text-xs font-semibold text-[var(--text)]">{t.heading}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-3)]">{t.detail}</div>
                  {t.tickers.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.tickers.map((tk) => (
                        <span key={tk} className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-2)]">{tlink(tk)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* left rail */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5">
          <button onClick={() => setSel(MOST)} className={"mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " + (sel === MOST ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-2)] hover:bg-[var(--surface-hover)]")}>
            <span className="text-[#f59e0b]">★</span> <span className="font-semibold">Most owned</span>
            <span className="ml-auto text-[11px] text-[var(--text-4)]">{data.mostOwned.length}</span>
          </button>
          <div className="max-h-[70vh] overflow-auto">
            {data.investors.map((i) => (
              <button key={i.slug} onClick={() => { setSel(i.slug); setShowAll(false); }} className={"flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors " + (sel === i.slug ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[var(--text)]">{i.manager}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-4)]">{big(i.totalValue)}</span>
                </span>
                <span className="truncate text-[11px] text-[var(--text-3)]">{i.name} · {i.count} positions</span>
              </button>
            ))}
          </div>
          <p className="px-2.5 py-2 text-[10px] text-[var(--text-4)]">As of {fmtDate(data.generatedAt)}. 13F is a lagged, long-only snapshot.</p>
        </div>

        {/* detail */}
        <div className="min-w-0">
          {sel === MOST ? (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] p-4">
                <h2 className="text-lg font-semibold">Most owned by super-investors</h2>
                <p className="mt-0.5 text-xs text-[var(--text-3)]">Names held across the most portfolios — a high-conviction overlap list. Click a ticker for the full page.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                      <th className="px-4 py-2 text-left font-medium">#</th>
                      <th className="px-4 py-2 text-left font-medium">Ticker</th>
                      <th className="px-4 py-2 text-left font-medium">Company</th>
                      <th className="px-4 py-2 text-right font-medium">Held by</th>
                      <th className="px-4 py-2 text-left font-medium">Holders</th>
                      <th className="px-4 py-2 text-right font-medium">Total value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mostOwned.map((m, i) => (
                      <tr key={m.cusip} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-2 text-[var(--text-4)] tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2 font-mono font-semibold">{tlink(m.ticker)}</td>
                        <td className="max-w-[16rem] truncate px-4 py-2 text-[var(--text-2)]">{m.name}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{m.holderCount}</td>
                        <td className="max-w-[18rem] truncate px-4 py-2 text-[11px] text-[var(--text-3)]">{m.holders.map(nameOf).join(", ")}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--text-2)]">{big(m.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : inv ? (
            <div className="space-y-4">
              {/* summary */}
              <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{inv.manager} <span className="font-normal text-[var(--text-3)]">· {inv.name}</span></h2>
                  <span className="text-xs text-[var(--text-4)]">13F as of {inv.asOf} · filed {inv.filedAt}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--text-3)]">{inv.blurb}</p>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span><span className="text-[var(--text-4)]">Portfolio </span><span className="font-semibold tabular-nums">{big(inv.totalValue)}</span></span>
                  <span><span className="text-[var(--text-4)]">Positions </span><span className="font-semibold tabular-nums">{inv.count}</span></span>
                  <span><span className="text-[var(--text-4)]">Top 10 </span><span className="font-semibold tabular-nums">{inv.holdings.slice(0, 10).reduce((s, h) => s + h.pct, 0).toFixed(0)}%</span></span>
                </div>
                {/* activity */}
                {(inv.newBuys.length > 0 || inv.soldOut.length > 0) && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {inv.newBuys.length > 0 && (
                      <div className="rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/[0.05] p-2.5">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#22c55e]">New buys</div>
                        <div className="flex flex-wrap gap-1.5">{inv.newBuys.map((b, k) => <span key={k} className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs">{tlink(b.ticker, <span className="font-mono">{b.ticker ?? b.name}</span>)} <span className="text-[var(--text-4)]">{b.pct.toFixed(1)}%</span></span>)}</div>
                      </div>
                    )}
                    {inv.soldOut.length > 0 && (
                      <div className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/[0.05] p-2.5">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#ef4444]">Sold out</div>
                        <div className="flex flex-wrap gap-1.5">{inv.soldOut.slice(0, 12).map((b, k) => <span key={k} className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs">{tlink(b.ticker, <span className="font-mono">{b.ticker ?? b.name}</span>)}</span>)}</div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* holdings */}
              <section className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                      <th className="px-4 py-2 text-left font-medium">#</th>
                      <th className="px-4 py-2 text-left font-medium">Ticker</th>
                      <th className="px-4 py-2 text-left font-medium">Company</th>
                      <th className="px-4 py-2 text-right font-medium">% Port</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                      <th className="px-4 py-2 text-right font-medium">Q/Q</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? inv.holdings : inv.holdings.slice(0, 25)).map((h, i) => (
                      <tr key={h.cusip} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-1.5 text-[var(--text-4)] tabular-nums">{i + 1}</td>
                        <td className="px-4 py-1.5 font-mono font-semibold">{tlink(h.ticker)}</td>
                        <td className="max-w-[18rem] truncate px-4 py-1.5 text-[var(--text-2)]">{h.name}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{h.pct.toFixed(1)}%</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-[var(--text-2)]">{big(h.value)}</td>
                        <td className="px-4 py-1.5 text-right"><ChangeBadge h={h} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {inv.holdings.length > 25 && (
                  <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-[var(--border)] py-2 text-xs text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
                    {showAll ? "Show top 25" : `Show all ${inv.holdings.length} positions`}
                  </button>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
