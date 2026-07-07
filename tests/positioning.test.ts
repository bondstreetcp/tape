import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPositioning, buildCatalystIndex, daysUntil, rankPositioning, type FlowEntryInput } from "../lib/positioning";

const NOW = Date.parse("2026-07-07T15:00:00Z"); // mid US session — the day-count edge case

const entry = (o: Partial<FlowEntryInput> & { symbol: string; type: "call" | "put"; strike: number; premium: number }): FlowEntryInput => ({
  name: o.symbol + " Inc", underlying: 100, chgPct: 1, expiry: "2026-07-17", dte: 10, vol: 1000, oi: 100, volOI: 10,
  iv: 0.4, mid: 1, unusual: true, ...o,
});

test("daysUntil: floors now to UTC midnight (same-day = 0 mid-session, not -1)", () => {
  assert.equal(daysUntil("2026-07-07", NOW), 0);
  assert.equal(daysUntil("2026-07-08", NOW), 1);
  assert.equal(daysUntil("2026-07-10", NOW), 3);
  assert.equal(daysUntil("2026-07-01", NOW), -6);
  assert.equal(daysUntil("not-a-date", NOW), null);
});

test("buildPositioning: rolls the tape up per name, splits OTM (directional) from ITM (delta-one)", () => {
  const entries: FlowEntryInput[] = [
    // AAPL spot 100: two OTM calls (directional upside) + one deep-ITM call (stock replacement, big $, not a view)
    entry({ symbol: "AAPL", type: "call", strike: 110, premium: 3_000_000, underlying: 100 }),
    entry({ symbol: "AAPL", type: "call", strike: 120, premium: 2_000_000, underlying: 100 }),
    entry({ symbol: "AAPL", type: "call", strike: 50, premium: 9_000_000, underlying: 100, unusual: false }), // ITM
    entry({ symbol: "AAPL", type: "put", strike: 90, premium: 1_000_000, underlying: 100 }), // OTM put
  ];
  const [aapl] = buildPositioning(entries, {}, NOW);
  assert.equal(aapl.symbol, "AAPL");
  assert.equal(aapl.callPrem, 14_000_000);
  assert.equal(aapl.putPrem, 1_000_000);
  assert.equal(aapl.totalPrem, 15_000_000);
  assert.equal(aapl.otmCallPrem, 5_000_000); // 110 + 120 strikes only — the 50-strike ITM call is excluded
  assert.equal(aapl.otmPutPrem, 1_000_000);
  assert.equal(aapl.dirPrem, 6_000_000);
  assert.equal(aapl.unusualPrem, 6_000_000); // the ITM call had unusual:false
  assert.equal(aapl.lean, "calls"); // 5M OTM calls vs 1M OTM puts → ≥1.6× → calls
  assert.equal(aapl.strikesN, 4);
  assert.equal(aapl.topContracts[0].premium, 9_000_000); // biggest first
  assert.equal(aapl.topContracts[0].otm, false); // the ITM call
});

test("buildPositioning: lean is 'mixed' when neither OTM side dominates", () => {
  const entries: FlowEntryInput[] = [
    entry({ symbol: "X", type: "call", strike: 110, premium: 1_000_000, underlying: 100 }),
    entry({ symbol: "X", type: "put", strike: 90, premium: 900_000, underlying: 100 }),
  ];
  const [x] = buildPositioning(entries, {}, NOW);
  assert.equal(x.lean, "mixed"); // 1.0M vs 0.9M — under the 1.6× threshold
});

test("buildPositioning: tags the nearest forward catalyst (earnings this week beats a far PDUFA)", () => {
  const entries: FlowEntryInput[] = [entry({ symbol: "REGN", type: "call", strike: 110, premium: 5_000_000, underlying: 100 })];
  const rows = buildPositioning(
    entries,
    {
      earnings: [{ symbol: "REGN", name: "Regeneron", earningsDate: "2026-07-07", impliedMovePct: 6.5 }], // today
      biotech: [{ ticker: "REGN", statusKind: "pdufa", primaryCompletion: "2026-08-01" }], // ~25d
    },
    NOW,
  );
  const regn = rows.find((r) => r.symbol === "REGN")!;
  assert.equal(regn.catalyst?.kind, "earnings"); // nearest wins
  assert.equal(regn.catalyst?.daysTo, 0); // today, not dropped mid-session
  assert.equal(regn.catalyst?.impliedMovePct, 6.5);
});

test("buildCatalystIndex: honors the per-type windows (drops a too-far event)", () => {
  const idx = buildCatalystIndex(
    {
      earnings: [{ symbol: "FAR", earningsDate: "2026-07-30" }], // 23d > 14d earnings window → drop
      biotech: [{ ticker: "BIO", statusKind: "readout", primaryCompletion: "2026-08-10", phase: "Phase 3" }], // 34d ≤ 45 → keep
      investorDays: [{ ticker: "IVD", eventType: "Analyst day", eventDate: "2026-08-20" }], // 44d > 30 → drop
    },
    NOW,
  );
  assert.equal(idx.has("FAR"), false);
  assert.equal(idx.get("BIO")?.kind, "readout");
  assert.equal(idx.get("BIO")?.label, "Phase 3 readout");
  assert.equal(idx.has("IVD"), false);
});

test("rankPositioning: lenses reorder correctly", () => {
  const entries: FlowEntryInput[] = [
    entry({ symbol: "BULL", type: "call", strike: 110, premium: 4_000_000, underlying: 100, unusual: false }),
    entry({ symbol: "BEAR", type: "put", strike: 90, premium: 6_000_000, underlying: 100, unusual: false }),
    entry({ symbol: "NEW", type: "call", strike: 105, premium: 3_000_000, underlying: 100, unusual: true }),
  ];
  const rows = buildPositioning(entries, { earnings: [{ symbol: "NEW", earningsDate: "2026-07-09", impliedMovePct: 5 }] }, NOW);
  assert.equal(rankPositioning(rows, "premium")[0].symbol, "BEAR"); // biggest total
  assert.equal(rankPositioning(rows, "bullish")[0].symbol, "BULL"); // most OTM call premium
  assert.equal(rankPositioning(rows, "bearish")[0].symbol, "BEAR"); // most OTM put premium
  assert.equal(rankPositioning(rows, "unusual")[0].symbol, "NEW"); // only NEW is unusual
  assert.equal(rankPositioning(rows, "catalyst")[0].symbol, "NEW"); // only NEW has a catalyst
});

test("buildPositioning: empty entries → empty, no throw", () => {
  assert.deepEqual(buildPositioning([], {}, NOW), []);
  assert.deepEqual(buildPositioning([entry({ symbol: "Z", type: "call", strike: 100, premium: 0 })], {}, NOW), []); // 0 premium dropped
});
