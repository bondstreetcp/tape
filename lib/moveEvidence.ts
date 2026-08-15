/**
 * MOVE EVIDENCE — the code-computed mechanism context for a 1-day mover ("why did it move" support).
 *
 * The desk brief kept headlining big movers "no specific catalyst" (2026-08-15 report) because the
 * model was STARVED: it had the name's own returns and headlines-or-nothing, so when no fresh headline
 * existed it could only shrug. But "there's always a reason" — and most reasons that aren't a headline
 * are VISIBLE IN DATA WE ALREADY HOLD: the sector moved (sympathy/rotation), a same-industry peer had
 * the actual news and dragged the group (SNDK lighting the storage complex), or positioning pressure
 * (elevated short volume) unwound. This module computes that evidence so the model can STATE a
 * grounded mechanism instead of shrugging — and, critically, so it never has to GUESS one.
 *
 * Doctrine (the move-attribution trap): code verifies, models propose. Everything here is arithmetic
 * on the same-day snapshot + FINRA short volume — no fetched text, no room to fabricate. The prompt
 * still forbids inventing headlines; this only widens what the model may legitimately cite.
 */

export interface MoverLite {
  symbol: string;
  sector?: string | null;
  industry?: string | null;
  /** The stock row's sector ETF (snapshot carries it) — the join key for the sector's own 1d move. */
  etf?: string | null;
  ret1d: number;
}

export interface PeerRow {
  symbol: string;
  industry?: string | null;
  sector?: string | null;
  marketCap?: number | null;
  ret1d: number | null;
}

export interface EvidenceCtx {
  /** Sector ETF → the sector's own 1-day return (%), from the snapshot's sector aggregates. */
  sectorRet1d: Map<string, number>;
  /** The full universe's rows (the snapshot) — peers are found here. */
  rows: PeerRow[];
  /** Symbol → {pct, trendPp}: FINRA short volume as % of tape + its recent trend (short-mechanics). */
  shortVol?: Map<string, { pct: number; trendPp?: number | null }>;
}

/** Short volume ≥ this % of the tape reads as elevated shorting pressure — worth surfacing. */
export const SHORT_VOL_ELEVATED = 50;

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Largest + hottest same-industry peers: from the 8 biggest by cap, take the 3 largest |1d| movers,
 *  and ALWAYS include the industry's single biggest absolute mover (the likely news leader) even if
 *  it's small — that's how "SNDK +18% lit the storage complex" reaches the model as DATA. */
export function pickPeers(m: MoverLite, rows: PeerRow[], maxN = 4): PeerRow[] {
  const pool = rows.filter(
    (r) =>
      r.symbol !== m.symbol &&
      r.ret1d != null &&
      (m.industry ? r.industry === m.industry : m.sector ? r.sector === m.sector : false),
  );
  if (!pool.length) return [];
  const byCap = [...pool].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 8);
  const picked = [...byCap].sort((a, b) => Math.abs(b.ret1d!) - Math.abs(a.ret1d!)).slice(0, Math.max(1, maxN - 1));
  const leader = [...pool].sort((a, b) => Math.abs(b.ret1d!) - Math.abs(a.ret1d!))[0];
  if (leader && !picked.some((p) => p.symbol === leader.symbol)) picked.unshift(leader);
  // Biggest movers first — the leader reads first.
  return picked.sort((a, b) => Math.abs(b.ret1d!) - Math.abs(a.ret1d!)).slice(0, maxN);
}

/**
 * One compact, model-citable evidence line for a mover. "" when nothing is computable.
 * Example: `MOVE EVIDENCE: sector (XLK) 1d +2.9% → residual +3.6% (mostly name-specific) ·
 *           peers (Semiconductors): SNDK +18.2%, MU +5.8%, NVDA +3.1% · short volume 61% of tape (elevated, +4pp trend)`
 */
export function buildMoveEvidence(m: MoverLite, ctx: EvidenceCtx): string {
  const parts: string[] = [];

  // Sector residual — the share of the move the sector does NOT explain. The single most useful
  // discriminator: a small residual = a sector/theme day; a large one = name-specific.
  const sec = m.etf != null ? ctx.sectorRet1d.get(m.etf) : undefined;
  if (sec != null && Number.isFinite(sec)) {
    const residual = m.ret1d - sec;
    const sectorExplains = Math.sign(sec) === Math.sign(m.ret1d) && Math.abs(residual) < Math.abs(m.ret1d) * 0.5;
    parts.push(`sector (${m.etf}) 1d ${pct(sec)} → residual ${pct(residual)} (${sectorExplains ? "mostly a sector move" : "mostly name-specific"})`);
  }

  const peers = pickPeers(m, ctx.rows);
  if (peers.length) {
    parts.push(`peers${m.industry ? ` (${m.industry})` : ""}: ${peers.map((p) => `${p.symbol} ${pct(p.ret1d!)}`).join(", ")}`);
  }

  const sv = ctx.shortVol?.get(m.symbol);
  if (sv && sv.pct >= SHORT_VOL_ELEVATED) {
    const trend = sv.trendPp != null && Math.abs(sv.trendPp) >= 1 ? `, ${sv.trendPp > 0 ? "+" : ""}${sv.trendPp.toFixed(0)}pp trend` : "";
    parts.push(`short volume ${sv.pct.toFixed(0)}% of tape (elevated${trend})`);
  }

  return parts.length ? `MOVE EVIDENCE: ${parts.join(" · ")}` : "";
}
