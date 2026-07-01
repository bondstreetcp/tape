/**
 * Builds data/ipo-monitor.json — recent IPOs + the IPO-lockup-expiry calendar.
 *
 * Two EDGAR full-text scans of 424B4 final prospectuses: (a) the last ~16 days = recent IPOs;
 * (b) ~150-215 days ago = IPOs whose ~180-day lockup is expiring soon (a supply catalyst). GLM
 * confirms each is a genuine IPO (not a follow-on/shelf) and extracts ticker/price/size/exchange.
 *
 * Run: npm run refresh-ipo. Nightly. Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { eftsSearch, fetchFilingBodyText, type EftsHit } from "../lib/edgarSearch";
import type { IpoData, IpoEvent, IpoKind } from "../lib/ipoMonitor";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "ipo-monitor.json");
const DAY = 86_400_000;
const LOCKUP_DAYS = 180;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (d: number) => new Date(d).toISOString().slice(0, 10);

async function classify(hit: EftsHit, text: string): Promise<{ ticker: string; company: string; priceUsd: number | null; sizeUsdM: number | null; exchange: string } | null> {
  const SYSTEM =
    "You read one SEC 424B4 prospectus and determine if it is an INITIAL public offering (a company listing its common stock for the FIRST time) — NOT a follow-on, secondary, shelf takedown, ETF, SPAC unit, or debt/notes offering. If it IS an IPO, return the ticker symbol, company name, the IPO price per share (number), the total deal size in US$ MILLIONS (number), and the exchange (NYSE/Nasdaq). " +
    "If it is NOT a first-time common-stock IPO, return isIpo=false and it is dropped. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"isIpo":boolean,"ticker":string,"company":string,"priceUsd":number|null,"sizeUsdM":number|null,"exchange":string}';
  const out = await chatJSON<any>(SYSTEM, `Filed ${hit.date}. ${hit.issuer}${hit.ticker ? ` (${hit.ticker})` : ""}.\n\n${text.slice(0, 6000)}\n\n${SCHEMA}`, { maxTokens: 260 });
  if (!out || out.isIpo === false) return null;
  const ticker = String(out.ticker || hit.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6);
  if (!ticker) return null;
  const num = (x: any) => (typeof x === "number" && isFinite(x) && x > 0 ? x : null);
  return { ticker, company: String(out.company || hit.issuer).slice(0, 70), priceUsd: num(out.priceUsd), sizeUsdM: num(out.sizeUsdM), exchange: String(out.exchange || "").slice(0, 12) };
}

async function ipoPerf(ticker: string, ipoPrice: number | null): Promise<number | null> {
  try {
    const ch: any = await yf.chart(ticker, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false });
    const q = (ch?.quotes || []).filter((x: any) => x?.close != null);
    if (!q.length) return null;
    const now = q[q.length - 1].close as number;
    return ipoPrice && ipoPrice > 0 ? +(((now / ipoPrice) - 1) * 100).toFixed(2) : null;
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

  // (a) recent IPOs; (b) IPOs whose ~180d lockup is expiring soon
  const recent = await eftsSearch({ forms: "424B4", startdt: iso(Date.now() - 16 * DAY), enddt: iso(Date.now()) });
  const lockWin = await eftsSearch({ forms: "424B4", startdt: iso(Date.now() - (LOCKUP_DAYS + 35) * DAY), enddt: iso(Date.now() - (LOCKUP_DAYS - 30) * DAY) });
  const tagged = [...recent.map((h) => ({ hit: h, kind: "ipo" as IpoKind })), ...lockWin.map((h) => ({ hit: h, kind: "lockup" as IpoKind }))];
  const seen = new Set<string>();
  const uniq = tagged.filter((t) => (seen.has(t.hit.accession) ? false : (seen.add(t.hit.accession), true)));
  console.log(`fetched ${recent.length} recent + ${lockWin.length} lockup-window 424B4 → ${uniq.length} unique`);

  const prior: IpoData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, events: [] as IpoEvent[] }));
  const known = new Set(prior.events.map((e) => e.id));
  const fresh = uniq.filter((t) => !known.has(t.hit.accession)).slice(0, 70);
  console.log(`${fresh.length} new 424B4 to screen`);

  const built = await mapPool(fresh, 4, async ({ hit, kind }): Promise<IpoEvent | null> => {
    const text = await fetchFilingBodyText(hit);
    if (!text) return null;
    const c = await classify(hit, text);
    if (!c) return null;
    const ipoT = Date.parse((hit.date || iso(Date.now())) + "T12:00:00Z");
    const lockupT = ipoT + LOCKUP_DAYS * DAY;
    return {
      id: hit.accession, kind, ticker: c.ticker, company: c.company,
      ipoDate: iso(ipoT), lockupDate: iso(lockupT), daysToLockup: Math.round((lockupT - Date.now()) / DAY),
      priceUsd: c.priceUsd, sizeUsdM: c.sizeUsdM, exchange: c.exchange, sinceIpoPct: null,
      url: hit.ciks[0] ? `https://www.sec.gov/Archives/edgar/data/${Number(hit.ciks[0])}/${hit.accession.replace(/-/g, "")}/${hit.doc}` : "",
    };
  });

  const merged = [...built.filter((x): x is IpoEvent => !!x), ...prior.events]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    .map((e) => ({ ...e, daysToLockup: e.lockupDate ? Math.round((Date.parse(e.lockupDate) - Date.now()) / DAY) : null })) // refresh the clock
    .filter((e) => e.kind === "ipo" ? Date.now() - Date.parse(e.ipoDate) < 60 * DAY : (e.daysToLockup != null && e.daysToLockup > -30 && e.daysToLockup < 60)) // keep recent IPOs + near-term unlocks
    .sort((a, b) => a.kind !== b.kind ? (a.kind === "lockup" ? -1 : 1) : (a.kind === "lockup" ? (a.daysToLockup! - b.daysToLockup!) : (Date.parse(b.ipoDate) - Date.parse(a.ipoDate))))
    .slice(0, 200);

  // refresh perf
  const syms = [...new Set(merged.map((e) => e.ticker))];
  const priceByTicker: Record<string, number | null> = {};
  merged.forEach((e) => { if (e.priceUsd) priceByTicker[e.ticker] = e.priceUsd; });
  const perf: Record<string, number | null> = {};
  await mapPool(syms, 6, async (s) => { perf[s] = await ipoPerf(s, priceByTicker[s] ?? null); });
  for (const e of merged) e.sinceIpoPct = perf[e.ticker] ?? null;

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: uniq.length, events: merged } satisfies IpoData));
  const nIpo = merged.filter((e) => e.kind === "ipo").length, nLock = merged.filter((e) => e.kind === "lockup").length;
  console.log(`\nwrote ${merged.length} events (${nIpo} recent IPOs, ${nLock} upcoming lockups).`);
  for (const e of merged.slice(0, 10)) console.log(`  [${e.kind.padEnd(6)}] ${e.ticker.padEnd(6)} ipo ${e.ipoDate} ${e.priceUsd ? "$" + e.priceUsd : ""} ${e.kind === "lockup" ? `unlock ${e.lockupDate} (${e.daysToLockup}d)` : ""} since ${e.sinceIpoPct ?? "—"}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
