/**
 * Nightly build of data/spac-arb.json — SPACs trading below trust redemption value (/spac-arb).
 *
 * Pipeline (keyless, all SEC + Yahoo): (1) ENUMERATE the SPAC universe from the XBRL
 * AssetsHeldInTrust instant frames over the last ~4 quarters — every pre-deal SPAC holds a trust;
 * union the CIKs. (2) Per name, companyfacts → trust$ (FRESHEST across the trust concepts) + the
 * redemption FLOOR (prefer the filer's own redemption-price tag, which nets out tax-earmarked
 * interest that trust÷shares over-counts; fall back to computed; the LOWER when they disagree) at
 * the share count's own end → discount. (3) Map CIK→COMMON-share ticker (never a warrant/right/
 * unit). (4) Yahoo price + exchange. A discount past PLAUSIBLE_MAX_DISCOUNT is flagged UNVERIFIED —
 * a real pre-deal common can't trade far below its floor, so it's a stale post-deal trust or a
 * mispicked listing. Sorted: plausible below-trust first, unverified sunk to the bottom.
 *
 * Every row stamps trust + share as-of dates (daysStale = the older). Degrades STALE, never empty.
 * Run: npm run refresh-spac-arb. FULL tier. SPAC_LIMIT caps the companyfacts scan for testing.
 */
import { promises as fsp } from "fs";
import path from "path";
import { instantFrameIds } from "../lib/secFrames";
import { SPAC_TRUST_BAND, SHARE_CONCEPTS, PLAUSIBLE_MAX_DISCOUNT, pickCommon, trustPerShare, discountPct, type SpacRow, type SpacArbFile } from "../lib/spacArb";
import { writeFeedGuarded } from "../lib/feedGuard";
import { sleep } from "../lib/scriptKit";
import { yahoo as yf } from "../lib/yahooClient";

const DATA = path.join(process.cwd(), "data");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const TRUST_CONCEPTS = ["AssetsHeldInTrustNoncurrent", "AssetsHeldInTrust", "AssetsHeldInTrustCurrent"];
const PPS_CONCEPT = "TemporaryEquityRedemptionPricePerShare";
const LIMIT = Number(process.env.SPAC_LIMIT) || Infinity;
const DAY = 86_400_000;
const cikKey = (c: string | number) => String(Number(String(c).replace(/\D/g, "")));

// Returns the parsed JSON, `null` for a genuine 404 (legitimate ABSENCE), or `undefined` when all
// retries fail (a FETCH FAILURE — reset/429/5xx/timeout). Callers must distinguish the two: a partial
// frame map from silent failures is worse than no map (it drives a false filing-detector reuse).
async function secJson(url: string): Promise<any | null | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return null;
      if (r.ok) { const j = await r.json().catch(() => undefined); if (j !== undefined) return j; }
    } catch { /* retry */ }
    await sleep(600 * (i + 1));
  }
  return undefined; // retries exhausted — a failure, NOT an absence
}

/** Latest fact (end ≤ anchor, exact end preferred by the caller) within the given unit buckets. */
function atEnd(unitsObj: Record<string, any[]> | undefined, anchor: string, unitKeys: string[]): { val: number; end: string } | null {
  if (!unitsObj) return null;
  let best: { val: number; end: string } | null = null;
  for (const uk of unitKeys) {
    const arr = unitsObj[uk];
    if (!Array.isArray(arr)) continue;
    for (const f of arr) {
      if (typeof f?.val !== "number" || !f?.end || f.end > anchor) continue;
      if (!best || f.end > best.end) best = { val: f.val, end: f.end };
    }
  }
  return best;
}
const freshest = (u: Record<string, any[]> | undefined, unitKeys: string[]) => atEnd(u, "9999-12-31", unitKeys);

async function main() {
  // ── (1) enumerate SPAC CIKs from the trust frames ──
  const cikSet = new Set<string>();
  // Freshest CALENDAR trust-frame end per CIK — the "did it file a new quarterly trust value?" signal
  // that drives the filing-detector below. Monotonic per CIK across the scanned quarters.
  const frameEnd = new Map<string, string>();
  let okFrames = 0, failedFrames = 0;
  for (const id of instantFrameIds(Date.now(), 4)) {
    for (const concept of TRUST_CONCEPTS) {
      const j = await secJson(`https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/USD/${id}.json`);
      await sleep(200);
      if (j === undefined) { failedFrames++; continue; } // FETCH FAILED — the frameEnd map is now incomplete
      if (!j?.data?.length) continue; // legit empty / absent frame (404 or no filers this quarter)
      okFrames++;
      for (const row of j.data) {
        if (!row?.cik) continue;
        const k = cikKey(row.cik);
        cikSet.add(k);
        if (row.end && (!frameEnd.has(k) || row.end > frameEnd.get(k)!)) frameEnd.set(k, row.end);
      }
    }
  }
  if (!okFrames) { console.error("spac-arb: no trust frames loaded (SEC unreachable) — keeping prior file"); process.exit(1); }
  // A partial frame map is worse than no map: a CIK that filed a new quarter inside a FAILED frame keeps
  // its stale frameEnd, which then spuriously matches the prior trustEnd and reuses a now-stale floor.
  // So the filing-detector runs ONLY when every frame loaded — otherwise fall back to fresh pulls for all.
  const detectorOk = failedFrames === 0;

  // ── cik → COMMON-share ticker (SEC company_tickers) ──
  const tmap = await secJson("https://www.sec.gov/files/company_tickers.json");
  const byCik = new Map<string, { ticker: string; title: string }[]>();
  if (tmap) for (const k in tmap) {
    const e = tmap[k];
    if (e?.cik_str == null || !e?.ticker) continue;
    (byCik.get(cikKey(e.cik_str)) ?? byCik.set(cikKey(e.cik_str), []).get(cikKey(e.cik_str))!).push({ ticker: e.ticker, title: e.title || "" });
  }
  const cikTicker = new Map<string, { ticker: string; title: string }>();
  for (const [k, list] of byCik) { const c = pickCommon(list); if (c) cikTicker.set(k, c); }

  // ── FILING-DETECTOR: the feed file is its own cache (spac-arb.json round-trips via R2). A name's
  // companyfacts-derived floor changes ONLY when it files a new quarterly trust value, which advances
  // its freshest CALENDAR frame end. So when frameEnd matches the prior row's trustEnd, companyfacts
  // would yield the identical freshest instant → REUSE the prior floor and skip the ~400KB pull. A
  // non-calendar filer (trustEnd not on a scanned quarter) never matches → safely falls back to a pull;
  // correctness is never traded for the bandwidth. (SEC-bandwidth doctrine: fetch only on a filing.)
  type Cand = Omit<SpacRow, "price" | "exchange" | "discountPct" | "implausible">;
  const prior = await fsp
    .readFile(path.join(DATA, "spac-arb.json"), "utf8")
    .then((s) => JSON.parse(s) as SpacArbFile)
    .catch(() => null);
  const priorByCik = new Map<string, SpacRow>();
  for (const r of prior?.rows ?? []) priorByCik.set(cikKey(r.cik), r);
  const staleFrom = (asOf: string) => Math.max(0, Math.round((Date.now() - Date.parse(asOf + "T00:00:00Z")) / DAY));
  /** A candidate rebuilt from the prior row's companyfacts-derived fields — shared by the
   *  filing-detector reuse and the transport-failure carry (staleness recomputed, ticker fresh). */
  const candFromPrior = (pr: SpacRow, cik: string, ticker: string): Cand => {
    const asOf = pr.sharesEnd < pr.trustEnd ? pr.sharesEnd : pr.trustEnd;
    return {
      ticker, cik, name: pr.name,
      trustUsd: pr.trustUsd, trustEnd: pr.trustEnd, daysStale: staleFrom(asOf),
      shares: pr.shares, sharesConcept: pr.sharesConcept, sharesEnd: pr.sharesEnd,
      trustPerShare: pr.trustPerShare, ppsTag: pr.ppsTag,
      floorPerShare: pr.floorPerShare, floorSource: pr.floorSource, ppsMismatch: pr.ppsMismatch,
    };
  };

  // Enumeration carry (2026-08-15 sweep): frames that FAILED to load can be the only place a CIK is
  // visible — without this, those names silently VANISH from the feed for the night. Union in the
  // prior file's CIKs whenever the frame map is incomplete, so the universe degrades stale, not shrunk.
  if (!detectorOk) for (const k of priorByCik.keys()) cikSet.add(k);
  const ciks = [...cikSet].slice(0, LIMIT);
  console.log(`spac-arb: ${cikSet.size} SPAC CIKs from ${okFrames} frames${detectorOk ? "" : ` (+ prior-file carry — ${failedFrames} frame(s) failed)`} · scanning ${ciks.length}`);

  // ── (2) per-name companyfacts → floor per share ──
  const cands: Cand[] = [];
  let noTrust = 0, noShares = 0, offBand = 0, noTicker = 0, reused = 0, carriedFail = 0, carryMiss = 0;
  for (const cik of ciks) {
    // Filing-detector: nothing new filed since we last computed this name → reuse, no companyfacts pull.
    // Only when the frame map is COMPLETE (detectorOk) — a partial map would false-match a stale floor.
    const pr = priorByCik.get(cik);
    const t0 = cikTicker.get(cik);
    if (detectorOk && pr && t0 && frameEnd.get(cik) === pr.trustEnd) {
      cands.push(candFromPrior(pr, cik, t0.ticker));
      reused++;
      continue;
    }
    const cf = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`);
    await sleep(120);
    // Transport failure ≠ "no facts" (2026-08-15 sweep): a failed pull must CARRY the prior row
    // (staleness recomputed) instead of silently dropping the name from the feed for the night.
    if (cf === undefined) {
      if (pr && t0) { cands.push(candFromPrior(pr, cik, t0.ticker)); carriedFail++; }
      else carryMiss++;
      continue;
    }
    const g = cf?.facts?.["us-gaap"];
    if (!g) { noTrust++; continue; }
    // Freshest trust value ACROSS the concepts (a name mid-cycle can tag Current fresher than Noncurrent).
    let trust: { val: number; end: string } | null = null;
    for (const c of TRUST_CONCEPTS) { const t = freshest(g[c]?.units, ["USD"]); if (t && (!trust || t.end > trust.end)) trust = t; }
    if (!trust) { noTrust++; continue; }
    if (trust.val < 5e6) { offBand++; continue; } // dead shell / near-liquidated
    // Shares: prefer the concept tagged at the EXACT trust end; else the latest ≤, stamping its own end.
    let shares: { val: number; end: string } | null = null, sharesConcept = "";
    for (const c of SHARE_CONCEPTS) { const s = atEnd(g[c]?.units, trust.end, ["shares"]); if (s?.end === trust.end) { shares = s; sharesConcept = c; break; } }
    if (!shares) for (const c of SHARE_CONCEPTS) { const s = atEnd(g[c]?.units, trust.end, ["shares"]); if (s) { shares = s; sharesConcept = c; break; } }
    if (!shares) { noShares++; continue; }
    const computed = trustPerShare(trust.val, shares.val);
    if (computed == null) { noShares++; continue; }
    // Floor: prefer the filer's redemption tag (nets out non-distributable interest); conservative on disagree.
    const pps = atEnd(g[PPS_CONCEPT]?.units, trust.end, ["USD/shares"]);
    const tag = pps?.val ?? null;
    const mismatch = tag != null ? Math.abs(computed - tag) / tag > 0.02 : false;
    const floor = tag == null ? computed : mismatch ? Math.min(computed, tag) : tag;
    const floorSource: "tag" | "computed" | "conservative" = tag == null ? "computed" : mismatch ? "conservative" : "tag";
    if (floor < SPAC_TRUST_BAND[0] || floor > SPAC_TRUST_BAND[1]) { offBand++; continue; }
    const t = cikTicker.get(cik);
    if (!t) { noTicker++; continue; }
    const asOf = shares.end < trust.end ? shares.end : trust.end; // report the OLDER of the two
    cands.push({
      ticker: t.ticker, cik, name: (cf.entityName || t.title || "").slice(0, 60),
      trustUsd: Math.round(trust.val), trustEnd: trust.end,
      daysStale: Math.max(0, Math.round((Date.now() - Date.parse(asOf + "T00:00:00Z")) / DAY)),
      shares: shares.val, sharesConcept, sharesEnd: shares.end,
      trustPerShare: +computed.toFixed(4),
      ppsTag: tag != null ? +tag.toFixed(2) : null,
      floorPerShare: +floor.toFixed(4), floorSource,
      ppsMismatch: mismatch,
    });
  }
  console.log(`spac-arb: ${cands.length} in-band SPACs (${reused} reused via filing-detector, ${carriedFail} carried on fetch-failure, ${cands.length - reused - carriedFail} freshly pulled${detectorOk ? "" : ` — DETECTOR OFF: ${failedFrames} frame(s) failed, all re-pulled`}; dropped ${noTrust} no-trust, ${noShares} no-shares, ${offBand} off-band, ${noTicker} no-ticker${carryMiss ? `, ${carryMiss} fetch-failed with no prior to carry` : ""})`);

  // ── (3) Yahoo price + exchange → discount + plausibility ──
  const rows: SpacRow[] = [];
  for (const c of cands) {
    let price: number | null = null, exchange: string | null = null;
    try {
      const q: any = await yf.quote(c.ticker, {}, { validateResult: false });
      price = typeof q?.regularMarketPrice === "number" && q.regularMarketPrice > 0 ? q.regularMarketPrice : null;
      exchange = q?.fullExchangeName ?? q?.exchange ?? null;
    } catch { /* uncovered */ }
    await sleep(120);
    const disc = discountPct(c.floorPerShare, price);
    rows.push({ ...c, price, exchange, discountPct: disc, implausible: disc != null && disc > PLAUSIBLE_MAX_DISCOUNT });
  }
  // Plausible below-trust first; unverified (implausible) sunk to the bottom regardless of magnitude.
  rows.sort((a, b) => Number(a.implausible) - Number(b.implausible) || (b.discountPct ?? -1e9) - (a.discountPct ?? -1e9));

  const payload: SpacArbFile = {
    generatedAt: new Date().toISOString(),
    universe: rows.length,
    priced: rows.filter((r) => r.price != null).length,
    rows,
  };
  const w = await writeFeedGuarded("spac-arb.json", payload, { replacer: (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v) });
  if (!w.written) { console.error(`spac-arb: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const belowTrust = rows.filter((r) => (r.discountPct ?? 0) > 0 && !r.implausible).length;
  console.log(`spac-arb: ${rows.length} SPACs · ${payload.priced} priced · ${belowTrust} plausibly below trust · ${rows.filter((r) => r.implausible).length} flagged unverified [${w.reason}]`);
}

main().catch((e) => { console.error("refresh-spac-arb failed:", e); process.exit(1); });
