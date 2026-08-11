/**
 * Nightly build of data/merger-arb.json — live cash-merger spreads from EDGAR DEFM14A filings.
 *
 * DEFM14A = the definitive merger proxy a target files once a deal is signed and headed to a vote:
 * an unambiguous "there is a live deal." Per filing: fetch the proxy text, extract the terms with
 * FLASH, VERIFY the cash price appears verbatim (code, not trust), drop SPACs, join a live quote,
 * compute spread + annualized return. Reject-aware cache so a parsed/rejected filing isn't re-judged.
 *
 * Run: npm run refresh-merger-arb. FULL tier; episodic feed (age-only freshness).
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, llmConfigured } from "../lib/llm";
import { deadline, withDeadline } from "../lib/deadline";
import { daysUntil } from "../lib/calendar";
import { isSpac, priceInText, spreadMath, dedupeTargets, DEFAULT_CLOSE_DAYS, type MergerArbRow, type MergerArbFile, type DealTarget } from "../lib/mergerArb";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "merger-arb.json");
const CACHE = path.join(DATA, ".tmp", "merger-arb-seen.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
// A TYPICAL deal runs proxy→close in 3-5 months, but mega-deals run 9-12 (KVUE filed its DEFM14A
// 2025-12-16 for an H2-2026 close and a 150d window aged it out — dropping both its board row while
// live AND the acquisition flag that suppresses earnings plays on it). Closed deals self-resolve
// (the ticker delists / rows drop past expectedClose); the residual cost of the wide window is a
// BROKEN deal wrongly withholding plays until it ages out — a conservative miss, accepted.
const WINDOW_DAYS = 365;
const DAY = 86_400_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function tickerFrom(dn: string): string | null {
  for (const m of dn.matchAll(/\(([^)]+)\)/g)) {
    const inner = m[1].trim();
    if (/^CIK/i.test(inner)) continue;
    const t = inner.split(",")[0].trim(); // primary listing when multiple
    if (/^[A-Z][A-Z0-9.\-]{0,5}$/.test(t)) return t.replace(/\./g, "-");
  }
  return null;
}

async function bodyText(cik: string, adsh: string): Promise<string> {
  const acc = adsh.replace(/-/g, "");
  const idx: any = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/index.json`, { headers: { "User-Agent": UA }, signal: deadline(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const items: any[] = idx?.directory?.item ?? [];
  const doc = items.filter((i) => /\.htm/i.test(i.name) && !/index/i.test(i.name)).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  if (!doc) return "";
  const raw = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${doc.name}`, { headers: { "User-Agent": UA }, signal: deadline(35_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/[ \t]+/g, " ").trim();
}

const SYSTEM =
  "You read one SEC DEFM14A (definitive merger proxy) for a company being acquired. Extract the deal terms as stated. " +
  "acquirer: the buyer's name. consideration: 'cash' if shareholders receive a fixed dollar amount per share; 'stock' if they receive acquirer shares; 'mixed' if both. " +
  "cashPerShare: the fixed cash dollars per share of THIS company (the cash amount, or the cash portion of a mixed deal); null for a pure stock deal. " +
  "expectedClose: the expected closing date or period as YYYY-MM-DD (use the last day of a stated quarter/half), or null if not stated. " +
  "note: ONE short phrase on the most material condition or status (a competing bid, a regulatory review, a go-shop, a shareholder vote date), or null.";
const SCHEMA = 'Return ONLY JSON: {"acquirer":string,"consideration":"cash"|"stock"|"mixed","cashPerShare":number|null,"expectedClose":string|null,"note":string|null}';

async function eftsDEFM14A(): Promise<any[]> {
  const start = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  // EFTS caps a page at 100 hits — a 365d window carries ~200+ DEFM14A, so page with `from` until a
  // short page (cap paranoia at 10 pages; EFTS refuses from>10k anyway).
  const all: any[] = [];
  for (let from = 0; from < 1000; from += 100) {
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?forms=DEFM14A&startdt=${start}&enddt=${end}&size=100&from=${from}`, { headers: { "User-Agent": UA }, signal: deadline(20_000) });
    if (!res.ok) { if (from === 0) throw new Error(`EFTS HTTP ${res.status}`); break; } // page-1 failure is fatal; later pages degrade to partial
    const page = (await res.json())?.hits?.hits ?? [];
    all.push(...page);
    if (page.length < 100) break;
    await sleep(250);
  }
  return all;
}

async function quote(sym: string): Promise<{ price: number | null; shares: number | null }> {
  try {
    const q: any = await withDeadline(yf.quote(sym, {}, { validateResult: false }), 12_000, `quote ${sym}`);
    const price = typeof q?.regularMarketPrice === "number" && q.regularMarketPrice > 0 ? q.regularMarketPrice : null;
    // sharesOutstanding rides the SAME quote object (lib/liveStock reads marketCap off it) — free.
    const shares = typeof q?.sharesOutstanding === "number" && q.sharesOutstanding > 0 ? q.sharesOutstanding : null;
    return { price, shares };
  } catch { return { price: null, shares: null }; }
}

async function main() {
  if (!(await llmConfigured())) { console.warn("refresh-merger-arb: no LLM key — skipping."); return; }
  let seen: Record<string, string> = {};
  try { seen = JSON.parse(await fsp.readFile(CACHE, "utf8")); } catch { /* first run */ }
  let prior: MergerArbFile | null = null;
  try { prior = JSON.parse(await fsp.readFile(FILE, "utf8")); } catch { /* first run */ }
  const priorByUrl = new Map((prior?.rows ?? []).map((r) => [r.url, r]));

  const hits = await eftsDEFM14A();
  console.log(`refresh-merger-arb: ${hits.length} DEFM14A in ${WINDOW_DAYS}d`);
  const rows: MergerArbRow[] = [];
  const targets: DealTarget[] = [];
  let spacs = 0;
  for (const h of hits) {
    const src = h._source ?? {};
    const adsh: string = src.adsh ?? h._id?.split(":")[0] ?? "";
    const cik: string = (src.ciks ?? [])[0] ?? "";
    const dn: string = (src.display_names ?? []).join(" | ");
    if (!adsh || !cik) continue;
    const name = dn.replace(/\s*\([^)]*\)/g, "").split("|")[0].trim();
    if (isSpac(name)) { spacs++; continue; }
    const ticker = tickerFrom(dn);
    if (!ticker) continue;
    // Every non-SPAC DEFM14A filer is a deal TARGET under a signed agreement — recorded regardless
    // of consideration (and of the reject cache), because the earnings desk must know a name is
    // pinned to a deal even when the cash board can't spread it (mixed/stock — the KVUE case).
    targets.push({ ticker, name, filedAt: (src.file_date || "").slice(0, 10) });
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, "")}/${adsh}-index.htm`;

    const cached = seen[adsh];
    let row: MergerArbRow | null = null;
    if (cached === "row" && priorByUrl.has(url)) {
      row = priorByUrl.get(url)!; // already extracted — reuse terms, refresh the quote below
    } else if (cached && cached !== "row") {
      continue; // remembered reject (non-cash, unreadable, unverifiable)
    } else {
      await sleep(300);
      const text = await bodyText(cik, adsh);
      if (text.length < 1000) { seen[adsh] = "unreadable"; continue; }
      const out = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\n=== DEFM14A: ${name} (${ticker}) ===\n${text.slice(0, 30_000)}`, { maxTokens: 500 }).catch(() => null);
      const cash = typeof out?.cashPerShare === "number" ? out.cashPerShare : null;
      // CASH DEALS ONLY. A mixed/stock deal's per-share value floats with the acquirer's stock, so a
      // clean cash spread is a LIE for it (the first run ranked mixed deals at the top with 30-40%
      // "spreads" that are really unhedged acquirer-stock exposure — MDV, RMAX, CLBK). Arbing those
      // needs a short-the-acquirer hedge this board doesn't model, so they're dropped, not mispriced.
      const priceOk = out?.consideration === "cash" && cash != null && priceInText(text, cash);
      if (!priceOk) { seen[adsh] = out?.consideration === "cash" ? "unverified-price" : "not-cash"; continue; }
      row = {
        ticker, name, acquirer: String(out.acquirer || "").slice(0, 60) || "—",
        consideration: out.consideration === "stock" || out.consideration === "mixed" ? out.consideration : "cash",
        cashPerShare: cash, verified: true,
        expectedClose: typeof out.expectedClose === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.expectedClose) ? out.expectedClose : null,
        filedAt: src.file_date || "", spot: null, spreadPct: null, annualizedPct: null,
        note: typeof out.note === "string" ? out.note.slice(0, 120) : null, url,
      };
      seen[adsh] = "row";
    }
    rows.push(row);
  }

  // Fresh quote + spread for every kept deal (cheap: a few dozen names).
  for (const r of rows) {
    const q = await quote(r.ticker);
    r.spot = q.price;
    // Deal equity value = cash price × shares outstanding (both in the one quote object). The size
    // key for the small-cap lens — the sub-$500M deals big arb desks skip, where the spread is widest.
    // null when Yahoo omits shares → the UI treats null as "unknown size", never "excluded".
    r.dealValue = r.cashPerShare != null && q.shares != null ? Math.round(r.cashPerShare * q.shares) : null;
    const dtc = r.expectedClose ? Math.max(1, daysUntil(r.expectedClose) ?? DEFAULT_CLOSE_DAYS) : DEFAULT_CLOSE_DAYS;
    const m = spreadMath(r.cashPerShare, r.spot, dtc);
    r.spreadPct = m.spreadPct;
    r.annualizedPct = m.annualizedPct;
    await sleep(150);
  }
  // Widest annualized spread first (the arb ranking); deals past their close date drop off.
  // Liveness is TWO gates, both learned from the 365d widening surfacing closed deals:
  // 1. A stated close keeps a deal until 5d past it. WITHOUT one, age out ~200d after the proxy —
  //    proxy→close runs 1-5 months, and a target that closed DELISTS, after which Yahoo serves a
  //    stale residual print that fabricates a monster "spread" (RNA showed +483% five months after
  //    its vote; TASK +126% a year after closing).
  // 2. A cash spread >35% is never an arb — it's a dead ticker's stale print or a broken deal, and
  //    ranking by annualized return would crown exactly those rows. Dropped, not shown greyed:
  //    a number we can't trust doesn't belong on the board at all.
  const preLive = rows.filter((r) => {
    if (r.expectedClose) return (daysUntil(r.expectedClose) ?? 0) >= -5;
    const ageD = (Date.now() - Date.parse(r.filedAt)) / DAY;
    return Number.isFinite(ageD) ? ageD <= 200 : true;
  });
  const sane = preLive.filter((r) => r.spreadPct == null || r.spreadPct <= 35);
  // One row per target — amendments supersede (WBD carried both its $27.75 and bumped $31 proxies
  // as separate "deals"; only the newest proxy's terms are tenderable).
  const newest = new Map<string, MergerArbRow>();
  for (const r of sane) { const prev = newest.get(r.ticker); if (!prev || r.filedAt > prev.filedAt) newest.set(r.ticker, r); }
  const live = [...newest.values()];
  const aged = rows.length - preLive.length, insane = preLive.length - sane.length, superseded = sane.length - live.length;
  if (aged || insane || superseded) console.log(`merger-arb: dropped ${aged} presumed-closed (no stated close, proxy >200d old) + ${insane} untrustworthy spreads (>35% "cash spread" = stale/broken) + ${superseded} superseded amendments`);
  live.sort((a, b) => (b.annualizedPct ?? -1e9) - (a.annualizedPct ?? -1e9));

  const allTargets = dedupeTargets(targets);
  const out: MergerArbFile = { generatedAt: new Date().toISOString(), rows: live, scanned: hits.length, spacs, targets: allTargets };
  await fsp.mkdir(path.join(DATA, ".tmp"), { recursive: true });
  await fsp.writeFile(CACHE, JSON.stringify(seen));
  await fsp.writeFile(FILE, JSON.stringify(out));
  console.log(`merger-arb: ${live.length} live cash deals (${spacs} SPACs dropped of ${hits.length} DEFM14A); ${allTargets.length} deal targets recorded (any consideration).`);
}

main().catch((e) => { console.error("refresh-merger-arb:", String(e?.message || e)); process.exit(1); });
