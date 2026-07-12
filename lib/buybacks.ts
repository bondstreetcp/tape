/**
 * Buyback & Capital-Return board — how much of a company's value it returns to shareholders, and
 * whether it's REAL. Everything here is grounded in SEC XBRL companyfacts (built by
 * scripts/refresh-buybacks.ts); this module owns the client-safe types, the pure XBRL math
 * (de-cumulation, TTM, YoY), the classifier, and the loader. No I/O, no LLM.
 *
 * The differentiated read: a high buyback yield means nothing if the share count isn't actually
 * falling — plenty of companies spend billions just to mop up stock-comp dilution. netShareChangePct
 * is the truth serum: negative = the count is really shrinking; ~0 or positive = the buyback is
 * treading water against dilution.
 */

export interface BuybackRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  buybackTtm: number | null; // trailing-12-mo cash spent repurchasing stock, USD
  buybackYield: number | null; // buybackTtm / marketCap (fraction)
  dividendYield: number | null; // fraction (from the snapshot / Yahoo)
  totalYield: number | null; // buybackYield + dividendYield — the shareholder-yield factor
  netShareChangePct: number | null; // YoY % change in shares outstanding; NEGATIVE = count shrinking (real)
  buybackAccel: number | null; // latest-quarter annualized pace ÷ TTM pace; >1 = ramping up
  payoutToFcf: number | null; // (buybacks + dividends) ÷ free cash flow, TTM; >1 = returning more than earned
  asOf: string | null; // period-end date of the latest buyback figure (ISO)
  badges: BuybackBadge[];
}

export type BuybackBadge = "shrinking" | "high-yield" | "accelerating" | "overdistributing" | "no-buyback";

export interface BuybackData {
  generatedAt: string;
  source: string;
  rows: BuybackRow[];
}

// ── XBRL fact math (pure — unit-tested) ──────────────────────────────────────────────────────────
// One companyfacts duration fact (subset). Cash-flow items are reported YTD-CUMULATIVE within a
// fiscal year in 10-Qs (Q1=3mo, then 6mo, 9mo, FY=12mo), so they must be de-cumulated to quarters
// before a trailing-twelve-month sum. `val` is additive ONLY for flow concepts (cash spent) — never
// for an average like weighted-average shares.
export interface DurFact {
  start: string; // period start (ISO)
  end: string; // period end (ISO)
  val: number;
  fy?: number; // fiscal year
  accn?: string; // accession — latest filing wins on a duplicate (start,end)
}
export interface InstFact {
  end: string; // instant date (ISO)
  val: number;
  accn?: string;
}

const DAY = 86_400_000;
const spanDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Dedupe duration facts on (start,end), keeping the latest-filed (max accession). */
function dedupeDur(facts: DurFact[]): DurFact[] {
  const m = new Map<string, DurFact>();
  for (const f of facts) {
    if (!f?.start || !f?.end || typeof f.val !== "number" || !Number.isFinite(f.val)) continue;
    const k = `${f.start}|${f.end}`;
    const prev = m.get(k);
    if (!prev || String(f.accn ?? "") >= String(prev.accn ?? "")) m.set(k, f);
  }
  return [...m.values()];
}

/**
 * De-cumulate YTD-cumulative flow facts into discrete quarters, keyed by period-end.
 * Facts sharing a `start` are the SAME fiscal year's cumulative ladder (Q1=3mo, then 6mo, 9mo,
 * FY=12mo), so within a start-group each quarter = the fact minus the previous shorter one in the
 * group (the first is itself). A company that reports discrete quarters instead gives each quarter its
 * OWN start, so it lands in a singleton group and passes through unchanged. Returns { end, val }
 * ascending by end; negatives (de-cumulation artifacts from a missing interim period) are dropped.
 */
export function quarterize(raw: DurFact[]): { end: string; val: number }[] {
  const facts = dedupeDur(raw);
  const out = new Map<string, number>(); // end → quarterly val
  const byStart = new Map<string, DurFact[]>();
  for (const f of facts) {
    const arr = byStart.get(f.start) ?? [];
    arr.push(f);
    byStart.set(f.start, arr);
  }
  for (const [start, arr] of byStart) {
    arr.sort((a, b) => a.end.localeCompare(b.end)); // ascending cumulative length
    let prevCum = 0, prevEnd = start; // same-start facts are cumulative from the shared start
    for (const f of arr) {
      const inc = f.val - prevCum;
      const incSpan = spanDays(prevEnd, f.end); // the period THIS piece actually covers
      // Only emit a genuine ~one-quarter increment. A longer span means an interim quarter is
      // missing (e.g. an annual-only filer, or a gap), so the piece is a half/9-mo/full-year lump —
      // skip it and let the caller fall back to the clean annual figure rather than book a fat "quarter".
      if (incSpan >= 55 && incSpan <= 100) out.set(f.end, inc);
      prevCum = f.val;
      prevEnd = f.end;
    }
  }
  return [...out.entries()]
    .map(([end, val]) => ({ end, val }))
    .filter((q) => q.val >= 0) // a negative "buyback quarter" is a de-cumulation artifact, not real
    .sort((a, b) => a.end.localeCompare(b.end));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Drop extreme-outlier quarters — a single quarter more than `k`× the company's own median quarter
 *  is almost always an XBRL data fault (an authorization amount or ASR notional mis-tagged as cash
 *  paid), e.g. CRM once showed a $27B quarter vs a ~$3B norm. Kills the spike so the TTM is real;
 *  removing it usually drops below 4 clean quarters, so the caller falls back to the annual figure. */
export function despikeQuarters(quarters: { end: string; val: number }[], k = 5): { end: string; val: number }[] {
  const nz = quarters.filter((q) => q.val > 0).map((q) => q.val);
  if (nz.length < 4) return quarters;
  const med = median(nz);
  if (med <= 0) return quarters;
  return quarters.filter((q) => q.val <= k * med);
}

/** Sum the trailing-twelve-months from a quarterly series: the last 4 quarters whose ends fall within
 *  ~400 days of the newest. Returns null if fewer than 4 clean quarters (caller may fall back to FY). */
export function ttmSum(quarters: { end: string; val: number }[]): { val: number; asOf: string } | null {
  if (quarters.length < 4) return null;
  const last4 = quarters.slice(-4);
  // A clean TTM is 4 CONSECUTIVE quarters. The total-span check catches a big hole, but when
  // despikeQuarters removes a MID-series spike the surviving last-4 span only ~1y and sneak under 400d
  // while silently substituting the year-ago quarter for the missing one — so also reject any internal
  // step wider than a single quarter (~92d; 130 leaves slack for 53-week fiscal calendars).
  if (spanDays(last4[0].end, last4[3].end) > 400) return null;
  for (let i = 1; i < last4.length; i++) if (spanDays(last4[i - 1].end, last4[i].end) > 130) return null;
  return { val: last4.reduce((s, q) => s + q.val, 0), asOf: last4[3].end };
}

/** Latest instant value and its year-ago comparable (closest instant 300–430 days earlier). */
export function yoyChange(insts: InstFact[]): number | null {
  const clean = insts.filter((f) => f?.end && typeof f.val === "number" && f.val > 0).sort((a, b) => a.end.localeCompare(b.end));
  if (clean.length < 2) return null;
  const latest = clean[clean.length - 1];
  let best: InstFact | null = null;
  for (const f of clean) {
    const d = spanDays(f.end, latest.end);
    if (d >= 300 && d <= 430) best = f; // keep the latest qualifying (closest to exactly 1y from below)
  }
  if (!best) return null;
  return (latest.val - best.val) / best.val;
}

// ── classification ───────────────────────────────────────────────────────────────────────────────
export const SHRINK_THRESHOLD = -0.01; // net share count down ≥1% YoY = genuinely shrinking
export const HIGH_YIELD_THRESHOLD = 0.05; // total shareholder yield ≥5%
export const ACCEL_THRESHOLD = 1.25; // latest-quarter pace ≥25% above the TTM run-rate
export const OVERDISTRIBUTE_THRESHOLD = 1.15; // returning >115% of FCF

export function classifyBuyback(r: Omit<BuybackRow, "badges">): BuybackBadge[] {
  const b: BuybackBadge[] = [];
  if (!r.buybackTtm) b.push("no-buyback");
  if (r.netShareChangePct != null && r.netShareChangePct <= SHRINK_THRESHOLD) b.push("shrinking");
  if (r.totalYield != null && r.totalYield >= HIGH_YIELD_THRESHOLD) b.push("high-yield");
  if (r.buybackAccel != null && r.buybackAccel >= ACCEL_THRESHOLD && (r.buybackTtm ?? 0) > 0) b.push("accelerating");
  if (r.payoutToFcf != null && r.payoutToFcf > OVERDISTRIBUTE_THRESHOLD) b.push("overdistributing");
  return b;
}

export const BADGE_META: Record<BuybackBadge, { label: string; color: string; blurb: string }> = {
  shrinking: { label: "Shrinking count", color: "#22c55e", blurb: "Shares outstanding fell ≥1% over the past year — a real, per-share-accretive buyback, not just offsetting stock-comp dilution." },
  "high-yield": { label: "High total yield", color: "#38bdf8", blurb: "Buybacks + dividends return ≥5% of the company's market value per year." },
  accelerating: { label: "Accelerating", color: "#a78bfa", blurb: "The latest quarter's repurchase pace is running ≥25% above the trailing-year rate." },
  overdistributing: { label: "Over-distributing", color: "#f59e0b", blurb: "Buybacks + dividends exceed free cash flow — funded from the balance sheet or debt, not earnings. Watch sustainability." },
  "no-buyback": { label: "No buyback", color: "#6b7280", blurb: "No material share repurchases in the trailing year (dividends may still apply)." },
};

// NOTE: no loader here on purpose — this module is imported by the "use client" BuybacksView (for
// BADGE_META + the classifier), so it must stay free of `fs`. The page reads data/buybacks.json itself.
