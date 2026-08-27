/**
 * refresh-attention — the Attention/demand board. Pulls ~1yr of daily Wikipedia pageviews (Wikimedia's
 * official, keyless REST API) for a curated set of tickers + economic-stress topics, and computes the
 * latest 7-day average, the week-over-week move, and an attention-spike z-score (this week vs the
 * trailing ~90-day mean/σ). Throttled + 429-backoff (Wikimedia rate-limits bursts); per-item logging so
 * a bad article title is visible and non-fatal. Writes data/attention.json. Keyless, no LLM.
 *
 *   npx tsx scripts/refresh-attention.ts
 */
import { writeFeedGuarded } from "../lib/feedGuard";
import type { AttnItem, AttnGroup, AttentionData } from "../lib/attention";

const API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents";
const UA = { "User-Agent": "stock-chart-screener (research; equity dashboard)" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const DAY = 86_400_000;

type Art = { key: string; label: string; ticker?: string; group: AttnGroup; article: string };
const ARTICLES: Art[] = [
  // Big tech
  { key: "aapl", label: "Apple", ticker: "AAPL", group: "Big tech", article: "Apple_Inc." },
  { key: "msft", label: "Microsoft", ticker: "MSFT", group: "Big tech", article: "Microsoft" },
  { key: "nvda", label: "Nvidia", ticker: "NVDA", group: "Big tech", article: "Nvidia" },
  { key: "amzn", label: "Amazon", ticker: "AMZN", group: "Big tech", article: "Amazon_(company)" },
  { key: "googl", label: "Alphabet", ticker: "GOOGL", group: "Big tech", article: "Alphabet_Inc." },
  { key: "meta", label: "Meta", ticker: "META", group: "Big tech", article: "Meta_Platforms" },
  { key: "nflx", label: "Netflix", ticker: "NFLX", group: "Big tech", article: "Netflix" },
  { key: "tsla", label: "Tesla", ticker: "TSLA", group: "Big tech", article: "Tesla,_Inc." },
  // Consumer & retail
  { key: "cost", label: "Costco", ticker: "COST", group: "Consumer & retail", article: "Costco" },
  { key: "mcd", label: "McDonald's", ticker: "MCD", group: "Consumer & retail", article: "McDonald's" },
  { key: "sbux", label: "Starbucks", ticker: "SBUX", group: "Consumer & retail", article: "Starbucks" },
  { key: "nke", label: "Nike", ticker: "NKE", group: "Consumer & retail", article: "Nike,_Inc." },
  { key: "dis", label: "Disney", ticker: "DIS", group: "Consumer & retail", article: "The_Walt_Disney_Company" },
  { key: "cmg", label: "Chipotle", ticker: "CMG", group: "Consumer & retail", article: "Chipotle_Mexican_Grill" },
  { key: "lulu", label: "Lululemon", ticker: "LULU", group: "Consumer & retail", article: "Lululemon" },
  // Meme & momentum
  { key: "gme", label: "GameStop", ticker: "GME", group: "Meme & momentum", article: "GameStop" },
  { key: "amc", label: "AMC", ticker: "AMC", group: "Meme & momentum", article: "AMC_Theatres" },
  { key: "pltr", label: "Palantir", ticker: "PLTR", group: "Meme & momentum", article: "Palantir_Technologies" },
  { key: "coin", label: "Coinbase", ticker: "COIN", group: "Meme & momentum", article: "Coinbase" },
  { key: "hood", label: "Robinhood", ticker: "HOOD", group: "Meme & momentum", article: "Robinhood_Markets" },
  // Economic stress (topics — public anxiety proxy, no ticker)
  { key: "recession", label: "Recession", group: "Economic stress", article: "Recession" },
  { key: "layoff", label: "Layoffs", group: "Economic stress", article: "Layoff" },
  { key: "inflation", label: "Inflation", group: "Economic stress", article: "Inflation" },
  { key: "bankruptcy", label: "Bankruptcy", group: "Economic stress", article: "Bankruptcy" },
];

const yyyymmdd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
const tsToDate = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

type Obs = { date: string; value: number };

async function fetchViews(article: string, start: string, end: string): Promise<Obs[]> {
  const url = `${API}/${encodeURIComponent(article)}/daily/${start}/${end}`;
  for (let i = 0; i < 4; i++) {
    let res: Response;
    try { res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) }); }
    catch { await sleep(1200 * (i + 1)); continue; }
    if (res.status === 429) { await sleep(1500 * (i + 1)); continue; } // rate-limited → back off
    if (res.status === 404) return []; // no such article / no data
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json();
    return ((j?.items ?? []) as any[])
      .map((x) => ({ date: tsToDate(String(x.timestamp)), value: Number(x.views) }))
      .filter((o) => o.date && Number.isFinite(o.value));
  }
  throw new Error("429 (rate-limited after retries)");
}

/** Downsample to ~weekly for a compact sparkline, keep the last `keep`. */
function weekly(obs: Obs[], keep = 52): [string, number][] {
  const out: [string, number][] = [];
  for (let i = obs.length - 1; i >= 0; i -= 7) out.push([obs[i].date, obs[i].value]);
  return out.reverse().slice(-keep);
}

function build(a: Art, obs: Obs[]): AttnItem | null {
  if (obs.length < 21) return null;
  const v = obs.map((o) => o.value);
  const last7 = mean(v.slice(-7));
  const prev7 = mean(v.slice(-14, -7));
  const trailing = v.slice(-97, -7); // ~90d before the latest week
  const m = mean(trailing);
  const sd = Math.sqrt(mean(trailing.map((x) => (x - m) ** 2)));
  return {
    key: a.key, label: a.label, ticker: a.ticker, group: a.group,
    latest: Math.round(last7), latestDate: obs[obs.length - 1].date,
    wowPct: prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 1000) / 10 : null,
    spikeZ: sd > 0 ? Math.round(((last7 - m) / sd) * 100) / 100 : null,
    history: weekly(obs),
  };
}

async function main() {
  const end = Date.now();
  const start = end - 400 * DAY;
  const s = yyyymmdd(start), e = yyyymmdd(end);
  const items: AttnItem[] = [];
  for (const a of ARTICLES) {
    try {
      const item = build(a, await fetchViews(a.article, s, e));
      if (item) { items.push(item); console.log(`  ${a.key.padEnd(10)} ${item.latest} views/day (wow ${item.wowPct ?? "—"}%, spike ${item.spikeZ ?? "—"}σ)`); }
      else console.warn(`  ${a.key}: insufficient/no data — check article title "${a.article}"`);
    } catch (err: any) { console.warn(`  ${a.key}: ${String(err?.message || err).slice(0, 40)} ("${a.article}")`); }
    await sleep(350); // be polite to the Wikimedia API
  }
  const data: AttentionData = { asOf: new Date().toISOString(), items };
  const w = await writeFeedGuarded("attention.json", data);
  console.log(`refresh-attention: ${items.length}/${ARTICLES.length} items — ${w.reason}`);
  if (!w.written) { console.error("refresh-attention: kept prior file (too thin) — retry next tick."); process.exitCode = 1; }
}

main().catch((err) => { console.error("refresh-attention:", String((err as Error)?.message || err)); process.exitCode = 1; });
