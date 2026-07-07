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
