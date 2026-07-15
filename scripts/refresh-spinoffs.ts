/**
 * Spinoff turnover tracker → data/spinoffs.json. For each completed spinoff in lib/spinoffs'
 * curated roster: cumulative daily volume since the first regular-way session (plus any
 * when-issued volume Yahoo carries) ÷ shares outstanding = the % of the register that has
 * turned over — the seller-exhaustion clock (≈50% has historically marked the bottom zone).
 * Free Yahoo. Run: npm run refresh-spinoffs. Nightly (FULL).
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { SPINOFF_ROSTER, type SpinoffRow, type SpinoffsData, type SpinPipelineRow } from "../lib/spinoffs";
import { eftsSearch, fetchFilingBodyText, edgarDocUrl, type EftsHit } from "../lib/edgarSearch";
import { chatJSON, FLASH_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const FILE = path.join(process.cwd(), "data", "spinoffs.json");
const SCREENED = path.join(process.cwd(), "data", "spinoff-screened.json");

interface Bar { t: number; close: number | null; vol: number | null }

async function bars(sym: string, fromISO: string): Promise<Bar[]> {
  try {
    const ch: any = await yf.chart(sym, { period1: new Date(Date.parse(fromISO) - 21 * DAY), interval: "1d" } as any, { validateResult: false });
    return (ch?.quotes || []).map((q: any) => ({ t: new Date(q.date).getTime(), close: q.close ?? null, vol: q.volume ?? null }));
  } catch {
    return [];
  }
}

async function sharesOutstanding(sym: string): Promise<number | null> {
  try {
    const q: any = await yf.quote(sym, {}, { validateResult: false });
    if (q?.sharesOutstanding > 0) return q.sharesOutstanding;
  } catch { /* fall through */ }
  try {
    const s: any = await yf.quoteSummary(sym, { modules: ["defaultKeyStatistics"] } as any, { validateResult: false });
    const v = s?.defaultKeyStatistics?.sharesOutstanding;
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

// When-issued volume: Yahoo sometimes lists the WI line (conventions vary: SYMV, SYM-WI). Sum any
// volume it traded BEFORE the regular-way start. Best-effort — 0 when no WI symbol resolves.
async function whenIssuedVol(seed: { ticker: string; wiTicker?: string; spinDate: string }): Promise<number> {
  const spinT = Date.parse(seed.spinDate);
  const candidates = seed.wiTicker ? [seed.wiTicker] : [`${seed.ticker}V`, `${seed.ticker}-WI`];
  for (const sym of candidates) {
    const b = await bars(sym, new Date(spinT - 30 * DAY).toISOString().slice(0, 10));
    const pre = b.filter((x) => x.t < spinT && (x.vol ?? 0) > 0);
    if (pre.length) return pre.reduce((s, x) => s + (x.vol ?? 0), 0);
  }
  return 0;
}

// ── Upcoming pipeline: EDGAR Form 10 (10-12B) discovery ──────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
/** A phrase is grounded when each of its ≥4-char words appears somewhere in the filing text. */
function phraseGrounded(phrase: string | null, textLower: string): boolean {
  if (!phrase) return false;
  const words = norm(phrase).split(" ").filter((w) => w.length >= 4);
  return words.length > 0 && words.every((w) => textLower.includes(w));
}

const PIPE_SYSTEM =
  "You read one SEC Form 10 (10-12B) registration statement and determine whether it registers a SPIN-OFF or CARVE-OUT — a subsidiary being separated from a PARENT company into an independent public company (shares typically distributed to the parent's shareholders). Extract: isSpinoff (false for a direct listing, a REIT/fund organizational registration, or any Form 10 that is NOT a parent-subsidiary separation); parent (the company doing the spin, exactly as named); parentTicker (its stock symbol if stated, else null); business (ONE short phrase for what the SpinCo does); expectedTiming (the stated expected completion, e.g. 'first half of 2026' — null if not stated); ratio (the distribution ratio if stated, e.g. '1 share of SpinCo for every 3 shares of Parent' — null if not). Copy ONLY what the filing states; never guess a ticker or a date. " +
  NO_ADVICE;
const PIPE_SCHEMA = 'Return ONLY JSON: {"isSpinoff":boolean,"parent":string|null,"parentTicker":string|null,"business":string|null,"expectedTiming":string|null,"ratio":string|null}';

/**
 * Has this SpinCo already DISTRIBUTED? Ask the tape, not the roster.
 *
 * SPINOFF_ROSTER is hand-curated, so it always lags reality by however long it takes a human to
 * notice — and until then the pipeline advertises a finished spin as "in registration". That is
 * exactly how MFP (Midera Food Processing) sat on the board as "Progressing · 49d" on 2026-07-15
 * while it had been trading on NasdaqGS since 2026-06-26 at $43. A live regular-way quote is the
 * ground truth for "the shares are out"; the roster is just bookkeeping.
 *
 * GROUNDED against a ticker collision: a Form 10's EFTS ticker can be pre-listing, stale, or reused
 * by an unrelated issuer, so a quote alone isn't enough — the quote's OWN name must match the
 * SpinCo's (name-core, suffixes stripped). Without that, a recycled 3-letter ticker would silently
 * delete a genuinely upcoming spin from the board. Returns the first trade date (the spin date) so
 * the log can hand you a ready-made roster line.
 */
async function distributedOn(spinco: string, ticker: string | null): Promise<string | null> {
  if (!ticker) return null;
  try {
    const q: any = await yf.quote(ticker, {}, { validateResult: false });
    const px = q?.regularMarketPrice;
    const first = q?.firstTradeDateMilliseconds;
    if (!(px > 0) || !first || first > Date.now()) return null;
    const quoted = stripSuffix(String(q?.longName || q?.shortName || ""));
    const want = stripSuffix(spinco);
    // Name must corroborate the ticker, or we're looking at somebody else's stock.
    const ok = !!quoted && !!want && (quoted === want || quoted.includes(want) || want.includes(quoted));
    return ok ? new Date(first).toISOString().slice(0, 10) : null;
  } catch {
    return null; // no quote → not listed → still upcoming
  }
}

// A completed spin lives in SPINOFF_ROSTER; keep it OUT of "upcoming". Match by ticker OR by name —
// a Form 10's EFTS hit often carries no ticker (or a pre-listing one), so ticker alone misses e.g.
// Versigent/Atrium that have already distributed. Compare on the name CORE (suffixes stripped).
const stripSuffix = (s: string) =>
  norm(s).replace(/\b(inc|incorporated|ltd|limited|corp|corporation|plc|company|co|holdings?|group|the|ii|iii)\b/g, " ").replace(/\s+/g, " ").trim();
const ROSTER_TICKERS = new Set(SPINOFF_ROSTER.map((s) => s.ticker));
const ROSTER_CORES = SPINOFF_ROSTER.map((s) => stripSuffix(s.name)).filter((c) => c.length >= 4);
function isCompleted(spinco: string, ticker: string | null): boolean {
  if (ticker && ROSTER_TICKERS.has(ticker)) return true;
  const core = stripSuffix(spinco);
  if (core.length < 4) return false;
  return ROSTER_CORES.some((rc) => rc === core || (rc.length >= 6 && (rc.includes(core) || core.includes(rc))));
}

async function discoverPipeline(prior: SpinPipelineRow[]): Promise<SpinPipelineRow[]> {
  const now = Date.now();
  const priorByCik = new Map(prior.map((p) => [p.cik, p]));
  if (!(await llmConfigured())) {
    console.log("pipeline: LLM not configured — carrying prior rows only");
    return prior.filter((p) => !isCompleted(p.spinco, p.ticker) && (now - Date.parse(p.firstFiledDate)) / DAY < 400);
  }
  const enddt = new Date(now).toISOString().slice(0, 10);
  const startdt = new Date(now - 220 * DAY).toISOString().slice(0, 10); // spins distribute a few months after the Form 10
  const hits = await eftsSearch({ forms: "10-12B,10-12B/A", startdt, enddt }).catch(() => [] as EftsHit[]);

  // Group every filing by the SpinCo's CIK: initial date, latest filing, amendment count, latest doc.
  interface Grp { cik: string; hit: EftsHit; first: string; last: string; amendments: number }
  const byCik = new Map<string, Grp>();
  for (const h of hits) {
    const cik = h.ciks[0];
    if (!cik) continue;
    const isAmd = /\/A/.test(h.form);
    const g = byCik.get(cik);
    if (!g) byCik.set(cik, { cik, hit: h, first: h.date, last: h.date, amendments: isAmd ? 1 : 0 });
    else {
      g.amendments += isAmd ? 1 : 0;
      if (h.date < g.first) g.first = h.date;
      if (h.date > g.last) { g.last = h.date; g.hit = h; } // keep the newest doc to read
    }
  }
  console.log(`pipeline: ${hits.length} Form 10 filings → ${byCik.size} distinct registrants`);

  const screened: Record<string, string> = await fsp.readFile(SCREENED, "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
  const out: SpinPipelineRow[] = [];
  // Graduated this run — surfaced loudly so the roster can catch up. Keyed by ticker: a name can be
  // caught by BOTH the EFTS loop and the carry-forward loop (it's in `prior` and still in the window),
  // and it must be reported once, not twice.
  const distributed = new Map<string, string>();
  let llmCalls = 0, gated = 0;
  for (const g of byCik.values()) {
    if (isCompleted(g.hit.issuer, g.hit.ticker)) continue; // already in the roster → lives in the turnover table
    // The roster lags; the tape doesn't. A SpinCo whose own ticker is already trading has distributed,
    // roster entry or not — showing it as "in registration" is just wrong (the MFP case).
    const spinDate = await distributedOn(g.hit.issuer, g.hit.ticker);
    if (spinDate) { distributed.set(String(g.hit.ticker), `${g.hit.ticker} (${g.hit.issuer}) — first traded ${spinDate}`); continue; }
    const prev = priorByCik.get(g.cik);
    // The EFTS window slides, so g.first / g.amendments only see hits still INSIDE the 220-day window;
    // once the initial 10-12B scrolls past startdt, g.first jumps forward and the age would RESET. Anchor
    // to the earliest date we've ever recorded (and never let the amendment count run backwards) so a
    // late-stage spin keeps aging monotonically and sorts ahead of newer filings.
    const firstFiled = prev?.firstFiledDate && prev.firstFiledDate < g.first ? prev.firstFiledDate : g.first;
    const amendments = Math.max(g.amendments, prev?.amendments ?? 0);
    const daysInReg = Math.round((now - Date.parse(firstFiled)) / DAY);
    const base: Omit<SpinPipelineRow, "parent" | "parentTicker" | "business" | "expectedTiming" | "ratio"> = {
      spinco: g.hit.issuer, ticker: g.hit.ticker, firstFiledDate: firstFiled, filedDate: g.last,
      amendments, daysInReg, url: edgarDocUrl(g.cik, g.hit.accession, g.hit.doc), cik: g.cik,
    };
    // Already screened this exact latest filing → never re-fetch or re-LLM it (cost ~nil). A prior row
    // means it classified as a spin: reuse the extraction, just refresh the counters. NO prior row means
    // it was screened and GATED as a non-spin — skip it silently. The ledger must remember REJECTS too,
    // or every gated 10-12B in the window gets re-billed nightly until it ages out (the refresh-ipo fix).
    if (screened[g.cik] === g.hit.accession) {
      if (prev) out.push({ ...prev, ...base });
      continue;
    }
    const text = await fetchFilingBodyText(g.hit).catch(() => "");
    if (!text || text.length < 1000) continue; // fetch failed → don't mark screened; retry next run
    screened[g.cik] = g.hit.accession;
    const o = await chatJSON<any>(PIPE_SYSTEM, `Filed ${g.last}. ${g.hit.issuer}.\n\n${text.slice(0, 12000)}\n\n${PIPE_SCHEMA}`, { model: FLASH_MODEL, maxTokens: 500, reasoningEffort: "low", local: true }).catch(() => null);
    llmCalls++;
    if (!o || o.isSpinoff !== true) { gated++; continue; }
    const tl = text.toLowerCase();
    const parent = typeof o.parent === "string" && phraseGrounded(o.parent, tl) ? o.parent.trim() : null; // parent must appear in the filing
    out.push({
      ...base,
      parent,
      parentTicker: parent && typeof o.parentTicker === "string" && /^[A-Z][A-Z0-9.\-]{0,5}$/.test(o.parentTicker.trim()) ? o.parentTicker.trim().toUpperCase() : null,
      business: typeof o.business === "string" && o.business.trim() ? o.business.trim().slice(0, 140) : null,
      expectedTiming: typeof o.expectedTiming === "string" && phraseGrounded(o.expectedTiming, tl) ? o.expectedTiming.trim().slice(0, 60) : null,
      ratio: typeof o.ratio === "string" && o.ratio.trim() ? o.ratio.trim().slice(0, 80) : null,
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  // Carry forward any prior row we didn't re-see this run (EFTS window slid past it) until it graduates
  // to the roster or ages out — a Form 10 filed 7 months ago may be days from distributing.
  for (const p of prior) {
    if (out.some((r) => r.cik === p.cik)) continue;
    if (isCompleted(p.spinco, p.ticker)) continue;
    if ((now - Date.parse(p.firstFiledDate)) / DAY >= 400) continue;
    // Same tape check on the carry-forward path: once the EFTS window slides past a spin's filings it
    // is ONLY reachable here, so without this a distributed name would be carried as "upcoming" for
    // its full 400-day life.
    const spinDate = await distributedOn(p.spinco, p.ticker);
    if (spinDate) { distributed.set(String(p.ticker), `${p.ticker} (${p.spinco}) — first traded ${spinDate}`); continue; }
    out.push({ ...p, daysInReg: Math.round((now - Date.parse(p.firstFiledDate)) / DAY) });
  }
  // Prune the screened ledger to CIKs EFTS still returned this run (i.e. still inside the 220-day
  // window). Rejects stay remembered while in-window — that's the point; once a filing ages out EFTS
  // stops returning it, so it can never be re-billed and is safe to forget. (Pruning to `out` would drop
  // every reject, reopening the leak.)
  const seen = new Set(byCik.keys());
  for (const k of Object.keys(screened)) if (!seen.has(k)) delete screened[k];
  await fsp.writeFile(SCREENED, JSON.stringify(screened));
  out.sort((a, b) => b.daysInReg - a.daysInReg); // late-stage (longest in registration) first
  console.log(`pipeline: ${out.length} upcoming spins (${llmCalls} LLM calls, ${gated} gated non-spins)`);
  // Dropping a graduated spin silently would just swap a wrong board for a MISSING name — the
  // turnover clock (the seller-exhaustion signal) is the valuable half, and it needs a roster entry.
  // So name them loudly with the line to paste. Ratio still needs a human: it comes from the
  // distribution terms, and guessing it would corrupt the derived share count.
  if (distributed.size) {
    console.log(`pipeline: ${distributed.size} DISTRIBUTED since the last run — add to SPINOFF_ROSTER (lib/spinoffs.ts) to track turnover:`);
    for (const d of distributed.values()) console.log(`  ⚑ ${d}`);
  }
  return out;
}

async function main() {
  const rows: SpinoffRow[] = [];
  for (const seed of SPINOFF_ROSTER) {
    const spinT = Date.parse(seed.spinDate);
    const [b, sharesOwn, wiLine] = await Promise.all([bars(seed.ticker, seed.spinDate), sharesOutstanding(seed.ticker), whenIssuedVol(seed)]);
    // Yahoo publishes NOTHING (not even market cap) for a days-old spinco — derive the count from
    // the PARENT's shares × the distribution ratio until the spinco's own figure appears.
    const shares = sharesOwn ?? (seed.ratio ? await sharesOutstanding(seed.parentTicker).then((p) => (p ? Math.round(p * seed.ratio!) : null)) : null);
    const reg = b.filter((x) => x.t >= spinT && x.close != null);
    // When-issued = the separate V-line (if Yahoo carries it) PLUS any pre-spin-date bars Yahoo
    // folds into the regular ticker's own history (it does for e.g. SNDK).
    const wiVol = wiLine + b.filter((x) => x.t < spinT).reduce((s, x) => s + (x.vol ?? 0), 0);
    if (!reg.length) {
      console.log(`  ${seed.ticker}: no regular-way bars yet — skipped`);
      continue;
    }
    // Base = MEDIAN of the first 3 regular-way closes — day-1 prints on fresh spincos are often
    // junk ticks (SNDK's first Yahoo bar is ~10× off), and the median shrugs those off.
    const firstCloses = reg.slice(0, 3).map((x) => x.close as number).sort((a, b) => a - b);
    const first = firstCloses[Math.floor(firstCloses.length / 2)];
    const last = reg[reg.length - 1].close as number;
    let cum = 0;
    const weekly: { d: string; pct: number }[] = [];
    reg.forEach((x, i) => {
      cum += x.vol ?? 0;
      if (shares && (i % 5 === 4 || i === reg.length - 1))
        weekly.push({ d: new Date(x.t).toISOString().slice(0, 10), pct: +(((cum + wiVol) / shares) * 100).toFixed(1) });
    });
    const turnoverPct = shares ? +(((cum + wiVol) / shares) * 100).toFixed(1) : null;
    rows.push({
      ...seed,
      daysSince: Math.round((Date.now() - spinT) / DAY),
      price: last,
      sincePct: first > 0 ? +(((last / first) - 1) * 100).toFixed(1) : null,
      sharesOut: shares,
      cumVol: cum,
      wiVol,
      turnoverPct,
      floatTurned: turnoverPct != null && turnoverPct >= 100, // backtest-calibrated (see lib/spinoffs)
      weekly: weekly.slice(-26), // ~6 months of weekly milestones
    });
    console.log(`  ${seed.ticker.padEnd(6)} turnover ${turnoverPct ?? "?"}%${wiVol ? ` (incl. ${(wiVol / 1e6).toFixed(1)}M WI)` : ""} · ${rows[rows.length - 1].daysSince}d since spin · since-spin ${rows[rows.length - 1].sincePct}%`);
    await new Promise((r) => setTimeout(r, 250));
  }
  rows.sort((a, b) => (b.turnoverPct ?? -1) - (a.turnoverPct ?? -1)); // raw order; the view re-sorts by setup proximity

  // Upstream pipeline — carry the prior rows in so discovery is incremental (screened-ledger cached).
  const prior: SpinoffsData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: "", rows: [], pipeline: [] }));
  const pipeline = await discoverPipeline(prior.pipeline ?? []).catch((e) => { console.warn(`pipeline failed: ${e?.message || e}`); return prior.pipeline ?? []; });

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), rows, pipeline } satisfies SpinoffsData));
  console.log(`\nwrote ${rows.length} completed spinoffs + ${pipeline.length} upcoming.`);
  for (const p of pipeline.slice(0, 8)) console.log(`  [reg ${String(p.daysInReg).padStart(3)}d] ${(p.ticker || p.spinco).slice(0, 22).padEnd(22)} ← ${p.parent ?? "?"}${p.expectedTiming ? ` · ${p.expectedTiming}` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
