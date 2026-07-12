/**
 * Portfolio Catalyst Radar — "what's live in MY book, and when." Joins the pasted portfolio to the
 * forward Catalyst Calendar (earnings w/ implied move, investor days, biotech readouts, IPO lockups)
 * and tags each event with the position side, because a catalyst on a SHORT is risk in the opposite
 * direction from the same catalyst on a long. Pure + fs-free (the page ships the events, the client
 * reads the localStorage book and joins), so it's unit-tested. Reuses lib/catalystCalendar's events.
 */
import type { CatalystEvent } from "./catalystCalendar";

export type Side = "long" | "short";
export type Impact = "high" | "medium" | "low";

export interface BookPosition {
  symbol: string;
  shares: number; // negative = short (as parsePositions returns)
}

export interface PortfolioCatalyst extends CatalystEvent {
  side: Side;
  shares: number; // absolute share count held
  impact: Impact;
}

export interface PortfolioCatalystResult {
  catalysts: PortfolioCatalyst[]; // soonest first, then higher impact
  ownedWithCatalysts: number; // distinct owned symbols that have ≥1 forward catalyst
  totalOwned: number; // distinct symbols in the book
  highNext30: number; // high-impact catalysts within 30 days
  quietNames: string[]; // owned symbols with NO forward catalyst in the horizon (transparency)
}

const IMPACT_RANK: Record<Impact, number> = { high: 0, medium: 1, low: 2 };

/** A forward earnings date from the snapshot (Yahoo), used to fill in reporters beyond the ≤16-day
 *  options feed so the radar covers the whole quarter, not just the next two weeks. */
export interface SnapshotEarnings {
  date: string; // ISO YYYY-MM-DD
  name?: string;
  sector?: string;
  estimated?: boolean; // Yahoo's date is an estimate, not confirmed
}

/** Impact of an event for a holding. Binary clinical/regulatory events rank highest; earnings scale
 *  with the options-implied move (an unpriced/unknown move → medium, a scheduled event we can't size);
 *  lockups are a supply overhang; everything else is medium. */
export function eventImpact(e: CatalystEvent): Impact {
  if (e.kind === "biotech") return "high"; // PDUFA / trial readout — binary
  if (e.kind === "earnings") {
    if (e.movePct == null) return "medium"; // scheduled print, move not yet priced by the options feed
    return e.movePct >= 7 ? "high" : e.movePct >= 4 ? "medium" : "low";
  }
  if (e.kind === "lockup") return "medium"; // insider-supply overhang
  if (e.kind === "investor-day") return e.movePct != null && e.movePct >= 5 ? "high" : "medium";
  return "medium";
}

/**
 * Join a book to the forward calendar. `events` is the full calendar (all names); we keep only the
 * owned symbols, attach side + |shares| + impact, and sort soonest-first (impact breaks ties).
 * Symbol match is exact-uppercase; both sides are normalized so "brk.b"/"BRK.B" align.
 */
export function buildPortfolioCatalysts(
  positions: BookPosition[],
  events: CatalystEvent[],
  opts: { horizonDays?: number; earningsDates?: Record<string, SnapshotEarnings>; nowMs?: number } = {},
): PortfolioCatalystResult {
  const horizon = opts.horizonDays ?? 120;
  const DAY = 86_400_000;
  // Floor "now" to UTC midnight: a bare YYYY-MM-DD earnings date parses to UTC midnight, so diffing it
  // against a live instant makes a name reporting TODAY read as daysTo −1 during US market hours and
  // wrongly drop into "quiet" (the documented date-countdown off-by-one). Compare by calendar day.
  const nowMs = Math.floor((opts.nowMs ?? Date.now()) / DAY) * DAY;
  const norm = (s: string) => s.trim().toUpperCase();
  // Net shares per symbol (a book may list a name twice); sign decides the side, 0 nets out → skip.
  const bySymbol = new Map<string, number>();
  for (const p of positions) {
    if (!p?.symbol || !Number.isFinite(p.shares)) continue;
    const k = norm(p.symbol);
    bySymbol.set(k, (bySymbol.get(k) ?? 0) + p.shares);
  }
  for (const [k, v] of bySymbol) if (v === 0) bySymbol.delete(k);

  const owned = new Set(bySymbol.keys());
  const catalysts: PortfolioCatalyst[] = [];
  const withCatalyst = new Set<string>();
  const hasEarnings = new Set<string>(); // owned symbols already covered by a real earnings event
  const add = (e: CatalystEvent, net: number) => {
    withCatalyst.add(norm(e.ticker));
    catalysts.push({ ...e, side: net > 0 ? "long" : "short", shares: Math.abs(net), impact: eventImpact(e) });
  };
  for (const e of events) {
    const sym = norm(e.ticker);
    const net = bySymbol.get(sym);
    if (net == null) continue;
    if (e.daysTo < 0 || e.daysTo > horizon) continue;
    if (e.kind === "earnings") hasEarnings.add(sym);
    add(e, net);
  }
  // Supplement with snapshot forward-earnings dates so reporters beyond the ≤16-day options feed still
  // surface (that feed only carries near-term names). Skip any symbol already covered by a real
  // earnings event (the options-feed version has the implied move and wins).
  if (opts.earningsDates) {
    for (const [sym, net] of bySymbol) {
      if (hasEarnings.has(sym)) continue;
      const se = opts.earningsDates[sym];
      if (!se?.date) continue;
      const daysTo = Math.round((Date.parse(se.date) - nowMs) / DAY);
      if (!Number.isFinite(daysTo) || daysTo < 0 || daysTo > horizon) continue;
      add({ date: se.date.slice(0, 10), daysTo, kind: "earnings", ticker: sym, company: se.name ?? sym, sector: se.sector, label: "Earnings", movePct: null, detail: se.estimated ? "date estimated" : undefined }, net);
    }
  }
  catalysts.sort((a, b) => a.daysTo - b.daysTo || IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || a.ticker.localeCompare(b.ticker));

  return {
    catalysts,
    ownedWithCatalysts: withCatalyst.size,
    totalOwned: owned.size,
    highNext30: catalysts.filter((c) => c.impact === "high" && c.daysTo <= 30).length,
    quietNames: [...owned].filter((s) => !withCatalyst.has(s)).sort(),
  };
}
