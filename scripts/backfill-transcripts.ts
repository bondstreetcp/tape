/**
 * Backfill the earnings-call ARCHIVE — pull the S&P 500's last ~3 years of transcripts from MarketBeat (the free
 * full-text source chosen after vetting 6; plain HTTP GET, no headless) into data/calls/<SYM>/<FY-QN>.json.
 *
 * RAW-FIRST: this stores each transcript with digest=null; the structured LLM ingestion runs SEPARATELY and free
 * on the AMD rig overnight (scripts/ingest-transcripts, routed via CALL_DIGEST_LOCAL_*). Fetching and digesting
 * are split so the (fast, free, network-bound) pull isn't gated on the (slow, one-sequence) local GPU.
 *
 * Incremental (skips already-archived call dates), polite (a delay between every fetch), resumable (re-run picks
 * up where it stopped). Env knobs: BACKFILL_YEARS (3), BACKFILL_DELAY_MS (700), BACKFILL_TICKER_LIMIT (0=all),
 * BACKFILL_ONLY ("AAPL,MSFT" — a test subset).
 *   npm run backfill-transcripts            # all 503, ~3yr
 *   BACKFILL_ONLY=LULU,AAPL npm run backfill-transcripts
 */
import { promises as fs } from "fs";
import path from "path";
import { discoverMarketBeatReports, fetchMarketBeatTranscript } from "../lib/marketbeat";
import { saveCallRecord, loadSymbolCalls, type CallRecord } from "../lib/callsArchive";
import { sleep } from "../lib/scriptKit";

const YEARS = Math.max(1, Number(process.env.BACKFILL_YEARS || 3));
const DELAY_MS = Math.max(0, Number(process.env.BACKFILL_DELAY_MS || 700));
const TICKER_LIMIT = Number(process.env.BACKFILL_TICKER_LIMIT || 0); // 0 = all
const ONLY = (process.env.BACKFILL_ONLY || "").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());

async function loadConstituents(): Promise<{ symbol: string; name: string }[]> {
  const p = path.join(process.cwd(), "data", "constituents", "sp500.json");
  const arr = JSON.parse(await fs.readFile(p, "utf8")) as { symbol: string; name: string }[];
  return arr.filter((c) => c.symbol);
}

async function main() {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - YEARS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  let names = await loadConstituents();
  if (ONLY.length) names = names.filter((c) => ONLY.includes(c.symbol.toUpperCase()));
  if (TICKER_LIMIT > 0) names = names.slice(0, TICKER_LIMIT);
  console.log(`backfill-transcripts: ${names.length} names · window ≥ ${cutoffISO} (${YEARS}yr) · source MarketBeat · delay ${DELAY_MS}ms`);

  const t0 = Date.now();
  let fetched = 0, skipped = 0, noReports = 0, tickersWithNew = 0, errors = 0;
  for (const { symbol } of names) {
    const sym = symbol.toUpperCase();
    try {
      const reports = await discoverMarketBeatReports(sym);
      const inWindow = reports.filter((r) => r.date >= cutoffISO);
      if (!inWindow.length) { noReports++; await sleep(DELAY_MS); continue; }
      const have = new Set((await loadSymbolCalls(sym)).map((r) => r.callDate)); // incremental: skip archived dates
      let got = 0;
      for (const rep of inWindow) {
        if (have.has(rep.date)) { skipped++; continue; }
        await sleep(DELAY_MS);
        const t = await fetchMarketBeatTranscript(rep);
        if (!t) continue; // results-only page / no transcript
        const rec: CallRecord = {
          symbol: sym,
          fiscalPeriod: t.fiscalPeriod || `d${rep.date}`, // fall back to a date key if the page had no "Q# YYYY"
          callDate: t.date,
          title: t.title,
          url: t.url,
          source: "MarketBeat",
          transcript: { text: t.text, chars: t.chars },
          digest: null, // awaiting the rig's overnight ingestion
          fetchedAt: new Date().toISOString(),
          digestedAt: null,
        };
        await saveCallRecord(rec);
        fetched++; got++;
      }
      if (got) tickersWithNew++;
      if (got || inWindow.length) console.log(`  ${sym.padEnd(6)} ${inWindow.length} in-window · +${got} new`);
    } catch (e) {
      errors++;
      console.warn(`  ${sym}: ${String((e as Error)?.message || e).slice(0, 90)}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(
    `backfill-transcripts: done in ${Math.round((Date.now() - t0) / 60_000)}min · +${fetched} transcripts stored across ${tickersWithNew} names · ${skipped} already archived · ${noReports} names with no in-window MarketBeat reports · ${errors} errors`,
  );
}

main().catch((e) => { console.error("backfill-transcripts:", String((e as Error)?.message || e)); process.exit(1); });
