/**
 * refresh-holdco-nav — compute look-through NAV + discount for each holdco in lib/holdco.ts's roster.
 * For every name: live-quote the holdco + each stake (+ FX), value the stakes (pctOwned × market cap,
 * or shares × price), add static otherNAV, subtract net debt → NAV; discount = price/NAVps − 1. Then
 * rebuild a ~400-day daily discount history from each stake's chart (current FX held constant) and
 * z-score the current discount vs its trailing 1-yr norm. Writes data/holdco-nav.json.
 *
 *   npm run refresh-holdco-nav
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { HOLDCOS, type Holdco, type HoldcoNav, type HoldcoNavData, type StakeVal } from "../lib/holdco";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Q { price: number | null; currency: string; marketCap: number | null }
const qCache = new Map<string, Q>();
const penceSyms = new Set<string>(); // symbols quoting in GBp/pence — their chart closes need ÷100 too
async function quote(sym: string): Promise<Q | null> {
  if (qCache.has(sym)) return qCache.get(sym)!;
  try {
    const q: any = await yf.quote(sym, {}, { validateResult: false });
    let cur = q?.currency || "USD";
    let price = q?.regularMarketPrice ?? null;
    let mcap = q?.marketCap ?? null;
    // Some lines quote in a subunit (London GBp/pence, JSE ZAc/cents) — normalize to the major unit.
    if (cur === "GBp" || cur === "GBX" || cur === "ZAc" || cur === "ZAX") { if (price != null) price /= 100; if (mcap != null) mcap /= 100; cur = cur[0] === "G" ? "GBP" : "ZAR"; penceSyms.add(sym); }
    const out: Q = { price, currency: cur.toUpperCase(), marketCap: mcap };
    qCache.set(sym, out);
    return out;
  } catch { return null; }
}

// FX: units of `to` per 1 unit of `from`. Yahoo 'XXXYYY=X' = YYY per XXX. (Note: London lines may
// quote in GBp/pence — a known v1 caveat for GBP-listed names; verify those against the NAV sheet.)
const fxCache = new Map<string, number>();
async function fx(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const key = `${from}${to}`;
  if (fxCache.has(key)) return fxCache.get(key)!;
  const q = await quote(`${from}${to}=X`);
  if (q?.price == null) { console.warn(`  ! no FX ${from}->${to}`); return 1; }
  fxCache.set(key, q.price);
  return q.price;
}

async function dailyCloses(sym: string, days = 1900): Promise<Map<string, number> | null> {
  try {
    const c: any = await yf.chart(sym, { period1: new Date(Date.now() - days * DAY), interval: "1d" }, { validateResult: false });
    const scale = penceSyms.has(sym) ? 0.01 : 1; // GBp chart closes → GBP
    const m = new Map<string, number>();
    for (const q of c?.quotes || []) if (q?.date && q.close != null) m.set(dayKey(new Date(q.date).getTime()), q.close * scale);
    return m.size ? m : null;
  } catch { return null; }
}

function median(xs: number[]): number { const a = [...xs].sort((p, q) => p - q); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
// last close on/before a day, from a sorted day list
function closeOnOrBefore(sortedDays: string[], series: Map<string, number>, day: string): number | null {
  // binary search the greatest day <= target
  let lo = 0, hi = sortedDays.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sortedDays[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? series.get(sortedDays[ans]) ?? null : null;
}

async function computeHoldco(h: Holdco): Promise<HoldcoNav> {
  const base: HoldcoNav = {
    slug: h.slug, name: h.name, ticker: h.ticker, currency: h.currency, asOf: h.asOf,
    price: null, navPerShare: null, grossAssetM: null, listedM: null, otherNavM: h.otherNavM, netDebtM: h.netDebtM,
    navM: null, discount: null, z1y: null, stretched: false, coveragePct: null, stakes: [], history: [], note: h.note,
  };
  const hq = await quote(h.ticker);
  if (!hq?.price) { base.error = "no holdco quote"; return base; }
  const holdcoPriceRep = hq.price * (await fx(hq.currency, h.currency)); // holdco price in reporting ccy

  // ── current stake values + effective share counts (for the history) ──
  const legs: { ticker: string; name: string; effShares: number; priceRep: number; series: Map<string, number> | null; fxRate: number }[] = [];
  const stakeVals: StakeVal[] = [];
  let listed = 0;
  for (const s of h.stakes) {
    const q = await quote(s.ticker);
    if (!q?.price) { stakeVals.push({ ticker: s.ticker, name: s.name, valueM: null, pctOfNav: null }); continue; }
    const rate = await fx(q.currency, h.currency);
    const effShares = s.pctOwned != null ? (q.marketCap && q.price ? s.pctOwned * (q.marketCap / q.price) : 0) : (s.sharesM ?? 0) * 1e6;
    const valueRep = effShares * q.price * rate;
    listed += valueRep;
    legs.push({ ticker: s.ticker, name: s.name, effShares, priceRep: q.price * rate, series: await dailyCloses(s.ticker), fxRate: rate });
    stakeVals.push({ ticker: s.ticker, name: s.name, valueM: Math.round(valueRep / 1e6), pctOfNav: null });
    await sleep(60);
  }

  const otherNav = h.otherNavM * 1e6;
  const grossAsset = listed + otherNav;
  const navAbs = grossAsset - h.netDebtM * 1e6;
  const navPerShare = navAbs / (h.sharesOutM * 1e6);
  const discount = navPerShare ? (holdcoPriceRep / navPerShare - 1) * 100 : null;
  for (const sv of stakeVals) if (sv.valueM != null && grossAsset) sv.pctOfNav = Math.round((sv.valueM * 1e6 / navAbs) * 100);

  base.price = Math.round(holdcoPriceRep * 100) / 100;
  base.grossAssetM = Math.round(grossAsset / 1e6);
  base.listedM = Math.round(listed / 1e6);
  base.navM = Math.round(navAbs / 1e6);
  base.navPerShare = Math.round(navPerShare * 100) / 100;
  base.discount = discount == null ? null : Math.round(discount * 10) / 10;
  base.coveragePct = grossAsset ? Math.round((listed / grossAsset) * 100) : null;
  base.stakes = stakeVals;

  // ── historical discount series (current FX held constant; static otherNAV/netDebt/shares) ──
  const hSeries = await dailyCloses(h.ticker);
  const holdcoFx = await fx(hq.currency, h.currency); // hoisted out of the per-day loop
  if (hSeries && legs.some((l) => l.series)) {
    const stakeSorted = legs.map((l) => ({ l, days: l.series ? [...l.series.keys()].sort() : [] }));
    const hist: [string, number, number][] = [];
    for (const day of [...hSeries.keys()].sort()) {
      const hp = hSeries.get(day)! * holdcoFx; // holdco price that day, reporting ccy
      let stakeSum = 0, have = 0;
      for (const { l, days } of stakeSorted) {
        if (!l.series) continue;
        const c = closeOnOrBefore(days, l.series, day);
        if (c != null) { stakeSum += l.effShares * c * l.fxRate; have++; }
      }
      if (have < legs.length) continue; // need all legs that day
      const navT = stakeSum + otherNav - h.netDebtM * 1e6;
      const npsT = navT / (h.sharesOutM * 1e6);
      if (npsT > 0) hist.push([day, Math.round(npsT * 100) / 100, Math.round(hp * 100) / 100]);
    }
    base.history = hist.slice(-1300); // ~5yr of daily points so the 1Y/2Y/3Y/Max toggle is meaningful
    // z-score of current discount vs the trailing 1yr discount history (derived from nav/price)
    const win = base.history.slice(-252).map(([, nav, price]) => (price / nav - 1) * 100);
    if (win.length >= 30 && discount != null) {
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length) || 1;
      base.z1y = Math.round(((discount - mean) / sd) * 100) / 100;
      base.stretched = base.z1y <= -1;
    }
  }
  return base;
}

async function main() {
  console.log(`Computing look-through NAV for ${HOLDCOS.length} holdcos…`);
  const holdcos: HoldcoNav[] = [];
  for (const h of HOLDCOS) {
    try {
      const r = await computeHoldco(h);
      holdcos.push(r);
      console.log(`  ${h.name.padEnd(28)} disc ${r.discount == null ? "—" : r.discount.toFixed(1) + "%"}  z ${r.z1y ?? "—"}  cov ${r.coveragePct ?? "—"}%  ${r.error || ""}`);
    } catch (e: any) {
      console.warn(`  ! ${h.name}: ${String(e?.message || e).slice(0, 120)}`);
    }
    await sleep(120);
  }
  holdcos.sort((a, b) => (a.discount ?? 99) - (b.discount ?? 99)); // deepest discount first
  const out: HoldcoNavData = { generatedAt: new Date().toISOString(), asOf: new Date().toISOString().slice(0, 10), holdcos };
  await fs.writeFile(path.join(DATA, "holdco-nav.json"), JSON.stringify(out));
  console.log(`Wrote data/holdco-nav.json (${holdcos.length} holdcos)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
