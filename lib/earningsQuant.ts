/**
 * The earnings-prep QUANT ENGINE — the options + reaction-history read behind the stock page's
 * Earnings tab, extracted from app/api/earnings-prep/[symbol]/route.ts so the nightly preview logger
 * (scripts/refresh-earnings-preview-log.ts) computes from the SAME code path the live card shows.
 * The lib/earningsTrade.ts precedent: a logged record is only meaningful if it's byte-for-byte what
 * the user saw. SERVER-ONLY (options chains, yahoo, fs) — never import from a "use client" file.
 */
import { getEarningsReactions } from "./earningsReaction";
import { loadEarningsMove } from "./earningsMove";
import { getOptions, getTermStructure, type OptionChain, type Opt } from "./options";
import { straddleMove, tradeIdea } from "./earningsTrade";
import { peerCohort } from "./peerCohorts";
import { yahoo } from "./yahooClient";
import { beatGuide, type GuidanceData, type GuidanceTicker } from "./guidance";
import type { SssData, SssTicker } from "./sameStoreSales";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function optionsRead(chain: OptionChain | null) {
  if (!chain || !chain.underlying || (!chain.calls.length && !chain.puts.length)) return null;
  const u = chain.underlying;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length < 3) return null;
  const atm = strikes.reduce((a, b) => (Math.abs(b - u) < Math.abs(a - u) ? b : a));
  const cIV = chain.calls.find((o) => o.strike === atm)?.iv ?? null;
  const pIV = chain.puts.find((o) => o.strike === atm)?.iv ?? null;
  const atmVals = [cIV, pIV].filter((v): v is number => v != null && v > 0);
  // Max pain: the settle price (= a listed strike) that minimizes total option payout to holders.
  let maxPain: number | null = null, bestPay = Infinity;
  for (const S of strikes) {
    let pay = 0;
    for (const c of chain.calls) if (c.oi && c.strike < S) pay += c.oi * (S - c.strike);
    for (const p of chain.puts) if (p.oi && p.strike > S) pay += p.oi * (p.strike - S);
    if (pay < bestPay) { bestPay = pay; maxPain = S; }
  }
  // OI walls — the heaviest open-interest strikes around spot. A big call wall above caps/pins
  // upside; a big put wall below acts as a magnet/support. Dealers hedge around them.
  let callWall: { strike: number; oi: number } | null = null;
  let putWall: { strike: number; oi: number } | null = null;
  for (const c of chain.calls) if (c.oi && c.strike >= u && (!callWall || c.oi > callWall.oi)) callWall = { strike: c.strike, oi: c.oi };
  for (const p of chain.puts) if (p.oi && p.strike <= u && (!putWall || p.oi > putWall.oi)) putWall = { strike: p.strike, oi: p.oi };
  return {
    expiry: chain.selected,
    atmIV: atmVals.length ? atmVals.reduce((a, b) => a + b, 0) / atmVals.length : null,
    skew: cIV != null && pIV != null ? pIV - cIV : null, // >0 = puts bid over calls (downside hedging)
    maxPain,
    maxPainVsSpot: maxPain ? maxPain / u - 1 : null,
    callWall,
    putWall,
  };
}

// IV term structure → expected vol-crush: the front (event) cycle's ATM IV vs a later cycle's. Event
// IV sits elevated into the print and collapses the morning after, so a front-rich (backwardated) term
// structure is the crush a premium-seller harvests. crushRatio = frontIV / backIV (>~1.1 = meaningful).
export function termRead(ts: { points: { date: string; dte: number; atmIV: number | null }[] } | null) {
  if (!ts) return null;
  const pts = ts.points.filter((p) => p.atmIV != null && p.atmIV > 0 && p.dte >= 0).sort((a, b) => a.dte - b.dte);
  if (pts.length < 2) return null;
  const front = pts[0];
  const back = pts.find((p) => p.dte >= front.dte + 15) || pts[pts.length - 1]; // a genuinely later cycle
  if (back === front || back.atmIV == null || back.atmIV <= 0 || front.atmIV == null) return null;
  return { frontIV: front.atmIV, backIV: back.atmIV, frontDte: front.dte, backDte: back.dte, crushRatio: front.atmIV / back.atmIV };
}

// Compact strike ladder (~15 strikes around ATM) from the EVENT chain + context — feeds the client-side
// IV-crush scenario tool (components/IvCrushScenario), which reprices with Black-Scholes as the user
// drags a vol-crush slider. Sent once; all the interactivity (IV solved from premium) is client-side.
export function ivScenarioFrom(
  sm: { price: number; atmStrike: number; expiry: string | null; dte: number | null; chain: OptionChain } | null,
  chain: OptionChain | null,
  term: { crushRatio: number } | null,
) {
  const src = sm?.chain ?? chain;
  if (!src?.underlying || (!src.calls.length && !src.puts.length)) return null;
  const S = sm?.price ?? src.underlying;
  const strikes = [...new Set([...src.calls, ...src.puts].map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length < 5) return null;
  // Nearest LISTED strike to spot — re-derive from the strike set so the ATM is always in the ladder
  // (sm.atmStrike can be a float that isn't an exact set member → indexOf -1 → a mis-centered slice).
  const atm = strikes.reduce((a, b) => (Math.abs(b - S) < Math.abs(a - S) ? b : a));
  const ai = strikes.indexOf(atm);
  const lo = Math.max(0, ai - 7), hi = Math.min(strikes.length, ai + 8);
  const mid = (o: Opt | undefined): number | null =>
    o && o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o?.last != null && o.last > 0 ? o.last : null;
  const ladder = strikes
    .slice(lo, hi)
    .map((k) => {
      const c = src.calls.find((o) => o.strike === k), p = src.puts.find((o) => o.strike === k);
      return { k, cMid: mid(c), cIV: c?.iv ?? null, pMid: mid(p), pIV: p?.iv ?? null };
    })
    .filter((r) => r.cMid != null || r.pMid != null);
  if (ladder.length < 4) return null;
  const expectedCrushPct = term && term.crushRatio > 1 ? Math.round((1 - 1 / term.crushRatio) * 100) : null;
  return { spot: S, atmStrike: atm, expiry: sm?.expiry ?? src.selected, dteNow: sm?.dte ?? null, expectedCrushPct, ladder };
}

// ~2yr of daily closes (dated) — for the realized-vol regime + the peer-sympathy day lookups.
export async function dailyCloses(sym: string): Promise<{ t: number; c: number }[]> {
  try {
    const chart: any = await yahoo.chart(sym, { period1: new Date(Date.now() - 760 * 86_400_000), interval: "1d" } as any, { validateResult: false });
    return (chart.quotes || []).filter((q: any) => q?.date && q.close != null).map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close as number })).sort((a: any, b: any) => a.t - b.t);
  } catch {
    return [];
  }
}

// Quantified peer read-through (sympathy): when a cohort peer reported in the past, how did THIS stock
// move that day? Returns, per peer: avg |this stock's same-day move|, the slope (beta) of this stock's
// move on the peer's move, and the same-direction rate. A peer printing before this name is a live prior.
export async function peerReadThrough(sym: string, myCloses: { t: number; c: number }[]) {
  const cohort = peerCohort(sym);
  if (!cohort || myCloses.length < 60) return null;
  const dayMove = new Map<string, number>(); // YYYY-MM-DD → this stock's close-to-close move that session
  for (let i = 1; i < myCloses.length; i++) dayMove.set(new Date(myCloses[i].t).toISOString().slice(0, 10), myCloses[i].c / myCloses[i - 1].c - 1);
  const peers = cohort.tickers.filter((t) => t !== sym).slice(0, 4);
  const out = await Promise.all(peers.map(async (p) => {
    const pr = await getEarningsReactions(p, 8).catch(() => []);
    const pairs: { peer: number; me: number }[] = [];
    for (const e of pr) { if (e.move == null) continue; const me = dayMove.get(e.reactionDate); if (me != null) pairs.push({ peer: e.move, me }); }
    if (pairs.length < 3) return null;
    const avgAbsMe = pairs.reduce((a, x) => a + Math.abs(x.me), 0) / pairs.length;
    const mp = pairs.reduce((a, x) => a + x.peer, 0) / pairs.length, mm = pairs.reduce((a, x) => a + x.me, 0) / pairs.length;
    let cov = 0, vp = 0; for (const x of pairs) { cov += (x.peer - mp) * (x.me - mm); vp += (x.peer - mp) ** 2; }
    const beta = vp > 0 ? cov / vp : null;
    const sameDir = pairs.filter((x) => Math.sign(x.peer) === Math.sign(x.me) && x.peer !== 0).length / pairs.length;
    return { sym: p, n: pairs.length, avgAbsMe, beta, sameDir };
  }));
  const list = out.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.avgAbsMe - a.avgAbsMe);
  return list.length ? list : null;
}

// Vol regime: is the event IV rich in ABSOLUTE terms? ATM IV vs trailing realized (historical) vol +
// where current 20d HV sits in its own 1yr range. (Options rich/cheap compares IV to the realized MOVE;
// this compares IV to day-to-day realized vol — the variance-risk-premium view.)
export function volRegimeFrom(closes: number[], atmIV: number | null) {
  if (atmIV == null || closes.length < 40) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const ann = (r: number[]) => { if (r.length < 5) return null; const m = r.reduce((a, b) => a + b, 0) / r.length; const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); return sd * Math.sqrt(252); };
  const hv20 = ann(rets.slice(-20));
  if (hv20 == null || hv20 <= 0) return null;
  const roll: number[] = [];
  for (let i = 20; i <= rets.length; i++) { const v = ann(rets.slice(i - 20, i)); if (v != null) roll.push(v); }
  const hvPctile = roll.length ? (roll.filter((v) => v <= hv20).length / roll.length) * 100 : null;
  return { atmIV, hv20, ivHvRatio: atmIV / hv20, hvPctile };
}

// Standing guidance + comp series (nightly LLM extracts) — read here so the AI preview's signal
// line is built from the server's own data, mirroring what the stock page feeds the card.
export function loadGuidance(sym: string): GuidanceTicker | null {
  try {
    const p = join(process.cwd(), "data", "guidance.json");
    if (!existsSync(p)) return null;
    return (JSON.parse(readFileSync(p, "utf8")) as GuidanceData).byTicker?.[sym] ?? null;
  } catch { return null; }
}
export function loadSss(sym: string): SssTicker | null {
  try {
    const p = join(process.cwd(), "data", "same-store-sales.json");
    if (!existsSync(p)) return null;
    return (JSON.parse(readFileSync(p, "utf8")) as SssData).byTicker?.[sym] ?? null;
  } catch { return null; }
}

// The full options + reaction-history quant read — shared by the card (part=data), the AI preview's
// QUANT SIGNALS line (part=ai), and the nightly preview logger, so every consumer sees the SAME numbers.
export async function computeQuant(sym: string, earningsISO: string | null) {
  const [reactions, emove, chain, ts, closes] = await Promise.all([
    getEarningsReactions(sym, 8).catch(() => []),
    loadEarningsMove().catch(() => null),
    getOptions(sym).catch(() => null),
    getTermStructure(sym, 6).catch(() => null),
    dailyCloses(sym),
  ]);
  const term = termRead(ts);
  const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
  const reaction = moves.length
    ? { avgAbsMove: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length, maxAbsMove: Math.max(...moves.map(Math.abs)), upRate: moves.filter((m) => m > 0).length / moves.length, n: moves.length }
    : null;
  const events = (reactions || []).filter((r) => r.move != null).slice(0, 8).map((r) => ({ date: r.date, surprise: r.surprise, move: r.move, drift5: r.drift5, timing: r.timing }));
  // Typical reporting timing (the company's own pattern) → when the NEXT print's move lands: before-open
  // reporters move that session, after-close reporters move the next session.
  const tg = (reactions || []).map((r) => r.timing);
  const nextTiming: "bmo" | "amc" | null = tg.length ? (tg.filter((t) => t === "amc").length >= tg.length / 2 ? "amc" : "bmo") : null;
  // Implied move: PREFER the live ATM-straddle cost from the chain (works for any name, always fresh);
  // fall back to the precomputed earnings-move file when there's no usable chain.
  const sm = await straddleMove(sym, chain, earningsISO);
  const impliedMove = sm?.movePct ?? (emove?.rows || []).find((r) => r.symbol === sym)?.impliedMovePct ?? null;
  // The straddle ≈ the EARNINGS move only when we picked the expiry bracketing earnings AND it's near
  // (a far-out straddle is mostly time value, not the event) — so the rich/cheap-vs-1-day-reaction
  // comparison is gated on that. The precomputed-file fallback (sm==null) is already an ≤16d event move.
  const nearTerm = !sm ? true : sm.isEvent && (sm.dte == null || sm.dte <= 21);
  const options = optionsRead(chain);
  // Isolated EVENT move: strip the baseline (non-event) vol out of the front straddle using the back-cycle
  // IV. Both straddles scale ~linearly with IV over the same horizon, so eventMove = impliedMove·√(1−1/crush²)
  // — the variance decomposition of the front move into event + calendar vol. Only when the front is elevated.
  const eventMove = nearTerm && impliedMove != null && term && term.crushRatio > 1 ? impliedMove * Math.sqrt(1 - 1 / (term.crushRatio * term.crushRatio)) : null;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  // Straddle "win-rate": of past prints, how often the realized move EXCEEDED what options price now.
  const straddleWinRate = nearTerm && impliedMove != null && moves.length ? { exceeded: moves.filter((m) => Math.abs(m) > impliedMove / 100).length, total: moves.length } : null;
  // PEAD: post-earnings 5-day drift after beats vs misses + follow-through rate (drift same sign as the day-1 move).
  const withDrift = (reactions || []).filter((r) => r.drift5 != null) as { move: number | null; surprise: number | null; drift5: number }[];
  const beatDrift = withDrift.filter((r) => r.surprise != null && r.surprise > 0).map((r) => r.drift5);
  const missDrift = withDrift.filter((r) => r.surprise != null && r.surprise <= 0).map((r) => r.drift5);
  const ftSet = withDrift.filter((r) => r.move != null);
  const pead = ftSet.length >= 3
    ? { avgBeatDrift5: avg(beatDrift), avgMissDrift5: avg(missDrift), followThrough: ftSet.filter((r) => Math.sign(r.move!) === Math.sign(r.drift5)).length / ftSet.length, n: ftSet.length }
    : null;

  // Reaction reliability: does a beat actually mean UP (sell-the-news), and a miss mean DOWN? The
  // DIRECTIONAL hit-rate is robust at small n (Yahoo keeps ~4 surprises); a fitted slope/intercept is
  // not, so we don't report one. Complements the beats/misses AVERAGE (which shows magnitude, not consistency).
  const srP = (reactions || []).filter((r) => r.surprise != null && r.move != null).map((r) => ({ x: r.surprise as number, y: r.move as number }));
  const surpriseReaction = (() => {
    const beats = srP.filter((p) => p.x > 0), misses = srP.filter((p) => p.x < 0);
    if (beats.length < 3 && misses.length < 3) return null;
    return {
      n: srP.length,
      beatUp: beats.length ? beats.filter((p) => p.y > 0).length / beats.length : null, beatN: beats.length,
      missDown: misses.length ? misses.filter((p) => p.y < 0).length / misses.length : null, missN: misses.length,
    };
  })();

  // Options rich/cheap (implied vs avg REALIZED move) + the straddle breakevens.
  const price = chain?.underlying ?? null;
  const avgRealized = reaction ? reaction.avgAbsMove * 100 : null; // %
  const richness =
    nearTerm && impliedMove != null && avgRealized != null && avgRealized > 0
      ? { ratio: impliedMove / avgRealized, verdict: impliedMove / avgRealized >= 1.2 ? "rich" : impliedMove / avgRealized <= 0.85 ? "cheap" : "fair", avgRealized }
      : null;
  // Straddle breakevens + cost: the REAL straddle when we have the live chain (with its expiry/DTE),
  // else derived from the implied-move % and spot.
  const straddle = sm
    ? { cost: sm.cost, upperBE: sm.upperBE, lowerBE: sm.lowerBE, price: sm.price, expiry: sm.expiry, dte: sm.dte, live: true, bid: sm.liq.bid, ask: sm.liq.ask, widthPct: sm.liq.widthPct, oi: sm.liq.oi, vol: sm.liq.vol }
    : impliedMove != null && price
      ? { cost: (price * impliedMove) / 100, upperBE: price * (1 + impliedMove / 100), lowerBE: price * (1 - impliedMove / 100), price, expiry: null, dte: null, live: false, bid: null, ask: null, widthPct: null, oi: null, vol: null }
      : null;
  const volRegime = volRegimeFrom(closes.map((x) => x.c), options?.atmIV ?? null);
  // Price the legs on the SAME expiry the straddle used (the one bracketing earnings), not the nearest
  // chain — so the suggested strikes and their premiums are internally consistent with the implied move.
  const trade = tradeIdea(richness, options, straddle, sm?.chain ?? chain, impliedMove, term);
  // Strike ladder for the interactive IV-crush scenario matrix (client reprices via Black-Scholes).
  const ivScenario = ivScenarioFrom(sm, chain, term);
  // Should you BUY premium (calls/puts/straddle) into the print? Even a right directional call loses if
  // the move comes in UNDER the priced move and the IV crushes. Synthesize: how often the realized move
  // cleared the implied (incl. CONDITIONAL on a beat — the call-buyer's case), + rich/cheap + the crush.
  const longPremium = (() => {
    if (!nearTerm || impliedMove == null) return null;
    const im = impliedMove / 100;
    const beats = (reactions || []).filter((r) => r.surprise != null && r.surprise > 0 && r.move != null);
    const beatClear = beats.filter((r) => (r.move as number) > im).length; // beat AND rose MORE than priced
    const clearRate = straddleWinRate && straddleWinRate.total ? straddleWinRate.exceeded / straddleWinRate.total : null;
    const richV = richness?.verdict;
    let verdict: "favorable" | "neutral" | "unfavorable" = "neutral";
    if (richV === "cheap" && (clearRate == null || clearRate >= 0.45)) verdict = "favorable";
    else if (richV === "rich" || (clearRate != null && clearRate <= 0.4)) verdict = "unfavorable";
    return { verdict, beatClear, beatN: beats.length, crushRatio: term?.crushRatio ?? null };
  })();
  // Daily price series (compact [t,c] tuples) for the expected-move cone. ~14 months (well past the
  // longest 1Y lookback) so the cone's client-side timeframe selector can window it down to 3M/6M/YTD/1Y.
  const priceSeries = closes.slice(-300).map((x) => [x.t, Math.round(x.c * 100) / 100] as [number, number]);

  return { reaction, events, impliedMove, eventMove, options, richness, straddle, straddleWinRate, pead, term, nextTiming, volRegime, trade, surpriseReaction, priceSeries, longPremium, ivScenario, closes };
}

export type QuantResult = Awaited<ReturnType<typeof computeQuant>>;

// Server-side rebuild of the card's quant-signal line for the AI preview. The LLM's "QUANT SIGNALS"
// input must come from this terminal's OWN computation — the old client-supplied ?sig= param let a
// crafted URL feed the model fabricated signals (and the poisoned preview would be CDN-cached).
// Mirrors the aiSignals composition in components/EarningsPrep.tsx.
export function buildSig(q: QuantResult, guid: GuidanceTicker | null, sss: SssTicker | null): string {
  const pp = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
  const o: string[] = [];
  if (q.richness && q.impliedMove != null) o.push(`options ${q.richness.verdict.toUpperCase()} — pricing ±${q.impliedMove.toFixed(1)}% vs ±${q.richness.avgRealized.toFixed(1)}% avg realized move (${q.richness.ratio.toFixed(1)}x)`);
  else if (q.impliedMove != null && q.straddle?.dte != null) o.push(`options imply ±${q.impliedMove.toFixed(1)}% by expiry (${q.straddle.dte}d out)`);
  if (q.term && q.term.crushRatio >= 1.04) o.push(`IV term backwardated ${q.term.crushRatio.toFixed(2)}x (vol crush into the print)`);
  if (q.volRegime) o.push(`IV ${(q.volRegime.atmIV * 100).toFixed(0)}% vs realized HV ${(q.volRegime.hv20 * 100).toFixed(0)}% (${q.volRegime.ivHvRatio.toFixed(1)}x; HV ${q.volRegime.hvPctile?.toFixed(0) ?? "?"}th pctile)`);
  if (q.options?.skew != null && Math.abs(q.options.skew) > 0.02) o.push(`options skew: ${q.options.skew > 0 ? "puts bid (downside hedging)" : "calls bid (upside chase)"}`);
  if (q.pead) o.push(`post-print 5d drift: after beats ${pp(q.pead.avgBeatDrift5)}, after misses ${pp(q.pead.avgMissDrift5)}`);
  if (q.surpriseReaction?.beatUp != null && q.surpriseReaction.beatN >= 3) o.push(`beats→up ${Math.round(q.surpriseReaction.beatUp * 100)}% of ${q.surpriseReaction.beatN}${q.surpriseReaction.beatUp <= 0.5 && q.surpriseReaction.beatN >= 4 ? " (sell-the-news pattern)" : ""}`);
  if (q.longPremium && q.longPremium.beatN >= 3) o.push(`buying premium ${q.longPremium.verdict} — on past beats the stock cleared the implied move only ${q.longPremium.beatClear}/${q.longPremium.beatN} (a right call can lose to a small move + IV crush)`);
  const ps = (sss?.periods || []).filter((p) => p.comp != null);
  if (ps.length) {
    const seq = ps[1]?.comp != null ? (ps[0].comp as number) - (ps[1].comp as number) : null;
    o.push(`last comp ${(ps[0].comp as number) >= 0 ? "+" : ""}${(ps[0].comp as number).toFixed(1)}%${seq != null ? ` (${seq >= 0 ? "accelerating" : "decelerating"})` : ""}`);
  }
  const g0 = (guid?.guides || []).find((g) => g.action !== "none");
  if (g0) o.push(`standing guidance ${g0.period} ${g0.action.toUpperCase()}`);
  const bg = beatGuide(guid?.history);
  if (bg) o.push(`beats its own guide ${bg.beats}/${bg.total}${bg.avgVsGuide != null && bg.avgVsGuide > 0.01 && bg.beats / bg.total >= 0.7 ? " — guides conservatively" : ""}`);
  // Momentum into the print, from the same daily-close series (the card shows the snapshot's 1w/52wk-high).
  if (q.closes.length >= 6) {
    const last = q.closes[q.closes.length - 1].c, wAgo = q.closes[q.closes.length - 6].c;
    const hi52 = Math.max(...q.closes.slice(-252).map((x) => x.c));
    const r1w = wAgo > 0 ? (last / wAgo - 1) * 100 : null;
    const fromHigh = hi52 > 0 ? (last / hi52 - 1) * 100 : null;
    if (r1w != null) o.push(`into the print ${r1w >= 0 ? "+" : ""}${r1w.toFixed(1)}% 1wk${fromHigh != null ? `, ${fromHigh >= -1.5 ? "at" : `${Math.abs(fromHigh).toFixed(0)}% below`} 52wk high` : ""}`);
  }
  return o.join(" · ");
}
