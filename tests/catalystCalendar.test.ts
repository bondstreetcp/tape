import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalystCalendar, type CatalystEvent } from "../lib/catalystCalendar";

const NOW = Date.parse("2026-07-04T00:00:00Z");

test("buildCatalystCalendar: merges feeds, drops past/beyond-horizon, sorts by soonest", () => {
  const events = buildCatalystCalendar(
    {
      earnings: { rows: [
        { symbol: "AAPL", name: "Apple", sector: "Tech", earningsDate: "2026-07-09", impliedMovePct: 5.2 }, // in 5d
        { symbol: "OLD", name: "Old Co", earningsDate: "2026-07-01" }, // past → drop
      ] },
      investorDays: { rows: [{ ticker: "NVDA", company: "Nvidia", eventType: "Analyst day", eventDate: "2026-08-01", impliedMovePct: 4 }] }, // ~28d
      biotech: { rows: [
        { ticker: "SRPT", company: "Sarepta", drug: "SRP-9001", condition: "DMD", phase: "Phase 3", primaryCompletion: "2026-09-01" }, // ~59d
        { ticker: "AXSM", company: "Axsome", drug: "AXS-14", condition: "fibromyalgia", phase: "NDA", statusKind: "pdufa", primaryCompletion: "2026-10-15" }, // ~103d — PDUFA row
      ] },
      lockups: { events: [{ ticker: "FAR", company: "Far Out", lockupDate: "2027-02-01", ipoDate: "2026-08-05", sizeUsdM: 120 }] }, // ~212d → drop (>120)
    },
    NOW,
    { horizonDays: 120 },
  );
  const syms = events.map((e) => e.ticker);
  assert.deepEqual(syms, ["AAPL", "NVDA", "SRPT", "AXSM"]); // OLD (past) + FAR (beyond horizon) dropped, sorted soonest-first
  const aapl = events[0] as CatalystEvent;
  assert.equal(aapl.kind, "earnings");
  assert.equal(aapl.daysTo, 5);
  assert.equal(aapl.detail, "implied ±5.2%");
  assert.equal(events[2].label, "Phase 3 readout");
  assert.equal(events[2].detail, "SRP-9001 · DMD");
  assert.equal(events[3].label, "FDA decision (PDUFA)"); // pdufa row's phase (NDA) must NOT render as "NDA readout"
  assert.equal(events[3].detail, "AXS-14 · fibromyalgia");
});

test("buildCatalystCalendar: honors horizon + tolerates missing/empty feeds", () => {
  const wide = buildCatalystCalendar(
    { lockups: { events: [{ ticker: "FAR", company: "Far", lockupDate: "2027-02-01", ipoDate: "2026-08-05", sizeUsdM: 120 }] } },
    NOW,
    { horizonDays: 400 },
  );
  assert.equal(wide.length, 1); // now inside the wider horizon
  assert.equal(wide[0].kind, "lockup");
  assert.match(wide[0].detail ?? "", /IPO 2026-08-05 · \$120M/);
  assert.deepEqual(buildCatalystCalendar({}, NOW), []); // all feeds missing → empty, no throw
  assert.deepEqual(buildCatalystCalendar({ earnings: null, biotech: { rows: [] } }, NOW), []);
});
