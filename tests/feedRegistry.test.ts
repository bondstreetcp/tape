import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { feedSpec } from "../lib/dataFreshness";

// Every feed a refresh script writes must be either REGISTERED in the freshness monitor or named here as an
// intermediate with the reason it needs no floor. Found 2026-09-05: nineteen written files were invisible to
// the monitor, five of them user-facing (market headlines, macro releases, regime replay, staples scanner,
// the valuation panel) — a dead feed there could not have tripped an alert.

const ROOT = path.join(__dirname, "..");

/** Not feeds: caches, stores consumed by other scripts, per-universe files registered by directory. */
const INTERMEDIATES: Record<string, string> = {
  "buybacks-facts.json": "per-name XBRL facts store consumed by refresh-buybacks",
  "company-tickers.json": "SEC ticker→CIK map cache",
  "cusip-map.json": "CUSIP resolution cache",
  "ipo-screened.json": "reject cache: filings already judged not-an-IPO",
  "spinoff-screened.json": "reject cache: filings already judged not-a-spinoff",
  "lobbying-store.json": "LDA filings accumulator consumed by refresh-lobbying",
  "market.json": "S&P 500 daily series consumed by refresh-hedge-etfs",
  "putwrite-ivhist.json": "IV history store behind the put-writing screen",
  "sec-registrants.json": "EDGAR registrant cache",
  "short-history.json": "per-symbol short-interest history consumed by refresh-short-mechanics",
  "snapshot.json": "per-universe snapshots are registered by directory (Snapshot: <universe>)",
  "sp500.json": "constituents list (data/constituents/)",
  "splits.json": "build-data intermediate for the snapshot builder",
  "vol-universe.json": "vol-dislocation's probe intermediate (the board reads vol-dislocation.json)",
  // ORPHAN as of 2026-09-05: the nightly "Regime replay trickle" writes 727 graded rows (~390 KB) and no page,
  // component or lib reads the file. Wire a board or retire the step — until then it is not a feed to monitor.
  "regime-replay.json": "earnings-vol backtest output with no reader (see note)",
};
const RUNTIME = /^(tick-report|tick-history|llm-usage|av-margins|force-tick|runner|package|tsconfig|manifest|.*-seen|.*-cache|.*cache.*)\.json$/;

test("every data/*.json a refresh script writes is registered in the freshness monitor or a named intermediate", () => {
  const dir = path.join(ROOT, "scripts");
  const files = readdirSync(dir).filter((f) => (f.startsWith("refresh-") || f === "build-data.ts") && f.endsWith(".ts"));
  const written = new Set<string>();
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/"([a-z0-9-]+\.json)"/g)) written.add(m[1]);
  }
  const unaccounted = [...written].filter((n) => !RUNTIME.test(n) && !INTERMEDIATES[n] && !feedSpec(n)).sort();
  assert.deepEqual(unaccounted, [], `unregistered feeds (add to lib/dataFreshness FEEDS, or name them as intermediates here): ${unaccounted.join(", ")}`);
  // The allowlist must not go stale either: an intermediate that gets registered should leave this list.
  const both = Object.keys(INTERMEDIATES).filter((n) => feedSpec(n));
  assert.deepEqual(both, [], `registered feeds still listed as intermediates: ${both.join(", ")}`);
});
