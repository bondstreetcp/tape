/**
 * Consensus economist estimates for the current week's US economic releases, from
 * ForexFactory's free weekly calendar JSON (faireconomy CDN — no API key). Each
 * event carries the consensus `forecast` and `previous`. Only the current week is
 * published, so we surface estimates for the imminent releases (consensus firms up
 * close to the release anyway).
 */
const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export interface EconEstimate {
  forecast: string; // consensus, e.g. "0.5%", "225K", "1.43M"
  previous: string;
  title: string; // the ForexFactory release title (disambiguates the metric)
  dateISO: string;
}

interface FFEvent { title: string; country: string; date: string; impact: string; forecast: string; previous: string }

// Release key → ForexFactory title patterns, in priority order (prefer the metric
// matching our chart's transform; ^ anchors avoid matching the "Core …" variant).
const PATTERNS: Record<string, RegExp[]> = {
  payrolls: [/Non-Farm Employment Change/i],
  cpi: [/^CPI y\/y/i, /^CPI m\/m/i],
  ppi: [/^PPI y\/y/i, /^PPI m\/m/i],
  gdp: [/GDP q\/q/i],
  pce: [/Core PCE Price Index y\/y/i, /Core PCE Price Index m\/m/i, /Core PCE/i],
  retail: [/^Retail Sales m\/m/i],
  indpro: [/Industrial Production m\/m/i],
  durable: [/^Durable Goods Orders m\/m/i],
  housing: [/Housing Starts/i],
  jolts: [/JOLTS Job Openings/i],
  claims: [/Unemployment Claims/i],
  sentiment: [/UoM Consumer Sentiment/i],
};

let cache: { at: number; data: FFEvent[] } | null = null;

export async function getEconEstimates(): Promise<FFEvent[]> {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.data;
  try {
    const r = await fetch(FF_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return cache?.data ?? [];
    const j = await r.json();
    const us = (Array.isArray(j) ? j : []).filter((e: any) => e.country === "USD" && e.forecast) as FFEvent[];
    cache = { at: Date.now(), data: us };
    return us;
  } catch {
    return cache?.data ?? [];
  }
}

/** Best consensus estimate for a release near a target date (within ±7 days). */
export function matchEstimate(releaseKey: string, eventDate: string, ff: FFEvent[]): EconEstimate | null {
  const pats = PATTERNS[releaseKey];
  if (!pats || !ff.length) return null;
  const target = new Date(eventDate + "T12:00:00Z").getTime();
  for (const pat of pats) {
    let best: FFEvent | null = null;
    let bestDiff = Infinity;
    for (const e of ff) {
      if (!pat.test(e.title) || !e.forecast) continue;
      const diff = Math.abs(new Date(e.date).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = e; }
    }
    if (best && bestDiff <= 7 * 86_400_000) {
      return { forecast: best.forecast, previous: best.previous, title: best.title, dateISO: best.date };
    }
  }
  return null;
}
