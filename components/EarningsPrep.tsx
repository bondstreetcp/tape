"use client";
import { useEffect, useState } from "react";
import type { CompanyStats } from "@/lib/companyStats";
import type { StockRow } from "@/lib/types";
import type { SssTicker } from "@/lib/sameStoreSales";
import { guideMidEps, guideMidRevM, beatGuide, type GuidanceTicker, type GuidanceAction } from "@/lib/guidance";

interface DataPart {
  reaction: { avgAbsMove: number; maxAbsMove: number; upRate: number; n: number } | null;
  events: { date: string; surprise: number | null; move: number | null; drift5: number | null; timing: "bmo" | "amc" }[];
  impliedMove: number | null; // percent (e.g. 7.8)
  options: { expiry: string | null; atmIV: number | null; skew: number | null; maxPain: number | null; maxPainVsSpot: number | null; callWall: { strike: number; oi: number } | null; putWall: { strike: number; oi: number } | null } | null;
  richness: { ratio: number; verdict: "rich" | "cheap" | "fair"; avgRealized: number } | null;
  straddle: { cost: number; upperBE: number; lowerBE: number; price: number } | null;
  straddleWinRate: { exceeded: number; total: number } | null;
  pead: { avgBeatDrift5: number | null; avgMissDrift5: number | null; followThrough: number; n: number } | null;
  term: { frontIV: number; backIV: number; frontDte: number; backDte: number; crushRatio: number } | null;
  nextTiming: "bmo" | "amc" | null;
  volRegime: { atmIV: number; hv20: number; ivHvRatio: number; hvPctile: number | null } | null;
  trade: { verdict: string; structure: string; legs: string; rationale: string } | null;
  peerSympathy: { sym: string; n: number; avgAbsMe: number; beta: number | null; sameDir: number }[] | null;
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
      <div className="text-[11px] text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] leading-tight text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

export default function EarningsPrep({ symbol, stats, earningsDate, row, peers, sss, guidance }: { symbol: string; stats: CompanyStats | null; earningsDate?: string | null; row?: StockRow | null; peers?: StockRow[]; sss?: SssTicker | null; guidance?: GuidanceTicker | null }) {
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

  // Peer / sympathy earnings calendar — cohort names reporting near this print (from the peers prop)
  const myEarn = earningsDate && !Number.isNaN(Date.parse(earningsDate)) ? Date.parse(earningsDate) : null;
  const peerCal = (peers || [])
    .filter((p) => p.symbol !== symbol && p.earningsDate && !Number.isNaN(Date.parse(p.earningsDate)))
    .map((p) => ({ sym: p.symbol, t: Date.parse(p.earningsDate as string) }))
    .filter((p) => { const dd = (p.t - Date.now()) / 86_400_000; return dd >= -4 && dd <= 30; }) // just-reported → upcoming month
    .sort((a, b) => a.t - b.t)
    .slice(0, 7);

  // Pre-print analyst moves — rating/PT changes dated into the print (last ~45d), newest first
  const moves = (stats.ratingChanges || [])
    .filter((c) => c.date && !Number.isNaN(Date.parse(c.date)) && (Date.now() - Date.parse(c.date)) / 86_400_000 <= 45)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 5);

  // SSS "comp to beat" — last reported comparable-sales (the bar) for restaurant/retail names
  const sssRead = (() => {
    const ps = (sss?.periods || []).filter((p) => p.comp != null);
    if (!ps.length) return null;
    const latest = ps[0], prior = ps[1] ?? null;
    const yrAgo = ps.find((p) => { const yr = (Date.parse(latest.fpEnd) - Date.parse(p.fpEnd)) / (365.25 * 86_400_000); return yr >= 0.8 && yr <= 1.2; });
    return {
      comp: latest.comp as number, label: sss?.metricLabel || latest.metricLabel || "Comparable sales", fiscalLabel: latest.fiscalLabel,
      prior: prior?.comp ?? null, seqDelta: prior?.comp != null ? (latest.comp as number) - prior.comp : null,
      twoYrStack: yrAgo?.comp != null ? (latest.comp as number) + yrAgo.comp : null,
      traffic: latest.traffic ?? null, ticket: latest.ticket ?? null,
    };
  })();
  const mDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sgn1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // Reporting timing → when the post-earnings move lands: before-open reporters move THAT session (day-of),
  // after-close reporters move the NEXT session. nextTiming = the company's own historical pattern.
  const timing = d?.nextTiming ?? null;
  const nextBiz = (t: number) => { const x = new Date(t); do { x.setUTCDate(x.getUTCDate() + 1); } while (x.getUTCDay() === 0 || x.getUTCDay() === 6); return x.getTime(); };
  const reactionDay = timing != null && myEarn != null ? (timing === "amc" ? nextBiz(myEarn) : myEarn) : null;
  const timingShort = timing === "amc" ? "after close" : timing === "bmo" ? "before open" : null;

  // Guidance — the standing outlook + a consensus SANITY GATE: only trust an extracted number that sits
  // within 0.5–2× of SOME consensus period (filters LLM misreads, e.g. a margin% pulled in as EPS).
  const estimates = (stats.estimates || []) as any[];
  const matchConsensus = (mid: number | null, field: "epsAvg" | "revAvg"): { val: number; ok: boolean } | null => {
    if (mid == null) return null;
    let best: { val: number; ok: boolean } | null = null, bestRatio = Infinity;
    for (const e of estimates) { const v = e[field]; if (typeof v !== "number" || v <= 0) continue; const ratio = Math.max(mid / v, v / mid); if (ratio < bestRatio) { bestRatio = ratio; best = { val: v, ok: ratio <= 2 }; } }
    return best;
  };
  const guideRows = (guidance?.guides || []).slice(0, 2).map((g) => {
    const epsMid = guideMidEps(g), revMidM = guideMidRevM(g);
    const epsM = matchConsensus(epsMid, "epsAvg"), revM = matchConsensus(revMidM != null ? revMidM * 1e6 : null, "revAvg");
    const epsOk = epsMid != null && !!epsM?.ok, revOk = revMidM != null && !!revM?.ok;
    return { g, epsOk, epsPct: epsOk && epsM!.val ? epsMid! / epsM!.val - 1 : null, revOk, revPct: revOk && revM!.val ? (revMidM! * 1e6) / revM!.val - 1 : null };
  }).filter((r) => r.g.action !== "none" || r.epsOk || r.revOk || r.g.metricLabel);
  const ACTION_META: Record<GuidanceAction, { label: string; color: string; arrow: string }> = {
    raise: { label: "RAISED", color: "#22c55e", arrow: "▲" }, cut: { label: "CUT", color: "#ef4444", arrow: "▼" },
    reaffirm: { label: "REAFFIRMED", color: "var(--text-2)", arrow: "=" }, initiate: { label: "INITIATED guide", color: "#60a5fa", arrow: "◆" },
    mixed: { label: "MIXED", color: "#eab308", arrow: "◆" }, none: { label: "", color: "var(--text-3)", arrow: "" },
  };
  const shortDate = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const bg = beatGuide(guidance?.history); // beats-its-own-guide track record (sandbagger detection)

  return (
    <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">Earnings prep</h3>
        {dateLabel && <span className="text-xs text-[var(--text-3)]">{days != null && days >= 0 ? `reports ${dateLabel}${timingShort ? ` ${timingShort}` : ""} · in ${days}d` : `next/last report ${dateLabel}`}</span>}
      </div>

      {/* #2 pre-earnings setup — how it's positioned going in */}
      {row && (r1w != null || r3m != null || fromHigh != null) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px] text-[var(--text-3)]">
          <span className="text-[var(--text-4)]">Setup into the print:</span>
          {r1w != null && <span>1wk <b style={{ color: col(r1w) }}>{r1w >= 0 ? "+" : ""}{r1w.toFixed(1)}%</b></span>}
          {r3m != null && <span>3mo <b style={{ color: col(r3m) }}>{r3m >= 0 ? "+" : ""}{r3m.toFixed(1)}%</b></span>}
          {fromHigh != null && <span><b className="text-[var(--text-2)]">{fromHigh >= -1.5 ? "at" : `${Math.abs(fromHigh).toFixed(0)}% below`}</b> 52wk high</span>}
        </div>
      )}

      {/* SSS comp-to-beat — for restaurant/retail names the comparable-sales line IS the print */}
      {sssRead && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-3)]" title="Last reported comparable-sales / like-for-like — the number the desk watches for this name. The historical bar (not a forward Street consensus, which no feed carries).">
          <span className="text-[var(--text-4)]">{sssRead.label} — last:</span>
          <span><b style={{ color: col(sssRead.comp) }}>{sgn1(sssRead.comp)}</b>{sssRead.fiscalLabel ? <span className="text-[var(--text-4)]"> {sssRead.fiscalLabel}</span> : null}</span>
          {sssRead.seqDelta != null && <span>{sssRead.seqDelta >= 0 ? "accelerating" : "decelerating"} <b style={{ color: col(sssRead.seqDelta) }}>{sssRead.seqDelta >= 0 ? "+" : ""}{sssRead.seqDelta.toFixed(1)}pt</b>{sssRead.prior != null ? <span className="text-[var(--text-4)]"> vs prior {sgn1(sssRead.prior)}</span> : null}</span>}
          {sssRead.twoYrStack != null && <span><b className="text-[var(--text-2)]">2yr stack</b> {sgn1(sssRead.twoYrStack)}</span>}
          {(sssRead.traffic != null || sssRead.ticket != null) && <span className="text-[var(--text-4)]">{sssRead.traffic != null ? `traffic ${sgn1(sssRead.traffic)}` : ""}{sssRead.traffic != null && sssRead.ticket != null ? " · " : ""}{sssRead.ticket != null ? `ticket ${sgn1(sssRead.ticket)}` : ""}</span>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Consensus EPS (this Q)" value={q0?.epsAvg != null ? `$${q0.epsAvg.toFixed(2)}` : "—"} sub={q0?.epsAnalysts && q0.epsLow != null && q0.epsHigh != null ? `${q0.epsAnalysts} est · $${q0.epsLow.toFixed(2)}–$${q0.epsHigh.toFixed(2)}` : undefined} />
        <Stat label="Consensus revenue" value={fmtRev(q0?.revAvg)} sub={q0?.growth != null ? `${pp(q0.growth, 0)} YoY${compEps != null ? ` · yr-ago EPS $${compEps.toFixed(2)}` : ""}` : undefined} />
        <Stat label="Estimate trend (90d)" value={revPct != null ? `${revPct >= 0 ? "+" : ""}${revPct.toFixed(1)}%` : "—"} color={revPct != null ? (revPct >= 0 ? "#22c55e" : "#ef4444") : undefined} sub={q0 ? `${q0.epsUp30d ?? 0}↑ / ${q0.epsDown30d ?? 0}↓ revisions (30d)` : undefined} />
      </div>

      {/* management guidance — the standing outlook + guide-vs-consensus (numbers shown only when sane) */}
      {(guideRows.length > 0 || bg) && (
        <div className="mt-2.5 space-y-1">
          {guideRows.map(({ g, epsOk, epsPct, revOk, revPct: gRevPct }, i) => {
            const a = ACTION_META[g.action];
            return (
              <div key={i} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-3)]" title={g.quote || undefined}>
                <span className="text-[var(--text-4)]">Guidance · {g.period}{i === 0 && guidance?.updated ? ` (as of ${shortDate(guidance.updated)})` : ""}</span>
                {a.label && <b style={{ color: a.color }}>{a.arrow} {a.label}</b>}
                {epsOk && <span>EPS ${g.epsLow!.toFixed(2)}{g.epsHigh !== g.epsLow ? `–$${g.epsHigh!.toFixed(2)}` : ""}{epsPct != null && <span className="text-[var(--text-4)]"> · <span style={{ color: col(epsPct) }}>{epsPct >= 0 ? "+" : ""}{(epsPct * 100).toFixed(0)}%</span> vs Street</span>}</span>}
                {revOk && <span>rev ${(g.revLowM! / 1000).toFixed(1)}{g.revHighM !== g.revLowM ? `–${(g.revHighM! / 1000).toFixed(1)}` : ""}B{gRevPct != null && <span className="text-[var(--text-4)]"> · <span style={{ color: col(gRevPct) }}>{gRevPct >= 0 ? "+" : ""}{(gRevPct * 100).toFixed(0)}%</span> vs Street</span>}</span>}
                {!epsOk && !revOk && g.metricLabel && <span className="text-[var(--text-2)]">{g.metricLabel}</span>}
              </div>
            );
          })}
          {bg && (() => {
            const rate = bg.beats / bg.total, sandbags = rate >= 0.7 && (bg.avgVsGuide ?? 0) > 0.01;
            return (
              <div className="text-[12.5px] text-[var(--text-3)]" title="How often ACTUAL EPS beat the company's OWN next-quarter guide given the prior quarter — a sandbagger guides low then beats. Distinct from the beat-CONSENSUS rate.">
                <b className="text-[var(--text-2)]">Beats its own guide</b> <span style={{ color: rate >= 0.6 ? "#22c55e" : rate <= 0.4 ? "#ef4444" : "var(--text-2)" }}>{bg.beats}/{bg.total}</span>
                {bg.avgVsGuide != null && <span className="text-[var(--text-4)]"> · actual avg {bg.avgVsGuide >= 0 ? "+" : ""}{(bg.avgVsGuide * 100).toFixed(1)}% vs guide</span>}
                {sandbags && <span className="text-[var(--text-4)]"> · guides conservatively</span>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Expected-move bento — the options-implied move + breakevens + rich/cheap + crush + when it lands */}
      {(d?.impliedMove != null || d?.straddle) && (
        <div className="mt-3 rounded-xl border bg-[var(--accent-soft)] p-3" style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
            <div className="flex items-end gap-2.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Expected move · options-implied</div>
                <div className="font-mono text-3xl font-bold leading-none tabular-nums text-[var(--text)]">±{d?.impliedMove != null ? d.impliedMove.toFixed(1) : "—"}<span className="text-xl">%</span></div>
              </div>
              {d?.straddle && <div className="pb-0.5 text-[12.5px] leading-tight text-[var(--text-3)]">≈ ${d.straddle.cost.toFixed(2)}<br />straddle</div>}
              {d?.reaction && <div className="pb-0.5 text-[12.5px] leading-tight text-[var(--text-4)]">vs ±{(d.reaction.avgAbsMove * 100).toFixed(1)}%<br />avg realized ({d.reaction.n})</div>}
            </div>
            {d?.richness && (() => {
              const v = d.richness.verdict, vc = v === "rich" ? "#ef4444" : v === "cheap" ? "#22c55e" : "var(--text-2)";
              return <div className="rounded-lg px-2.5 py-1 text-right" style={{ background: v === "fair" ? "var(--surface-2)" : `${vc}1a` }} title="Implied move vs the average realized move on past prints">
                <div className="text-sm font-bold" style={{ color: vc }}>{v === "rich" ? "Options RICH" : v === "cheap" ? "Options CHEAP" : "Fairly priced"}</div>
                <div className="text-[11px] text-[var(--text-4)]">{d.richness.ratio.toFixed(2)}× realized{v === "rich" ? " · sell premium" : v === "cheap" ? " · buy the move" : ""}</div>
              </div>;
            })()}
          </div>

          {d?.straddle && (
            <div className="mt-2.5">
              <div className="relative h-1.5 rounded-full bg-gradient-to-r from-[#ef4444] via-[var(--surface-2)] to-[#22c55e]">
                <div className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text)]" style={{ left: "50%" }} title={`Spot $${d.straddle.price.toFixed(2)}`} />
              </div>
              <div className="mt-1 flex justify-between text-[12.5px] tabular-nums">
                <span className="text-[#ef4444]">${d.straddle.lowerBE.toFixed(2)}</span>
                <span className="text-[var(--text-4)]">breakevens · spot ${d.straddle.price.toFixed(2)}</span>
                <span className="text-[#22c55e]">${d.straddle.upperBE.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 text-[12.5px] text-[var(--text-3)]">
            {d?.straddleWinRate && d.straddleWinRate.total >= 4 && <span title="Of the last N prints, how often the realized move EXCEEDED the current implied move — low = the straddle's been a sell"><b className="text-[var(--text-2)]">Realized &gt; implied</b> {d.straddleWinRate.exceeded}/{d.straddleWinRate.total} ({Math.round((d.straddleWinRate.exceeded / d.straddleWinRate.total) * 100)}%)</span>}
            {d?.term && d.term.crushRatio >= 1.04 && <span title="Front (event) cycle ATM IV vs a later cycle — the event premium that collapses after the print"><b className="text-[var(--text-2)]">Vol crush</b> {(d.term.frontIV * 100).toFixed(0)}%→{(d.term.backIV * 100).toFixed(0)}% <span style={{ color: d.term.crushRatio >= 1.15 ? "#ef4444" : "var(--text-4)" }}>{d.term.crushRatio.toFixed(2)}×</span></span>}
            {reactionDay != null && timingShort && <span title="Before-open reporters move that same session; after-close reporters move the next session"><b className="text-[var(--text-2)]">Move lands</b> {new Date(reactionDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} <span className="text-[var(--text-4)]">({timingShort})</span></span>}
          </div>

          {/* earnings-day trade idea — the read turned into a structure at expected-move strikes */}
          {d?.trade && (
            <div className="mt-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px]" title="A structure consistent with the rich/cheap + skew read, at the expected-move strikes from the live chain. Decision-support, not advice.">
              <span className="font-semibold text-[var(--text)]">Play </span>
              <b style={{ color: d.trade.verdict === "rich" ? "#ef4444" : "#22c55e" }}>{d.trade.structure}</b>
              <span className="text-[var(--text-2)]"> · {d.trade.legs}</span>
              <span className="text-[var(--text-4)]"> — {d.trade.rationale}</span>
            </div>
          )}
        </div>
      )}


      {/* positioning + track record */}
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[var(--text-3)]">
        {beatRate != null && <span><b className="text-[var(--text-2)]">Beat rate</b> {(beatRate * 100).toFixed(0)}% of {sp.length}q{avgSurprise != null ? ` · avg surprise ${pp(avgSurprise, 1)}` : ""}</span>}
        {buys != null && sells != null && <span><b className="text-[var(--text-2)]">Sell-side</b> {buys} buy / {r!.hold} hold / {sells} sell{upside != null ? ` · PT ${pp(upside, 0)}` : ""}</span>}
        {stats.shortPercentOfFloat != null && <span><b className="text-[var(--text-2)]">Short</b> {(stats.shortPercentOfFloat * 100).toFixed(1)}% float{shortMoM != null ? ` (${shortMoM >= 0 ? "↑" : "↓"}${Math.abs(shortMoM * 100).toFixed(0)}% MoM)` : ""}{stats.shortRatio != null ? ` · ${stats.shortRatio.toFixed(1)}d cover` : ""}</span>}
        {stats.forwardPE != null && <span><b className="text-[var(--text-2)]">Fwd P/E</b> {stats.forwardPE.toFixed(0)}</span>}
      </div>

      {/* pre-print analyst moves — how the bar moved into the print */}
      {moves.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" title="Rating / price-target changes in the ~45 days into the print — how positioning and the bar shifted vs stale consensus">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Moves in</span>
          {moves.map((c, i) => {
            const up = c.action === "up", down = c.action === "down", init = c.action === "init";
            const ac = up ? "#22c55e" : down ? "#ef4444" : "var(--text-3)";
            const arrow = up ? "↑" : down ? "↓" : init ? "◆" : "•";
            return (
              <span key={i} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-3)]" title={`${c.firm}: ${c.fromGrade ? c.fromGrade + " → " : ""}${c.toGrade}${c.targetTo != null ? ` · PT $${c.targetTo}${c.targetFrom != null && c.targetFrom !== c.targetTo ? ` (was $${c.targetFrom})` : ""}` : ""}`}>
                <span className="text-[var(--text-4)]">{new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>{" "}
                <span style={{ color: ac }}>{arrow}</span> {c.firm}{c.targetTo != null ? <span className="text-[var(--text-4)]"> ${c.targetTo}</span> : null}
              </span>
            );
          })}
        </div>
      )}

      {/* #1 reaction history + #4 conditional moves */}
      {ev.length > 0 && (
        <div className="mt-3 border-t border-[var(--divider)] pt-3">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Past prints — surprise → 1-day move</span>
            {(avg(beatMoves) != null || avg(missMoves) != null) && (
              <span className="text-[11px] text-[var(--text-3)]">
                {avg(beatMoves) != null && <>beats avg <b style={{ color: col(avg(beatMoves)) }}>{pp(avg(beatMoves))}</b></>}
                {avg(missMoves) != null && <> · misses avg <b style={{ color: col(avg(missMoves)) }}>{pp(avg(missMoves))}</b></>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ev.map((e, i) => (
              <span key={i} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[11px] tabular-nums" title={e.date}>
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
        <div className="mt-2 text-[12.5px] text-[var(--text-3)]" title="Post-earnings drift: the stock's return over the 5 sessions AFTER the initial reaction — does the move continue or fade?">
          <b className="text-[var(--text-2)]">Post-print drift (5d)</b>{" "}
          {d.pead.avgBeatDrift5 != null && <>after beats <b style={{ color: col(d.pead.avgBeatDrift5) }}>{pp(d.pead.avgBeatDrift5)}</b></>}
          {d.pead.avgMissDrift5 != null && <> · after misses <b style={{ color: col(d.pead.avgMissDrift5) }}>{pp(d.pead.avgMissDrift5)}</b></>}
          <span className="text-[var(--text-4)]"> · move follows through {Math.round(d.pead.followThrough * 100)}% of {d.pead.n}</span>
        </div>
      )}

      {/* #5 options positioning */}
      {d?.options && (d.options.skew != null || d.options.maxPain != null || d.options.callWall != null) && (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[var(--text-3)]">
          {d?.volRegime ? <span title="ATM implied vol vs 20-day realized (historical) vol = the variance risk premium; + where current realized vol sits in its own 1yr range. >1.3× = vol rich in absolute terms."><b className="text-[var(--text-2)]">IV vs HV</b> {(d.volRegime.atmIV * 100).toFixed(0)}%/{(d.volRegime.hv20 * 100).toFixed(0)}% <span style={{ color: d.volRegime.ivHvRatio >= 1.3 ? "#ef4444" : d.volRegime.ivHvRatio <= 1 ? "#22c55e" : "var(--text-4)" }}>{d.volRegime.ivHvRatio.toFixed(1)}×</span>{d.volRegime.hvPctile != null ? <span className="text-[var(--text-4)]"> · HV {d.volRegime.hvPctile.toFixed(0)}ᵗʰ %ile</span> : null}</span>
            : d.options.atmIV != null && <span><b className="text-[var(--text-2)]">ATM IV</b> {(d.options.atmIV * 100).toFixed(0)}%</span>}
          {d.options.skew != null && <span title="ATM put IV minus call IV — positive = downside hedging bid"><b className="text-[var(--text-2)]">Skew</b> <span style={{ color: d.options.skew > 0 ? "#ef4444" : "#22c55e" }}>{d.options.skew > 0 ? "puts bid" : "calls bid"} {(Math.abs(d.options.skew) * 100).toFixed(1)}pt</span></span>}
          {d.options.maxPain != null && <span title="Strike that minimizes total option payout at expiry"><b className="text-[var(--text-2)]">Max pain</b> ${d.options.maxPain.toFixed(0)}{d.options.maxPainVsSpot != null ? ` (${pp(d.options.maxPainVsSpot, 0)} vs spot)` : ""}</span>}
          {d.options.callWall && <span title="Heaviest call open interest above spot — a level where dealer gamma can cap / pin the stock"><b className="text-[var(--text-2)]">Call wall</b> ${d.options.callWall.strike.toFixed(0)}</span>}
          {d.options.putWall && <span title="Heaviest put open interest below spot — support / downside magnet"><b className="text-[var(--text-2)]">Put wall</b> ${d.options.putWall.strike.toFixed(0)}</span>}
          {d.options.expiry && <span className="text-[var(--text-4)]">exp {d.options.expiry.slice(5)}</span>}
        </div>
      )}

      {/* peer / sympathy earnings calendar — cohort names reporting near this print */}
      {peerCal.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--text-3)]" title="Cohort peers reporting near this print — a peer's beat/miss + reaction is the best real-time read-through for this name. ⮞ = reports before this print.">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Peers reporting</span>
          {peerCal.map((p) => {
            const dd = Math.round((p.t - Date.now()) / 86_400_000);
            const before = myEarn != null && p.t < myEarn && dd >= 0;
            return (
              <span key={p.sym} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[11px] tabular-nums" title={`${p.sym} reports ${mDay(p.t)}${myEarn != null ? (p.t < myEarn ? " — before this print (read-through)" : " — after this print") : ""}`}>
                <span className="text-[var(--text-2)]">{p.sym}</span> <span className="text-[var(--text-4)]">{dd < 0 ? "reported" : mDay(p.t)}</span>{before ? <span className="text-[var(--accent)]"> ⮞</span> : null}
              </span>
            );
          })}
        </div>
      )}

      {/* quantified sympathy — how this stock has co-moved on each peer's past prints */}
      {d?.peerSympathy && d.peerSympathy.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--text-3)]" title="On the day each cohort peer reported in the past, how this stock moved: avg |same-day move|, the slope (β) of this stock's move on the peer's, and the same-direction rate. A peer reporting before this name is a live prior.">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Sympathy on peer prints</span>
          {d.peerSympathy.map((s) => (
            <span key={s.sym} className="tabular-nums">
              <span className="text-[var(--text-2)]">{s.sym}</span> ±{(s.avgAbsMe * 100).toFixed(1)}%
              {s.beta != null && <span className="text-[var(--text-4)]"> β{s.beta.toFixed(1)}</span>}
              <span className="text-[var(--text-4)]"> · {Math.round(s.sameDir * 100)}% same-dir</span>
            </span>
          ))}
        </div>
      )}

      {/* AI StreetAccount-style preview (button-triggered) */}
      <div className="mt-3 border-t border-[var(--divider)] pt-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Preview <span className="font-normal normal-case">· AI, StreetAccount-style</span></div>
        {ai === "idle" ? (
          <div>
            <button onClick={runAi} className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90">Build the earnings preview →</button>
            <p className="mt-1.5 text-[12.5px] text-[var(--text-4)]">An AI desk-style preview — the money line, what changed since last call, what the Street is watching, guidance, peer read-throughs, and the bull/bear into the print (takes a few seconds).</p>
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
                <div className="mb-1 text-[12.5px] font-semibold text-[var(--text)]">What the Street is watching</div>
                <ul className="space-y-1">{a.watch.map((x, i) => <li key={i} className="text-[var(--text-2)]"><span className="text-[var(--accent)]">▸</span> {x}</li>)}</ul>
              </div>
            )}
            {a.guidance && <p><span className="font-semibold text-[var(--text)]">Guidance </span><span className="text-[var(--text-2)]">{a.guidance}</span></p>}
            {a.peerReads.length > 0 && (
              <div>
                <div className="mb-1 text-[12.5px] font-semibold text-[var(--text)]">Peer read-throughs</div>
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

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">Consensus, revisions, ratings &amp; short interest via Yahoo; reaction = close-to-close moves on past prints; implied move + skew/max-pain from the options chain. AI context — decision-support, not investment advice.</p>
    </div>
  );
}
