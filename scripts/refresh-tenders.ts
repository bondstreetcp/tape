/**
 * Nightly build of data/tenders.json — the odd-lot tender monitor (/tenders).
 *
 * Pipeline: EFTS scan of SC TO-I + SC TO-T over a trailing window → keep only filings with a LISTED
 * ticker (the overwhelming majority of SC TO-I volume is unlisted interval-fund/BDC quarterly
 * repurchases — counted, then skipped) → per new filing, fetch the body text, detect odd-lot
 * priority in CODE, extract terms with FLASH, then VERIFY every number against the text — an
 * unverifiable price is dropped, never shown → join a live quote → premium + per-odd-lot value.
 *
 * Skip-cache remembers REJECTS too (the KEDM doctrine): an unlisted/unparseable accession must not
 * be re-fetched and re-judged every night.
 *
 * Run: npm run refresh-tenders. FULL tier; sparse feed (age-only freshness, no floor).
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, llmConfigured } from "../lib/llm";
import { deadline, withDeadline } from "../lib/deadline";
import { dedupeOffers, detectOddLotPriority, oddLotMath, priceInText, tickersFromDisplayName, type TenderRow, type TendersFile } from "../lib/tenders";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "tenders.json");
const CACHE = path.join(DATA, ".tmp", "tenders-seen.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const WINDOW_DAYS = 45; // tenders run 20 business days; 45d keeps live ones visible through expiry
const DAY = 86_400_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function efts(form: string, startdt: string, enddt: string): Promise<any[]> {
  const u = `https://efts.sec.gov/LATEST/search-index?forms=${encodeURIComponent(form)}&startdt=${startdt}&enddt=${enddt}`;
  const res = await fetch(u, { headers: { "User-Agent": UA }, signal: deadline(20_000) });
  if (!res.ok) throw new Error(`EFTS ${form} HTTP ${res.status}`);
  const j: any = await res.json();
  return j?.hits?.hits ?? [];
}

/** Filing body text via the EDGAR archive index (adsh → primary doc). */
async function bodyText(cik: string, adsh: string): Promise<string> {
  const acc = adsh.replace(/-/g, "");
  const idxUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/index.json`;
  const idx: any = await fetch(idxUrl, { headers: { "User-Agent": UA }, signal: deadline(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const items: any[] = idx?.directory?.item ?? [];
  const doc = items.find((i) => /\.htm/i.test(i.name) && !/index/i.test(i.name)) ?? items.find((i) => /\.txt$/i.test(i.name));
  if (!doc) return "";
  const raw = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${doc.name}`, { headers: { "User-Agent": UA }, signal: deadline(30_000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/[ \t]+/g, " ").trim();
}

const EXTRACT_SYSTEM =
  "You read one SEC tender-offer document (SC TO-I = the issuer buying back its own shares; SC TO-T = a third party). Extract ONLY terms stated in the text. " +
  "offerType: 'fixed' when one purchase price is stated; 'dutch' when a price RANGE is stated (modified Dutch auction). priceUsd: the fixed price, or the LOW end of the range. priceHighUsd: the HIGH end of the range (null for fixed). " +
  "expiresAt: the expiration date of the offer as YYYY-MM-DD (offers state a date and time; take the date), null if not stated. " +
  "conditions: ONE short sentence naming the most material condition (a minimum tender condition, financing, a merger closing), or null if none beyond customary. " +
  "For an offer to purchase a security OTHER than listed common stock (notes, preferred units, warrants), or a per-unit price that is a percentage of NAV rather than dollars, set priceUsd null.";
const EXTRACT_SCHEMA =
  'Return ONLY JSON: {"offerType":"fixed"|"dutch"|"unknown","priceUsd":number|null,"priceHighUsd":number|null,"expiresAt":string|null,"conditions":string|null}';

async function quote(sym: string): Promise<number | null> {
  try {
    const q: any = await withDeadline(yf.quote(sym, {}, { validateResult: false }), 12_000, `quote ${sym}`);
    const p = q?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!(await llmConfigured())) { console.warn("refresh-tenders: no LLM key — skipping."); return; }
  const now = Date.now();
  const startdt = new Date(now - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const enddt = new Date(now).toISOString().slice(0, 10);

  // seen-cache: accession → "row" (kept), "unlisted"/"nolisted-price"/"unreadable" (rejects, never refetched)
  let seen: Record<string, string> = {};
  try { seen = JSON.parse(await fsp.readFile(CACHE, "utf8")); } catch { /* first run */ }
  let prior: TendersFile | null = null;
  try { prior = JSON.parse(await fsp.readFile(FILE, "utf8")); } catch { /* first run */ }
  const priorRows = new Map<string, TenderRow>();
  for (const r of prior?.rows ?? []) priorRows.set(r.url, r);

  const hits = [...(await efts("SC TO-I", startdt, enddt)), ...(await efts("SC TO-T", startdt, enddt))];
  console.log(`refresh-tenders: ${hits.length} EFTS hits in ${WINDOW_DAYS}d`);

  const rows: TenderRow[] = [];
  let unlisted = 0;
  for (const h of hits) {
    const src = h._source ?? {};
    const adsh: string = src.adsh ?? h._id?.split(":")[0] ?? "";
    const cik: string = (src.ciks ?? [])[0] ?? "";
    const dn: string = (src.display_names ?? []).join(" | ");
    const filedAt: string = src.file_date ?? "";
    const form: string = (src.file_type ?? src.forms ?? "").includes("TO-T") ? "SC TO-T" : "SC TO-I";
    if (!adsh || !cik) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, "")}/${adsh}-index.htm`;

    const cached = seen[adsh];
    if (cached && cached !== "row") { unlisted++; continue; } // remembered reject
    if (cached === "row" && priorRows.has(url)) {
      // Already extracted on a prior night: keep the row, refresh only the quote-derived columns below.
      rows.push(priorRows.get(url)!);
      continue;
    }

    const tickers = tickersFromDisplayName(dn);
    if (!tickers.length) { seen[adsh] = "unlisted"; unlisted++; continue; }
    const ticker = tickers[0];
    const name = dn.replace(/\s*\([^)]*\)/g, "").split("|")[0].trim();

    await sleep(300); // SEC pacing
    const text = await bodyText(cik, adsh);
    if (text.length < 800) { seen[adsh] = "unreadable"; continue; }
    const oddLot = detectOddLotPriority(text);
    const out = await chatJSON<any>(EXTRACT_SYSTEM, `${EXTRACT_SCHEMA}\n\n=== ${form} for ${name} (${ticker}) ===\n${text.slice(0, 28_000)}`, { maxTokens: 700 }).catch(() => null);
    // CODE VERIFIES: a price the text doesn't contain is not a price.
    const priceOk = out?.priceUsd != null && priceInText(text, out.priceUsd);
    const highOk = out?.priceHighUsd != null && priceInText(text, out.priceHighUsd);
    const row: TenderRow = {
      ticker, name, form, filedAt,
      offerType: out?.offerType === "fixed" || out?.offerType === "dutch" ? out.offerType : "unknown",
      priceUsd: priceOk ? out.priceUsd : null,
      priceHighUsd: highOk ? out.priceHighUsd : null,
      expiresAt: typeof out?.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.expiresAt) ? out.expiresAt : null,
      oddLotPriority: oddLot,
      verified: priceOk,
      spot: null, premiumPct: null, oddLotValueUsd: null,
      conditions: typeof out?.conditions === "string" ? out.conditions.slice(0, 160) : null,
      url,
    };
    if (row.priceUsd == null && !row.oddLotPriority) { seen[adsh] = "no-listed-price"; continue; } // notes/NAV repurchases etc.
    seen[adsh] = "row";
    rows.push(row);
    console.log(`  + ${ticker.padEnd(7)} ${form} ${row.offerType} ${row.priceUsd ?? "?"}${row.priceHighUsd ? "-" + row.priceHighUsd : ""} exp ${row.expiresAt ?? "?"} oddLot=${row.oddLotPriority}`);
  }

  // One row per OFFER (amendments + dual-filer copies collapse); DROP offers expired >2 days (they
  // linger in the 45d scan window long after the money is gone), then live quotes + math.
  const { daysUntil } = await import("../lib/calendar");
  const deduped = dedupeOffers(rows).filter((r) => {
    if (!r.expiresAt) return true; // no stated expiry → keep, the row says so
    const d = daysUntil(r.expiresAt);
    return d == null || d >= -2;
  });
  for (const r of deduped) {
    r.spot = await quote(r.ticker);
    const m = oddLotMath(r.priceUsd, r.spot);
    r.premiumPct = m.premiumPct;
    r.oddLotValueUsd = m.oddLotValueUsd;
    await sleep(150);
  }
  deduped.sort((a, b) => (b.oddLotValueUsd ?? -1) - (a.oddLotValueUsd ?? -1) || b.filedAt.localeCompare(a.filedAt));

  const outFile: TendersFile = { generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS, rows: deduped, scanned: hits.length, unlisted };
  await fsp.mkdir(path.join(DATA, ".tmp"), { recursive: true });
  await fsp.writeFile(CACHE, JSON.stringify(seen));
  await fsp.writeFile(FILE, JSON.stringify(outFile));
  console.log(`tenders: ${deduped.length} offer(s) after dedup (${rows.length} filings kept, ${unlisted} unlisted/rejected of ${hits.length} scanned), ${deduped.filter((r) => r.oddLotPriority).length} with odd-lot priority.`);
}

main().catch((e) => { console.error("refresh-tenders:", String(e?.message || e)); process.exit(1); });
