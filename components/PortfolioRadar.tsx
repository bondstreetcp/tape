"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { parsePositions } from "@/lib/portfolio";
import { KIND_META, type CatalystEvent } from "@/lib/catalystCalendar";
import { buildPortfolioCatalysts, type Impact, type PortfolioCatalyst, type SnapshotEarnings } from "@/lib/portfolioCatalysts";
import UniverseSwitcher from "./UniverseSwitcher";
import HowToRead from "./HowToRead";

// Same book the Portfolio Cockpit saves — so paste it in either place and both stay in sync.
const STORE_KEY = "tape.portfolio.positions";
const LONG = "#22c55e", SHORT = "#ef4444";
const IMPACT_META: Record<Impact, { label: string; color: string }> = {
  high: { label: "High", color: "#ef4444" },
  medium: { label: "Med", color: "#f59e0b" },
  low: { label: "Low", color: "#6b7280" },
};
const bucketOf = (d: number) => (d <= 7 ? "This week" : d <= 30 ? "This month" : "Later (≤120d)");

export default function PortfolioRadar({ universe, events, earningsDates, generatedAt }: { universe: string; events: CatalystEvent[]; earningsDates: Record<string, SnapshotEarnings>; generatedAt: string }) {
  const [text, setText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [highOnly, setHighOnly] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw != null) setText(raw); } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) try { localStorage.setItem(STORE_KEY, text); } catch { /* ignore */ }
  }, [text, hydrated]);

  const positions = useMemo(() => parsePositions(text), [text]);
  const result = useMemo(() => buildPortfolioCatalysts(positions, events, { earningsDates }), [positions, events, earningsDates]);
  const shown = useMemo(() => (highOnly ? result.catalysts.filter((c) => c.impact === "high") : result.catalysts), [result, highOnly]);

  // group the shown list into urgency buckets, preserving the soonest-first order
  const groups = useMemo(() => {
    const g = new Map<string, PortfolioCatalyst[]>();
    for (const c of shown) { const b = bucketOf(c.daysTo); (g.get(b) ?? g.set(b, []).get(b)!).push(c); }
    return [...g.entries()];
  }, [shown]);

  const hasBook = positions.length > 0;

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Portfolio Catalyst Radar</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            What&apos;s live in <i>your</i> book — every forward catalyst on a name you hold, on one timeline, with the position side attached. Feeds as of {fmtDateTime(generatedAt)}. Your book stays in your browser.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What&apos;s here:</b> your pasted holdings joined to the forward Catalyst Calendar — earnings (with the options-implied move), investor days, biotech/FDA readouts, and IPO-lockup expiries. Only names you own show up, soonest first.</p>
        <p><b>Side matters:</b> a catalyst on a <span style={{ color: LONG }}>long</span> and the same catalyst on a <span style={{ color: SHORT }}>short</span> are opposite risks — an FDA readout you&apos;re short into is a binary <i>against</i> you. <b>Impact</b> is highest for binary clinical/regulatory events, then earnings with a big implied move; lockups are a supply overhang.</p>
        <p><b>Private + grounded:</b> the book never leaves the browser (it&apos;s read from the same local store as the Portfolio Cockpit). Every date and implied move comes from the underlying feeds — nothing is invented. US-market catalysts. Decision-support, not advice.</p>
      </HowToRead>

      {/* Book input */}
      <details className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" open={!hasBook}>
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-2)]">Your book {hasBook ? <span className="text-[var(--text-4)]">· {result.totalOwned} names (click to edit)</span> : <span className="text-[var(--text-4)]">· paste to begin</span>}</summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"AAPL 100\nMSFT 60\nTSLA -50   (short)"}
          className="mt-2 h-40 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 font-mono text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent)]/60"
        />
        <p className="mt-1 text-[11px] text-[var(--text-4)]">One position per line: <span className="font-mono">TICKER shares</span> — negative shares = short. Shared with the <Link href={`/u/${universe}/portfolio`} className="text-[var(--accent)] hover:underline">Portfolio Cockpit</Link>.</p>
      </details>

      {!hasBook ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-12 text-center text-[13px] text-[var(--text-3)]">Paste your holdings above to see every forward catalyst in your book.</div>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <span><b className="text-[var(--text)]">{result.catalysts.length}</b> <span className="text-[var(--text-3)]">catalysts across</span> <b className="text-[var(--text)]">{result.ownedWithCatalysts}</b> <span className="text-[var(--text-3)]">of your {result.totalOwned} names</span></span>
            {result.highNext30 > 0 && <span style={{ color: "#ef4444" }}><b>{result.highNext30}</b> high-impact in 30d</span>}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-3)]">
              <input type="checkbox" checked={highOnly} onChange={(e) => setHighOnly(e.target.checked)} className="accent-[var(--accent)]" /> High-impact only
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-3)]">No {highOnly ? "high-impact " : ""}catalysts in your book in the next 120 days.</div>
          ) : (
            <div className="space-y-4">
              {groups.map(([bucket, rows]) => (
                <div key={bucket}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{bucket} <span className="font-normal">· {rows.length}</span></div>
                  <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                    {rows.map((c, i) => (
                      <div key={`${c.ticker}-${c.kind}-${c.date}-${i}`} className="flex items-center gap-3 border-b border-[var(--divider)] px-3 py-2 last:border-0 hover:bg-[var(--surface-2)]">
                        <div className="w-14 shrink-0 text-right">
                          <div className="text-[15px] font-bold tabular-nums text-[var(--text)]">{c.daysTo}<span className="text-[10px] font-normal text-[var(--text-4)]">d</span></div>
                          <div className="text-[10px] text-[var(--text-4)]">{fmtDate(c.date)}</div>
                        </div>
                        <div className="w-12 shrink-0">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ color: c.side === "long" ? LONG : SHORT, background: `color-mix(in oklab, ${c.side === "long" ? LONG : SHORT} 15%, transparent)` }}>{c.side === "long" ? "LONG" : "SHORT"}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/u/${universe}/stock/${c.ticker}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{c.ticker}</Link>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color: KIND_META[c.kind].color, background: `color-mix(in oklab, ${KIND_META[c.kind].color} 14%, transparent)` }}>{c.label}</span>
                            {c.detail && <span className="text-[11px] text-[var(--text-4)]">{c.detail}</span>}
                          </div>
                          <div className="truncate text-[11px] text-[var(--text-4)]">{c.company}</div>
                        </div>
                        <div className="shrink-0">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: IMPACT_META[c.impact].color, background: `color-mix(in oklab, ${IMPACT_META[c.impact].color} 15%, transparent)` }} title="Higher for binary clinical/regulatory events and big implied moves">{IMPACT_META[c.impact].label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.quietNames.length > 0 && (
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-4)]">
              No forward catalyst in the next 120 days for {result.quietNames.length} of your names: <span className="font-mono">{result.quietNames.slice(0, 30).join(", ")}{result.quietNames.length > 30 ? " …" : ""}</span>
            </p>
          )}
        </>
      )}
    </main>
  );
}
