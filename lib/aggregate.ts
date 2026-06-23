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
      const pts = [...s.pts].sort((a, b) => a[0] - b[0]); // ascending by time
      const lastPrice = pts[pts.length - 1][1];
      if (!lastPrice) return null;
      return { shares: s.cap / lastPrice, pts };
    })
    .filter((h): h is { shares: number; pts: XY[] } => !!h);

  if (!holders.length) return [];

  const tset = new Set<number>();
  for (const h of holders) for (const [t] of h.pts) tset.add(t);
  const ts = [...tset].sort((a, b) => a - b);

  // Forward-fill each name's last-known price across the union timeline. Live 15-minute bars from
  // different names end on slightly different ticks (the in-progress bar), so without this a name
  // drops out of the basket at the misaligned tail and the cap-weighted index craters at the last
  // point. Once a name has started it always contributes its most recent price.
  const ptr = new Array(holders.length).fill(0);
  const cur = new Array<number | null>(holders.length).fill(null);
  const raw: SeriesPoint[] = [];
  for (const t of ts) {
    let v = 0;
    let started = false;
    for (let i = 0; i < holders.length; i++) {
      const pts = holders[i].pts;
      while (ptr[i] < pts.length && pts[ptr[i]][0] <= t) { cur[i] = pts[ptr[i]][1]; ptr[i]++; }
      if (cur[i] != null) { v += holders[i].shares * (cur[i] as number); started = true; }
    }
    if (started) raw.push({ t, c: v });
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
