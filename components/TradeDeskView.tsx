"use client";
import Link from "next/link";
import type { TradeDeskData } from "@/lib/tradeIdeas";
import { sideLabel, sideColor, convColor } from "@/lib/tradeIdeas";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

export default function TradeDeskView({ universe, data }: { universe: string; data: TradeDeskData }) {
  const ideas = data.ideas || [];
  const narrated = ideas.some((i) => i.thesis);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Trade Desk — this week&apos;s option mispricings</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The best <b>code-detected</b> options mispricings this week — expensive/cheap straddles into a print <InfoDot term="Expected move" />, rich/cheap vol vs realized <InfoDot term="Variance premium" />, and cheap options into a scheduled catalyst <InfoDot term="Catalyst vol" />. <b>Code finds and prices the edge and picks the structure</b>; the AI only writes the thesis, the risk, and flags <b>traps</b> — it never invents a number.{data.weekOf ? ` Week of ${data.weekOf}.` : ""} Chosen from {data.pool} candidates · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>Where the ideas come from:</b> every night the code scans three feeds — (1) names reporting earnings in the next <b>16 days</b> whose options price far more or less movement than the stock&apos;s own history of earnings moves, (2) scheduled catalysts (investor days &amp;c.) with cheap straddles, and (3) standing vol dislocations (implied vol ≥1.6× or ≤0.9× what the stock actually moves).</p>
        <p><b>How the shortlist forms:</b> candidates clearing those thresholds are scored deterministically and pooled (up to ~16, deduped); the AI then narrates the top handful — it writes the thesis and the risk, but <b>every number was computed by code first</b>. That&apos;s why the list is short: it&apos;s the survivors of hard filters, not a ranking of everything.</p>
        <p><b>The numbers on each card</b> are the triggering stat — e.g. &quot;±6.2% implied vs ±3.1% historical&quot; means options price a 6.2% earnings move where the stock has averaged 3.1%. <b>⚠ trap</b> flags a &quot;cheap&quot; straddle that may just reflect a known binary already priced elsewhere.</p>
      </HowToRead>

      {!ideas.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">
          No trade ideas yet — the desk builds on the nightly options feeds. Check back after the next refresh.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {ideas.map((i, idx) => (
            <div key={i.symbol + idx} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div>
                  <Link href={`/u/${universe}/stock/${i.symbol}`} className="text-base font-bold text-[var(--accent)] hover:underline">{i.symbol}</Link>
                  <span className="ml-2 text-[12px] text-[var(--text-4)]">{i.name}</span>
                  {i.sector && i.sector !== "—" && <div className="text-[11px] text-[var(--text-4)]">{i.sector}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {i.trap && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: "#f59e0b", background: "#f59e0b1f" }} title="The edge may just be pricing a known pending event — not a free mispricing.">⚠ trap</span>}
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: sideColor(i.side), background: `color-mix(in oklab, ${sideColor(i.side)} 15%, transparent)` }}>{sideLabel(i.side)}</span>
                  {i.conviction && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: convColor(i.conviction) }} title="AI conviction on the setup">{i.conviction}</span>}
                </div>
              </div>

              <div className="text-[14px] font-semibold" style={{ color: sideColor(i.side) }}>{i.structure}</div>
              <div className="mt-0.5 font-mono text-[12px] tabular-nums text-[var(--text-2)]">{i.stat}</div>
              {i.event && <div className="mt-0.5 text-[11px] text-[var(--text-4)]">{i.event}</div>}

              {i.thesis && <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-2)]">{i.thesis}</p>}
              {i.risk && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-3)]">
                  <span className="font-semibold text-[var(--text-2)]">Risk:</span> {i.risk}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        {narrated ? `AI-narrated (${data.model?.split("/").pop() ?? "LLM"}) over code-detected signals — ` : "Code-detected signals — "}
        the ticker, structure and stat are computed by code from the options chain (vendor IV treated as junk); the AI selects the shortlist and writes the thesis/risk, grounded only in those numbers. A <b>trap</b> flag means the rich/cheap vol may simply be pricing a known event. Research / decision-support, not investment advice — verify liquidity and the catalyst before trading.
      </p>
    </main>
  );
}
