"use client";
import { useEffect, useState } from "react";
import type { CompanyStats } from "@/lib/companyStats";
import type { StockRow } from "@/lib/types";

interface DataPart {
  reaction: { avgAbsMove: number; maxAbsMove: number; upRate: number; n: number } | null;
  events: { date: string; surprise: number | null; move: number | null; drift5: number | null }[];
  impliedMove: number | null; // percent (e.g. 7.8)
  options: { expiry: string | null; atmIV: number | null; skew: number | null; maxPain: number | null; maxPainVsSpot: number | null; callWall: { strike: number; oi: number } | null; putWall: { strike: number; oi: number } | null } | null;
  richness: { ratio: number; verdict: "rich" | "cheap" | "fair"; avgRealized: number } | null;
  straddle: { cost: number; upperBE: number; lowerBE: number; price: number } | null;
  straddleWinRate: { exceeded: number; total: number } | null;
  pead: { avgBeatDrift5: number | null; avgMissDrift5: number | null; followThrough: number; n: number } | null;
}
interface AiPart {
  moneyLine: string;
  overview: string;
  watch: string[];
  guidance: string;
  peerReads: string[];
  bull: string;
  bear: string;
  fromLastCall: string;
}

const pp = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`); // decimal → %
const fmtRev = (v: number | null | undefined) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`);
const col = (v: number | null) => (v == null ? "var(--text-2)" : v >= 0 ? "#22c55e" : "#ef4444");

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] leading-tight text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

export default function EarningsPrep({ symbol, stats, earningsDate, row }: { symbol: string; stats: CompanyStats | null; earningsDate?: string | null; row?: StockRow | null }) {
  const [data, setData] = useState<DataPart | null | "loading">("loading");
  const [ai, setAi] = useState<AiPart | null | "idle" | "loading">("idle");

  useEffect(() => {
    let a = true;
    setData("loading");
    setAi("idle");
    fetch(`/api/earnings-prep/${encodeURIComponent(symbol)}?part=data`)
      .then((r) => r.json())
      .then((d) => a && setData(d.data || null))
      .catch(() => a && setData(null));
    return () => { a = false; };
  }, [symbol]);

  const runAi = () => {
    setAi("loading");
    fetch(`/api/earnings-prep/${encodeURIComponent(symbol)}?part=ai`)
      .then((r) => r.json())
      .then((d) => setAi(d.ai || null))
      .catch(() => setAi(null));
  };

  if (!stats) return null;
  const q0 = stats.estimates?.find((e) => e.period === "0q") || stats.estimates?.[0] || null;
  const days = earningsDate ? Math.round((Date.parse(earningsDate) - Date.now()) / 86_400_000) : null;
  const dateLabel = earningsDate && !Number.isNaN(Date.parse(earningsDate)) ? new Date(earningsDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const revPct = q0 && q0.epsCurrent != null && q0.eps90dAgo != null && q0.eps90dAgo !== 0 ? (q0.epsCurrent / q0.eps90dAgo - 1) * 100 : null;
  const sp = stats.surprises.map((s) => s.surprisePercent).filter((x): x is number => x != null);
  const beatRate = sp.length ? sp.filter((x) => x > 0).length / sp.length : null;
  const avgSurprise = sp.length ? sp.reduce((a, x) => a + x, 0) / sp.length : null;

  // #2 sell-side positioning
  const r = stats.ratings;
  const buys = r ? r.strongBuy + r.buy : null;
  const sells = r ? r.sell + r.strongSell : null;
  const upside = stats.targetMean != null && stats.price ? stats.targetMean / stats.price - 1 : null;
  // #3 short trend
  const shortMoM = stats.sharesShort != null && stats.sharesShortPriorMonth ? stats.sharesShort / stats.sharesShortPriorMonth - 1 : null;
  // #6 comp (year-ago quarter actual ≈ oldest of the recent reported quarters)
  const compEps = stats.surprises.length ? stats.surprises[0].actual : null;

  const d = typeof data === "object" ? data : null;
  // #4 conditional reaction (beats vs misses) from the event history
  const ev = d?.events || [];
  const beatMoves = ev.filter((e) => e.surprise != null && e.surprise > 0 && e.move != null).map((e) => e.move as number);
  const missMoves = ev.filter((e) => e.surprise != null && e.surprise <= 0 && e.move != null).map((e) => e.move as number);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const a = typeof ai === "object" ? ai : null;
  // pre-earnings setup (run-up into the print + distance from 52wk high) — returns are in % units
  const r1w = row?.returns?.["1w"] ?? null;
  const r3m = row?.returns?.["3m"] ?? null;
  const fromHigh = row?.pctFromHigh ?? null;

  return (
    <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">Earnings prep</h3>
        {dateLabel && <span className="text-xs text-[var(--text-3)]">{days != null && days >= 0 ? `reports ${dateLabel} · in ${days}d` : `next/last report ${dateLabel}`}</span>}
      </div>

      {/* #2 pre-earnings setup — how it's positioned going in */}
      {row && (r1w != null || r3m != null || fromHigh != null) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-3)]">
          <span className="text-[var(--text-4)]">Setup into the print:</span>
          {r1w != null && <span>1wk <b style={{ color: col(r1w) }}>{r1w >= 0 ? "+" : ""}{r1w.toFixed(1)}%</b></span>}
          {r3m != null && <span>3mo <b style={{ color: col(r3m) }}>{r3m >= 0 ? "+" : ""}{r3m.toFixed(1)}%</b></span>}
          {fromHigh != null && <span><b className="text-[var(--text-2)]">{fromHigh >= -1.5 ? "at" : `${Math.abs(fromHigh).toFixed(0)}% below`}</b> 52wk high</span>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Consensus EPS (this Q)" value={q0?.epsAvg != null ? `$${q0.epsAvg.toFixed(2)}` : "—"} sub={q0?.epsAnalysts && q0.epsLow != null && q0.epsHigh != null ? `${q0.epsAnalysts} est · $${q0.epsLow.toFixed(2)}–$${q0.epsHigh.toFixed(2)}` : undefined} />
        <Stat label="Consensus revenue" value={fmtRev(q0?.revAvg)} sub={q0?.growth != null ? `${pp(q0.growth, 0)} YoY${compEps != null ? ` · yr-ago EPS $${compEps.toFixed(2)}` : ""}` : undefined} />
        <Stat label="Estimate trend (90d)" value={revPct != null ? `${revPct >= 0 ? "+" : ""}${revPct.toFixed(1)}%` : "—"} color={revPct != null ? (revPct >= 0 ? "#22c55e" : "#ef4444") : undefined} sub={q0 ? `${q0.epsUp30d ?? 0}↑ / ${q0.epsDown30d ?? 0}↓ revisions (30d)` : undefined} />
        <Stat label="Options-implied move" value={d?.impliedMove != null ? `±${d.impliedMove.toFixed(1)}%` : data === "loading" ? "…" : "—"} sub={d?.reaction ? `avg past ±${(d.reaction.avgAbsMove * 100).toFixed(1)}% (${d.reaction.n})` : undefined} />
      </div>

      {/* #1 options rich/cheap + straddle breakevens + win-rate */}
      {(d?.richness || d?.straddle || d?.straddleWinRate) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--text-3)]">
          {d.richness && (() => {
            const v = d.richness.verdict, vc = v === "rich" ? "#ef4444" : v === "cheap" ? "#22c55e" : "var(--text-2)";
            return <span><b style={{ color: vc }}>Options {v === "rich" ? "RICH" : v === "cheap" ? "CHEAP" : "fairly priced"}</b> — pricing ±{d!.impliedMove!.toFixed(1)}% vs ~±{d.richness.avgRealized.toFixed(1)}% realized <span className="text-[var(--text-4)]">({d.richness.ratio.toFixed(2)}×{v === "rich" ? " · sell premium" : v === "cheap" ? " · buy the move" : ""})</span></span>;
          })()}
          {d.straddleWinRate && d.straddleWinRate.total >= 4 && <span title="How often the realized move EXCEEDED the current implied move, over the last N prints — low = options rich (the straddle's been a sell)"><b className="text-[var(--text-2)]">Realized &gt; implied</b> {d.straddleWinRate.exceeded}/{d.straddleWinRate.total} ({Math.round((d.straddleWinRate.exceeded / d.straddleWinRate.total) * 100)}%)</span>}
          {d.straddle && <span title="Straddle breakevens = price ± the implied move; the stock must close beyond these for a long straddle to pay"><b className="text-[var(--text-2)]">Breakevens</b> ${d.straddle.lowerBE.toFixed(2)} / ${d.straddle.upperBE.toFixed(2)} <span className="text-[var(--text-4)]">· straddle ~${d.straddle.cost.toFixed(2)}</span></span>}
        </div>
      )}

      {/* positioning + track record */}
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--text-3)]">
        {beatRate != null && <span><b className="text-[var(--text-2)]">Beat rate</b> {(beatRate * 100).toFixed(0)}% of {sp.length}q{avgSurprise != null ? ` · avg surprise ${pp(avgSurprise, 1)}` : ""}</span>}
        {buys != null && sells != null && <span><b className="text-[var(--text-2)]">Sell-side</b> {buys} buy / {r!.hold} hold / {sells} sell{upside != null ? ` · PT ${pp(upside, 0)}` : ""}</span>}
        {stats.shortPercentOfFloat != null && <span><b className="text-[var(--text-2)]">Short</b> {(stats.shortPercentOfFloat * 100).toFixed(1)}% float{shortMoM != null ? ` (${shortMoM >= 0 ? "↑" : "↓"}${Math.abs(shortMoM * 100).toFixed(0)}% MoM)` : ""}{stats.shortRatio != null ? ` · ${stats.shortRatio.toFixed(1)}d cover` : ""}</span>}
        {stats.forwardPE != null && <span><b className="text-[var(--text-2)]">Fwd P/E</b> {stats.forwardPE.toFixed(0)}</span>}
      </div>

      {/* #1 reaction history + #4 conditional moves */}
      {ev.length > 0 && (
        <div className="mt-3 border-t border-[var(--divider)] pt-3">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Past prints — surprise → 1-day move</span>
            {(avg(beatMoves) != null || avg(missMoves) != null) && (
              <span className="text-[10px] text-[var(--text-3)]">
                {avg(beatMoves) != null && <>beats avg <b style={{ color: col(avg(beatMoves)) }}>{pp(avg(beatMoves))}</b></>}
                {avg(missMoves) != null && <> · misses avg <b style={{ color: col(avg(missMoves)) }}>{pp(avg(missMoves))}</b></>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ev.map((e, i) => (
              <span key={i} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[10px] tabular-nums" title={e.date}>
                <span className="text-[var(--text-4)]">{e.date.slice(2, 7)}</span>{" "}
                {e.surprise != null && <span style={{ color: col(e.surprise) }}>{pp(e.surprise, 0)}</span>}{" → "}
                {e.move != null ? <span style={{ color: col(e.move) }}>{pp(e.move)}</span> : "—"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* #3 post-earnings drift (PEAD) */}
      {d?.pead && (
        <div className="mt-2 text-[11px] text-[var(--text-3)]" title="Post-earnings drift: the stock's return over the 5 sessions AFTER the initial reaction — does the move continue or fade?">
          <b className="text-[var(--text-2)]">Post-print drift (5d)</b>{" "}
          {d.pead.avgBeatDrift5 != null && <>after beats <b style={{ color: col(d.pead.avgBeatDrift5) }}>{pp(d.pead.avgBeatDrift5)}</b></>}
          {d.pead.avgMissDrift5 != null && <> · after misses <b style={{ color: col(d.pead.avgMissDrift5) }}>{pp(d.pead.avgMissDrift5)}</b></>}
          <span className="text-[var(--text-4)]"> · move follows through {Math.round(d.pead.followThrough * 100)}% of {d.pead.n}</span>
        </div>
      )}

      {/* #5 options positioning */}
      {d?.options && (d.options.skew != null || d.options.maxPain != null || d.options.callWall != null) && (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--text-3)]">
          {d.options.atmIV != null && <span><b className="text-[var(--text-2)]">ATM IV</b> {(d.options.atmIV * 100).toFixed(0)}%</span>}
          {d.options.skew != null && <span title="ATM put IV minus call IV — positive = downside hedging bid"><b className="text-[var(--text-2)]">Skew</b> <span style={{ color: d.options.skew > 0 ? "#ef4444" : "#22c55e" }}>{d.options.skew > 0 ? "puts bid" : "calls bid"} {(Math.abs(d.options.skew) * 100).toFixed(1)}pt</span></span>}
          {d.options.maxPain != null && <span title="Strike that minimizes total option payout at expiry"><b className="text-[var(--text-2)]">Max pain</b> ${d.options.maxPain.toFixed(0)}{d.options.maxPainVsSpot != null ? ` (${pp(d.options.maxPainVsSpot, 0)} vs spot)` : ""}</span>}
          {d.options.callWall && <span title="Heaviest call open interest above spot — a level where dealer gamma can cap / pin the stock"><b className="text-[var(--text-2)]">Call wall</b> ${d.options.callWall.strike.toFixed(0)}</span>}
          {d.options.putWall && <span title="Heaviest put open interest below spot — support / downside magnet"><b className="text-[var(--text-2)]">Put wall</b> ${d.options.putWall.strike.toFixed(0)}</span>}
          {d.options.expiry && <span className="text-[var(--text-4)]">exp {d.options.expiry.slice(5)}</span>}
        </div>
      )}

      {/* AI StreetAccount-style preview (button-triggered) */}
      <div className="mt-3 border-t border-[var(--divider)] pt-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Preview <span className="font-normal normal-case">· AI, StreetAccount-style</span></div>
        {ai === "idle" ? (
          <div>
            <button onClick={runAi} className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90">Build the earnings preview →</button>
            <p className="mt-1.5 text-[11px] text-[var(--text-4)]">An AI desk-style preview — the money line, what changed since last call, what the Street is watching, guidance, peer read-throughs, and the bull/bear into the print (takes a few seconds).</p>
          </div>
        ) : ai === "loading" ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-4)]"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" /> building the preview…</div>
        ) : a && (a.overview || a.moneyLine || a.watch.length) ? (
          <div className="space-y-2.5 text-[12px] leading-snug">
            {a.moneyLine && <p className="rounded-md bg-[var(--accent-soft)] px-2.5 py-1.5 text-[var(--text)]"><span className="font-semibold">The money line: </span>{a.moneyLine}</p>}
            {a.overview && <p className="text-[var(--text-2)]">{a.overview}</p>}
            {a.fromLastCall && <p className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5"><span className="font-semibold text-[var(--text)]">Since last call: </span><span className="text-[var(--text-2)]">{a.fromLastCall}</span></p>}
            {a.watch.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[var(--text)]">What the Street is watching</div>
                <ul className="space-y-1">{a.watch.map((x, i) => <li key={i} className="text-[var(--text-2)]"><span className="text-[var(--accent)]">▸</span> {x}</li>)}</ul>
              </div>
            )}
            {a.guidance && <p><span className="font-semibold text-[var(--text)]">Guidance </span><span className="text-[var(--text-2)]">{a.guidance}</span></p>}
            {a.peerReads.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[var(--text)]">Peer read-throughs</div>
                <ul className="space-y-1">{a.peerReads.map((x, i) => <li key={i} className="text-[var(--text-3)]"><span className="text-[var(--text-4)]">•</span> {x}</li>)}</ul>
              </div>
            )}
            {(a.bull || a.bear) && (
              <div className="flex flex-col gap-1.5 border-t border-[var(--divider)] pt-2">
                {a.bull && <p><span className="font-semibold text-[#22c55e]">Bull </span><span className="text-[var(--text-2)]">{a.bull}</span></p>}
                {a.bear && <p><span className="font-semibold text-[#ef4444]">Bear </span><span className="text-[var(--text-2)]">{a.bear}</span></p>}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--text-4)]">
            Couldn&apos;t build the preview just now.{" "}
            <button onClick={runAi} className="text-[var(--accent)] underline hover:no-underline">Try again</button>
          </div>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-4)]">Consensus, revisions, ratings &amp; short interest via Yahoo; reaction = close-to-close moves on past prints; implied move + skew/max-pain from the options chain. AI context — decision-support, not investment advice.</p>
    </div>
  );
}
