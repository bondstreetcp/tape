"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { parsePositions } from "@/lib/portfolio";
import type { TenorId } from "@/lib/putwrite"; // type-only — lib/putwrite pulls fs, can't value-import client-side
import { buildPortfolioIncome, type IncomeCandidate } from "@/lib/portfolioIncome";
import InfoDot from "./InfoDot";
import UniverseSwitcher from "./UniverseSwitcher";
import MyBookTabs from "./MyBookTabs";
import HowToRead from "./HowToRead";

const STORE_KEY = "tape.portfolio.positions"; // shared with the Cockpit + Radar
// Display list for the tenor toggle (id + label only) — mirrors lib/putwrite's PUT_TENORS, inlined
// because that module can't be value-imported client-side (it pulls fs for its loader).
const TENORS: { id: TenorId; short: string; note: string }[] = [
  { id: "m1", short: "~1M", note: "≈30Δ call · 30–45 DTE — more premium, tighter cap" },
  { id: "m3", short: "~3M", note: "≈20Δ call · ~3-month — less premium, more upside room" },
];
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
// CallSuggestion's yield/cap fields are ALREADY percentages (annPct 24.3 = 24.3%), unlike delta which
// is a fraction — so append "%" without re-multiplying (matches CoveredCallView's `pct` helper).
const apct = (n: number) => `${n.toFixed(0)}%`;
const spct = (n: number) => `${n.toFixed(1)}%`;

export default function PortfolioIncome({ universe, candidates, generatedAt }: { universe: string; candidates: IncomeCandidate[]; generatedAt: string }) {
  const [text, setText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [tenor, setTenor] = useState<TenorId>("m1");

  useEffect(() => {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw != null) setText(raw); } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) try { localStorage.setItem(STORE_KEY, text); } catch { /* ignore */ } }, [text, hydrated]);

  const positions = useMemo(() => parsePositions(text), [text]);
  const result = useMemo(() => buildPortfolioIncome(positions, candidates, tenor), [positions, candidates, tenor]);
  const hasBook = positions.length > 0;
  const tenorMeta = TENORS.find((t) => t.id === tenor)!;

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Portfolio Options Income</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            How much you could collect writing <b>covered calls</b> on the shares you already own — sized in real dollars for your position, with the yield if the shares get called away. Suggestions from the nightly options scan · {fmtDateTime(generatedAt)}. Your book stays in your browser.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <MyBookTabs universe={universe} current="/portfolio-income" />

      <HowToRead>
        <p><b>What&apos;s here:</b> for each LONG in your book that&apos;s in the options-quality universe, the best out-of-the-money covered call at the chosen tenor — the premium you collect up front (per share and in total dollars for your lot), the annualized income yield, and the total return if the stock rises through the strike and your shares are called away.</p>
        <p><b>Tenor:</b> <b>~1-month</b> writes a ~30-delta call (more premium, less upside room); <b>~3-month</b> a ~20-delta call (less premium, more room to run). <b>Shorts are excluded</b> — you need the shares to cover. Odd lots under 100 shares show the per-share yield but can&apos;t write a standard contract.</p>
        <p><b>⚠ Earnings-in-window</b> flags a holding whose next earnings print lands before the call expires — writing through earnings collects fat premium but takes gap-and-assignment risk (cross-check the <Link href={`/u/${universe}/portfolio-radar`} className="text-[var(--accent)] hover:underline">Catalyst Radar</Link>). Every strike, premium and yield comes from the scan; nothing is invented. US options universe. Not advice.</p>
      </HowToRead>

      {/* Book input */}
      <details className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" open={!hasBook}>
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-2)]">Your book {hasBook ? <span className="text-[var(--text-4)]">· click to edit</span> : <span className="text-[var(--text-4)]">· paste to begin</span>}</summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"AAPL 300\nMSFT 100\nTSLA -50   (short — excluded)"}
          className="mt-2 h-40 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 font-mono text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent)]/60"
        />
        <p className="mt-1 text-[11px] text-[var(--text-4)]">One position per line: <span className="font-mono">TICKER shares</span>. Shared with the <Link href={`/u/${universe}/portfolio`} className="text-[var(--accent)] hover:underline">Cockpit</Link> &amp; <Link href={`/u/${universe}/portfolio-radar`} className="text-[var(--accent)] hover:underline">Radar</Link>.</p>
      </details>

      {!hasBook ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-12 text-center text-[13px] text-[var(--text-3)]">Paste your holdings above to see the covered-call income on your longs.</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              {TENORS.map((t) => (
                <button key={t.id} onClick={() => setTenor(t.id)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (tenor === t.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")} title={t.note}>{t.short} call</button>
              ))}
            </div>
            <span className="text-[var(--text-3)]"><b className="text-[var(--text)]">{usd(result.totalPremium)}</b> premium up front across <b className="text-[var(--text)]">{result.coveredLongs}</b> of {result.totalLongs} longs <span className="text-[var(--text-4)]">({tenorMeta.short})</span></span>
          </div>

          {result.rows.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-3)]">None of your longs are in the options-quality universe at this tenor.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Holding</th>
                    <th className="px-2 py-2 text-right font-medium">Shares</th>
                    <th className="px-2 py-2 font-medium">Sell call</th>
                    <th className="px-2 py-2 text-right font-medium"><span className="inline-flex items-center gap-0.5">Premium $<InfoDot text="Cash collected up front = premium per share × 100 × contracts (floor of shares/100)." /></span></th>
                    <th className="px-2 py-2 text-right font-medium"><span className="inline-flex items-center gap-0.5">Ann. yield<InfoDot text="Static income return (premium ÷ price) annualized — what you earn if the stock is flat and you keep re-writing." /></span></th>
                    <th className="px-2 py-2 text-right font-medium"><span className="inline-flex items-center gap-0.5">If called<InfoDot text="Total annualized return if the stock rises through the strike and the shares are assigned away (premium + upside to strike)." /></span></th>
                    <th className="px-2 py-2 text-right font-medium"><span className="inline-flex items-center gap-0.5">Upside cap<InfoDot text="Room the stock can rise before your shares are called away (strike vs current price)." /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className="px-3 py-2.5">
                        <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=options`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                        <div className="max-w-[200px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                        {r.earningsBeforeExpiry && <span className="mt-0.5 inline-block rounded bg-[#f59e0b]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#f59e0b]" title={`Earnings ${r.nextEarnings ? fmtDate(r.nextEarnings) : ""}${r.earningsEstimate ? " (est)" : ""} lands before this call expires`}>⚠ earnings in window</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text-2)]">{r.shares.toLocaleString()}<div className="text-[10px] text-[var(--text-4)]">{r.oddLot ? "odd lot" : `${r.contracts} contract${r.contracts === 1 ? "" : "s"}`}</div></td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-[12px] text-[var(--text-2)]">${r.call.strike} <span className="text-[var(--text-4)]">· {fmtDate(r.call.expiry)} · {r.call.dte}d · {(r.call.delta * 100).toFixed(0)}Δ</span><div className="text-[10px] text-[var(--text-4)]">${r.call.premium.toFixed(2)}/sh {r.call.premiumSrc === "last" ? "(last)" : ""}</div></td>
                      <td className="px-2 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">{r.oddLot ? <span className="text-[var(--text-4)]">—</span> : usd(r.premiumDollars)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums" style={{ color: "#22c55e" }}>{apct(r.call.annPct)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text-2)]">{apct(r.call.ifCalledAnnPct)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text-3)]">+{spct(r.call.capPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-[var(--text-4)]">
            {result.uncovered.length > 0 && <p>No covered-call suggestion for {result.uncovered.length} of your longs (outside the options-quality screen — mkt-cap &gt; $500M, ROE &gt; 15%, P/E &lt; 25): <span className="font-mono">{result.uncovered.slice(0, 30).join(", ")}{result.uncovered.length > 30 ? " …" : ""}</span></p>}
            {result.shortsExcluded > 0 && <p>{result.shortsExcluded} short position{result.shortsExcluded === 1 ? "" : "s"} excluded — a covered call needs long shares to write against.</p>}
            <p>Premiums are the mid (or last trade when the market&apos;s closed) from the nightly scan and will differ from the live quote. Decision-support, not advice.</p>
          </div>
        </>
      )}
    </main>
  );
}
