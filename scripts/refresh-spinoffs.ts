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
import { SPINOFF_ROSTER, type SpinoffRow, type SpinoffsData } from "../lib/spinoffs";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const FILE = path.join(process.cwd(), "data", "spinoffs.json");

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
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), rows } satisfies SpinoffsData));
  console.log(`\nwrote ${rows.length} spinoffs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
