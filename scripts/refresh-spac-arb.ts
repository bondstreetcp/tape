/**
 * Nightly build of data/spac-arb.json — SPACs trading below trust redemption value (/spac-arb).
 *
 * Pipeline (keyless, all SEC + Yahoo): (1) ENUMERATE the SPAC universe from the XBRL
 * AssetsHeldInTrust(Noncurrent) instant frames over the last ~4 quarters — every pre-deal SPAC
 * holds a trust; union the CIKs. (2) Per name, companyfacts → trust$ (freshest end) + redeemable
 * shares (SHARE_CONCEPTS fallback chain, read at the SAME end) → trust-per-share, COMPUTED not
 * trusted from the lagging PPS tag. Gate to SPAC_TRUST_BAND (drops commodity/holding trusts the
 * frame also catches). (3) Map CIK→ticker (SEC company_tickers). (4) Yahoo price + exchange →
 * discount to trust + a PINK/OTC flag. Sorted by discount (below-trust first).
 *
 * Honest by construction: every row stamps its trust as-of date + days stale, and the floor is
 * redemption-gated (see lib/spacArb). Degrades to STALE via writeFeedGuarded, never empty.
 *
 * Run: npm run refresh-spac-arb. FULL tier. SPAC_LIMIT caps the companyfacts scan for testing.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { instantFrameIds } from "../lib/secFrames";
import { SPAC_TRUST_BAND, SHARE_CONCEPTS, trustPerShare, discountPct, type SpacRow, type SpacArbFile } from "../lib/spacArb";
import { writeFeedGuarded } from "../lib/feedGuard";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const TRUST_CONCEPTS = ["AssetsHeldInTrustNoncurrent", "AssetsHeldInTrust"]; // current + legacy tag
const PPS_CONCEPT = "TemporaryEquityRedemptionPricePerShare";
const LIMIT = Number(process.env.SPAC_LIMIT) || Infinity;
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cikKey = (c: string | number) => String(Number(String(c).replace(/\D/g, "")));

async function secJson(url: string): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return null;
      if (r.ok) { const j = await r.json().catch(() => undefined); if (j !== undefined) return j; }
    } catch { /* retry */ }
    await sleep(600 * (i + 1));
  }
  return null;
}

/** Latest us-gaap facts array entry with end ≤ anchor (exact end preferred), for a units bucket. */
function atEnd(units: Record<string, any[]> | undefined, anchor: string): { val: number; end: string } | null {
  if (!units) return null;
  let best: { val: number; end: string } | null = null;
  for (const arr of Object.values(units)) {
    if (!Array.isArray(arr)) continue;
    for (const f of arr) {
      if (typeof f?.val !== "number" || !f?.end || f.end > anchor) continue;
      if (!best || f.end > best.end) best = { val: f.val, end: f.end };
    }
  }
  return best;
}
/** Freshest entry across a concept's units (any date) — for the trust anchor itself. */
function freshest(units: Record<string, any[]> | undefined): { val: number; end: string } | null {
  return atEnd(units, "9999-12-31");
}

async function main() {
  // ── (1) enumerate SPAC CIKs from the trust frames ──
  const cikSet = new Set<string>();
  let okFrames = 0;
  for (const id of instantFrameIds(Date.now(), 4)) {
    for (const concept of TRUST_CONCEPTS) {
      const j = await secJson(`https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/USD/${id}.json`);
      await sleep(200);
      if (!j?.data?.length) continue;
      okFrames++;
      for (const row of j.data) if (row?.cik) cikSet.add(cikKey(row.cik));
    }
  }
  if (!okFrames) { console.error("spac-arb: no trust frames loaded (SEC unreachable) — keeping prior file"); process.exit(1); }
  const ciks = [...cikSet].slice(0, LIMIT);
  console.log(`spac-arb: ${cikSet.size} SPAC CIKs from ${okFrames} frames · scanning ${ciks.length}`);

  // ── cik → COMMON-SHARE ticker (SEC company_tickers) ──
  // A SPAC lists common + warrant + right + unit under ONE cik. We must price the COMMON: a warrant
  // trades at cents, so pricing it against a $10 trust fabricates a 99% "discount" (the seed's tell).
  // The common is the SHORTEST ticker (derivatives = base + a suffix); a hard derivative marker on
  // the only listing means we can't get the common → drop the name rather than price the wrong one.
  const DERIV = /(-|\.)(WS?|WT|RT|U|UN)$|(WS|WT)$|[UW]$/i; // dashed/appended warrant·unit·right forms
  const tmap = await secJson("https://www.sec.gov/files/company_tickers.json");
  const byCik = new Map<string, { ticker: string; title: string }[]>();
  if (tmap) for (const k in tmap) {
    const e = tmap[k];
    if (e?.cik_str == null || !e?.ticker) continue;
    const key = cikKey(e.cik_str);
    (byCik.get(key) ?? byCik.set(key, []).get(key)!).push({ ticker: e.ticker, title: e.title || "" });
  }
  const cikTicker = new Map<string, { ticker: string; title: string }>();
  for (const [k, list] of byCik) {
    const pick = [...list].sort((a, b) => a.ticker.length - b.ticker.length)[0]; // common = shortest
    if (!DERIV.test(pick.ticker)) cikTicker.set(k, pick); // else: only a derivative listed → skip
  }

  // ── (2) per-name companyfacts → trust-per-share ──
  const cands: Omit<SpacRow, "price" | "exchange" | "discountPct">[] = [];
  let noTrust = 0, noShares = 0, offBand = 0, noTicker = 0;
  for (const cik of ciks) {
    const cf = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`);
    await sleep(120);
    const g = cf?.facts?.["us-gaap"];
    if (!g) { noTrust++; continue; }
    let trust: { val: number; end: string } | null = null;
    for (const c of TRUST_CONCEPTS) { trust = freshest(g[c]?.units); if (trust) break; }
    if (!trust) { noTrust++; continue; }
    if (trust.val < 5e6) { offBand++; continue; } // dead shell / near-liquidated (a few $M trust left)
    let shares: { val: number; end: string } | null = null, sharesConcept = "";
    for (const c of SHARE_CONCEPTS) { const s = atEnd(g[c]?.units, trust.end); if (s) { shares = s; sharesConcept = c; break; } }
    if (!shares) { noShares++; continue; }
    const tps = trustPerShare(trust.val, shares.val);
    if (tps == null || tps < SPAC_TRUST_BAND[0] || tps > SPAC_TRUST_BAND[1]) { offBand++; continue; }
    const t = cikTicker.get(cik);
    if (!t) { noTicker++; continue; }
    const pps = atEnd(g[PPS_CONCEPT]?.units, trust.end);
    cands.push({
      ticker: t.ticker, cik, name: (cf.entityName || t.title || "").slice(0, 60),
      trustUsd: Math.round(trust.val), trustEnd: trust.end,
      daysStale: Math.max(0, Math.round((Date.now() - Date.parse(trust.end + "T00:00:00Z")) / DAY)),
      shares: shares.val, sharesConcept,
      trustPerShare: +tps.toFixed(4),
      ppsTag: pps ? +pps.val.toFixed(2) : null,
      ppsMismatch: pps ? Math.abs(pps.val - tps) / tps > 0.02 : false,
    });
  }
  console.log(`spac-arb: ${cands.length} in-band SPACs (dropped ${noTrust} no-trust, ${noShares} no-shares, ${offBand} off-band, ${noTicker} no-ticker)`);

  // ── (3) Yahoo price + exchange → discount ──
  const rows: SpacRow[] = [];
  for (const c of cands) {
    let price: number | null = null, exchange: string | null = null;
    try {
      const q: any = await yf.quote(c.ticker, {}, { validateResult: false });
      price = typeof q?.regularMarketPrice === "number" && q.regularMarketPrice > 0 ? q.regularMarketPrice : null;
      exchange = q?.fullExchangeName ?? q?.exchange ?? null;
    } catch { /* uncovered */ }
    await sleep(120);
    rows.push({ ...c, price, exchange, discountPct: discountPct(c.trustPerShare, price) });
  }
  rows.sort((a, b) => (b.discountPct ?? -1e9) - (a.discountPct ?? -1e9));

  const payload: SpacArbFile = {
    generatedAt: new Date().toISOString(),
    universe: rows.length,
    priced: rows.filter((r) => r.price != null).length,
    rows,
  };
  const w = await writeFeedGuarded("spac-arb.json", payload, { replacer: (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v) });
  if (!w.written) { console.error(`spac-arb: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const belowTrust = rows.filter((r) => (r.discountPct ?? 0) > 0).length;
  console.log(`spac-arb: ${rows.length} SPACs · ${payload.priced} priced · ${belowTrust} below trust [${w.reason}]`);
}

main().catch((e) => { console.error("refresh-spac-arb failed:", e); process.exit(1); });
