/**
 * My Names — Change Ledger (P1 of docs/SPEC-MY-NAMES-MONITOR.md). Pure types, ordering, and
 * thresholds for "what changed in MY names since I last looked": the server route joins each
 * watched name against feeds that already exist (no new collectors, no LLM — every event links
 * to its source), and this module decides WHAT counts as an event and HOW the scan is ordered,
 * so both are unit-testable and the client can import the types.
 */

export type LedgerKind =
  | "reported" // results 8-K on record (≤7d)
  | "preannounce" // 8-K 2.02 ahead of a scheduled print
  | "deal" // definitive acquisition (DEFM14A targets)
  | "review" // strategic alternatives live
  | "spin" // spin-off in motion
  | "earnings-ahead" // reports within 5d (with the implied move when priced)
  | "filing" // overnight-filings desk note on the name
  | "insider" // open-market cluster buying
  | "shorts" // FTD build / elevated short volume
  | "borrow" // borrow fee / availability squeeze
  | "estimate" // notable 30d EPS revision activity
  | "options" // unusual options flow premium
  | "headline"; // fresh dated news

export interface LedgerEvent {
  kind: LedgerKind;
  /** calendar square (YYYY-MM-DD) when the source is a date; full ISO when it's a feed timestamp */
  ts: string;
  title: string;
  detail?: string;
  href?: string; // deep link — the source row/filing/board (external or in-app path)
}

export interface LedgerName {
  symbol: string;
  name: string | null;
  pct1d: number | null;
  events: LedgerEvent[];
}

export interface LedgerData {
  generatedAt: string;
  names: LedgerName[];
}

/** Scan order — most-actionable kind first. Ties break on recency inside sortEvents/orderNames. */
const KIND_RANK: Record<LedgerKind, number> = {
  reported: 0,
  preannounce: 1,
  deal: 1,
  review: 2,
  spin: 2,
  "earnings-ahead": 3,
  filing: 4,
  insider: 5,
  shorts: 6,
  borrow: 7,
  estimate: 8,
  options: 9,
  headline: 10,
};
export const rankOf = (k: LedgerKind): number => KIND_RANK[k];

/** Events within one name: rank asc, then newest first (undated sinks). */
export function sortEvents(events: LedgerEvent[]): LedgerEvent[] {
  const t = (e: LedgerEvent) => {
    const ms = Date.parse(e.ts);
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return [...events].sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || t(b) - t(a));
}

/** Names: best (lowest) event rank first, then |1d move|, then symbol — the same doctrine as the
 *  desk wire: start the scan where action is. Names with NO events sink to the end (the client
 *  collapses them to a "quiet" line). */
export function orderNames(names: LedgerName[]): LedgerName[] {
  const best = (n: LedgerName) => (n.events.length ? Math.min(...n.events.map((e) => rankOf(e.kind))) : Infinity);
  return [...names].sort((a, b) => {
    const ra = best(a), rb = best(b);
    if (ra !== rb) return ra - rb;
    const ma = a.pct1d != null ? Math.abs(a.pct1d) : -1;
    const mb = b.pct1d != null ? Math.abs(b.pct1d) : -1;
    if (ma !== mb) return mb - ma;
    return a.symbol.localeCompare(b.symbol);
  });
}

// ── Thresholds (pure predicates over the source rows — what EARNS a ledger event) ──

/** Short-mechanics row → event when the plumbing is actually stressed: latest short volume ≥60%
 *  or ≥$1M of fails on the tape. */
export function shortsEvent(row: { latestShortVolPct?: number | null; ftdUsd?: number | null; ftdShares?: number | null } | undefined | null): { title: string; detail: string } | null {
  if (!row) return null;
  const sv = row.latestShortVolPct ?? null;
  const ftd = row.ftdUsd ?? null;
  const svHit = sv != null && sv >= 60;
  const ftdHit = ftd != null && ftd >= 1_000_000;
  if (!svHit && !ftdHit) return null;
  const bits: string[] = [];
  if (svHit) bits.push(`short volume ${sv!.toFixed(0)}% of tape`);
  if (ftdHit) bits.push(`$${(ftd! / 1e6).toFixed(1)}M fails-to-deliver`);
  return { title: "Short-mechanics stress", detail: bits.join(" · ") };
}

/** Borrow read → event when shorting this name is getting expensive or thin. */
export function borrowEvent(b: { fee?: number | null; available?: number | null } | undefined | null): { title: string; detail: string } | null {
  if (!b) return null;
  const feeHit = b.fee != null && b.fee >= 1;
  const availHit = b.available != null && b.available > 0 && b.available < 100_000;
  if (!feeHit && !availHit) return null;
  const bits: string[] = [];
  if (feeHit) bits.push(`borrow fee ${b.fee!.toFixed(1)}%`);
  if (availHit) bits.push(`${Math.round(b.available! / 1000)}K shares available`);
  return { title: "Borrow tightening", detail: bits.join(" · ") };
}

/** 30d EPS revision counts (current quarter, from the company stats bake) → event when the Street
 *  is actually moving: ≥3 revisions either way, or a one-sided 2:0. */
export function estimateEvent(q: { epsUp30d?: number | null; epsDown30d?: number | null } | undefined | null): { title: string; detail: string } | null {
  if (!q) return null;
  const up = q.epsUp30d ?? 0;
  const dn = q.epsDown30d ?? 0;
  if (up + dn < 2 || (up < 3 && dn < 3 && !(up >= 2 && dn === 0) && !(dn >= 2 && up === 0))) return null;
  const lean = up > dn ? "estimates moving UP" : dn > up ? "estimates moving DOWN" : "estimates in motion";
  return { title: `Street ${lean}`, detail: `${up}↑ / ${dn}↓ EPS revisions (30d, current qtr)` };
}

/** Options-flow entries for one symbol → event when serious premium traded: ≥$1M in one line or
 *  ≥$2M across the name's flagged flows. Returns the aggregate + the biggest line. */
export function flowEvent(entries: { type?: string; strike?: number; expiry?: string; premium?: number | null }[]): { title: string; detail: string } | null {
  const rows = (entries ?? []).filter((e) => (e.premium ?? 0) > 0);
  if (!rows.length) return null;
  const total = rows.reduce((a, e) => a + (e.premium ?? 0), 0);
  const top = rows.reduce((a, e) => ((e.premium ?? 0) > (a.premium ?? 0) ? e : a));
  if ((top.premium ?? 0) < 1_000_000 && total < 2_000_000) return null;
  const M = (v: number) => `$${(v / 1e6).toFixed(1)}M`;
  return {
    title: "Unusual options premium",
    detail: `${M(total)} flagged${rows.length > 1 ? ` across ${rows.length} lines` : ""} · top: ${M(top.premium ?? 0)} ${top.type ?? ""} ${top.strike ?? ""} ${top.expiry ?? ""}`.trim(),
  };
}
