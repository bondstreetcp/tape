import "./harness"; // FIRST: installs the jsdom globals Testing Library binds to
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { cleanup } from "@testing-library/react";
import { renderView, capturingErrors } from "./harness";

import OvernightFilingsView from "../../components/OvernightFilingsView";
import InsidersView from "../../components/InsidersView";
import LeadersView from "../../components/LeadersView";
import WarningsView from "../../components/WarningsView";
import ConfluenceView from "../../components/ConfluenceView";
import CompStackView from "../../components/CompStackView";
import CallDigestsView from "../../components/CallDigestsView";
import EarningsMoveView from "../../components/EarningsMoveView";
import SpinoffsView from "../../components/SpinoffsView";
import BuybacksView from "../../components/BuybacksView";
import StatusView from "../../components/StatusView";
import PortfolioCockpit from "../../components/PortfolioCockpit";
import EarningsPrep from "../../components/EarningsPrep";
import { buildLeaders } from "../../lib/leaders";
import { buildCompStackRows } from "../../lib/compStack";
import { appendTickHistory, summarizeTick, type TickReport } from "../../lib/tickHistory";
import type { OvernightData } from "../../lib/overnightFilings";
import { buildInsiderBuys, type InsidersFile } from "../../lib/insiders";
import type { CompanyStats } from "../../lib/companyStats";
import type { WarningsData } from "../../lib/warnings";
import type { ConfluenceData } from "../../lib/confluence";
import type { SssData } from "../../lib/sameStoreSales";
import type { CallDigestsData } from "../../lib/callDigests";
import type { EarningsMoveData } from "../../lib/earningsMove";
import type { SpinoffsData } from "../../lib/spinoffs";
import type { BuybackData } from "../../lib/buybacks";
import type { Snapshot } from "../../lib/types";
import type { FreshReport } from "../../lib/dataFreshness";

/**
 * Smoke coverage for the busiest client views: each renders REAL feed JSON (trimmed fixtures pulled
 * from the runner's tree on 2026-09-05) inside the app-router contexts, must show something from its
 * data, and must not make React complain (duplicate keys, state updates outside act, bad props).
 * The review found 0 component tests against 787 pure ones; the four most-changed files of the
 * summer were all views. These are deliberately shallow — a crash or a key collision on real data is
 * the bug class they catch — and cheap enough to run with every `npm test`.
 */

const fx = <T,>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8")) as T;
const REACT_COMPLAINTS = /Each child|unique "key"|Cannot update a component|not wrapped in act|Hydration|Invalid prop|Encountered two children|Warning:|Objects are not valid as a React child|Maximum update depth/;

afterEach(cleanup);

function smoke(name: string, ui: () => ReactNode, expect: RegExp[], minNodes = 20) {
  test(`${name} renders its feed`, () => {
    const { result, errors } = capturingErrors(() => renderView(ui()));
    const text = result.container.textContent ?? "";
    for (const re of expect) assert.match(text, re, `${name}: expected ${re} in the rendered text`);
    assert.ok(result.container.querySelectorAll("*").length >= minNodes, `${name}: rendered only ${result.container.querySelectorAll("*").length} elements`);
    const complaints = errors.filter((e) => REACT_COMPLAINTS.test(e));
    assert.deepEqual(complaints, [], `${name}: React complained — ${complaints.join(" | ").slice(0, 600)}`);
  });
}

const overnight = fx<OvernightData>("overnight-filings.json");
const insiders = fx<InsidersFile>("insiders.json");
const warnings = fx<WarningsData>("warnings.json");
const confluence = fx<ConfluenceData>("confluence.json");
const sss = fx<SssData>("same-store-sales.json");
const calls = fx<CallDigestsData>("call-digests.json");
const earningsMove = fx<EarningsMoveData>("earnings-move.json");
const spinoffs = fx<SpinoffsData>("spinoffs.json");
const buybacks = fx<BuybackData>("buybacks.json");
const snapshot = fx<Snapshot>("snapshot-sp500.json");
const freshness = fx<FreshReport>("freshness-report.json");

smoke("OvernightFilingsView",
  () => <OvernightFilingsView universe="sp500" data={overnight} known={overnight.items.map((i) => i.ticker)} sectors={{}} related={{}} />,
  [/Overnight/i, new RegExp(overnight.items[0].ticker)]);

// the page joins the on-disk file to a snapshot's stocks (lib/insiders.buildInsiderBuys) — same here
const insiderRows = buildInsiderBuys(insiders, snapshot.stocks);
smoke("InsidersView",
  () => <InsidersView data={insiderRows} universe="sp500" />,
  [/Insider/i, new RegExp(insiderRows.rows[0]?.symbol ?? Object.keys(insiders.names)[0])]);

smoke("LeadersView",
  () => <LeadersView rows={buildLeaders(snapshot.stocks)} universe="sp500" />,
  [/Leaders/i]);

smoke("WarningsView",
  () => <WarningsView data={warnings} universe="sp500" flagged={null} />,
  [/Warning/i, new RegExp(warnings.names[0].symbol)]);

smoke("ConfluenceView",
  () => <ConfluenceView data={confluence} universe="sp500" flagged={null} />,
  [/Confluence/i, new RegExp(confluence.names[0].symbol)]);

smoke("CompStackView",
  () => <CompStackView rows={buildCompStackRows(sss, (t) => snapshot.stocks.find((s) => s.symbol === t)?.name, () => undefined)} universe="sp500" asOf={sss.generatedAt.slice(0, 10)} />,
  [/stack/i, /CMG|MCD|DRI/]);

smoke("CallDigestsView",
  () => <CallDigestsView universe="sp500" data={calls} />,
  [/FIVE/, /Five Below/, /tariff/i]);

smoke("EarningsMoveView",
  () => <EarningsMoveView universe="sp500" rows={earningsMove.rows} generatedAt={earningsMove.generatedAt} source={earningsMove.source} windowDays={earningsMove.windowDays} intl={false} />,
  [/Earnings/i, new RegExp(earningsMove.rows[0].symbol)]);

smoke("SpinoffsView",
  () => <SpinoffsView universe="sp500" data={spinoffs} />,
  [/Spin/i, new RegExp(spinoffs.rows[0].ticker)]);

smoke("BuybacksView",
  () => <BuybacksView universe="sp500" data={buybacks} known={buybacks.rows.map((r) => r.symbol)} />,
  [/Buyback/i, new RegExp(buybacks.rows[0].symbol)]);

const tickReport: TickReport = {
  generatedAt: "2026-09-05T23:40:00.000Z", mode: "full", sha: "e8de7f5", fails: 1, total: 3,
  steps: [
    { name: "Hydrate data/ from R2 (prior tree)", ok: true, exit: 0, mins: 0.9 },
    { name: "Refresh earnings-call digests", ok: false, exit: 1, mins: 6.2, stderrTail: "HTTP 403", suppressed: { "investing listing": 3 } },
    { name: "Upload site data to R2 (build-time hydration)", ok: true, exit: 0, mins: 1.6 },
  ],
};
smoke("StatusView (with the runner history)",
  () => (
    <StatusView
      universe="sp500"
      report={freshness}
      build={{ version: "0.1.0", sha: "e8de7f5", builtAt: "2026-09-05T18:41:00.000Z" }}
      ticks={{ history: appendTickHistory(null, summarizeTick(tickReport)), latest: tickReport }}
    />
  ),
  [/System Status/, /Insider buys \(Form 4\)/, /Runner — last 30 days/, /Refresh earnings-call digests \(exit 1\)/, /investing listing ×3/]);

// The two monoliths (1,507 and 1,185 lines). They fetch in effects — the harness answers 503 — so
// this proves the initial render and the "server is down" path, not the loaded state.
smoke("PortfolioCockpit", () => <PortfolioCockpit universe="sp500" />, [/Portfolio/i]);

// EarningsPrep renders nothing without stats (the stock page passes the baked company cache); a
// blank-but-typed stats object exercises every null branch of the quant assembly.
const blankStats: CompanyStats = {
  price: 190.5, recommendationKey: null, recommendationMean: null, numAnalysts: null, targetMean: null, targetHigh: null, targetLow: null, ratings: null,
  forwardEps: null, trailingEps: null, earningsGrowth: null, revenueGrowth: null, totalRevenue: null, estimates: [], surprises: [], ratingChanges: [],
  trailingPE: null, forwardPE: null, pegRatio: null, priceToBook: null, priceToSales: null, evToRevenue: null, evToEbitda: null, beta: null,
  marketCap: null, enterpriseValue: null, grossMargins: null, operatingMargins: null, profitMargins: null, returnOnEquity: null, returnOnAssets: null,
  debtToEquity: null, currentRatio: null, totalCash: null, freeCashflow: null, heldPercentInsiders: null, heldPercentInstitutions: null,
  sharesShort: null, sharesShortPriorMonth: null, shortPercentOfFloat: null, shortRatio: null, floatShares: null, sharesOutstanding: null,
  dividendYield: null, dividendRate: null, payoutRatio: null,
};
smoke("EarningsPrep", () => <EarningsPrep symbol="AAPL" stats={blankStats} earningsDate="2026-10-29" />, [/Earnings/i], 5);
