"use client";
import { useEffect, useState } from "react";
import type { CompanyStats } from "@/lib/companyStats";
import type { StockRow } from "@/lib/types";
import type { SssTicker } from "@/lib/sameStoreSales";
import { guideMidEps, guideMidRevM, beatGuide, type GuidanceTicker, type GuidanceAction } from "@/lib/guidance";
import { ivStats, type IvSnapshot } from "@/lib/ivHistory";

interface DataPart {
  reaction: { avgAbsMove: number; maxAbsMove: number; upRate: number; n: number } | null;
  events: { date: string; surprise: number | null; move: number | null; drift5: number | null; timing: "bmo" | "amc" }[];
  impliedMove: number | null; // percent (e.g. 7.8)
  options: { expiry: string | null; atmIV: number | null; skew: number | null; maxPain: number | null; maxPainVsSpot: number | null; callWall: { strike: number; oi: number } | null; putWall: { strike: number; oi: number } | null } | null;
  richness: { ratio: number; verdict: "rich" | "cheap" | "fair"; avgRealized: number } | null;
  straddle: { cost: number; upperBE: number; lowerBE: number; price: number; expiry?: string | null; dte?: number | null; live?: boolean } | null;
  straddleWinRate: { exceeded: number; total: number } | null;
  pead: { avgBeatDrift5: number | null; avgMissDrift5: number | null; followThrough: number; n: number } | null;
  term: { frontIV: number; backIV: number; frontDte: number; backDte: number; crushRatio: number } | null;
  nextTiming: "bmo" | "amc" | null;
  volRegime: { atmIV: number; hv20: number; ivHvRatio: number; hvPctile: number | null } | null;
  trade: { verdict: string; structure: string; legs: string; rationale: string; expiry?: string | null; dte?: number | null; legsData?: { type: "C" | "P"; side: "long" | "short"; strike: number; premium: number }[] } | null;
  peerSympathy: { sym: string; n: number; avgAbsMe: number; beta: number | null; sameDir: number }[] | null;
  surpriseReaction: { n: number; beatUp: number | null; beatN: number; missDown: number | null; missN: number } | null;
  priceSeries?: [number, number][]; // [t, close] recent daily series for the expected-move cone
  longPremium: { verdict: "favorable" | "neutral" | "unfavorable"; beatClear: number; beatN: number; crushRatio: number | null } | null;
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

// A bordered "bento" card with an uppercase header — the building block of the redesigned grid.
function Bento({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={"mb-3 break-inside-avoid rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 " + className}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]" title={hint}>{title}</div>
      {children}
    </section>
  );
}

// Expected-move CONE — recent price line + the ±straddle range fanned out to the event expiry (1σ band
// in accent, a lighter 2σ band behind), so "where could it be after the print" is visual, not just a %.
function ExpectedMoveCone({ series, lowerBE, upperBE, spot, expiry }: { series: [number, number][]; lowerBE: number; upperBE: number; spot: number; expiry: string }) {
  const expT = Date.parse(expiry + "T00:00:00Z");
  if (series.length < 5 || Number.isNaN(expT)) return null;
  const W = 600, H = 130, ML = 2, MR = 52, MT = 10, MB = 16;
  const now = Date.now();
  const t0 = series[0][0], tMax = Math.max(expT, series[series.length - 1][0] + 86_400_000);
  const up2 = spot + 2 * (upperBE - spot), lo2 = spot - 2 * (spot - lowerBE);
  const prices = series.map((s) => s[1]);
  let yMin = Math.min(...prices, lo2), yMax = Math.max(...prices, up2);
  const pad = (yMax - yMin) * 0.06 || 1; yMin -= pad; yMax += pad;
  const x = (t: number) => ML + ((t - t0) / (tMax - t0)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);
  const path = series.map((s, i) => `${i ? "L" : "M"}${x(s[0]).toFixed(1)} ${y(s[1]).toFixed(1)}`).join("");
  const xN = x(now), xE = x(expT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      <path d={`M${xN} ${y(spot)} L${xE} ${y(up2)} L${xE} ${y(lo2)} Z`} fill="var(--text-4)" fillOpacity={0.1} />
      <path d={`M${xN} ${y(spot)} L${xE} ${y(upperBE)} L${xE} ${y(lowerBE)} Z`} fill="var(--accent)" fillOpacity={0.16} />
      <line x1={xN} y1={MT} x2={xN} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.45} strokeDasharray="2 3" />
      <line x1={xE} y1={y(up2)} x2={xE} y2={y(lo2)} stroke="var(--text-4)" strokeOpacity={0.3} />
      <path d={path} fill="none" stroke="var(--text-2)" strokeWidth={1.5} />
      <circle cx={xN} cy={y(spot)} r={2.5} fill="var(--text)" />
      <text x={xE + 4} y={y(upperBE) + 3} fontSize={10} fill="#22c55e" className="tabular-nums">${upperBE.toFixed(0)}</text>
      <text x={xE + 4} y={y(spot) + 3} fontSize={10} fill="var(--text-4)" className="tabular-nums">${spot.toFixed(0)}</text>
      <text x={xE + 4} y={y(lowerBE) + 3} fontSize={10} fill="#ef4444" className="tabular-nums">${lowerBE.toFixed(0)}</text>
      <text x={xN} y={H - 4} fontSize={9} fill="var(--text-4)" textAnchor="middle">now</text>
      <text x={xE} y={H - 4} fontSize={9} fill="var(--text-4)" textAnchor="end">{expiry.slice(5)}</text>
    </svg>
  );
}

// Options payoff diagram — P&L at expiry vs the underlying for the suggested structure, with the zero
// line, the breakevens, the ±expected-move zone shaded, and profit (green) / loss (red) regions.
function PayoffDiagram({ legs, spot, movePct }: { legs: { type: "C" | "P"; side: "long" | "short"; strike: number; premium: number }[]; spot: number; movePct: number }) {
  if (!legs.length || !spot || !(movePct > 0)) return null;
  const W = 600, H = 150, ML = 6, MR = 44, MT = 12, MB = 18;
  const move = (movePct / 100) * spot;
  const lo = Math.max(0.01, spot - 3.2 * move), hi = spot + 3.2 * move;
  const sgn = (l: typeof legs[number]) => (l.side === "short" ? 1 : -1);
  const intr = (l: typeof legs[number], S: number) => (l.type === "C" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S));
  const pnl = (S: number) => legs.reduce((a, l) => a + sgn(l) * (l.premium - intr(l, S)), 0);
  const N = 140;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const S = lo + ((hi - lo) * i) / N; return { S, p: pnl(S) }; });
  const pmin = Math.min(...pts.map((q) => q.p)), pmax = Math.max(...pts.map((q) => q.p));
  const pad = (pmax - pmin) * 0.12 || 1, yLo = pmin - pad, yHi = pmax + pad;
  const x = (S: number) => ML + ((S - lo) / (hi - lo)) * (W - ML - MR);
  const y = (p: number) => MT + (1 - (p - yLo) / (yHi - yLo || 1)) * (H - MT - MB);
  const curve = pts.map((q, i) => `${i ? "L" : "M"}${x(q.S).toFixed(1)} ${y(q.p).toFixed(1)}`).join("");
  const area = `${curve} L${x(hi).toFixed(1)} ${y(0).toFixed(1)} L${x(lo).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const y0 = y(0);
  const bes: number[] = [];
  for (let i = 1; i < pts.length; i++) if ((pts[i - 1].p <= 0) !== (pts[i].p <= 0)) { const t = pts[i - 1].p / (pts[i - 1].p - pts[i].p); bes.push(pts[i - 1].S + t * (pts[i].S - pts[i - 1].S)); }
  const cid = `pf${legs.map((l) => l.strike).join("")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      <defs>
        <clipPath id={`${cid}p`}><rect x={0} y={0} width={W} height={y0} /></clipPath>
        <clipPath id={`${cid}l`}><rect x={0} y={y0} width={W} height={H - y0} /></clipPath>
      </defs>
      <rect x={x(spot - move)} y={MT} width={x(spot + move) - x(spot - move)} height={H - MT - MB} fill="var(--accent)" fillOpacity={0.07} />
      <path d={area} fill="#22c55e" fillOpacity={0.14} clipPath={`url(#${cid}p)`} />
      <path d={area} fill="#ef4444" fillOpacity={0.14} clipPath={`url(#${cid}l)`} />
      <line x1={ML} x2={W - MR} y1={y0} y2={y0} stroke="var(--text-4)" strokeOpacity={0.6} strokeDasharray="3 3" />
      <line x1={x(spot)} y1={MT} x2={x(spot)} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.4} />
      <path d={curve} fill="none" stroke="var(--text)" strokeWidth={1.7} />
      {bes.map((be, i) => <g key={i}><circle cx={x(be)} cy={y0} r={2.5} fill="var(--text-2)" /><text x={x(be)} y={H - 5} fontSize={9} fill="var(--text-4)" textAnchor="middle" className="tabular-nums">${be.toFixed(0)}</text></g>)}
      <text x={x(spot)} y={H - 5} fontSize={9} fill="var(--text-4)" textAnchor="middle">spot</text>
      <text x={W - MR + 3} y={y(pmax) + 3} fontSize={9} fill="#22c55e" className="tabular-nums">+${pmax.toFixed(2)}</text>
      <text x={W - MR + 3} y={y(pmin) + 3} fontSize={9} fill="#ef4444" className="tabular-nums">{pmin >= 0 ? "+" : "−"}${Math.abs(pmin).toFixed(2)}</text>
    </svg>
  );
}

// A big lead metric (value + small label) for the top of a bento.
function Big({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-bold leading-none tabular-nums" style={color ? { color } : undefined}>{value}</div>
      <div className="mt-1 text-[12px] text-[var(--text-4)]">{label}</div>
    </div>
  );
}

export default function EarningsPrep({ symbol, stats, earningsDate, row, peers, sss, guidance, ivHistory }: { symbol: string; stats: CompanyStats | null; earningsDate?: string | null; row?: StockRow | null; peers?: StockRow[]; sss?: SssTicker | null; guidance?: GuidanceTicker | null; ivHistory?: IvSnapshot[] | null }) {
  const [data, setData] = useState<DataPart | null | "loading">("loading");
  const [ai, setAi] = useState<AiPart | null | "idle" | "loading">("idle");

  useEffect(() => {
    let a = true;
    setData("loading");
    setAi("idle");
    const eParam = earningsDate && !Number.isNaN(Date.parse(earningsDate)) ? `&e=${encodeURIComponent(earningsDate.slice(0, 10))}` : "";
    fetch(`/api/earnings-prep/${encodeURIComponent(symbol)}?part=data${eParam}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.data || null))
      .catch(() => a && setData(null));
    return () => { a = false; };
  }, [symbol, earningsDate]);

  const runAi = (sig?: string) => {
    setAi("loading");
    fetch(`/api/earnings-prep/${encodeURIComponent(symbol)}?part=ai${sig ? `&sig=${encodeURIComponent(sig.slice(0, 1400))}` : ""}`)
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
  const ivs = ivStats(ivHistory ?? undefined); // IV-rank + realized crush — null until the history accrues
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

  // A compact summary of the card's QUANT signals, fed to the AI preview so it synthesizes them (not generic).
  const aiSignals = (() => {
    const o: string[] = [];
    if (d?.richness && d.impliedMove != null) o.push(`options ${d.richness.verdict.toUpperCase()} — pricing ±${d.impliedMove.toFixed(1)}% vs ±${d.richness.avgRealized.toFixed(1)}% avg realized move (${d.richness.ratio.toFixed(1)}x)`);
    else if (d?.impliedMove != null && d.straddle?.dte != null) o.push(`options imply ±${d.impliedMove.toFixed(1)}% by expiry (${d.straddle.dte}d out)`);
    if (d?.term && d.term.crushRatio >= 1.04) o.push(`IV term backwardated ${d.term.crushRatio.toFixed(2)}x (vol crush into the print)`);
    if (d?.volRegime) o.push(`IV ${(d.volRegime.atmIV * 100).toFixed(0)}% vs realized HV ${(d.volRegime.hv20 * 100).toFixed(0)}% (${d.volRegime.ivHvRatio.toFixed(1)}x; HV ${d.volRegime.hvPctile?.toFixed(0) ?? "?"}th pctile)`);
    if (d?.options?.skew != null && Math.abs(d.options.skew) > 0.02) o.push(`options skew: ${d.options.skew > 0 ? "puts bid (downside hedging)" : "calls bid (upside chase)"}`);
    if (d?.pead) o.push(`post-print 5d drift: after beats ${pp(d.pead.avgBeatDrift5)}, after misses ${pp(d.pead.avgMissDrift5)}`);
    if (d?.surpriseReaction?.beatUp != null && d.surpriseReaction.beatN >= 3) o.push(`beats→up ${Math.round(d.surpriseReaction.beatUp * 100)}% of ${d.surpriseReaction.beatN}${d.surpriseReaction.beatUp <= 0.5 && d.surpriseReaction.beatN >= 4 ? " (sell-the-news pattern)" : ""}`);
    if (d?.longPremium && d.longPremium.beatN >= 3) o.push(`buying premium ${d.longPremium.verdict} — on past beats the stock cleared the implied move only ${d.longPremium.beatClear}/${d.longPremium.beatN} (a right call can lose to a small move + IV crush)`);
    if (sssRead) o.push(`last comp ${sgn1(sssRead.comp)}${sssRead.seqDelta != null ? ` (${sssRead.seqDelta >= 0 ? "accelerating" : "decelerating"})` : ""}`);
    if (guideRows.length) o.push(`standing guidance ${guideRows[0].g.period} ${guideRows[0].g.action.toUpperCase()}`);
    if (bg) o.push(`beats its own guide ${bg.beats}/${bg.total}${bg.avgVsGuide != null && bg.avgVsGuide > 0.01 && bg.beats / bg.total >= 0.7 ? " — guides conservatively" : ""}`);
    if (r1w != null) o.push(`into the print ${r1w >= 0 ? "+" : ""}${r1w.toFixed(1)}% 1wk${fromHigh != null ? `, ${fromHigh >= -1.5 ? "at" : `${Math.abs(fromHigh).toFixed(0)}% below`} 52wk high` : ""}`);
    return o.join(" · ");
  })();

  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--text)]">Earnings prep</h3>
        {dateLabel && <span className="text-sm text-[var(--text-3)]">{days != null && days >= 0 ? <>reports <b className="text-[var(--text-2)]">{dateLabel}</b>{timingShort ? ` ${timingShort}` : ""} · in {days}d</> : `next/last report ${dateLabel}`}</span>}
      </div>

      {/* Expected-move HERO — the headline options read (full-width, top of the card) */}
      {(d?.impliedMove != null || d?.straddle) && (
        <div className="mb-3 rounded-xl border bg-[var(--accent-soft)] p-3.5" style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
            <div className="flex items-end gap-2.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]" title={d?.straddle?.live ? "The ATM straddle (call + put) for the expiry bracketing earnings, as a % of spot — what the options market is actually pricing for the move by that expiry." : "Implied move from the options market."}>Expected move · {d?.straddle?.live ? "ATM straddle" : "options-implied"}</div>
                <div className="font-mono text-4xl font-bold leading-none tabular-nums text-[var(--text)]">±{d?.impliedMove != null ? d.impliedMove.toFixed(1) : "—"}<span className="text-2xl">%</span></div>
              </div>
              {d?.straddle && <div className="pb-0.5 text-[13px] leading-tight text-[var(--text-3)]">≈ ${d.straddle.cost.toFixed(2)} straddle{d.straddle.dte != null && d.straddle.expiry ? <><br /><span className="text-[var(--text-4)]">{d.straddle.dte}d · exp {d.straddle.expiry.slice(5)}</span></> : null}</div>}
              {d?.reaction && <div className="pb-0.5 text-[13px] leading-tight text-[var(--text-4)]">vs ±{(d.reaction.avgAbsMove * 100).toFixed(1)}%<br />avg realized ({d.reaction.n})</div>}
            </div>
            {d?.richness && (() => {
              const v = d.richness.verdict, vc = v === "rich" ? "#ef4444" : v === "cheap" ? "#22c55e" : "var(--text-2)";
              return <div className="rounded-lg px-3 py-1.5 text-right" style={{ background: v === "fair" ? "var(--surface-2)" : `${vc}1a` }} title="Implied move vs the average realized move on past prints">
                <div className="text-base font-bold" style={{ color: vc }}>{v === "rich" ? "Options RICH" : v === "cheap" ? "Options CHEAP" : "Fairly priced"}</div>
                <div className="text-[12px] text-[var(--text-4)]">{d.richness.ratio.toFixed(2)}× realized{v === "rich" ? " · sell premium" : v === "cheap" ? " · buy the move" : ""}</div>
              </div>;
            })()}
          </div>

          {d?.straddle && (
            <div className="mt-2.5">
              {d.priceSeries && d.priceSeries.length >= 5 && d.straddle.expiry ? (
                <div title="Recent price + the ±straddle (expected-move) range projected to the earnings expiry — accent band = the priced move, lighter = ±2×.">
                  <ExpectedMoveCone series={d.priceSeries} lowerBE={d.straddle.lowerBE} upperBE={d.straddle.upperBE} spot={d.straddle.price} expiry={d.straddle.expiry} />
                </div>
              ) : (
                <>
                  <div className="relative h-2 rounded-full bg-gradient-to-r from-[#ef4444] via-[var(--surface-2)] to-[#22c55e]">
                    <div className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text)]" style={{ left: "50%" }} title={`Spot $${d.straddle.price.toFixed(2)}`} />
                  </div>
                  <div className="mt-1 flex justify-between text-[13px] tabular-nums">
                    <span className="text-[#ef4444]">${d.straddle.lowerBE.toFixed(2)}</span>
                    <span className="text-[var(--text-4)]">breakevens · spot ${d.straddle.price.toFixed(2)}</span>
                    <span className="text-[#22c55e]">${d.straddle.upperBE.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2.5 text-[13px] text-[var(--text-3)]">
            {d?.straddleWinRate && d.straddleWinRate.total >= 4 && <span title="Of the last N prints, how often the realized move EXCEEDED the current implied move — low = the straddle's been a sell"><b className="text-[var(--text-2)]">Realized &gt; implied</b> {d.straddleWinRate.exceeded}/{d.straddleWinRate.total} ({Math.round((d.straddleWinRate.exceeded / d.straddleWinRate.total) * 100)}%)</span>}
            {d?.term && d.term.crushRatio >= 1.04 && <span title="Front (event) cycle ATM IV vs a later cycle — the event premium that collapses after the print"><b className="text-[var(--text-2)]">Vol crush</b> {(d.term.frontIV * 100).toFixed(0)}%→{(d.term.backIV * 100).toFixed(0)}% <span style={{ color: d.term.crushRatio >= 1.15 ? "#ef4444" : "var(--text-4)" }}>{d.term.crushRatio.toFixed(2)}×</span></span>}
            {reactionDay != null && timingShort && <span title="Before-open reporters move that same session; after-close reporters move the next session"><b className="text-[var(--text-2)]">Move lands</b> {new Date(reactionDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} <span className="text-[var(--text-4)]">({timingShort})</span></span>}
          </div>

          {d?.trade && (
            <div className="mt-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[13px]" title="A structure consistent with the rich/cheap + skew read, at the expected-move strikes from the live chain. Decision-support, not advice.">
              <span className="font-semibold text-[var(--text)]">Play </span>
              <b style={{ color: d.trade.verdict === "rich" ? "#ef4444" : "#22c55e" }}>{d.trade.structure}</b>
              {d.trade.expiry && (
                <span className="ml-1 rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-3)]" title="The option expiry these legs are priced on — the first one after the earnings date, so it captures the event.">
                  exp {d.trade.expiry}{d.trade.dte != null ? ` · ${d.trade.dte}d` : ""}
                </span>
              )}
              <span className="text-[var(--text-2)]"> · {d.trade.legs}</span>
              <span className="text-[var(--text-4)]"> — {d.trade.rationale}</span>
              {d.trade.legsData && d.straddle && d.impliedMove != null && (
                <div className="mt-1.5" title="P&L at expiry vs the stock price. Green = profit, red = loss; the shaded band is the ±expected move, dots on the zero line are the breakevens.">
                  <PayoffDiagram legs={d.trade.legsData} spot={d.straddle.price} movePct={d.impliedMove} />
                </div>
              )}
            </div>
          )}

          {d?.longPremium && (() => {
            const lp = d.longPremium, vc = lp.verdict === "favorable" ? "#22c55e" : lp.verdict === "unfavorable" ? "#ef4444" : "var(--text-2)";
            const msg = lp.verdict === "favorable" ? "the move has tended to EXCEED what's priced — long calls/straddle have paid"
              : lp.verdict === "unfavorable" ? "a right directional call can still LOSE — the move is usually smaller than priced, and the IV crush bleeds it"
              : "roughly a coin-flip vs the priced move";
            return (
              <div className="mt-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: lp.verdict === "neutral" ? "var(--surface-2)" : `${vc}14` }} title="Whether BUYING premium (calls/puts/straddle) into the print is favorable. The trap: you're right on the beat, but the stock moves less than the priced move and the post-earnings IV crush bleeds the option.">
                <b style={{ color: vc }}>Buying premium: {lp.verdict === "favorable" ? "FAVORABLE" : lp.verdict === "unfavorable" ? "UNFAVORABLE" : "NEUTRAL"}</b>
                {lp.beatN >= 3 && d.impliedMove != null && <span className="text-[var(--text-3)]"> · on past beats it cleared the ±{d.impliedMove.toFixed(1)}% move <b style={{ color: lp.beatClear / lp.beatN >= 0.5 ? "#22c55e" : "#ef4444" }}>{lp.beatClear}/{lp.beatN}</b></span>}
                <span className="text-[var(--text-4)]"> — {msg}</span>
              </div>
            );
          })()}
        </div>
      )}

      <div className="sm:columns-2 sm:gap-3">
      <Bento title="Consensus · this quarter">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Big value={q0?.epsAvg != null ? `$${q0.epsAvg.toFixed(2)}` : "—"} label={`EPS${q0?.epsAnalysts ? ` · ${q0.epsAnalysts} est` : ""}`} />
          <Big value={fmtRev(q0?.revAvg)} label={`revenue${q0?.growth != null ? ` · ${pp(q0.growth, 0)} YoY` : ""}`} />
          {revPct != null && <Big value={`${revPct >= 0 ? "+" : ""}${revPct.toFixed(1)}%`} label="est. trend 90d" color={revPct >= 0 ? "#22c55e" : "#ef4444"} />}
        </div>
        <div className="mt-2.5 text-[13px] text-[var(--text-3)]">
          {q0?.epsLow != null && q0?.epsHigh != null && <span>EPS range ${q0.epsLow.toFixed(2)}–${q0.epsHigh.toFixed(2)}</span>}
          {q0 && <span className="text-[var(--text-4)]"> · {q0.epsUp30d ?? 0}↑/{q0.epsDown30d ?? 0}↓ revisions (30d)</span>}
          {(r1w != null || fromHigh != null) && <span className="text-[var(--text-4)]"> · into the print {r1w != null ? `${r1w >= 0 ? "+" : ""}${r1w.toFixed(1)}% 1wk` : ""}{fromHigh != null ? `${r1w != null ? ", " : ""}${fromHigh >= -1.5 ? "at" : `${Math.abs(fromHigh).toFixed(0)}% below`} 52wk high` : ""}</span>}
        </div>
        {sssRead && (
          <div className="mt-2 border-t border-[var(--divider)] pt-2 text-[13px] text-[var(--text-3)]" title="Last reported comparable-sales / like-for-like — the bar for restaurant/retail names (historical, not a forward Street consensus).">
            <b className="text-[var(--text-2)]">{sssRead.label}</b> <b style={{ color: col(sssRead.comp) }}>{sgn1(sssRead.comp)}</b>{sssRead.fiscalLabel ? <span className="text-[var(--text-4)]"> {sssRead.fiscalLabel}</span> : null}{sssRead.seqDelta != null ? <span className="text-[var(--text-4)]"> · {sssRead.seqDelta >= 0 ? "accel." : "decel."} {sssRead.seqDelta >= 0 ? "+" : ""}{sssRead.seqDelta.toFixed(1)}pt</span> : null}{sssRead.twoYrStack != null ? <span className="text-[var(--text-4)]"> · 2yr stack {sgn1(sssRead.twoYrStack)}</span> : null}{sssRead.traffic != null ? <span className="text-[var(--text-4)]"> · traffic {sgn1(sssRead.traffic)}{sssRead.ticket != null ? ` / ticket ${sgn1(sssRead.ticket)}` : ""}</span> : null}
          </div>
        )}
      </Bento>

      {(guideRows.length > 0 || bg) && (
        <Bento title="Guidance" hint="Management's standing forward outlook + how often they beat their own guide.">
          {guideRows.map(({ g, epsOk, epsPct, revOk, revPct: gRevPct }, i) => {
            const am = ACTION_META[g.action];
            return (
              <div key={i} className={i ? "mt-1.5" : ""} title={g.quote || undefined}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {am.label && <span className="text-base font-bold" style={{ color: am.color }}>{am.arrow} {am.label}</span>}
                  <span className="text-[12px] text-[var(--text-4)]">{g.period}{i === 0 && guidance?.updated ? ` · as of ${shortDate(guidance.updated)}` : ""}</span>
                </div>
                <div className="text-[13px] text-[var(--text-3)]">
                  {epsOk && <span>EPS ${g.epsLow!.toFixed(2)}{g.epsHigh !== g.epsLow ? `–$${g.epsHigh!.toFixed(2)}` : ""}{epsPct != null && <> (<span style={{ color: col(epsPct) }}>{epsPct >= 0 ? "+" : ""}{(epsPct * 100).toFixed(0)}%</span> vs St)</>}</span>}
                  {revOk && <span>{epsOk ? " · " : ""}rev ${(g.revLowM! / 1000).toFixed(1)}{g.revHighM !== g.revLowM ? `–${(g.revHighM! / 1000).toFixed(1)}` : ""}B</span>}
                  {!epsOk && !revOk && g.metricLabel && <span className="text-[var(--text-2)]">{g.metricLabel}</span>}
                </div>
              </div>
            );
          })}
          {bg && (() => {
            const rate = bg.beats / bg.total;
            return (
              <div className={"text-[13px] text-[var(--text-3)] " + (guideRows.length ? "mt-2 border-t border-[var(--divider)] pt-2" : "")} title="How often ACTUAL EPS beat the company's OWN next-quarter guide — a sandbagger guides low then beats.">
                Beats its own guide <b style={{ color: rate >= 0.6 ? "#22c55e" : rate <= 0.4 ? "#ef4444" : "var(--text-2)" }}>{bg.beats}/{bg.total}</b>{bg.avgVsGuide != null ? <span className="text-[var(--text-4)]"> · avg {bg.avgVsGuide >= 0 ? "+" : ""}{(bg.avgVsGuide * 100).toFixed(1)}% vs guide</span> : null}{rate >= 0.7 && (bg.avgVsGuide ?? 0) > 0.01 ? <span className="text-[var(--text-4)]"> · sandbags</span> : null}
              </div>
            );
          })()}
        </Bento>
      )}

        {/* Past reactions */}
        {ev.length > 0 && (
          <Bento title="Past reactions" hint="surprise → 1-day move, the directional reliability, and the post-print drift">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {d?.reaction && <Big value={`±${(d.reaction.avgAbsMove * 100).toFixed(1)}%`} label={`typical move (${d.reaction.n}q)`} />}
              <div className="text-[13px] text-[var(--text-3)]">
                {avg(beatMoves) != null && <div>beats avg <b style={{ color: col(avg(beatMoves)) }}>{pp(avg(beatMoves))}</b></div>}
                {avg(missMoves) != null && <div>misses avg <b style={{ color: col(avg(missMoves)) }}>{pp(avg(missMoves))}</b></div>}
              </div>
            </div>
            <table className="mt-2 w-full text-[13px] tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                  <th className="py-1 pr-2 text-left font-medium">Quarter</th>
                  <th className="py-1 px-1 text-right font-medium" title="EPS surprise vs consensus">Surprise</th>
                  <th className="py-1 px-1 text-right font-medium" title="Close-to-close reaction the session the move landed">1-day</th>
                  <th className="py-1 pl-1 text-right font-medium" title="Cumulative return over the 5 sessions after the reaction (post-earnings drift)">5-day</th>
                </tr>
              </thead>
              <tbody>
                {ev.map((e, i) => (
                  <tr key={i} className="border-t border-[var(--divider)]">
                    <td className="py-1 pr-2 text-left text-[var(--text-3)]">{new Date(e.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</td>
                    <td className="py-1 px-1 text-right" style={{ color: col(e.surprise) }}>{e.surprise != null ? pp(e.surprise, 0) : "—"}</td>
                    <td className="py-1 px-1 text-right font-semibold" style={{ color: col(e.move) }}>{e.move != null ? pp(e.move) : "—"}</td>
                    <td className="py-1 pl-1 text-right" style={{ color: col(e.drift5) }}>{e.drift5 != null ? pp(e.drift5) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d?.surpriseReaction && (() => {
              const sr = d.surpriseReaction, sellNews = sr.beatUp != null && sr.beatN >= 4 && sr.beatUp <= 0.5;
              return (
                <div className="mt-2 text-[13px] text-[var(--text-3)]" title="Does a beat actually mean the stock goes UP? The directional hit-rate; a low beat→up rate = sell-the-news.">
                  <b className="text-[var(--text-2)]">Reliability</b>
                  {sr.beatUp != null && sr.beatN >= 3 && <span> · beats→up <b style={{ color: sr.beatUp >= 0.6 ? "#22c55e" : sr.beatUp < 0.5 ? "#ef4444" : "var(--text-2)" }}>{Math.round(sr.beatUp * 100)}%</b> ({sr.beatN})</span>}
                  {sr.missDown != null && sr.missN >= 3 && <span> · misses→down <b style={{ color: sr.missDown >= 0.6 ? "#22c55e" : "var(--text-2)" }}>{Math.round(sr.missDown * 100)}%</b> ({sr.missN})</span>}
                  {sellNews && <span className="text-[#ef4444]"> · sell-the-news</span>}
                </div>
              );
            })()}
            {d?.pead && (
              <div className="mt-1 text-[13px] text-[var(--text-3)]" title="Post-earnings drift over the 5 sessions AFTER the initial reaction — does the move continue or fade?">
                <b className="text-[var(--text-2)]">Drift 5d</b>{" "}
                {d.pead.avgBeatDrift5 != null && <>beats <b style={{ color: col(d.pead.avgBeatDrift5) }}>{pp(d.pead.avgBeatDrift5)}</b></>}
                {d.pead.avgMissDrift5 != null && <> · misses <b style={{ color: col(d.pead.avgMissDrift5) }}>{pp(d.pead.avgMissDrift5)}</b></>}
                <span className="text-[var(--text-4)]"> · follows {Math.round(d.pead.followThrough * 100)}%</span>
              </div>
            )}
          </Bento>
        )}

        {/* Options & volatility */}
        {d?.options && (d.options.skew != null || d.options.maxPain != null || d.options.callWall != null || d.volRegime) && (
          <Bento title="Options & volatility">
            {d.volRegime ? (
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <Big value={`${(d.volRegime.atmIV * 100).toFixed(0)}%`} label="implied vol" />
                <Big value={`${(d.volRegime.hv20 * 100).toFixed(0)}%`} label="realized HV20" />
                <div><div className="font-mono text-2xl font-bold leading-none tabular-nums" style={{ color: d.volRegime.ivHvRatio >= 1.3 ? "#ef4444" : d.volRegime.ivHvRatio <= 1 ? "#22c55e" : "var(--text-2)" }}>{d.volRegime.ivHvRatio.toFixed(1)}×</div><div className="mt-1 text-[12px] text-[var(--text-4)]">HV {d.volRegime.hvPctile?.toFixed(0) ?? "?"}ᵗʰ %ile</div></div>
              </div>
            ) : d.options.atmIV != null ? <Big value={`${(d.options.atmIV * 100).toFixed(0)}%`} label="ATM IV" /> : null}
            <div className={"flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--text-3)] " + ((d.volRegime || d.options.atmIV != null) ? "mt-2.5" : "")}>
              {d.options.skew != null && <span title="ATM put IV minus call IV — positive = downside hedging bid"><b className="text-[var(--text-2)]">Skew</b> <span style={{ color: d.options.skew > 0 ? "#ef4444" : "#22c55e" }}>{d.options.skew > 0 ? "puts bid" : "calls bid"} {(Math.abs(d.options.skew) * 100).toFixed(1)}pt</span></span>}
              {d.options.maxPain != null && <span title="Strike that minimizes total option payout at expiry"><b className="text-[var(--text-2)]">Max pain</b> ${d.options.maxPain.toFixed(0)}{d.options.maxPainVsSpot != null ? ` (${pp(d.options.maxPainVsSpot, 0)})` : ""}</span>}
              {d.options.callWall && <span title="Heaviest call open interest above spot — a level dealer gamma can cap / pin"><b className="text-[var(--text-2)]">Call wall</b> ${d.options.callWall.strike.toFixed(0)}</span>}
              {d.options.putWall && <span title="Heaviest put open interest below spot — support / magnet"><b className="text-[var(--text-2)]">Put wall</b> ${d.options.putWall.strike.toFixed(0)}</span>}
            </div>
            {ivs && (
              <div className="mt-2 border-t border-[var(--divider)] pt-2 text-[13px] text-[var(--text-3)]" title="From this name's own IV history (accrues over earnings cycles). IV-rank = where the current event IV sits vs its past. Realized crush = avg drop in ATM IV the session AFTER past prints — the vol decay a long-premium buyer pays.">
                {ivs.ivRank != null && <span><b className="text-[var(--text-2)]">IV-rank</b> {ivs.ivRank.toFixed(0)}<span className="text-[var(--text-4)]">ᵗʰ %ile</span></span>}
                {ivs.avgCrushPct != null && <span> · <b className="text-[var(--text-2)]">realized crush</b> <b style={{ color: ivs.avgCrushPct >= 15 ? "#ef4444" : "var(--text-2)" }}>−{ivs.avgCrushPct.toFixed(0)}%</b> <span className="text-[var(--text-4)]">avg after prints ({ivs.crushN})</span></span>}
              </div>
            )}
          </Bento>
        )}

        {/* Street positioning */}
        <Bento title="Street positioning">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {beatRate != null && <Big value={`${(beatRate * 100).toFixed(0)}%`} label={`beat rate (${sp.length}q)`} />}
            {upside != null && <Big value={pp(upside, 0)} label="to mean PT" color={col(upside)} />}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--text-3)]">
            {buys != null && sells != null && <span><b className="text-[var(--text-2)]">Ratings</b> {buys}B / {r!.hold}H / {sells}S</span>}
            {stats.shortPercentOfFloat != null && <span><b className="text-[var(--text-2)]">Short</b> {(stats.shortPercentOfFloat * 100).toFixed(1)}%{shortMoM != null ? ` ${shortMoM >= 0 ? "↑" : "↓"}${Math.abs(shortMoM * 100).toFixed(0)}%` : ""}{stats.shortRatio != null ? ` · ${stats.shortRatio.toFixed(1)}d cover` : ""}</span>}
            {stats.forwardPE != null && <span><b className="text-[var(--text-2)]">Fwd P/E</b> {stats.forwardPE.toFixed(0)}</span>}
            {avgSurprise != null && <span><b className="text-[var(--text-2)]">Avg surprise</b> {pp(avgSurprise, 1)}</span>}
          </div>
          {moves.length > 0 && (
            <div className="mt-2 border-t border-[var(--divider)] pt-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Analyst moves into the print</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {moves.map((c, i) => {
                  const up = c.action === "up", down = c.action === "down", init = c.action === "init";
                  const ac = up ? "#22c55e" : down ? "#ef4444" : "var(--text-3)";
                  const arrow = up ? "↑" : down ? "↓" : init ? "◆" : "•";
                  return (
                    <span key={i} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[12px] tabular-nums text-[var(--text-3)]" title={`${c.firm}: ${c.fromGrade ? c.fromGrade + " → " : ""}${c.toGrade}${c.targetTo != null ? ` · PT $${c.targetTo}` : ""}`}>
                      <span className="text-[var(--text-4)]">{new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> <span style={{ color: ac }}>{arrow}</span> {c.firm}{c.targetTo != null ? <span className="text-[var(--text-4)]"> ${c.targetTo}</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </Bento>

        {/* Peers & read-through */}
        {(peerCal.length > 0 || (d?.peerSympathy && d.peerSympathy.length > 0)) && (
          <Bento title="Peers & read-through" hint="Cohort peers reporting near this print, and how this stock has co-moved on their prints.">
            {peerCal.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {peerCal.map((p) => {
                  const dd = Math.round((p.t - Date.now()) / 86_400_000);
                  const before = myEarn != null && p.t < myEarn && dd >= 0;
                  return (
                    <span key={p.sym} className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[12px] tabular-nums" title={`${p.sym} reports ${mDay(p.t)}${myEarn != null ? (p.t < myEarn ? " — before this print (read-through)" : " — after this print") : ""}`}>
                      <span className="text-[var(--text-2)]">{p.sym}</span> <span className="text-[var(--text-4)]">{dd < 0 ? "reported" : mDay(p.t)}</span>{before ? <span className="text-[var(--accent)]"> ⮞</span> : null}
                    </span>
                  );
                })}
              </div>
            )}
            {d?.peerSympathy && d.peerSympathy.length > 0 && (
              <div className={"text-[13px] text-[var(--text-3)] " + (peerCal.length ? "mt-2" : "")} title="On each peer's past prints, how this stock moved: avg |same-day move|, β, same-direction rate.">
                <span className="text-[var(--text-4)]">Sympathy on their prints:</span>{" "}
                {d.peerSympathy.map((s, i) => <span key={s.sym} className="tabular-nums">{i ? " · " : ""}<span className="text-[var(--text-2)]">{s.sym}</span> ±{(s.avgAbsMe * 100).toFixed(1)}%{s.beta != null ? ` β${s.beta.toFixed(1)}` : ""}</span>)}
              </div>
            )}
          </Bento>
        )}
      </div>

      {/* AI StreetAccount-style preview (button-triggered) */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">AI preview <span className="font-normal normal-case">· StreetAccount-style, grounded in the signals above</span></div>
        {ai === "idle" ? (
          <div>
            <button onClick={() => runAi(aiSignals)} className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90">Build the earnings preview →</button>
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
            <button onClick={() => runAi(aiSignals)} className="text-[var(--accent)] underline hover:no-underline">Try again</button>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">Consensus, revisions, ratings &amp; short interest via Yahoo; reaction = close-to-close moves on past prints; implied move + skew/max-pain from the options chain. AI context — decision-support, not investment advice.</p>
    </div>
  );
}
