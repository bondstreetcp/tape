/**
 * Per-stock Catalyst Path — the forward timeline of a single name's dated catalysts, stitched from the
 * feeds the app already builds: the next earnings print (with its options-implied move), FDA action
 * dates (PDUFA) and clinical readouts, an IPO lockup expiry, scheduled investor/analyst days, and the
 * next ex-dividend. For an event-driven read: "what's the next thing that moves this stock, and when."
 *
 * CLIENT-SAFE: types + a pure merge only (no fs, no network). The API route reads the feeds and calls it.
 */

export type CatalystKind = "earnings" | "pdufa" | "biotech" | "lockup" | "investor-day" | "ex-div";

export interface StockCatalyst {
  date: string; // ISO YYYY-MM-DD
  daysTo: number; // whole days from nowMs (≥0 for forward events)
  kind: CatalystKind;
  label: string; // short event label
  detail?: string; // extra context
  movePct?: number | null; // options-implied move where a feed prices one
  url?: string;
}

export const CATALYST_META: Record<CatalystKind, { label: string; color: string }> = {
  earnings: { label: "Earnings", color: "#60a5fa" },
  pdufa: { label: "FDA decision", color: "#a78bfa" },
  biotech: { label: "Clinical readout", color: "#f59e0b" },
  lockup: { label: "IPO lockup", color: "#22c55e" },
  "investor-day": { label: "Investor day", color: "#38bdf8" },
  "ex-div": { label: "Ex-dividend", color: "#94a3b8" },
};

const isoDate = (v: unknown): string => {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
};
const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Merge one name's catalysts into a forward, chronologically-sorted list. Pure — `nowMs` is injected. */
export function buildCatalystPath(input: {
  nowMs: number;
  horizonDays?: number; // default 400 (a PDUFA can be ~a year out)
  earnings?: { date?: string | null; implied?: number | null; estimate?: boolean } | null;
  biotech?: { date?: string | null; kind?: "pdufa" | "biotech"; label?: string; detail?: string; url?: string }[];
  lockup?: { date?: string | null; detail?: string; url?: string } | null;
  investorDays?: { date?: string | null; label?: string; detail?: string; implied?: number | null; url?: string }[];
  exDiv?: { date?: string | null; amount?: number | null } | null;
}): StockCatalyst[] {
  const horizon = input.horizonDays ?? 400;
  const out: StockCatalyst[] = [];
  const push = (e: Omit<StockCatalyst, "daysTo"> & { date: string }) => {
    const date = isoDate(e.date);
    if (!date) return;
    const daysTo = Math.round((Date.parse(date + "T00:00:00Z") - input.nowMs) / 86_400_000);
    if (!Number.isFinite(daysTo) || daysTo < 0 || daysTo > horizon) return; // forward + within horizon
    out.push({ ...e, date, daysTo });
  };

  if (input.earnings?.date) {
    const im = numOrNull(input.earnings.implied);
    push({
      date: input.earnings.date, kind: "earnings",
      label: input.earnings.estimate ? "Earnings (est.)" : "Earnings",
      movePct: im,
      detail: im != null ? `options imply ±${im.toFixed(1)}%` : undefined,
    });
  }
  for (const b of input.biotech ?? []) {
    if (!b.date) continue;
    push({ date: b.date, kind: b.kind === "pdufa" ? "pdufa" : "biotech", label: b.label || (b.kind === "pdufa" ? "FDA decision (PDUFA)" : "Clinical readout"), detail: b.detail, url: b.url });
  }
  if (input.lockup?.date) push({ date: input.lockup.date, kind: "lockup", label: "IPO lockup expiry", detail: input.lockup.detail, url: input.lockup.url });
  for (const d of input.investorDays ?? []) {
    if (!d.date) continue;
    const im = numOrNull(d.implied);
    push({ date: d.date, kind: "investor-day", label: d.label || "Investor day", detail: d.detail ?? (im != null ? `options imply ±${im.toFixed(1)}%` : undefined), movePct: im, url: d.url });
  }
  if (input.exDiv?.date) {
    const amt = numOrNull(input.exDiv.amount);
    push({ date: input.exDiv.date, kind: "ex-div", label: "Ex-dividend", detail: amt != null ? `$${amt.toFixed(2)}/sh` : undefined });
  }

  // Dedupe same-day same-kind (e.g. a PDUFA that also appears as a readout), then sort soonest-first.
  const seen = new Set<string>();
  return out
    .filter((e) => { const k = `${e.date}|${e.kind}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.daysTo - b.daysTo || a.kind.localeCompare(b.kind));
}
