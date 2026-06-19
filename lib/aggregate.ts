import type { XY, SeriesPoint } from "./types";

export interface AggInput {
  cap: number;
  daily: XY[];
  intraday: XY[];
}

/**
 * Build a cap-weighted index series from a group of constituents: hold implied
 * shares (currentCap / lastPrice) of each name and value the basket at every
 * timestamp. Normalized to start at 100 — the comparison view re-bases it to the
 * selected window, so only relative moves matter.
 *
 * Constituents missing data at a timestamp are simply excluded from that point
 * (fine for the common case where the window's names all have full history).
 */
function aggregate(series: { cap: number; pts: XY[] }[]): SeriesPoint[] {
  const holders = series
    .map((s) => {
      if (!s.pts.length || !s.cap) return null;
      const lastPrice = s.pts[s.pts.length - 1][1];
      if (!lastPrice) return null;
      const shares = s.cap / lastPrice;
      const map = new Map<number, number>();
      for (const [t, c] of s.pts) map.set(t, c);
      return { shares, map };
    })
    .filter((h): h is { shares: number; map: Map<number, number> } => !!h);

  if (!holders.length) return [];

  const tset = new Set<number>();
  for (const h of holders) for (const t of h.map.keys()) tset.add(t);
  const ts = [...tset].sort((a, b) => a - b);

  const raw: SeriesPoint[] = [];
  for (const t of ts) {
    let v = 0;
    let any = false;
    for (const h of holders) {
      const p = h.map.get(t);
      if (p != null) {
        v += h.shares * p;
        any = true;
      }
    }
    if (any) raw.push({ t, c: v });
  }
  if (!raw.length) return [];

  const base = raw[0].c / 100;
  return base
    ? raw.map((p) => ({ t: p.t, c: Math.round((p.c / base) * 100) / 100 }))
    : raw;
}

export function buildIndustryIndex(constituents: AggInput[]): {
  daily: SeriesPoint[];
  intraday: SeriesPoint[];
} {
  return {
    daily: aggregate(constituents.map((c) => ({ cap: c.cap, pts: c.daily }))),
    intraday: aggregate(constituents.map((c) => ({ cap: c.cap, pts: c.intraday }))),
  };
}
