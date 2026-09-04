import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCompStack, buildCompStackRows, fiscalYearOf, parseFiscalLabel } from "../lib/compStack";
import type { SssData, SssGuide, SssPeriod, SssTicker } from "../lib/sameStoreSales";

// The analyzer answers "what does the guide imply for the two-year stack over the rest of the year". The
// fixture is the Five Below Q2 FY26 print (Sep 2026): FY25 comps 7.1 / 12.4 / 14.3 / 15.4, FY26 so far
// 22.7 / 14.1, a Q3 guide of +8–10% and a raised FY guide of +10–12% (from +6–8%). Worked by hand on the
// desk before this existed — those hand numbers are the assertions below. (FY24 comps are fixture values.)

const src = { form: "8-K", url: "https://sec.gov/x", date: "2026-09-02", quote: null };
const P = (fpEnd: string, fiscalLabel: string, comp: number): SssPeriod => ({ fpEnd, fiscalLabel, comp, source: src });
const PERIODS: SssPeriod[] = [
  P("2026-08-01", "Q2 FY26", 14.1),
  P("2026-05-02", "Q1 FY26", 22.7),
  P("2026-01-31", "Q4 FY25", 15.4),
  P("2025-11-01", "Q3 FY25", 14.3),
  P("2025-08-02", "Q2 FY25", 12.4),
  P("2025-05-03", "Q1 FY25", 7.1),
  P("2025-02-01", "Q4 FY24", 3.4),
  P("2024-11-02", "Q3 FY24", 0.6),
];
const ACC = "0001177609-26-000020";
const GUIDE: SssGuide = {
  accession: ACC, date: "2026-09-02", url: "https://sec.gov/q2",
  nextQ: { label: "Q3 FY26", compLow: 8, compHigh: 10, revLowM: 1210, revHighM: 1230, quote: "q3" },
  fy: { label: "FY2026", compLow: 10, compHigh: 12, priorCompLow: 6, priorCompHigh: 8, revLowM: 5630, revHighM: 5710, quote: "fy" },
  ytdComp: 18.3, netNewUnits: 150, confidence: "high",
};
const FIVE: SssTicker = { metricLabel: "Comparable sales", lastAccession: ACC, industry: "Specialty Retail", periods: PERIODS, guide: GUIDE };
// Quarterly net sales, $M (FY25 = the weights for solving FY26; FY26 YTD = the revenue cross-check).
const REVENUE = [
  { date: "2026-08-01", rev: 1262 }, { date: "2026-05-02", rev: 1286 },
  { date: "2026-01-31", rev: 1728.4 }, { date: "2025-11-01", rev: 1038.3 }, { date: "2025-08-02", rev: 1026.8 }, { date: "2025-05-03", rev: 970.5 },
];
const near = (a: number | null | undefined, b: number, tol = 0.15) => assert.ok(a != null && Math.abs(a - b) <= tol, `expected ≈${b}, got ${a}`);

test("parseFiscalLabel / fiscalYearOf: the label styles issuers actually use", () => {
  assert.deepEqual(parseFiscalLabel("Q3 FY26"), { q: 3, fy: 2026 });
  assert.deepEqual(parseFiscalLabel("3Q26"), { q: 3, fy: 2026 });
  assert.deepEqual(parseFiscalLabel("Q2 '25"), { q: 2, fy: 2025 });
  assert.deepEqual(parseFiscalLabel("third quarter fiscal 2026"), { q: 3, fy: 2026 });
  assert.deepEqual(parseFiscalLabel("Q1 2027"), { q: 1, fy: 2027 });
  assert.deepEqual(parseFiscalLabel("Q4"), { q: 4, fy: null });
  assert.equal(parseFiscalLabel("FY2026"), null); // no quarter
  assert.equal(parseFiscalLabel(""), null);
  assert.equal(fiscalYearOf("FY2026"), 2026);
  assert.equal(fiscalYearOf("fiscal 2027"), 2027);
  assert.equal(fiscalYearOf("full year"), null);
});

test("FIVE Q2 FY26: guided Q3 stack, back-solved Q4, hold-the-stack FY, and the decel read", () => {
  const a = analyzeCompStack(FIVE, { revenueByDate: REVENUE });
  assert.ok(a);
  assert.equal(a.weightSource, "revenue");
  assert.equal(a.guideStatus, "fresh");
  assert.deepEqual(a.fiscal, { fy: 2026, latestQ: 2, solvingNextFy: false, remainingQs: [3, 4] });
  // the just-reported stack: 14.1 + the 12.4 it lapped
  near(a.latest.stack, 26.5, 1e-9);
  near(a.history[a.history.length - 2].stack, 29.8, 1e-9); // Q1 FY26: 22.7 + 7.1
  // blended YTD reproduces the release's own 18.3% — the revenue-weighting is doing its job
  near(a.ytdComp, 18.3, 0.1);
  assert.equal(a.ytdCompStated, 18.3);
  // Q3: straight from the guide, lapping +14.3
  const q3 = a.remaining[0];
  assert.equal(q3.kind, "guided");
  assert.equal(q3.label, "Q3 FY26");
  near(q3.stackLow, 22.3, 1e-9);
  near(q3.stackHigh, 24.3, 1e-9);
  // Q4: what the +10–12% FY guide leaves after 22.7 / 14.1 / 8–10 (revenue-weighted) — the desk's ~+1.6 to +5.9
  const q4 = a.remaining[1];
  assert.equal(q4.kind, "implied");
  assert.equal(q4.label, "Q4 FY26");
  near(a.implied?.low, 1.63);
  near(a.implied?.mid, 3.79);
  near(a.implied?.high, 5.95);
  near(q4.stack, 19.2); // 3.79 + 15.4
  // holding +26.5 through year-end: Q3 +12.2 / Q4 +11.1 → FY ≈ +14.35, ~3.3 pts above the guide midpoint
  assert.deepEqual(a.holdStack?.comps.map((c) => c.label), ["Q3 FY26", "Q4 FY26"]);
  near(a.holdStack?.comps[0].comp, 12.2, 1e-9);
  near(a.holdStack?.comps[1].comp, 11.1, 1e-9);
  near(a.holdStack?.fyComp, 14.35);
  near(a.holdStack?.vsGuideMid, 3.35);
  // the read: stacks 23.3 and 19.2 vs 26.5 now → ~5.3 pts of embedded deceleration
  near(a.stackShift, -5.26);
  assert.equal(a.read?.tag, "decel");
  assert.match(a.read!.text, /fading from \+26\.5/);
  assert.match(a.read!.text, /Holding the stack flat/);
  // revenue cross-check: $5.63–5.71B less $2.55B YTD less the $1.21–1.23B Q3 guide → Q4 $1.87–1.93B vs $1.73B LY
  near(a.revenueCheck?.revLowM, 1872, 0.5);
  near(a.revenueCheck?.revHighM, 1932, 0.5);
  near(a.revenueCheck?.growthLow, 8.3, 0.1);
  near(a.revenueCheck?.growthHigh, 11.8, 0.1);
  assert.deepEqual(a.fyGuide, { label: "FY2026", low: 10, high: 12, mid: 11, priorLow: 6, priorHigh: 8 });
  assert.equal(a.notes.length, 0);
});

test("no revenue history → equal weights, flagged, and the implied comp moves accordingly", () => {
  const a = analyzeCompStack(FIVE);
  assert.ok(a);
  assert.equal(a.weightSource, "equal");
  assert.ok(a.notes.some((n) => /equal/.test(n)));
  // 11 = 0.25 × (22.7 + 14.1 + 9 + c4) → c4 = −1.8
  near(a.implied?.mid, -1.8);
  assert.equal(a.revenueCheck, null); // no $ history → no $ cross-check
});

test("a guide from an OLDER release than the latest comp is stale: laps + hold-stack still computed, nothing implied", () => {
  const a = analyzeCompStack({ ...FIVE, lastAccession: "0001177609-26-000099" }, { revenueByDate: REVENUE });
  assert.ok(a);
  assert.equal(a.guideStatus, "stale");
  assert.equal(a.fyGuide, null);
  assert.equal(a.nextQGuide, null);
  assert.equal(a.implied, null);
  assert.equal(a.read, null);
  assert.equal(a.stackShift, null);
  assert.equal(a.remaining[0].kind, "implied");
  assert.equal(a.remaining[0].comp, null);
  near(a.remaining[0].lap, 14.3, 1e-9);
  near(a.holdStack?.comps[1].comp, 11.1, 1e-9);
  assert.ok(a.notes.some((n) => /not yet re-read/.test(n)));
});

test("a year-end (Q4) print solves the NEXT fiscal year: no YTD, four remaining quarters lapping this year", () => {
  const acc = "0001177609-26-000006";
  const tk: SssTicker = {
    metricLabel: "Comparable sales", lastAccession: acc, periods: PERIODS.slice(2), // latest = Q4 FY25
    guide: {
      accession: acc, date: "2026-03-18", url: "u",
      nextQ: { label: "Q1 FY26", compLow: 7, compHigh: 9, revLowM: null, revHighM: null, quote: null },
      fy: { label: "FY2026", compLow: 6, compHigh: 8, revLowM: null, revHighM: null, quote: null },
      ytdComp: null, netNewUnits: 150, confidence: "medium",
    },
  };
  const a = analyzeCompStack(tk, { revenueByDate: REVENUE });
  assert.ok(a);
  assert.deepEqual(a.fiscal, { fy: 2026, latestQ: 4, solvingNextFy: true, remainingQs: [1, 2, 3, 4] });
  assert.equal(a.ytdComp, null);
  near(a.latest.stack, 18.8, 1e-9); // 15.4 + the 3.4 fixture lap
  assert.deepEqual(a.remaining.map((r) => r.label), ["Q1 FY26", "Q2 FY26", "Q3 FY26", "Q4 FY26"]);
  assert.deepEqual(a.remaining.map((r) => r.lap), [7.1, 12.4, 14.3, 15.4]);
  assert.equal(a.remaining[0].kind, "guided");
  // 7 = w1·8 + (1 − w1)·c → c = (7 − 0.2037·8) / 0.7963 ≈ 6.74 for Q2–Q4
  near(a.implied?.mid, 6.74);
  assert.deepEqual(a.implied?.quarters, ["Q2 FY26", "Q3 FY26", "Q4 FY26"]);
  assert.equal(a.read?.tag, "flat"); // stacks 15.1 / 19.1 / 21.0 / 22.1 vs 18.8 → mean shift ≈ +0.6
});

test("a Q3 print with a Q4 guide leaves nothing to solve — the pieces are summed instead", () => {
  const acc = "0001177609-25-000048";
  const tk: SssTicker = {
    metricLabel: "Comparable sales", lastAccession: acc, periods: PERIODS.slice(3), // latest = Q3 FY25
    guide: {
      accession: acc, date: "2025-12-03", url: "u",
      nextQ: { label: "Q4 FY25", compLow: 8, compHigh: 10, revLowM: null, revHighM: null, quote: null },
      fy: { label: "FY2025", compLow: 10, compHigh: 11, revLowM: null, revHighM: null, quote: null },
      ytdComp: null, netNewUnits: null, confidence: "medium",
    },
  };
  const a = analyzeCompStack(tk);
  assert.ok(a);
  assert.equal(a.implied, null);
  // equal weights: 0.25 × (7.1 + 12.4 + 14.3 + 9) = 10.7 at the midpoint
  near(a.piecesFy?.mid, 10.7);
  assert.equal(a.remaining.length, 1);
  assert.equal(a.remaining[0].kind, "guided");
});

test("no quarter number anywhere → null; the guide's next-quarter label can stand in for a bare comp label", () => {
  const bare = PERIODS.map((p) => ({ ...p, fiscalLabel: undefined }));
  assert.equal(analyzeCompStack({ metricLabel: "Comps", periods: bare }), null);
  const a = analyzeCompStack({ ...FIVE, periods: bare });
  assert.ok(a);
  assert.equal(a.fiscal.latestQ, 2); // "Q3 FY26" is next → Q2 FY26 was just reported
  assert.equal(a.fiscal.fy, 2026);
});

test("buildCompStackRows: guided names first, most embedded deceleration first, then by the latest stack", () => {
  const flatGuide: SssGuide = { ...GUIDE, nextQ: { ...GUIDE.nextQ!, compLow: 12, compHigh: 13 }, fy: { ...GUIDE.fy!, compLow: 14, compHigh: 15 } };
  const data: SssData = {
    generatedAt: "2026-09-03T00:00:00Z",
    byTicker: {
      NOGUIDE: { metricLabel: "Comps", periods: PERIODS, guide: null },
      FIVE,
      FLAT: { ...FIVE, guide: flatGuide },
      THIN: { metricLabel: "Comps", periods: PERIODS.slice(0, 2) }, // no lap → no stack → excluded
    },
  };
  const rows = buildCompStackRows(data, (t) => t, () => REVENUE);
  assert.deepEqual(rows.map((r) => r.ticker), ["FIVE", "FLAT", "NOGUIDE"]);
  assert.equal(rows[0].guideUrl, "https://sec.gov/q2");
  assert.equal(rows[2].guideUrl, null);
});
