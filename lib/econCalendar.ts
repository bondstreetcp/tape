/**
 * Upcoming US economic releases from FRED's releases/dates API. Needs a free
 * FRED API key in the FRED_API_KEY env var (the no-key fredgraph CSV used by
 * lib/fred.ts has the data but not the release schedule).
 */
const KEY = process.env.FRED_API_KEY;

// Release-name substrings → short label for the calendar.
const MAJOR: [string, string][] = [
  ["Employment Situation", "Jobs report (NFP)"],
  ["Consumer Price Index", "CPI"],
  ["Producer Price Index", "PPI"],
  ["Gross Domestic Product", "GDP"],
  ["Personal Income and Outlays", "PCE / personal income"],
  ["Advance Monthly Sales for Retail", "Retail sales"],
  ["Industrial Production", "Industrial production"],
  ["New Residential Construction", "Housing starts"],
  ["Job Openings and Labor Turnover", "JOLTS"],
  ["Unemployment Insurance Weekly Claims", "Jobless claims"],
  ["University of Michigan", "Consumer sentiment"],
  ["Advance Durable Goods", "Durable goods"],
];

export const econKeyConfigured = () => !!KEY;

export interface EconEvent {
  date: string; // YYYY-MM-DD
  label: string;
  name: string; // full FRED release name
}

export async function getEconCalendar(days = 45): Promise<EconEvent[]> {
  if (!KEY) return [];
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  try {
    const url =
      `https://api.stlouisfed.org/fred/releases/dates?api_key=${KEY}&file_type=json` +
      `&realtime_start=${today}&include_release_dates_with_no_data=true&sort_order=asc&limit=1000`;
    const res = await fetch(url, { headers: { "User-Agent": "stock-chart-screener" } });
    if (!res.ok) return [];
    const j: any = await res.json();
    const seen = new Set<string>();
    const out: EconEvent[] = [];
    for (const d of j.release_dates || []) {
      if (!d.date || d.date < today || d.date > end) continue;
      const hit = MAJOR.find(([m]) => (d.release_name || "").includes(m));
      if (!hit) continue;
      const k = d.date + "|" + hit[1];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ date: d.date, label: hit[1], name: d.release_name });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
  } catch {
    return [];
  }
}
