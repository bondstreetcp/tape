/**
 * Builds data/ipo-monitor.json — the IPO desk:
 *   • UPCOMING IPOs — companies that filed an S-1/F-1 to go public (the pipeline).
 *   • RECENT IPOs — priced in the last ~16 days (424B4 final prospectus).
 *   • LOCKUP expiries — IPOs from ~180 days ago whose insider lockup is about to lift (supply catalyst).
 * Each carries an AI summary of the S-1/prospectus (what the company does, financials, use of proceeds,
 * risks) for the per-company detail page. GLM confirms genuine first-time IPOs (drops resales/shelves/
 * SPACs). Free EDGAR. Run: npm run refresh-ipo. Nightly. Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import { cleanTicker } from "../lib/llmValidate";
import { eftsSearch, fetchFilingBodyText, type EftsHit } from "../lib/edgarSearch";
import type { IpoData, IpoEvent, IpoKind, IpoSummary } from "../lib/ipoMonitor";
import { deriveIpoMetrics, type IpoFinancials, type IpoFiscalYear } from "../lib/ipoFinancials";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "ipo-monitor.json");
const DAY = 86_400_000;
const LOCKUP_DAYS = 180;
const iso = (d: number) => new Date(d).toISOString().slice(0, 10);
const num = (x: any, max = Infinity) => (typeof x === "number" && isFinite(x) && x > 0 && x <= max ? x : null);
// Bounds: an IPO priced above $1,000/share or $100B raised means the model confused units (size
// in dollars not millions, or total-raise as the share price) — store null over a wrong number.

// A priced IPO (424B4).
async function classifyIpo(hit: EftsHit, text: string) {
  const SYSTEM =
    "You read one SEC 424B4 prospectus and determine if it is an INITIAL public offering (a company listing common stock for the FIRST time) — NOT a follow-on, secondary, shelf takedown, ETF, SPAC unit, or debt offering. If it IS an IPO, return the ticker, company name, IPO price per share, total deal size in US$ MILLIONS, and exchange (NYSE/Nasdaq). Else isIpo=false. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"isIpo":boolean,"ticker":string,"company":string,"priceUsd":number|null,"sizeUsdM":number|null,"exchange":string}';
  // GLM-5.2 is a reasoning model — a tight max_tokens gets fully consumed by reasoning, yielding EMPTY
  // content (the filing then silently drops). Cap reasoning low + leave ample token room. (See the
  // same "reasoning eats max_tokens" gotcha in refresh-sss.)
  const user = `Filed ${hit.date}. ${hit.issuer}${hit.ticker ? ` (${hit.ticker})` : ""}.\n\n${text.slice(0, 6000)}\n\n${SCHEMA}`;
  let out = await chatJSON<any>(SYSTEM, user, { maxTokens: 1200, reasoningEffort: "low" });
  // SECOND OPINION on rejects: a 424B4 is a PRICED prospectus, so a "not an IPO" verdict is usually
  // a false negative (model-quality eval: the cheap tier rejected real IPOs). Before dropping the
  // filing, re-ask the PRO model — a reject must be confirmed twice to stand. ~$0.002/reject.
  if (!out || out.isIpo === false) {
    const second = await chatJSON<any>(SYSTEM, user, { maxTokens: 1200, reasoningEffort: "low", model: PRO_MODEL }).catch(() => null);
    if (second && second.isIpo !== false) { console.log(`  ${hit.ticker || hit.issuer.slice(0, 20)}: reject overturned by second opinion`); out = second; }
    else return null;
  }
  const ticker = cleanTicker(out.ticker || hit.ticker);
  if (!ticker) return null;
  return { ticker, company: String(out.company || hit.issuer).slice(0, 70), priceUsd: num(out.priceUsd, 1000), sizeUsdM: num(out.sizeUsdM, 100000), exchange: String(out.exchange || "").slice(0, 12) };
}

// An S-1/F-1 registration for a company still trying to go public (the pipeline).
async function classifyUpcoming(hit: EftsHit, text: string) {
  const SYSTEM =
    "You read one SEC S-1/F-1 registration statement and determine if it is a GENUINE upcoming INITIAL public offering — a company registering to list its common stock publicly for the FIRST time. Return isIpo=false (dropped) if it is: a resale/secondary registration by an already-public company, a shelf, a SPAC/blank-check, a debt/warrant/unit-only registration, or an amendment with no offering. If it IS a real IPO registration, return the proposed ticker ('' if not yet assigned), company name, expected deal size in US$ MILLIONS (or null), proposed price-range midpoint per share (or null), and the intended exchange. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"isIpo":boolean,"ticker":string,"company":string,"priceUsd":number|null,"sizeUsdM":number|null,"exchange":string}';
  const user = `Filed ${hit.date}. ${hit.issuer}${hit.ticker ? ` (${hit.ticker})` : ""}.\n\n${text.slice(0, 6500)}\n\n${SCHEMA}`;
  let out = await chatJSON<any>(SYSTEM, user, { maxTokens: 1200, reasoningEffort: "low" });
  // Second opinion on rejects — but ONLY for TICKERED registrations (a reserved exchange ticker is
  // the strongest tell of a real deal; the tickerless S-1 pile is mostly shells and not worth 2×).
  if ((!out || out.isIpo === false) && hit.ticker) {
    const second = await chatJSON<any>(SYSTEM, user, { maxTokens: 1200, reasoningEffort: "low", model: PRO_MODEL }).catch(() => null);
    if (second && second.isIpo !== false) { console.log(`  ${hit.ticker}: upcoming reject overturned by second opinion`); out = second; }
    else return null;
  }
  if (!out || out.isIpo === false) return null;
  const ticker = cleanTicker(out.ticker || hit.ticker);
  return { ticker, company: String(out.company || hit.issuer).slice(0, 70), priceUsd: num(out.priceUsd, 1000), sizeUsdM: num(out.sizeUsdM, 100000), exchange: String(out.exchange || "").slice(0, 12) };
}

// The investor recap of the prospectus (for the per-company detail page).
async function summarizeFiling(hit: EftsHit, text: string): Promise<IpoSummary | null> {
  const SYSTEM =
    "You read an IPO prospectus (S-1 or 424B4) and write a crisp investor summary. Return: 'business' (2-3 sentences: what the company does and how it makes money); 'sector'; 'financials' (revenue, growth rate, and whether it's profitable — with the actual figures if stated in the summary); 'useOfProceeds' (what they'll do with the money raised); 'risks' (2-4 of the most material risk factors, each a terse phrase); 'underwriters' (the lead / book-running-manager investment banks running the deal — usually named on the cover page and in the 'Underwriting' section, e.g. 'Goldman Sachs', 'Morgan Stanley', 'J.P. Morgan'; return the bank names only, 1-6 of them, [] if none are stated). Use only what the prospectus supports; don't invent numbers. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"business":string,"sector":string,"financials":string,"useOfProceeds":string,"risks":string[],"underwriters":string[]}';
  // Ample token room + low reasoning so GLM-5.2 doesn't burn the whole budget reasoning and return
  // empty content (which drops the summary — leaving a row with no business recap / underwriters).
  const out = await chatJSON<any>(SYSTEM, `${hit.issuer}. Prospectus excerpt:\n\n${text.slice(0, 15000)}\n\n${SCHEMA}`, { maxTokens: 2200, reasoningEffort: "low" });
  if (!out || !out.business) return null;
  const cleanList = (v: any, max: number, len: number): string[] =>
    Array.isArray(v) ? v.filter((r: any) => typeof r === "string" && r.trim()).map((r: string) => r.trim().slice(0, len)).slice(0, max) : [];
  return {
    business: String(out.business).slice(0, 600),
    sector: String(out.sector || "").slice(0, 60),
    financials: String(out.financials || "").slice(0, 400),
    useOfProceeds: String(out.useOfProceeds || "").slice(0, 400),
    risks: cleanList(out.risks, 4, 160),
    underwriters: cleanList(out.underwriters, 6, 40),
  };
}

// Reconstruct a minimal EftsHit from a stored prospectus URL so we can re-fetch + summarize old rows.
function hitFromUrl(url: string, id: string, company: string): EftsHit | null {
  const m = url.match(/\/data\/(\d+)\/(\d+)\/(.+)$/);
  if (!m) return null;
  return { accession: id, doc: m[3], form: "", date: "", issuer: company, ticker: null, others: "", ciks: [m[1]] };
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
// De-duplicate the pipeline tab. Two cases, both keyed by ticker:
//   (a) GRADUATED: an issuer that has since PRICED (a 424B4 "ipo" row exists) is no longer upcoming —
//       drop its stale S-1 row so it shows only under Recent IPOs, not both tabs.
//   (b) AMENDMENTS: multiple S-1/F-1 amendments of the same issuer (distinct accessions, so they slip
//       past the accession-dedup) collapse to one row — keep the best: a summarized row over an
//       un-summarized one, else the newest filing.
// Order-preserving. Tickerless drafts and priced (recent/lockup) rows pass through untouched.
function dedupeUpcoming(events: IpoEvent[]): IpoEvent[] {
  const priced = new Set(events.filter((e) => e.kind === "ipo" && e.ticker).map((e) => e.ticker));
  const at = new Map<string, number>(); // ticker → index in out
  const out: IpoEvent[] = [];
  for (const e of events) {
    if (e.kind === "upcoming" && e.ticker) {
      if (priced.has(e.ticker)) continue; // (a) graduated to a priced IPO
      if (at.has(e.ticker)) {
        const i = at.get(e.ticker)!;
        const better = (e.summary ? 1 : 0) - (out[i].summary ? 1 : 0) || e.ipoDate.localeCompare(out[i].ipoDate);
        if (better > 0) out[i] = e; // (b) keep the best amendment
        continue;
      }
      at.set(e.ticker, out.length);
    }
    out.push(e);
  }
  return out;
}
async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let idx = 0, errs = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { errs++; out[i] = null as any; } } }));
  if (errs) console.warn(`  mapPool: ${errs}/${items.length} tasks threw (dropped as null)`); // A9: swallowed errors must be visible
  return out;
}

async function main() {
  const nowISO = new Date().toISOString();
  if (!(await llmConfigured())) { console.log("LLM not configured — skipping."); return; }

  const [recent, lockWin, s1, f1] = await Promise.all([
    // 35d recent window (was 16d) so a name that priced up to ~5 weeks ago is still caught even if a
    // nightly run was missed — e.g. a 424B4 filed 19 days ago was aging out of a 16-day window.
    eftsSearch({ forms: "424B4", startdt: iso(Date.now() - 35 * DAY), enddt: iso(Date.now()) }),
    eftsSearch({ forms: "424B4", startdt: iso(Date.now() - (LOCKUP_DAYS + 35) * DAY), enddt: iso(Date.now() - (LOCKUP_DAYS - 30) * DAY) }),
    eftsSearch({ forms: "S-1", startdt: iso(Date.now() - 30 * DAY), enddt: iso(Date.now()) }),
    eftsSearch({ forms: "F-1", startdt: iso(Date.now() - 30 * DAY), enddt: iso(Date.now()) }),
  ]);
  // Merge S-1 (domestic) + F-1 (foreign) and order TICKERED filings first, then newest-first. A real
  // IPO nearing pricing reserves an exchange ticker; the tickerless remainder is almost all micro-cap
  // shell S-1s. Ordering this way (+ a high upcoming cap below) stops a flood of fresh shell filings
  // from starving a real IPO that filed a week earlier — e.g. Bending Spoons' F-1 (rank 123 by pure
  // date) and Neutron/Lime's S-1 (rank 103) were being dropped entirely.
  const upcomingHits = [...s1, ...f1].sort(
    (a, b) => (a.ticker ? 0 : 1) - (b.ticker ? 0 : 1) || (b.date || "").localeCompare(a.date || ""),
  );
  const tagged = [
    ...recent.map((h) => ({ hit: h, kind: "ipo" as IpoKind })),
    ...lockWin.map((h) => ({ hit: h, kind: "lockup" as IpoKind })),
    ...upcomingHits.map((h) => ({ hit: h, kind: "upcoming" as IpoKind })),
  ];
  const seen = new Set<string>();
  const uniq = tagged.filter((t) => (seen.has(t.hit.accession) ? false : (seen.add(t.hit.accession), true)));
  console.log(`fetched ${recent.length} recent + ${lockWin.length} lockup-window 424B4 + ${s1.length + f1.length} S-1/F-1 → ${uniq.length} unique`);

  const prior: IpoData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, events: [] as IpoEvent[] }));
  const known = new Set(prior.events.map((e) => e.id));
  // Per-kind screen budget. Each kind has its OWN counter, so no kind can starve another. Upcoming
  // runs high (130) because the tickered-first pool holds ~all real registrations (≈128 in a busy
  // 30-day window); a real IPO that filed a week ago must be reachable before it ages out. A junk
  // shell S-1 is cheap to reject (one short classify call — the expensive summary only runs once an
  // IPO is confirmed). recent (424B4) / lockup stay at 60.
  const LIMIT: Record<IpoKind, number> = { upcoming: 130, ipo: 60, lockup: 60 };
  const cap: Record<string, number> = {};
  const fresh = uniq.filter((t) => !known.has(t.hit.accession)).filter((t) => { const n = cap[t.kind] || 0; if (n >= LIMIT[t.kind]) return false; cap[t.kind] = n + 1; return true; });
  console.log(`${fresh.length} new filings to screen ${JSON.stringify(cap)}`);

  const built = await mapPool(fresh, 4, async ({ hit, kind }): Promise<IpoEvent | null> => {
    const text = await fetchFilingBodyText(hit);
    if (!text) return null;
    const c = kind === "upcoming" ? await classifyUpcoming(hit, text) : await classifyIpo(hit, text);
    if (!c || (kind !== "upcoming" && !c.ticker)) return null;
    const summary = await summarizeFiling(hit, text).catch(() => null);
    const ipoT = Date.parse((hit.date || iso(Date.now())) + "T12:00:00Z");
    const lockupT = ipoT + LOCKUP_DAYS * DAY;
    const url = hit.ciks[0] ? `https://www.sec.gov/Archives/edgar/data/${Number(hit.ciks[0])}/${hit.accession.replace(/-/g, "")}/${hit.doc}` : "";
    return {
      id: hit.accession, kind, ticker: c.ticker || "", company: c.company,
      ipoDate: iso(ipoT), lockupDate: kind === "upcoming" ? null : iso(lockupT), daysToLockup: kind === "upcoming" ? null : Math.round((lockupT - Date.now()) / DAY),
      priceUsd: c.priceUsd, sizeUsdM: c.sizeUsdM, exchange: c.exchange, sinceIpoPct: null, url, summary,
    };
  });

  const merged = dedupeUpcoming(
    [...built.filter((x): x is IpoEvent => !!x), ...prior.events]
      .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
      .map((e) => ({ ...e, daysToLockup: e.lockupDate ? Math.round((Date.parse(e.lockupDate) - Date.now()) / DAY) : null }))
      .filter((e) =>
        e.kind === "ipo" ? Date.now() - Date.parse(e.ipoDate) < 60 * DAY
          : e.kind === "upcoming" ? Date.now() - Date.parse(e.ipoDate) < 75 * DAY
            : (e.daysToLockup != null && e.daysToLockup > -30 && e.daysToLockup < 60)),
  ).slice(0, 300);

  // perf for priced names (recent + lockup); upcoming aren't trading yet
  const syms = [...new Set(merged.filter((e) => e.kind !== "upcoming" && e.ticker).map((e) => e.ticker))];
  const priceBy: Record<string, number | null> = {};
  merged.forEach((e) => { if (e.priceUsd && e.ticker) priceBy[e.ticker] = e.priceUsd; });
  const perf: Record<string, number | null> = {};
  await mapPool(syms, 6, async (s) => { perf[s] = await ipoPerf(s, priceBy[s] ?? null); });
  for (const e of merged) e.sinceIpoPct = e.kind !== "upcoming" && e.ticker ? (perf[e.ticker] ?? null) : null;

  // Backfill prospectus summaries for kept rows that lack one — OR that were summarized before
  // underwriters were extracted (summary.underwriters === undefined). Self-healing, so gaps and the
  // new field fill over a night. (An empty [] means "checked, none disclosed" and won't re-trigger.)
  const needSummary = merged.filter((e) => (!e.summary || e.summary.underwriters === undefined) && e.url).slice(0, 60);
  if (needSummary.length) {
    console.log(`backfilling ${needSummary.length} prospectus summaries (missing summary or underwriters)…`);
    await mapPool(needSummary, 3, async (e) => {
      const hit = hitFromUrl(e.url, e.id, e.company);
      if (!hit) return;
      const text = await fetchFilingBodyText(hit);
      if (!text) return;
      const s = await summarizeFiling(hit, text).catch(() => null);
      if (s) e.summary = s;
    });
  }

  // Backfill structured S-1 financials + a grounded valuation read for recent IPOs. Self-healing:
  // undefined = never tried; null = tried, no usable XBRL yet (won't retry until it appears).
  const needFin = merged.filter((e) => e.kind === "ipo" && e.ticker && e.url && e.financials === undefined).slice(0, 30);
  if (needFin.length) {
    console.log(`extracting S-1 financials for ${needFin.length} recent IPOs…`);
    await mapPool(needFin, 3, async (e) => {
      const cikM = e.url.match(/edgar\/data\/(\d+)\//);
      e.financials = cikM ? await fetchIpoFinancials(cikM[1], e.ticker).catch(() => null) : null;
    });
  }

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: uniq.length, events: merged } satisfies IpoData));
  const by = (k: string) => merged.filter((e) => e.kind === k).length;
  console.log(`\nwrote ${merged.length} events (${by("upcoming")} upcoming, ${by("ipo")} recent IPOs, ${by("lockup")} lockups).`);
  for (const e of merged.slice(0, 12)) console.log(`  [${e.kind.padEnd(8)}] ${(e.ticker || "—").padEnd(6)} ${e.company.slice(0, 30).padEnd(30)} ${e.summary ? "✓summary" : ""}`);
}

// ── S-1 financials + valuation (recent IPOs) ────────────────────────────────────────────────────
const SEC_UA = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };
const daysApart = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

// Pull a newly-public company's annual financials from its SEC XBRL facts, join a market cap from
// Yahoo (companyfacts rarely tags total shares), compute valuation, and let the LLM narrate ONLY the
// computed numbers into a grounded value read. Every figure comes from the filing; nothing is invented.
async function fetchIpoFinancials(cik: string, ticker: string): Promise<IpoFinancials | null> {
  const facts = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, { headers: SEC_UA })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const gaap = (facts as any)?.facts?.["us-gaap"];
  if (!gaap) return null;
  const usd = (tag: string): any[] => gaap[tag]?.units?.USD || [];
  const flow = (tags: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const tag of tags) for (const x of usd(tag)) {
      if (x.fp !== "FY" || !x.start || !x.end) continue;
      if (Math.abs(daysApart(x.start, x.end) - 365) > 20) continue; // full fiscal year only
      out[x.end.slice(0, 4)] = x.val; // later filings restate → last write wins
    }
    return out;
  };
  const instant = (tags: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const tag of tags) for (const x of usd(tag)) { if (x.fp === "FY" && !x.start && x.end) out[x.end.slice(0, 4)] = x.val; }
    return out;
  };
  const revenue = flow(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax"]);
  const gp = flow(["GrossProfit"]);
  const cogs = flow(["CostOfRevenue", "CostOfGoodsAndServicesSold"]);
  const ni = flow(["NetIncomeLoss"]);
  const cashByYr = instant(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const debtLt = instant(["LongTermDebtNoncurrent"]);
  const debtCur = instant(["LongTermDebtCurrent"]);
  const yrs = [...new Set([...Object.keys(revenue), ...Object.keys(ni)])].sort();
  if (!yrs.length) return null;
  const years: IpoFiscalYear[] = yrs.slice(-3).map((y) => ({
    year: y,
    revenue: revenue[y] ?? null,
    grossProfit: gp[y] ?? (revenue[y] != null && cogs[y] != null ? revenue[y] - cogs[y] : null),
    netIncome: ni[y] ?? null,
  }));
  const ly = yrs[yrs.length - 1];
  const debt = (debtLt[ly] ?? 0) + (debtCur[ly] ?? 0);

  // Market cap = shares outstanding × current price (Yahoo — the app's usual quote source).
  let shares: number | null = null, price: number | null = null;
  try {
    const qs: any = await yf.quoteSummary(ticker, { modules: ["defaultKeyStatistics", "price"] } as any).catch(() => null);
    shares = qs?.defaultKeyStatistics?.sharesOutstanding ?? null;
    price = qs?.price?.regularMarketPrice ?? null;
  } catch { /* no quote yet */ }

  const m = deriveIpoMetrics({ years, cash: cashByYr[ly] ?? null, debt: debt || null, sharesOutstanding: shares, price });
  if (m.revenue == null && years.every((y) => y.revenue == null && y.netIncome == null)) return null;

  // Grounded value read — the model may reference ONLY these computed numbers.
  const facts_str = [
    m.revenue != null && `latest FY revenue $${(m.revenue / 1e6).toFixed(0)}M`,
    m.revenueGrowthPct != null && `revenue ${m.revenueGrowthPct >= 0 ? "+" : ""}${m.revenueGrowthPct}% YoY`,
    m.grossMarginPct != null && `gross margin ${m.grossMarginPct}%`,
    m.netMarginPct != null && `net margin ${m.netMarginPct}% (${m.profitable ? "profitable" : "loss-making"})`,
    m.priceToSales != null && `price/sales ${m.priceToSales}×`,
    m.cash != null && `cash $${(m.cash / 1e6).toFixed(0)}M`,
    m.debt ? `debt $${(m.debt / 1e6).toFixed(0)}M` : "little/no debt",
  ].filter(Boolean).join("; ");
  let valueTag: IpoFinancials["valueTag"] = "unclear", valueRead = "";
  if (await llmConfigured()) {
    const SYSTEM = "You are an IPO analyst. Given a newly-public company's COMPUTED financial metrics, write ONE plain-English sentence judging whether the deal looks cheaply, fairly, or richly valued for its growth + profitability profile, and pick a tag. Use ONLY the numbers provided — never invent a figure and never cite a named peer's multiple. If price/sales is missing, comment on growth/margins/profitability but tag 'unclear'. " + NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"tag":"cheap"|"fair"|"rich"|"unclear","read":string}';
    const out = await chatJSON<{ tag: string; read: string }>(SYSTEM, `${ticker}: ${facts_str}\n\n${SCHEMA}`, { maxTokens: 160 }).catch(() => null);
    if (out) {
      valueTag = (["cheap", "fair", "rich", "unclear"].includes(out.tag) ? out.tag : "unclear") as IpoFinancials["valueTag"];
      valueRead = String(out.read || "").slice(0, 240);
    }
  }
  return { ...m, valueTag, valueRead, asOf: iso(Date.now()) };
}

main().catch((e) => { console.error(e); process.exit(1); });
