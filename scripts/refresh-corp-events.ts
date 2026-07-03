/**
 * Builds data/corp-events.json — the corporate-events monitor (buybacks, strategic-alternatives,
 * spin-offs, splits, leadership changes) from SEC 8-K full-text search + GLM extraction.
 *
 * Run: npm run refresh-corp-events. Nightly. Forward-accumulating. A disclosure tracker, not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { eftsSearch, fetchFilingBodyText, type EftsHit } from "../lib/edgarSearch";
import type { CorpEvent, CorpEventType, CorpEventsData } from "../lib/corpEvents";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "corp-events.json");
const DAY = 86_400_000;
const KEEP = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// per-type EFTS query + how far back to scan (leadership 8-Ks are high-volume → tight window)
const QUERIES: { type: CorpEventType; q: string; days: number }[] = [
  { type: "buyback", q: '"repurchase program"', days: 14 },
  { type: "strategic-alt", q: '"strategic alternatives"', days: 21 },
  { type: "spin-off", q: '"spin-off"', days: 21 },
  { type: "split", q: '"stock split"', days: 21 },
  { type: "leadership", q: '"Chief Executive Officer"', days: 4 },
];

const HINT: Record<CorpEventType, string> = {
  buyback: "a NEW share-repurchase / buyback authorization (give the $ size and % of market cap if stated, and whether it's an accelerated buyback or a tender/odd-lot)",
  "strategic-alt": "the board is exploring STRATEGIC ALTERNATIVES / a potential sale/merger/review (say what's under review)",
  "spin-off": "an announced SPIN-OFF, carve-out, or split of the company (name the business being separated + expected timing)",
  split: "a STOCK SPLIT (give the ratio and whether forward or reverse)",
  leadership: "a CEO or CFO change — a departure and/or appointment (name who is leaving and who is coming in)",
};

async function classify(hit: EftsHit, type: CorpEventType, text: string): Promise<{ ticker: string | null; headline: string } | null> {
  const SYSTEM =
    `You read one SEC 8-K and confirm it announces ${HINT[type]}. If it genuinely does, return the company ticker and a ONE-LINE headline with the key specifics. ` +
    "If the filing does NOT actually announce this event (routine mention, a past event, an unrelated 8-K, a director-only change for a leadership query, a buyback merely referenced not newly authorized), return material=false and it is dropped. Be strict. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"ticker":string|null,"headline":string,"material":boolean}';
  const out = await chatJSON<any>(SYSTEM, `Subject: ${hit.issuer}${hit.ticker ? ` (${hit.ticker})` : ""}. Filed ${hit.date}.\n\n${text.slice(0, 5500)}\n\n${SCHEMA}`, { maxTokens: 300 });
  if (!out || out.material === false) return null;
  const ticker = out.ticker ? String(out.ticker).toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6) : hit.ticker;
  return { ticker: ticker || hit.ticker, headline: String(out.headline || "").slice(0, 240) };
}


// A ticker the LLM emitted (vs one EDGAR supplied) must actually price on Yahoo before it is
// stored — else a wrong-but-real symbol shows another company's move as this event's performance.
async function validTicker(sym: string): Promise<boolean> {
  try { const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false }); return (ch?.quotes || []).some((q: any) => q?.close != null); } catch { return false; }
}
async function sinceFor(ticker: string, iso: string): Promise<number | null> {
  try {
    const eT = Date.parse(iso);
    const ch: any = await yf.chart(ticker, { period1: new Date(eT - 8 * DAY), interval: "1d" } as any, { validateResult: false });
    const q = (ch?.quotes || []).filter((x: any) => x?.close != null).map((x: any) => ({ t: new Date(x.date).getTime(), c: x.close as number }));
    if (!q.length) return null;
    const at = (q.find((p: any) => p.t >= eT) || q[0]).c, now = q[q.length - 1].c;
    return at && now ? +(((now / at) - 1) * 100).toFixed(2) : null;
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
  const enddt = nowISO.slice(0, 10);

  const raw: { hit: EftsHit; type: CorpEventType }[] = [];
  for (const { type, q, days } of QUERIES) {
    const startdt = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    const hits = await eftsSearch({ q, forms: "8-K", startdt, enddt });
    for (const h of hits) if (h.ticker) raw.push({ hit: h, type });
    await sleep(300);
  }
  // dedup by accession (keep first type seen)
  const seen = new Set<string>();
  const uniq = raw.filter((r) => (seen.has(r.hit.accession) ? false : (seen.add(r.hit.accession), true)));
  console.log(`fetched ${raw.length} 8-K hits → ${uniq.length} unique`);

  const prior: CorpEventsData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, events: [] as CorpEvent[] }));
  const known = new Set(prior.events.map((e) => e.id));
  // cap PER TYPE (else the high-volume leading queries — buybacks — eat the whole budget and spin/split/
  // leadership never get classified). ~22 each → balanced coverage across the monitor types.
  const perType: Record<string, number> = {};
  const fresh = uniq.filter((r) => !known.has(r.hit.accession)).filter((r) => { const n = perType[r.type] || 0; if (n >= 22) return false; perType[r.type] = n + 1; return true; });
  console.log(`${fresh.length} new to classify (${JSON.stringify(perType)})`);

  const built = await mapPool(fresh, 4, async ({ hit, type }): Promise<CorpEvent | null> => {
    const text = await fetchFilingBodyText(hit);
    if (!text) return null;
    const c = await classify(hit, type, text);
    if (c && c.ticker && c.ticker !== hit.ticker && !(await validTicker(c.ticker))) c.ticker = hit.ticker; // reject LLM-invented symbols
    if (!c || !c.ticker) return null;
    return { id: hit.accession, date: (hit.date || enddt) + "T12:00:00Z", type, ticker: c.ticker, company: hit.issuer, headline: c.headline, url: hit.ciks[0] ? `https://www.sec.gov/Archives/edgar/data/${Number(hit.ciks[0])}/${hit.accession.replace(/-/g, "")}/${hit.doc}` : "", sincePct: null };
  });

  const merged = [...built.filter((x): x is CorpEvent => !!x), ...prior.events]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, KEEP);

  // refresh since-perf (dedupe tickers)
  const syms = [...new Set(merged.map((e) => e.ticker).filter((t): t is string => !!t))];
  const perf: Record<string, number | null> = {};
  await mapPool(syms, 6, async (s) => { perf[s] = await sinceFor(s, merged.find((e) => e.ticker === s)!.date); });
  for (const e of merged) e.sincePct = e.ticker ? (perf[e.ticker] ?? null) : null;

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: uniq.length, events: merged } satisfies CorpEventsData));
  const by: Record<string, number> = {}; for (const e of merged) by[e.type] = (by[e.type] || 0) + 1;
  console.log(`\nwrote ${merged.length} events (${built.filter(Boolean).length} new). by type: ${JSON.stringify(by)}`);
  for (const e of merged.slice(0, 10)) console.log(`  ${e.date.slice(0, 10)} [${e.type.padEnd(13)}] ${(e.ticker || "—").padEnd(6)} ${e.headline.slice(0, 60)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
