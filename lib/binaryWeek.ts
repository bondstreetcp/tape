/**
 * Binary Events This Week — the near-term, IMPACT-RANKED digest of dated catalysts that can move a
 * stock hard: FDA PDUFA decisions, Phase 2/3 readouts, earnings prints, investor days, and IPO lockup
 * expiries. It joins the app's existing feeds (no new pipeline) and ranks each event by the options-
 * implied move where the market prices one, else an event-type prior — so the biggest potential movers
 * in the window surface first. "Hard binaries" (PDUFA / readouts) are flagged separately.
 *
 * CLIENT-SAFE: types + a pure merge/rank only (no fs, no network). The page reads the feeds and calls it.
 */

export type BinaryKind = "pdufa" | "readout" | "earnings" | "investor-day" | "lockup";

export interface BinaryEvent {
  date: string; // ISO YYYY-MM-DD
  daysTo: number;
  kind: BinaryKind;
  ticker: string;
  company: string;
  label: string;
  detail?: string;
  impliedMovePct: number | null; // options-implied move, where a feed prices one
  impact: number; // ranking score — implied move if priced, else a type prior
  hardBinary: boolean; // PDUFA / clinical readout — a discrete, potentially large outcome
  url?: string;
}

export const BINARY_META: Record<BinaryKind, { label: string; color: string; prior: number }> = {
  pdufa: { label: "FDA decision", color: "#a78bfa", prior: 35 },
  readout: { label: "Clinical readout", color: "#f59e0b", prior: 40 },
  earnings: { label: "Earnings", color: "#60a5fa", prior: 6 },
  "investor-day": { label: "Investor day", color: "#38bdf8", prior: 6 },
  lockup: { label: "IPO lockup", color: "#22c55e", prior: 8 },
};

const isoDate = (v: unknown): string => {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
};
const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Merge + rank the window's binary events. Pure — `nowMs` injected. `horizonDays` default 7 ("this week"). */
export function buildBinaryWeek(
  feeds: {
    earnings?: any[]; // earnings-move rows { symbol, name, earningsDate, impliedMovePct, sector }
    biotech?: any[]; // biotech-catalysts items { ticker, company, statusKind, primaryCompletion, drug, condition, phase, url }
    biotechVol?: any[]; // biotech-vol rows { ticker, eventDate, impliedMovePct } — the priced binary move
    investorDays?: any[]; // catalyst-vol rows { ticker, company, eventType, eventDate, impliedMovePct, url }
    lockups?: any[]; // ipo-monitor events { ticker, company, kind, lockupDate, ipoDate, url }
  },
  nowMs: number,
  opts: { horizonDays?: number } = {},
): BinaryEvent[] {
  const horizon = opts.horizonDays ?? 7;
  // Floor "now" to its own UTC midnight so the day diff compares calendar dates, not a live
  // wall-clock instant against event midnight — otherwise, during US market hours (past 12:00
  // UTC) today's events round to daysTo=-1 and silently drop off the board.
  const nowMid = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const out: BinaryEvent[] = [];
  const push = (e: Omit<BinaryEvent, "daysTo" | "impact"> & { date: string }) => {
    const date = isoDate(e.date);
    if (!date || !e.ticker) return;
    const daysTo = Math.round((Date.parse(date + "T00:00:00Z") - nowMid) / 86_400_000);
    if (!Number.isFinite(daysTo) || daysTo < 0 || daysTo > horizon) return;
    const impact = e.impliedMovePct != null ? e.impliedMovePct : BINARY_META[e.kind].prior;
    out.push({ ...e, date, daysTo, impact });
  };

  // Priced biotech-binary moves, joined by ticker + event date.
  const volBy = new Map<string, number>();
  for (const v of feeds.biotechVol ?? []) { const d = isoDate(v.eventDate); if (v.ticker && d && numOrNull(v.impliedMovePct) != null) volBy.set(`${v.ticker}|${d}`, v.impliedMovePct); }

  for (const r of feeds.earnings ?? []) {
    push({ date: isoDate(r.earningsDate), kind: "earnings", ticker: String(r.symbol ?? ""), company: String(r.name ?? r.symbol ?? ""), label: "Earnings", impliedMovePct: numOrNull(r.impliedMovePct), detail: r.sector || undefined, hardBinary: false });
  }
  for (const i of feeds.biotech ?? []) {
    const sk = String(i.statusKind ?? "");
    if (sk !== "pdufa" && sk !== "readout" && sk !== "enrolling-done") continue;
    const date = isoDate(i.primaryCompletion);
    const kind: BinaryKind = sk === "pdufa" ? "pdufa" : "readout";
    push({
      date, kind, ticker: String(i.ticker ?? ""), company: String(i.company ?? i.ticker ?? ""),
      label: kind === "pdufa" ? "FDA decision (PDUFA)" : `${i.phase || "Clinical"} readout`,
      detail: [i.drug, i.condition].filter(Boolean).join(" · ") || undefined,
      impliedMovePct: volBy.get(`${i.ticker}|${date}`) ?? null,
      hardBinary: true, url: i.url,
    });
  }
  for (const r of feeds.investorDays ?? []) {
    push({ date: isoDate(r.eventDate), kind: "investor-day", ticker: String(r.ticker ?? ""), company: String(r.company ?? r.ticker ?? ""), label: String(r.eventType || "Investor day"), impliedMovePct: numOrNull(r.impliedMovePct), hardBinary: false, url: r.url });
  }
  for (const e of feeds.lockups ?? []) {
    if (e.kind === "upcoming" || !e.lockupDate) continue;
    const ipo = isoDate(e.ipoDate);
    push({ date: isoDate(e.lockupDate), kind: "lockup", ticker: String(e.ticker ?? ""), company: String(e.company ?? e.ticker ?? ""), label: "IPO lockup expiry", detail: ipo ? `IPO ${ipo}` : undefined, impliedMovePct: null, hardBinary: false, url: e.url });
  }

  // One row per ticker+date+kind, ranked by impact (biggest potential mover first), then soonest.
  const seen = new Set<string>();
  return out
    .filter((e) => { const k = `${e.ticker}|${e.date}|${e.kind}`; return seen.has(k) ? false : (seen.add(k), true); })
    .sort((a, b) => b.impact - a.impact || a.daysTo - b.daysTo || a.ticker.localeCompare(b.ticker));
}
