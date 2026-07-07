import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBinaryWeek } from "../lib/binaryWeek";

const NOW = Date.parse("2026-07-07T00:00:00Z");

test("buildBinaryWeek: merges feeds, ranks by impact, honors the horizon", () => {
  const ev = buildBinaryWeek(
    {
      earnings: [
        { symbol: "AAPL", name: "Apple", earningsDate: "2026-07-10", impliedMovePct: 5.2, sector: "Tech" }, // 3d, impact 5.2
        { symbol: "TSLA", name: "Tesla", earningsDate: "2026-07-11", impliedMovePct: 9.8 }, // 4d, impact 9.8
        { symbol: "OLD", name: "Old", earningsDate: "2026-07-01" }, // past → drop
      ],
      biotech: [
        { ticker: "PRAX", company: "Praxis", statusKind: "pdufa", primaryCompletion: "2026-07-12", drug: "relutrigine", condition: "DEEs" }, // 5d, priced below
        { ticker: "SRPT", company: "Sarepta", statusKind: "readout", primaryCompletion: "2026-07-09", phase: "Phase 3", drug: "SRP-9001" }, // 2d, no priced move → prior 40
        { ticker: "FAIL", company: "Fail Co", statusKind: "failed", primaryCompletion: "2026-07-08" }, // not a forward binary → drop
      ],
      biotechVol: [{ ticker: "PRAX", eventDate: "2026-07-12", impliedMovePct: 55 }], // PRAX priced ±55%
      investorDays: [{ ticker: "NVDA", company: "Nvidia", eventType: "Analyst day", eventDate: "2026-07-13", impliedMovePct: 4 }], // 6d
      lockups: [{ ticker: "FAROUT", company: "Far", kind: "lockup", lockupDate: "2027-01-01", ipoDate: "2026-07-05" }], // beyond horizon → drop
    },
    NOW,
    { horizonDays: 7 },
  );
  // Ranked by impact desc: PRAX 55, SRPT 40 (prior), TSLA 9.8, AAPL 5.2, NVDA 4
  assert.deepEqual(ev.map((e) => e.ticker), ["PRAX", "SRPT", "TSLA", "AAPL", "NVDA"]);
  assert.equal(ev[0].impliedMovePct, 55); // joined from biotechVol
  assert.equal(ev[0].hardBinary, true);
  assert.equal(ev[1].impliedMovePct, null); // SRPT unpriced → ranked on the readout prior
  assert.equal(ev[1].impact, 40);
  assert.equal(ev[2].kind, "earnings");
});

test("buildBinaryWeek: empty / missing feeds → empty, no throw", () => {
  assert.deepEqual(buildBinaryWeek({}, NOW), []);
  assert.deepEqual(buildBinaryWeek({ earnings: [], biotech: [] }, NOW, { horizonDays: 14 }), []);
});

test("buildBinaryWeek: a wider horizon lets more through", () => {
  const feeds = { earnings: [{ symbol: "X", name: "X", earningsDate: "2026-07-20", impliedMovePct: 7 }] }; // 13d out
  assert.equal(buildBinaryWeek(feeds, NOW, { horizonDays: 7 }).length, 0);
  assert.equal(buildBinaryWeek(feeds, NOW, { horizonDays: 21 }).length, 1);
});

test("buildBinaryWeek: mid-session NOW keeps today's event at daysTo=0 (no off-by-one drop)", () => {
  // The page passes Date.now() — a live instant. At 15:00 UTC (mid US session) an event dated today
  // must still be daysTo=0, not -1 (which the `daysTo < 0` filter would drop). Regression for the
  // floor-to-UTC-midnight fix.
  const midSession = Date.parse("2026-07-07T15:00:00Z");
  const feeds = {
    earnings: [
      { symbol: "TODAY", name: "Today Co", earningsDate: "2026-07-07", impliedMovePct: 8 }, // today
      { symbol: "TMRW", name: "Tomorrow Co", earningsDate: "2026-07-08", impliedMovePct: 6 }, // +1d
      { symbol: "D3", name: "Three Co", earningsDate: "2026-07-10", impliedMovePct: 4 }, // +3d
    ],
  };
  const ev = buildBinaryWeek(feeds, midSession, { horizonDays: 7 });
  const today = ev.find((e) => e.ticker === "TODAY");
  assert.ok(today, "today's event must not be dropped during market hours");
  assert.equal(today!.daysTo, 0);
  assert.equal(ev.find((e) => e.ticker === "TMRW")!.daysTo, 1);
  assert.equal(ev.find((e) => e.ticker === "D3")!.daysTo, 3);
});
