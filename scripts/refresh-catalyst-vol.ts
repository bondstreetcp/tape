/**
 * Builds data/catalyst-vol.json — cheap options into a known catalyst.
 *
 * 1. EDGAR full-text search for recent 8-Ks announcing an INVESTOR / ANALYST / CAPITAL-MARKETS DAY.
 * 2. GLM extracts the exact upcoming event DATE (keeps future events only).
 * 3. Price the ATM straddle over the expiry bracketing the event → implied move, and compare to the
 *    stock's realized-vol baseline over the same window. A low implied/baseline ratio = the options
 *    market isn't pricing the catalyst (cheap optionality).
 *
 * Run: npm run refresh-catalyst-vol. Nightly. Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { eftsSearch, fetchFilingBodyText, type EftsHit } from "../lib/edgarSearch";
import { getOptions } from "../lib/options";
import { straddleMove } from "../lib/earningsTrade";
import type { CatalystRow, CatalystVolData } from "../lib/catalystVol";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "catalyst-vol.json");
const DAY = 86_400_000;
const MAX_DAYS_OUT = 120; // catalysts within ~4 months (investor days are often announced well ahead)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findEventHits(): Promise<EftsHit[]> {
  const enddt = new Date().toISOString().slice(0, 10);
  const startdt = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const phrases = ['"investor day"', '"analyst day"', '"capital markets day"'];
  const all: EftsHit[] = [];
  for (const q of phrases) { all.push(...(await eftsSearch({ q, forms: "8-K", startdt, enddt }))); await sleep(300); }
  // one per ticker (the announcement + reminders collapse); keep tickered US names
  const byTicker = new Map<string, EftsHit>();
  for (const h of all) { if (h.ticker && !byTicker.has(h.ticker)) byTicker.set(h.ticker, h); }
  return [...byTicker.values()];
}

async function extractDate(hit: EftsHit, text: string): Promise<{ eventType: string; eventDate: string } | null> {
  const SYSTEM =
    "From this 8-K, find the company's UPCOMING investor day / analyst day / capital markets day (an event where management presents its strategy/guidance to investors). Return the eventType and the exact event DATE as an ISO date (YYYY-MM-DD). " +
    "If the date is only a month/quarter, use the first plausible day. If the event is in the PAST, or the filing doesn't actually schedule such a future event (e.g. it just mentions a past one, or a webcast replay), return eventDate ''. Only a real, dated, FUTURE event counts. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"eventType":string,"eventDate":string}';
  const out = await chatJSON<any>(SYSTEM, `Filed ${hit.date}. Company: ${hit.issuer} (${hit.ticker}).\n\n${text.slice(0, 5000)}\n\n${SCHEMA}`, { maxTokens: 200 });
  const d = out?.eventDate && /^\d{4}-\d{2}-\d{2}/.test(out.eventDate) ? out.eventDate.slice(0, 10) : "";
  if (!d) return null;
  return { eventType: String(out.eventType || "Investor Day").slice(0, 40), eventDate: d };
}

async function hvAnnual(sym: string): Promise<number | null> {
  try {
    const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 90 * DAY), interval: "1d" } as any, { validateResult: false });
    const c = (ch?.quotes || []).filter((q: any) => q?.close != null).map((q: any) => q.close as number);
    if (c.length < 20) return null;
    const rets: number[] = []; for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
    const last = rets.slice(-30);
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    const v = last.reduce((a, b) => a + (b - mean) ** 2, 0) / (last.length - 1);
    return Math.sqrt(v * 252);
  } catch { return null; }
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } } }));
  return out;
}

async function main() {
  const nowISO = new Date().toISOString();
  if (!(await llmConfigured())) { console.log("LLM not configured — skipping."); return; }

  const hits = await findEventHits().catch(() => []);
  console.log(`${hits.length} unique tickers with a recent investor/analyst-day 8-K`);

  // extract the event date for each (fetch the filing text + LLM)
  const dated = await mapPool(hits.slice(0, 40), 4, async (h) => {
    const text = await fetchFilingBodyText(h);
    if (!text) return null;
    const d = await extractDate(h, text);
    if (!d) return null;
    const days = Math.round((Date.parse(d.eventDate) - Date.now()) / DAY);
    if (days < 0 || days > MAX_DAYS_OUT) return null; // future, near-dated only
    return { hit: h, ...d, days };
  });
  const events = dated.filter(Boolean) as { hit: EftsHit; eventType: string; eventDate: string; days: number }[];
  console.log(`${events.length} have a dated, near-term future event → pricing options`);

  // Build the event CALENDAR: new EDGAR events + any prior events still in the future (forward-
  // accumulating — the EDGAR scan only shows recent 8-Ks, so a found investor day would otherwise fall
  // off before it happens). Then re-price everything against fresh options each run.
  const prior: CatalystVolData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, rows: [] as CatalystRow[] }));
  type Ev = { ticker: string; company: string; eventType: string; eventDate: string; url: string };
  const calendar = new Map<string, Ev>();
  for (const r of prior.rows) if (Date.parse(r.eventDate) > Date.now()) calendar.set(`${r.ticker}-${r.eventDate}`, { ticker: r.ticker, company: r.company, eventType: r.eventType, eventDate: r.eventDate, url: r.url });
  for (const e of events) calendar.set(`${e.hit.ticker}-${e.eventDate}`, { ticker: e.hit.ticker!, company: e.hit.issuer, eventType: e.eventType, eventDate: e.eventDate, url: `https://www.sec.gov/Archives/edgar/data/${Number(e.hit.ciks[0])}/${e.hit.accession.replace(/-/g, "")}/${e.hit.doc}` });

  const rows = await mapPool([...calendar.values()], 4, async (ev): Promise<CatalystRow | null> => {
    const days = Math.round((Date.parse(ev.eventDate) - Date.now()) / DAY);
    if (days < 0 || days > MAX_DAYS_OUT) return null;
    const [chain, hv] = await Promise.all([getOptions(ev.ticker).catch(() => null), hvAnnual(ev.ticker)]);
    if (!chain || hv == null || hv <= 0) return null;
    const sm = await straddleMove(ev.ticker, chain, ev.eventDate);
    if (!sm || !sm.isEvent || sm.dte == null || sm.dte < 1) return null;
    const baselineMovePct = hv * Math.sqrt(sm.dte / 365) * 100;
    if (!(baselineMovePct > 0)) return null;
    return {
      ticker: ev.ticker, company: ev.company, eventType: ev.eventType, eventDate: ev.eventDate, daysToEvent: days,
      price: +sm.price.toFixed(2), expiry: sm.expiry || "", dte: sm.dte,
      impliedMovePct: +sm.movePct.toFixed(2), baselineMovePct: +baselineMovePct.toFixed(2),
      ratio: +(sm.movePct / baselineMovePct).toFixed(2), hvAnnual: +(hv * 100).toFixed(1), url: ev.url,
    };
  });

  const out = (rows.filter(Boolean) as CatalystRow[]).sort((a, b) => a.ratio - b.ratio); // cheapest first
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: hits.length, rows: out } satisfies CatalystVolData));
  console.log(`\nwrote ${out.length} catalyst rows (cheapest first):`);
  for (const r of out.slice(0, 12)) console.log(`  ${r.ticker.padEnd(6)} ${r.eventType.padEnd(16)} ${r.eventDate} (${r.daysToEvent}d) implied ±${r.impliedMovePct}% vs baseline ±${r.baselineMovePct}% = ${r.ratio}×`);
}

main().catch((e) => { console.error(e); process.exit(1); });
