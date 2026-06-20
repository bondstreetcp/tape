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
  approx?: boolean; // computed from the typical schedule (no FRED key) rather than the exact release date
  estimate?: import("./econEstimates").EconEstimate | null; // consensus, attached by the page
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Typical day-of-month for the major monthly releases (data for the prior month).
// Approximate — exact dates come from the FRED key path above.
const MONTHLY: [number, string, string][] = [
  [4, "JOLTS", "Job Openings and Labor Turnover Survey"],
  [12, "CPI", "Consumer Price Index"],
  [13, "PPI", "Producer Price Index"],
  [14, "Consumer sentiment (prelim)", "University of Michigan Consumer Sentiment"],
  [16, "Retail sales", "Advance Monthly Sales for Retail Trade"],
  [17, "Industrial production", "Industrial Production"],
  [18, "Housing starts", "New Residential Construction"],
  [25, "Durable goods", "Advance Durable Goods Orders"],
  [27, "GDP", "Gross Domestic Product"],
  [28, "PCE / personal income", "Personal Income and Outlays"],
];

const weekdayAdjust = (ms: number) => {
  const dow = new Date(ms).getUTCDay();
  return dow === 6 ? ms - DAY : dow === 0 ? ms + DAY : ms; // Sat→Fri, Sun→Mon
};
function firstFriday(year: number, month: number): number {
  const first = Date.UTC(year, month, 1);
  return first + ((5 - new Date(first).getUTCDay() + 7) % 7) * DAY;
}

/** Key-free fallback: upcoming US releases from their typical schedule. Weekly
 *  jobless claims (Thursdays) and the jobs report (1st Friday) are exact; the
 *  monthly indicators are approximate (`approx`). */
function computeSchedule(days: number): EconEvent[] {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + days * DAY;
  const out: EconEvent[] = [];
  for (let t = start; t <= end; t += DAY) {
    if (new Date(t).getUTCDay() === 4) out.push({ date: iso(t), label: "Jobless claims", name: "Unemployment Insurance Weekly Claims" });
  }
  for (let m = 0; m <= 2; m++) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + m;
    const ff = firstFriday(year, month);
    if (ff >= start && ff <= end) out.push({ date: iso(ff), label: "Jobs report (NFP)", name: "Employment Situation" });
    for (const [dom, label, name] of MONTHLY) {
      const adj = weekdayAdjust(Date.UTC(year, month, dom));
      if (adj >= start && adj <= end) out.push({ date: iso(adj), label, name, approx: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label)).slice(0, 40);
}

export async function getEconCalendar(days = 45): Promise<EconEvent[]> {
  if (!KEY) return computeSchedule(days); // key-free approximate schedule
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
