/**
 * Earnings trade-idea generation — the single source of truth for the concrete option structure the
 * Earnings-prep card suggests (rich → sell premium, cheap → own the move) AND the nightly trade-log
 * that tracks how those suggestions actually do. Keeping ONE definition here is correctness-critical:
 * if the logged trade drifted from the card's trade, the track record would be meaningless.
 *
 * Server-only (imports getOptions / getEarningsReactions). NEVER import from a "use client" component —
 * lib/tradeLog.ts holds the client-safe types + settlement math.
 */
import { getOptions, type OptionChain, type Opt } from "@/lib/options";
import { getEarningsReactions } from "@/lib/earningsReaction";

export interface TradeLegSpec {
  type: "C" | "P";
  side: "long" | "short";
  strike: number;
  premium: number; // per-share mid (or last) at generation time
}

export interface TradeIdea {
  verdict: "rich" | "cheap";
  structure: string; // e.g. "Short strangle", "Iron condor (defined risk)"
  legs: string; // human-readable leg list
  rationale: string;
  expiry: string | null; // the option expiry the legs are priced on (brackets the earnings event)
  dte: number | null; // calendar days to that expiry
  legsData?: TradeLegSpec[]; // structured legs WITH premiums — present only when every leg has a usable quote
  lean?: "bullish" | "bearish" | null; // positioning read (skew + max-pain + walls) — informational, not a call
  alt?: { structure: string; legs: string; rationale: string; kind: "directional" | "calendar" } | null; // one conditional alternative
}

const midOf = (o: Opt | undefined): number | null => {
  if (!o) return null;
  if (o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2; // prefer the quote midpoint
  return o.last != null && o.last > 0 ? o.last : null; // fall back to last trade
};

// ATM put IV − call IV: >0 means puts are bid over calls (downside hedging skew) → prefer a defined-risk condor.
function skewOf(chain: OptionChain | null): number | null {
  if (!chain?.underlying || (!chain.calls.length && !chain.puts.length)) return null;
  const u = chain.underlying;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))];
  if (!strikes.length) return null;
  const atm = strikes.reduce((a, b) => (Math.abs(b - u) < Math.abs(a - u) ? b : a));
  const cIV = chain.calls.find((o) => o.strike === atm)?.iv ?? null;
  const pIV = chain.puts.find((o) => o.strike === atm)?.iv ?? null;
  return cIV != null && pIV != null ? pIV - cIV : null;
}

// Live implied move from what the ATM STRADDLE actually costs: pick the expiry that brackets the next
// earnings date (or the nearest expiry), take the ATM call+put mid, and read move = straddle / spot.
// Returns the RESOLVED event chain so the trade idea prices its legs on the SAME expiry as the straddle.
export async function straddleMove(sym: string, baseChain: OptionChain | null, earningsISO: string | null) {
  if (!baseChain?.underlying || !baseChain.expirations?.length) return null;
  let expiry = baseChain.selected,
    isEvent = false;
  if (earningsISO) {
    // Bracketing rule: an AFTER-CLOSE print (timestamped ≥20:00 UTC ≈ post-4pm-ET) happens AFTER
    // same-day options die at the close, so the expiry must be STRICTLY after the report date —
    // BMNR's play once used a same-day expiry and "settled" hours before the print. Date-only or
    // pre-close timestamps keep on-or-after (a BMO print is bracketed by that day's expiry).
    const day = earningsISO.slice(0, 10);
    const t = Date.parse(earningsISO);
    const amc = earningsISO.length > 10 && Number.isFinite(t) && new Date(t).getUTCHours() >= 20;
    const ev = baseChain.expirations.find((d) => (amc ? d > day : d >= day));
    if (ev) {
      expiry = ev;
      isEvent = true;
    }
  }
  const chain = expiry && expiry !== baseChain.selected ? await getOptions(sym, expiry).catch(() => baseChain) : baseChain;
  const U = chain.underlying;
  if (!U || (!chain.calls.length && !chain.puts.length)) return null;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))];
  if (!strikes.length) return null;
  const atm = strikes.reduce((a, b) => (Math.abs(b - U) < Math.abs(a - U) ? b : a));
  const cO = chain.calls.find((o) => o.strike === atm), pO = chain.puts.find((o) => o.strike === atm);
  const c = midOf(cO), p = midOf(pO);
  if (c == null || p == null) return null;
  const cost = c + p;
  if (cost <= 0 || cost / U > 0.6) return null; // sanity (>60%-of-spot straddle = junk quotes)
  const dte = chain.selected ? Math.round((Date.parse(chain.selected + "T00:00:00Z") - Date.now()) / 86_400_000) : null;
  // Execution read on the ATM straddle: is it tradeable at a fair spread? BOTH legs need a live two-sided
  // quote (bid>0 & ask>0) or the width is meaningless (OTM zero-bids / after-hours). OI + volume gauge depth.
  const twoSided = !!(cO?.bid && cO?.ask && pO?.bid && pO?.ask);
  const bid = twoSided ? cO!.bid! + pO!.bid! : null;
  const ask = twoSided ? cO!.ask! + pO!.ask! : null;
  const liq = {
    bid,
    ask,
    widthPct: bid != null && ask != null && cost > 0 ? ((ask - bid) / cost) * 100 : null,
    oi: (cO?.oi ?? 0) + (pO?.oi ?? 0) || null,
    vol: (cO?.vol ?? 0) + (pO?.vol ?? 0) || null,
  };
  return { movePct: (cost / U) * 100, cost, atmStrike: atm, upperBE: U + cost, lowerBE: U - cost, price: U, expiry: chain.selected, dte, isEvent, chain, liq };
}

// Earnings-day trade idea — turn the rich/cheap + skew read into a concrete structure at expected-move
// strikes pulled from the live chain. Decision-support, not advice (NO_ADVICE is on the AI side). Legs
// are priced on the SAME (event) chain the straddle used, and the chosen expiry is reported.
export function tradeIdea(
  richness: { verdict: string; avgRealized: number } | null,
  optionsR: { skew: number | null; maxPainVsSpot?: number | null; callWall?: { strike: number } | null; putWall?: { strike: number } | null } | null,
  straddle: { lowerBE: number; upperBE: number; price: number; expiry?: string | null; dte?: number | null } | null,
  chain: OptionChain | null,
  impliedMove: number | null,
  term?: { crushRatio: number; frontDte: number; backDte: number } | null,
): TradeIdea | null {
  if (!richness || !straddle || !chain || impliedMove == null) return null;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length < 4) return null;
  const near = (t: number) => strikes.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const putK = near(straddle.lowerBE),
    callK = near(straddle.upperBE),
    atmK = near(straddle.price);
  const fmt = (k: number) => (Number.isInteger(k) ? `${k}` : k.toFixed(1));
  const exp = straddle.expiry ?? null;
  const dte = straddle.dte ?? null;
  const prem = (type: "C" | "P", k: number): number | null => midOf((type === "C" ? chain.calls : chain.puts).find((x) => x.strike === k));
  // structured legs WITH premiums (for the payoff diagram + the trade log) — only when every leg has a usable quote.
  const legsOf = (specs: { type: "C" | "P"; side: "long" | "short"; strike: number }[]): TradeLegSpec[] | undefined => {
    const out = specs.map((s) => ({ ...s, premium: prem(s.type, s.strike) }));
    return out.every((l) => l.premium != null) ? (out as TradeLegSpec[]) : undefined;
  };
  // Positioning LEAN (informational): skew (puts vs calls bid) + max-pain pull + wall placement. Needs ≥2
  // non-neutral signals to agree — max-pain alone is a soft "pin" signal, so it can't drive it by itself.
  const lean: "bullish" | "bearish" | null = (() => {
    const sig: number[] = [];
    if (optionsR?.skew != null) sig.push(optionsR.skew > 0.03 ? -1 : optionsR.skew < -0.03 ? 1 : 0); // puts bid → downside hedged
    if (optionsR?.maxPainVsSpot != null) sig.push(optionsR.maxPainVsSpot > 0.015 ? 1 : optionsR.maxPainVsSpot < -0.015 ? -1 : 0); // pin above spot → upward pull
    if (optionsR?.callWall && optionsR?.putWall) {
      const cd = Math.abs(optionsR.callWall.strike - straddle.price), pd = Math.abs(optionsR.putWall.strike - straddle.price);
      sig.push(cd < pd ? -1 : cd > pd ? 1 : 0); // nearer call wall caps upside → bearish tilt
    }
    if (sig.filter((s) => s !== 0).length < 2) return null;
    const net = sig.reduce((a, b) => a + b, 0);
    return net >= 2 ? "bullish" : net <= -2 ? "bearish" : null;
  })();
  const wing = Math.max((callK - putK) / 2, (impliedMove / 100) * straddle.price) || 5;
  // ONE conditional alternative: a directional vertical when the lean is clear, else a calendar when the
  // term crush is steep (rich premium + a genuinely later cycle to sell the event-inflated front against).
  const alt: TradeIdea["alt"] = (() => {
    if (lean === "bearish" && richness.verdict === "rich")
      return { kind: "directional", structure: "Bear call spread", legs: `short ${fmt(callK)}C / long ${fmt(near(callK + wing))}C`, rationale: "Positioning leans bearish (skew / max-pain / walls) — sell upside you're not paid for, cap the risk." };
    if (lean === "bullish" && richness.verdict === "rich")
      return { kind: "directional", structure: "Bull put spread", legs: `short ${fmt(putK)}P / long ${fmt(near(putK - wing))}P`, rationale: "Positioning leans bullish — sell the downside, define the risk." };
    if (lean === "bearish" && richness.verdict === "cheap")
      return { kind: "directional", structure: "Long put / put vertical", legs: `long ${fmt(atmK)}P`, rationale: "Cheap vol + bearish lean — own the downside directly." };
    if (lean === "bullish" && richness.verdict === "cheap")
      return { kind: "directional", structure: "Long call / call vertical", legs: `long ${fmt(atmK)}C`, rationale: "Cheap vol + bullish lean — own the upside directly." };
    if (richness.verdict === "rich" && term && term.crushRatio >= 1.15 && term.backDte >= term.frontDte + 21)
      return { kind: "calendar", structure: "Calendar (sell front / own back)", legs: `short ~${term.frontDte}d ${fmt(atmK)} straddle · long ~${term.backDte}d ${fmt(atmK)} straddle`, rationale: `Steep term crush (${term.crushRatio.toFixed(1)}×) — sell the event-inflated front, own the back; harvests the differential IV decay, not just the level.` };
    return null;
  })();
  if (richness.verdict === "rich") {
    const skewRich = optionsR?.skew != null && optionsR.skew > 0.03; // puts notably bid → prefer defined risk
    const wing = Math.max(strikes.find((s) => s > callK) ? near(callK + (callK - putK)) - callK : 0, (callK - putK) / 2) || 5;
    const legsData = skewRich
      ? legsOf([
          { type: "P", side: "long", strike: near(putK - wing) },
          { type: "P", side: "short", strike: putK },
          { type: "C", side: "short", strike: callK },
          { type: "C", side: "long", strike: near(callK + wing) },
        ])
      : legsOf([
          { type: "P", side: "short", strike: putK },
          { type: "C", side: "short", strike: callK },
        ]);
    return {
      verdict: "rich",
      structure: skewRich ? "Iron condor (defined risk)" : "Short strangle",
      legs: skewRich
        ? `short ${fmt(putK)}P / long ${fmt(near(putK - wing))}P · short ${fmt(callK)}C / long ${fmt(near(callK + wing))}C`
        : `short ${fmt(putK)}P · short ${fmt(callK)}C (the ±${impliedMove.toFixed(1)}% strikes)`,
      rationale: `Implied ±${impliedMove.toFixed(1)}% is rich vs ~±${richness.avgRealized.toFixed(1)}% realized — sell the move${skewRich ? "; condor caps the tail since puts are bid" : ""}.`,
      expiry: exp,
      dte,
      legsData,
      lean,
      alt,
    };
  }
  if (richness.verdict === "cheap") {
    return {
      verdict: "cheap",
      structure: "Long straddle / strangle",
      legs: `long ${fmt(atmK)}P + ${fmt(atmK)}C`,
      rationale: `Implied ±${impliedMove.toFixed(1)}% is cheap vs ~±${richness.avgRealized.toFixed(1)}% realized — own the move.`,
      expiry: exp,
      dte,
      legsData: legsOf([
        { type: "C", side: "long", strike: atmK },
        { type: "P", side: "long", strike: atmK },
      ]),
      lean,
      alt,
    };
  }
  return null; // fairly priced → no clean premium edge
}

export interface BuiltTrade {
  spot: number;
  impliedMovePct: number;
  verdict: "rich" | "cheap";
  richnessRatio: number;
  avgRealizedPct: number;
  trade: TradeIdea;
}

// One-call orchestration for the nightly logger: reproduce EXACTLY what the card computes for the
// suggested play. Returns null when there's no clean, near-dated, priced structure to log (no chain,
// far-dated straddle, no reaction history, fairly priced, or missing leg quotes).
export async function buildEarningsTrade(sym: string, earningsISO: string | null): Promise<BuiltTrade | null> {
  const [base, reactions] = await Promise.all([getOptions(sym).catch(() => null), getEarningsReactions(sym, 8).catch(() => [])]);
  const sm = await straddleMove(sym, base, earningsISO);
  if (!sm) return null;
  // Only track the earnings event itself: the straddle must bracket the report and be near-dated
  // (a far-out straddle is mostly time value, not the event) — mirrors the card's `nearTerm` gate.
  const nearTerm = sm.isEvent && (sm.dte == null || sm.dte <= 21);
  if (!nearTerm) return null;
  const impliedMove = sm.movePct;
  const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
  if (!moves.length) return null;
  const avgRealizedPct = (moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length) * 100;
  if (!(avgRealizedPct > 0)) return null;
  const ratio = impliedMove / avgRealizedPct;
  const verdict = ratio >= 1.2 ? "rich" : ratio <= 0.85 ? "cheap" : "fair";
  if (verdict === "fair") return null;
  const richness = { verdict, avgRealized: avgRealizedPct };
  const straddle = { lowerBE: sm.lowerBE, upperBE: sm.upperBE, price: sm.price, expiry: sm.expiry, dte: sm.dte };
  const trade = tradeIdea(richness, { skew: skewOf(sm.chain) }, straddle, sm.chain, impliedMove);
  if (!trade || !trade.legsData) return null; // need priced legs to settle later
  return { spot: sm.price, impliedMovePct: impliedMove, verdict: verdict as "rich" | "cheap", richnessRatio: ratio, avgRealizedPct, trade };
}
