/**
 * Forward Catalyst Calendar — merges the app's existing forward-dated event feeds into ONE chronological
 * timeline: earnings (earnings-move.json), investor/analyst days (catalyst-vol.json), clinical readouts
 * (biotech-catalysts.json), and IPO lockup expiries (ipo-monitor.json). Pure + fs-free (the page reads
 * the JSON and passes it in), so buildCatalystCalendar is unit-tested. US-sourced feeds → US-only page.
 */

export type CatalystKind = "earnings" | "investor-day" | "biotech" | "lockup";

export interface CatalystEvent {
  date: string; // ISO YYYY-MM-DD (forward)
  daysTo: number; // whole days from `nowMs`
  kind: CatalystKind;
  ticker: string;
  company: string;
  label: string; // short event label ("Earnings", "Analyst day", "Phase 3 readout", "IPO lockup")
  detail?: string; // extra context ("psoriasis · Phase 3", "IPO 2026-06-09 · $66M")
  movePct?: number | null; // options-implied move, where the feed has one (earnings / investor day)
  sector?: string;
  url?: string;
}

export const KIND_META: Record<CatalystKind, { label: string; color: string }> = {
  earnings: { label: "Earnings", color: "#60a5fa" },
  "investor-day": { label: "Investor day", color: "#a78bfa" },
  biotech: { label: "Biotech readout", color: "#f59e0b" },
  lockup: { label: "IPO lockup", color: "#22c55e" },
};

/** Extract the row array from a feed regardless of its wrapper key. */
const arr = (f: any): any[] =>
  (Array.isArray(f) ? f : f?.rows ?? f?.items ?? f?.events ?? []) as any[];

/** Normalize a date-ish value to 'YYYY-MM-DD' (or '' if unparseable). Prefers the literal prefix so a
 *  plain date string isn't timezone-shifted. */
function isoDate(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Merge the four feeds into a forward, chronologically-sorted event list. Drops anything in the past or
 * beyond `horizonDays` (default 120). `nowMs` is injected so the function stays pure/testable.
 */
export function buildCatalystCalendar(
  feeds: { earnings?: any; investorDays?: any; biotech?: any; lockups?: any },
  nowMs: number,
  opts: { horizonDays?: number } = {},
): CatalystEvent[] {
  const horizon = opts.horizonDays ?? 120;
  const out: CatalystEvent[] = [];
  const push = (e: Omit<CatalystEvent, "daysTo"> & { date: string }) => {
    if (!e.date || !e.ticker) return;
    const daysTo = Math.round((Date.parse(e.date) - nowMs) / 86_400_000);
    if (!Number.isFinite(daysTo) || daysTo < 0 || daysTo > horizon) return; // forward + within horizon
    out.push({ ...e, daysTo });
  };

  for (const r of arr(feeds.earnings)) {
    push({
      date: isoDate(r.earningsDate), kind: "earnings", ticker: String(r.symbol ?? ""), company: String(r.name ?? r.symbol ?? ""),
      sector: r.sector, label: "Earnings", movePct: numOrNull(r.impliedMovePct),
      detail: numOrNull(r.impliedMovePct) != null ? `implied ±${(r.impliedMovePct as number).toFixed(1)}%` : undefined,
    });
  }
  for (const r of arr(feeds.investorDays)) {
    push({
      date: isoDate(r.eventDate), kind: "investor-day", ticker: String(r.ticker ?? ""), company: String(r.company ?? r.ticker ?? ""),
      label: String(r.eventType || "Investor day"), url: r.url, movePct: numOrNull(r.impliedMovePct),
      detail: numOrNull(r.impliedMovePct) != null ? `implied ±${(r.impliedMovePct as number).toFixed(1)}%` : undefined,
    });
  }
  for (const r of arr(feeds.biotech)) {
    const bits = [r.drug, r.condition].filter((x) => typeof x === "string" && x.trim());
    push({
      date: isoDate(r.primaryCompletion), kind: "biotech", ticker: String(r.ticker ?? ""), company: String(r.company ?? r.ticker ?? ""),
      label: r.phase ? `${r.phase} readout` : "Clinical readout", url: r.url,
      detail: bits.length ? bits.join(" · ") : (typeof r.catalyst === "string" ? r.catalyst : undefined),
    });
  }
  for (const r of arr(feeds.lockups)) {
    const ipo = isoDate(r.ipoDate);
    const sz = numOrNull(r.sizeUsdM);
    push({
      date: isoDate(r.lockupDate), kind: "lockup", ticker: String(r.ticker ?? ""), company: String(r.company ?? r.ticker ?? ""),
      label: "IPO lockup expiry", url: r.url,
      detail: [ipo && `IPO ${ipo}`, sz != null && `$${Math.round(sz)}M`].filter(Boolean).join(" · ") || undefined,
    });
  }

  return out.sort((a, b) => a.daysTo - b.daysTo || a.kind.localeCompare(b.kind) || a.ticker.localeCompare(b.ticker));
}
