/**
 * Positioning Radar — the NAME-LEVEL read of the options-flow tape. The raw flow board (/flow) lists the
 * biggest single option trades; this rolls those same trades up per underlying into a directional
 * positioning read: net call vs put premium, how much of it is OTM (a real directional/leverage bet) vs
 * ITM (delta-one / stock-replacement / rolls — big notional, not a view), how much is NEW positioning
 * (today's volume > open interest), and — the event-driven payoff — the dated catalyst each name is being
 * positioned in front of (earnings, PDUFA/readout, investor day).
 *
 * CLIENT-SAFE: types + a pure roll-up/join only (no fs, no network). The page reads the feeds and calls it.
 * Doctrine: every number here is computed from the flow snapshot + the catalyst feeds — no LLM, no invention.
 */

// Structural shape of a data/options-flow.json entry (redeclared here so this stays fs-free / client-safe).
export interface FlowEntryInput {
  symbol: string;
  name: string;
  underlying: number | null;
  chgPct: number | null;
  type: "call" | "put";
  strike: number;
  expiry: string | null;
  dte: number | null;
  vol: number;
  oi: number;
  volOI: number | null;
  premium: number; // $ traded today (vol × mid × 100)
  iv: number | null;
  mid: number;
  unusual: boolean; // today's volume exceeded open interest
}

export type PosCatalystKind = "earnings" | "pdufa" | "readout" | "investor-day";

export interface PosCatalyst {
  kind: PosCatalystKind;
  date: string; // ISO YYYY-MM-DD
  daysTo: number;
  label: string;
  impliedMovePct: number | null; // where a feed prices the event
}

export const POS_CATALYST_META: Record<PosCatalystKind, { label: string; color: string }> = {
  earnings: { label: "Earnings", color: "#60a5fa" },
  pdufa: { label: "FDA decision", color: "#a78bfa" },
  readout: { label: "Clinical readout", color: "#f59e0b" },
  "investor-day": { label: "Investor day", color: "#38bdf8" },
};

export interface PositioningContract {
  type: "call" | "put";
  strike: number;
  expiry: string | null;
  dte: number | null;
  premium: number;
  volOI: number | null;
  unusual: boolean;
  otm: boolean;
}

export interface PositioningRow {
  symbol: string;
  name: string;
  spot: number | null;
  chgPct: number | null;
  callPrem: number; // all call premium (incl. ITM/delta-one)
  putPrem: number;
  totalPrem: number;
  netPrem: number; // callPrem − putPrem (signed magnitude)
  cpSkew: number; // callPrem / (callPrem+putPrem), 0..1 (>0.5 call-heavy)
  otmCallPrem: number; // OTM calls = directional/leverage upside bets
  otmPutPrem: number; // OTM puts = hedging / downside bets
  dirPrem: number; // otmCall + otmPut — the directional (non-delta-one) premium
  unusualPrem: number; // premium in vol>OI contracts (NEW positioning)
  lean: "calls" | "puts" | "mixed"; // directional lean from the OTM premium
  contractsN: number;
  strikesN: number;
  expiriesN: number;
  nearDte: number | null; // soonest expiry carrying flow
  topContracts: PositioningContract[]; // up to 3 biggest by premium
  catalyst: PosCatalyst | null;
  score: number; // default rank = totalPrem
}

export interface PositioningInput {
  earnings?: any[]; // earnings-move rows { symbol, name, earningsDate, impliedMovePct }
  biotech?: any[]; // biotech-catalysts items { ticker, statusKind, primaryCompletion, drug, condition, phase }
  investorDays?: any[]; // catalyst-vol rows { ticker, eventType, eventDate, impliedMovePct }
}

const isoDate = (v: unknown): string => {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
};

/** Whole calendar days from `nowMs` to an ISO date, both floored to UTC midnight (so an intraday `now`
 * can't push a same-day event to −1). Returns null if the date is unparseable. */
export function daysUntil(dateIso: string, nowMs: number): number | null {
  const t = Date.parse(dateIso + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  const now0 = Math.floor(nowMs / 86_400_000) * 86_400_000;
  return Math.round((t - now0) / 86_400_000);
}

/** Build a symbol → nearest-forward-catalyst index from the dated feeds (earnings ≤14d, biotech
 * PDUFA/readout ≤45d, investor day ≤30d). Nearest (fewest days out) wins when a name has several. */
export function buildCatalystIndex(feeds: PositioningInput, nowMs: number): Map<string, PosCatalyst> {
  const best = new Map<string, PosCatalyst>();
  const consider = (sym: string, c: PosCatalyst) => {
    if (!sym) return;
    const cur = best.get(sym);
    if (!cur || c.daysTo < cur.daysTo) best.set(sym, c);
  };
  for (const r of feeds.earnings ?? []) {
    const d = isoDate(r.earningsDate);
    const dt = d ? daysUntil(d, nowMs) : null;
    if (dt == null || dt < 0 || dt > 14) continue;
    const im = typeof r.impliedMovePct === "number" && Number.isFinite(r.impliedMovePct) ? r.impliedMovePct : null;
    consider(String(r.symbol ?? "").toUpperCase(), { kind: "earnings", date: d, daysTo: dt, label: "Earnings", impliedMovePct: im });
  }
  for (const i of feeds.biotech ?? []) {
    const sk = String(i.statusKind ?? "");
    if (sk !== "pdufa" && sk !== "readout") continue;
    const d = isoDate(i.primaryCompletion);
    const dt = d ? daysUntil(d, nowMs) : null;
    if (dt == null || dt < 0 || dt > 45) continue;
    const kind: PosCatalystKind = sk === "pdufa" ? "pdufa" : "readout";
    const label = kind === "pdufa" ? "FDA decision (PDUFA)" : `${i.phase || "Clinical"} readout`;
    consider(String(i.ticker ?? "").toUpperCase(), { kind, date: d, daysTo: dt, label, impliedMovePct: null });
  }
  for (const r of feeds.investorDays ?? []) {
    const d = isoDate(r.eventDate);
    const dt = d ? daysUntil(d, nowMs) : null;
    if (dt == null || dt < 0 || dt > 30) continue;
    const im = typeof r.impliedMovePct === "number" && Number.isFinite(r.impliedMovePct) ? r.impliedMovePct : null;
    consider(String(r.ticker ?? "").toUpperCase(), { kind: "investor-day", date: d, daysTo: dt, label: String(r.eventType || "Investor day"), impliedMovePct: im });
  }
  return best;
}

const LEAN_RATIO = 1.6; // one side must outweigh the other by this to call a directional lean

/** Roll the flow tape up per underlying + tag each name with its nearest forward catalyst. Pure. */
export function buildPositioning(entries: FlowEntryInput[], feeds: PositioningInput, nowMs: number): PositioningRow[] {
  const catalysts = buildCatalystIndex(feeds, nowMs);
  const bySym = new Map<string, FlowEntryInput[]>();
  for (const e of entries) {
    if (!e?.symbol || !(e.premium > 0) || (e.type !== "call" && e.type !== "put")) continue;
    const k = e.symbol.toUpperCase();
    (bySym.get(k) ?? bySym.set(k, []).get(k)!).push(e);
  }

  const rows: PositioningRow[] = [];
  for (const [sym, es] of bySym) {
    // Spot: the entries carry a per-contract underlying; use the modal positive value.
    const spot = es.map((e) => e.underlying).find((u): u is number => typeof u === "number" && u > 0) ?? null;
    const isOtm = (e: FlowEntryInput): boolean =>
      spot == null ? false : e.type === "call" ? e.strike > spot : e.strike < spot;

    let callPrem = 0, putPrem = 0, otmCallPrem = 0, otmPutPrem = 0, unusualPrem = 0;
    const strikes = new Set<number>(), expiries = new Set<string>();
    let nearDte: number | null = null;
    for (const e of es) {
      const otm = isOtm(e);
      if (e.type === "call") { callPrem += e.premium; if (otm) otmCallPrem += e.premium; }
      else { putPrem += e.premium; if (otm) otmPutPrem += e.premium; }
      if (e.unusual) unusualPrem += e.premium;
      strikes.add(e.strike);
      if (e.expiry) expiries.add(e.expiry);
      if (e.dte != null && (nearDte == null || e.dte < nearDte)) nearDte = e.dte;
    }
    const totalPrem = callPrem + putPrem;
    if (totalPrem <= 0) continue;

    // Directional lean from the OTM premium (excludes ITM/delta-one, which is big $ but not a view).
    let lean: "calls" | "puts" | "mixed" = "mixed";
    if (otmCallPrem > 0 && otmCallPrem >= LEAN_RATIO * otmPutPrem) lean = "calls";
    else if (otmPutPrem > 0 && otmPutPrem >= LEAN_RATIO * otmCallPrem) lean = "puts";

    const topContracts: PositioningContract[] = [...es]
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 3)
      .map((e) => ({ type: e.type, strike: e.strike, expiry: e.expiry, dte: e.dte, premium: e.premium, volOI: e.volOI, unusual: e.unusual, otm: isOtm(e) }));

    rows.push({
      symbol: sym,
      name: es[0].name,
      spot,
      chgPct: es[0].chgPct,
      callPrem, putPrem, totalPrem,
      netPrem: callPrem - putPrem,
      cpSkew: totalPrem > 0 ? callPrem / totalPrem : 0.5,
      otmCallPrem, otmPutPrem,
      dirPrem: otmCallPrem + otmPutPrem,
      unusualPrem,
      lean,
      contractsN: es.length,
      strikesN: strikes.size,
      expiriesN: expiries.size,
      nearDte,
      topContracts,
      catalyst: catalysts.get(sym) ?? null,
      score: totalPrem,
    });
  }

  return rows.sort((a, b) => b.score - a.score);
}

export type PositioningSort = "premium" | "bullish" | "bearish" | "unusual" | "catalyst";

/** Rank rows for a chosen lens. `premium` (default) = biggest total flow; `bullish`/`bearish` = most
 * OTM call/put premium; `unusual` = most new positioning; `catalyst` = names with a dated event first. */
export function rankPositioning(rows: PositioningRow[], sort: PositioningSort = "premium"): PositioningRow[] {
  const r = [...rows];
  switch (sort) {
    case "bullish": return r.sort((a, b) => b.otmCallPrem - a.otmCallPrem || b.totalPrem - a.totalPrem);
    case "bearish": return r.sort((a, b) => b.otmPutPrem - a.otmPutPrem || b.totalPrem - a.totalPrem);
    case "unusual": return r.sort((a, b) => b.unusualPrem - a.unusualPrem || b.totalPrem - a.totalPrem);
    case "catalyst": return r.sort((a, b) => Number(!!b.catalyst) - Number(!!a.catalyst) || (a.catalyst?.daysTo ?? 999) - (b.catalyst?.daysTo ?? 999) || b.totalPrem - a.totalPrem);
    default: return r.sort((a, b) => b.totalPrem - a.totalPrem);
  }
}
