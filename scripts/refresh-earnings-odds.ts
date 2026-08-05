/**
 * Nightly build of data/earnings-odds.json — Polymarket's single-name earnings markets crossed with
 * the options-implied move, street consensus drift, and the desk's own predicted print.
 *
 * Sources, in join order:
 *   • gamma-api.polymarket.com /events?tag_slug=earnings (free, keyless; ~80-170 open markets in
 *     season, near zero out of it — an EMPTY rows[] out of season is CORRECT, so this feed carries
 *     no minCount and the page renders an explicit "no open markets" instead of pretending).
 *   • data/<broadest>/snapshot.json — name/sector/price/cap; also the universe gate (a ticker we
 *     don't cover renders nothing useful downstream, so it's counted honestly and skipped).
 *   • Yahoo earningsTrend (0q) — TODAY'S consensus vs the strike Polymarket froze at creation:
 *     the mechanical mispricing column. Throttled + deadline-bounded like every live vendor call.
 *   • data/earnings-move.json — the straddle-implied ±move for ≤16d reporters.
 *   • data/earnings-preview-log.json — the desk model's predicted print, where one was logged.
 *
 * Run:  npm run refresh-earnings-odds   (wired into run-tick STEPS + refresh-data.yml, FULL tier,
 * AFTER refresh-earnings-move and refresh-preview-log so it reads tonight's files.)
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { deadline, withDeadline } from "../lib/deadline";
import { daysUntil } from "../lib/calendar";
import { parseEarningsSlug, driftEps, pBeatFrom, SPREAD_SUPPRESS, type EarningsOddsRow, type EarningsOddsFile } from "../lib/earningsOdds";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const OUT = path.join(DATA, "earnings-odds.json");
const GAMMA = "https://gamma-api.polymarket.com/events";
const UNIVERSE = "russell3000"; // broadest US snapshot — same choice as the other US boards

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
const throttle = (gap = 150): Promise<void> => { const p = gate.then(() => sleep(gap)); gate = p; return p; };

const readJson = (f: string): Promise<any> => fsp.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

async function fetchOpenEarningsEvents(): Promise<any[]> {
  // Paginate defensively — in-season counts have been observed near 200.
  const all: any[] = [];
  for (let offset = 0; offset < 1000; offset += 500) {
    const res = await fetch(`${GAMMA}?tag_slug=earnings&closed=false&limit=500&offset=${offset}`, { signal: deadline(20_000) });
    if (!res.ok) throw new Error(`gamma ${res.status}`);
    const page = (await res.json()) as any[];
    all.push(...page);
    if (page.length < 500) break;
  }
  return all;
}

/** Yahoo earningsTrend 0q → current consensus + the 30d-ago mark. Null on any failure — a missing
 *  consensus costs one drift cell, never the run. */
async function fetchConsensus(sym: string): Promise<{ avg: number | null; n: number | null; avg30d: number | null } | null> {
  await throttle();
  try {
    const r: any = await withDeadline(
      yf.quoteSummary(sym, { modules: ["earningsTrend"] }, { validateResult: false }),
      15_000,
      `earningsTrend ${sym}`,
    );
    const q0 = (r?.earningsTrend?.trend || []).find((t: any) => t?.period === "0q");
    if (!q0) return null;
    const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      avg: num(q0.epsEstimate?.avg ?? q0.epsTrend?.current),
      n: num(q0.epsEstimate?.numberOfAnalysts),
      avg30d: num(q0.epsTrend?.["30daysAgo"]),
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log("refresh-earnings-odds: fetching Polymarket earnings markets…");
  const events = await fetchOpenEarningsEvents();
  console.log(`  ${events.length} open events on the venue`);

  const snap = await readJson(`${UNIVERSE}/snapshot.json`);
  const bySym = new Map<string, any>((snap?.stocks || []).map((s: any) => [s.symbol, s]));
  if (!bySym.size) throw new Error(`no ${UNIVERSE} snapshot — run after the universe build`);

  const em = await readJson("earnings-move.json");
  const emBySym = new Map<string, any>((em?.rows || []).map((r: any) => [r.symbol, r]));
  const pl = await readJson("earnings-preview-log.json");
  // Latest logged forecast per symbol — recs are append-ordered; keep the newest awaiting/graded one.
  const predBySym = new Map<string, any>();
  for (const r of pl?.recs || []) if (r?.symbol) predBySym.set(r.symbol, r);

  let offUniverse = 0;
  let pastDated = 0;
  const candidates: { parsed: NonNullable<ReturnType<typeof parseEarningsSlug>>; mkt: any; slug: string }[] = [];
  for (const ev of events) {
    const parsed = parseEarningsSlug(ev.slug || "");
    const mkt = ev.markets?.[0];
    if (!parsed || !mkt) continue; // unparseable = skipped, never guessed
    // Resolution stragglers stay listed for days after the print — a FORWARD board drops them.
    const d = daysUntil(parsed.reportDate);
    if (d == null || d < 0) { pastDated++; continue; }
    if (!bySym.has(parsed.ticker)) { offUniverse++; continue; }
    candidates.push({ parsed, mkt, slug: ev.slug });
  }
  console.log(`  ${candidates.length} forward + on-universe (${pastDated} past-dated, ${offUniverse} off-universe)`);

  // One consensus fetch per DISTINCT symbol (a name can list GAAP + non-GAAP markets).
  const symbols = [...new Set(candidates.map((c) => c.parsed.ticker))];
  const consensus = new Map<string, Awaited<ReturnType<typeof fetchConsensus>>>();
  for (const s of symbols) consensus.set(s, await fetchConsensus(s));
  const gotCons = [...consensus.values()].filter((c) => c?.avg != null).length;
  console.log(`  consensus: ${gotCons}/${symbols.length} symbols`);

  const rows: EarningsOddsRow[] = candidates.map(({ parsed, mkt, slug }) => {
    const st = bySym.get(parsed.ticker)!;
    const cons = consensus.get(parsed.ticker) || null;
    let yesMark: number | null = null;
    try {
      const outcomes: string[] = JSON.parse(mkt.outcomes || "[]");
      const prices: string[] = JSON.parse(mkt.outcomePrices || "[]");
      const yi = Math.max(0, outcomes.findIndex((o) => /yes/i.test(o)));
      const v = Number(prices[yi]);
      yesMark = Number.isFinite(v) ? v : null;
    } catch { /* leave null */ }
    const bid = typeof mkt.bestBid === "number" ? mkt.bestBid : null;
    const ask = typeof mkt.bestAsk === "number" ? mkt.bestAsk : null;
    const spread = bid != null && ask != null ? +(ask - bid).toFixed(3) : typeof mkt.spread === "number" ? mkt.spread : null;
    const emRow = emBySym.get(parsed.ticker);
    const pred = predBySym.get(parsed.ticker);
    // Only attach a desk forecast made for THIS report — an old quarter's call on tonight's print
    // would be worse than none. The log stamps the report's earnings date; match on the calendar day.
    const predMatches = pred?.earningsDate ? String(pred.earningsDate).slice(0, 10) === parsed.reportDate : false;
    return {
      symbol: parsed.ticker,
      name: st.name,
      sector: st.sector || "",
      price: st.price ?? null,
      marketCap: st.marketCap ?? null,
      reportDate: parsed.reportDate,
      basis: parsed.basis,
      strikeEps: parsed.strikeEps,
      epsAvg: cons?.avg ?? null,
      epsAnalysts: cons?.n ?? null,
      epsAvg30dAgo: cons?.avg30d ?? null,
      driftEps: driftEps(parsed.basis, parsed.strikeEps, cons?.avg ?? null),
      pBeat: pBeatFrom(bid, ask, yesMark),
      spread,
      thin: spread != null && spread > SPREAD_SUPPRESS,
      volumeUsd: typeof mkt.volumeNum === "number" ? Math.round(mkt.volumeNum) : null,
      liquidityUsd: typeof mkt.liquidityNum === "number" ? Math.round(mkt.liquidityNum) : null,
      polymarketSlug: slug,
      impliedMovePct: typeof emRow?.impliedMovePct === "number" ? emRow.impliedMovePct : null,
      richness: typeof emRow?.richness === "number" ? emRow.richness : null,
      predEps: predMatches && typeof pred.predEps === "number" ? pred.predEps : null,
      predCall: predMatches ? pred.vsConsensus ?? null : null,
      predConfidence: predMatches ? pred.confidence ?? null : null,
    };
  });

  rows.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));

  const out: EarningsOddsFile = {
    generatedAt: new Date().toISOString(),
    rows,
    scanned: events.length,
    offUniverse,
    pastDated,
  };
  await fsp.writeFile(OUT, JSON.stringify(out));
  const withDrift = rows.filter((r) => r.driftEps != null).length;
  console.log(`earnings-odds: wrote ${rows.length} rows (${withDrift} with drift, ${rows.filter((r) => r.thin).length} thin-book) from ${events.length} venue events.`);
}

main().catch((e) => { console.error("refresh-earnings-odds:", String(e?.message || e)); process.exit(1); });
