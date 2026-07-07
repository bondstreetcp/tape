/**
 * Builds data/biotech-vol.json — the options read on every DATED clinical binary.
 *
 * Pure re-pricing over data/biotech-catalysts.json (no EDGAR/LLM — the dates are already extracted):
 *  1. Take forward binaries: PDUFA action dates + Phase 2/3 readouts with a future primary-completion.
 *  2. Price the ATM straddle over the expiry bracketing the event → implied move, vs the stock's
 *     realized-vol baseline over the same window. The EVENT PREMIUM (implied ÷ baseline) is then
 *     percentile-ranked across the cohort: low = "options light", high = "fully loaded".
 *
 * Run: npm run refresh-biotech-vol. Nightly (after refresh-biotech). US options only. Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { getOptions } from "../lib/options";
import { straddleMove } from "../lib/earningsTrade";
import type { BioCatalyst, BiotechData } from "../lib/biotech";
import type { BioVolRow, BiotechVolData } from "../lib/biotechVol";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "biotech-vol.json");
const DAY = 86_400_000;
const MAX_DAYS_OUT = 250; // a PDUFA can be ~a year out; only the near ones will have a bracketing expiry

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
  const out: R[] = new Array(items.length); let idx = 0, errs = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { errs++; out[i] = null as any; } } }));
  if (errs) console.warn(`  mapPool: ${errs}/${items.length} tasks threw (dropped as null)`);
  return out;
}

const isForwardBinary = (i: BioCatalyst): boolean => {
  if (!(i.statusKind === "pdufa" || i.statusKind === "readout" || i.statusKind === "enrolling-done")) return false;
  if (!i.primaryCompletion) return false;
  const days = Math.round((Date.parse(i.primaryCompletion + "T00:00:00Z") - Date.now()) / DAY);
  return days >= 1 && days <= MAX_DAYS_OUT;
};

async function main() {
  const nowISO = new Date().toISOString();
  const bio: BiotechData | null = await fsp.readFile(path.join(DATA, "biotech-catalysts.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);
  if (!bio?.items?.length) { console.log("no biotech-catalysts.json — run refresh-biotech first."); return; }

  // Forward binaries, one per ticker+date, soonest first.
  const seen = new Set<string>();
  const events = bio.items.filter(isForwardBinary).filter((i) => { const k = `${i.ticker}|${i.primaryCompletion}`; return seen.has(k) ? false : (seen.add(k), true); })
    .sort((a, b) => Date.parse(a.primaryCompletion!) - Date.parse(b.primaryCompletion!));
  console.log(`${events.length} forward biotech binaries (≤${MAX_DAYS_OUT}d) → pricing options`);

  const priced = await mapPool(events, 4, async (i): Promise<BioVolRow | null> => {
    const eventDate = i.primaryCompletion!;
    const days = Math.round((Date.parse(eventDate + "T00:00:00Z") - Date.now()) / DAY);
    const base: BioVolRow = {
      ticker: i.ticker, company: i.company, drug: i.drug, condition: i.condition, phase: i.phase,
      eventKind: i.statusKind === "pdufa" ? "pdufa" : "readout",
      eventLabel: i.statusKind === "pdufa" ? "FDA decision (PDUFA)" : `${i.phase || "Clinical"} readout`,
      eventDate, daysToEvent: days,
      price: null, expiry: null, dte: null, impliedMovePct: null, baselineMovePct: null, ratio: null, premiumPctile: null, url: i.url,
    };
    const [chain, hv] = await Promise.all([getOptions(i.ticker).catch(() => null), hvAnnual(i.ticker)]);
    if (!chain || hv == null || hv <= 0) return base; // unpriced (dropped from view) — likely no listed options
    const sm = await straddleMove(i.ticker, chain, eventDate).catch(() => null);
    if (!sm || !sm.isEvent || sm.dte == null || sm.dte < 1) return base; // no expiry reaches the event
    const baselineMovePct = hv * Math.sqrt(sm.dte / 365) * 100;
    if (!(baselineMovePct > 0)) return base;
    return {
      ...base,
      price: +sm.price.toFixed(2), expiry: sm.expiry || "", dte: sm.dte,
      impliedMovePct: +sm.movePct.toFixed(2), baselineMovePct: +baselineMovePct.toFixed(2),
      ratio: +(sm.movePct / baselineMovePct).toFixed(2), premiumPctile: null, // filled below
    };
  });

  const rows = (priced.filter(Boolean) as BioVolRow[]);
  // Percentile-rank the event premium across the priced cohort (self-calibrating cheap/rich).
  const withRatio = rows.filter((r) => r.ratio != null).sort((a, b) => a.ratio! - b.ratio!);
  // MIN-RANK on the distinct ratio value — identical event premia (common: one sponsor's whole-company
  // straddle prices every one of its trials the same) must get the SAME percentile, else array order
  // alone splits ties across the volTag light/fair/loaded cutoffs and labels the same binary two ways.
  const firstIdxByRatio = new Map<number, number>();
  withRatio.forEach((r, idx) => { if (!firstIdxByRatio.has(r.ratio!)) firstIdxByRatio.set(r.ratio!, idx); });
  withRatio.forEach((r) => { r.premiumPctile = withRatio.length > 1 ? Math.round((firstIdxByRatio.get(r.ratio!)! / (withRatio.length - 1)) * 100) : 50; });

  const out = rows.filter((r) => r.impliedMovePct != null).sort((a, b) => a.daysToEvent - b.daysToEvent);
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: events.length, rows: out } satisfies BiotechVolData));
  console.log(`\nwrote ${out.length} priced biotech binaries:`);
  for (const r of out.slice(0, 12)) console.log(`  ${r.ticker.padEnd(6)} ${r.eventLabel.padEnd(20)} ${r.eventDate} (${r.daysToEvent}d) implied ±${r.impliedMovePct}% vs base ±${r.baselineMovePct}% = ${r.ratio}× (p${r.premiumPctile})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
