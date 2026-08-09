import { test } from "node:test";
import assert from "node:assert/strict";
import { sortEvents, orderNames, shortsEvent, borrowEvent, estimateEvent, flowEvent, rankOf, type LedgerEvent, type LedgerName } from "../lib/myNamesLedger";

// The ledger's ordering IS the monitoring product: the scan must start at the most actionable
// change, and the thresholds decide what earns a line at all — both pinned here.

const E = (kind: LedgerEvent["kind"], ts: string): LedgerEvent => ({ kind, ts, title: kind });
const N = (symbol: string, events: LedgerEvent[] = [], pct1d: number | null = null): LedgerName => ({ symbol, name: null, pct1d, events });

test("sortEvents: kind rank first (reported before headline), recency inside a rank", () => {
  const out = sortEvents([
    E("headline", "2026-08-08"),
    E("filing", "2026-08-06"),
    E("filing", "2026-08-08"),
    E("reported", "2026-08-06"),
  ]).map((e) => `${e.kind}:${e.ts}`);
  assert.deepEqual(out, ["reported:2026-08-06", "filing:2026-08-08", "filing:2026-08-06", "headline:2026-08-08"]);
});

test("orderNames: best event rank leads, |1d| breaks ties, eventless names sink", () => {
  const out = orderNames([
    N("QUIET", [], 9.0), // no events — sinks despite the big move
    N("NEWSY", [E("headline", "2026-08-08")], 0.5),
    N("PRINT", [E("reported", "2026-08-08")], 0.1),
    N("DEALCO", [E("deal", "2026-07-01")], null),
    N("MOVER", [E("headline", "2026-08-08")], -4.0),
  ]).map((n) => n.symbol);
  assert.deepEqual(out, ["PRINT", "DEALCO", "MOVER", "NEWSY", "QUIET"]);
  assert.ok(rankOf("reported") < rankOf("deal") && rankOf("deal") < rankOf("headline"));
});

test("shortsEvent: fires on 60%+ short volume or $1M+ FTDs, silent below", () => {
  assert.ok(shortsEvent({ latestShortVolPct: 65 }));
  assert.ok(shortsEvent({ ftdUsd: 1_500_000 })!.detail.includes("$1.5M"));
  assert.equal(shortsEvent({ latestShortVolPct: 45, ftdUsd: 400_000 }), null);
  assert.equal(shortsEvent(null), null);
});

test("borrowEvent: fee ≥1% or availability <100K; general-collateral names stay silent", () => {
  assert.ok(borrowEvent({ fee: 4.2, available: 5_000_000 })!.detail.includes("4.2%"));
  assert.ok(borrowEvent({ fee: 0.3, available: 40_000 })!.detail.includes("40K"));
  assert.equal(borrowEvent({ fee: 0.25, available: 8_000_000 }), null);
});

test("estimateEvent: needs real revision activity (≥3 one way, or a clean 2:0); 1↑/1↓ is noise", () => {
  assert.ok(estimateEvent({ epsUp30d: 4, epsDown30d: 1 })!.title.includes("UP"));
  assert.ok(estimateEvent({ epsUp30d: 0, epsDown30d: 3 })!.title.includes("DOWN"));
  assert.ok(estimateEvent({ epsUp30d: 2, epsDown30d: 0 }));
  assert.equal(estimateEvent({ epsUp30d: 1, epsDown30d: 1 }), null);
  assert.equal(estimateEvent(null), null);
});

test("flowEvent: $1M single line or $2M aggregate; small premium is silent", () => {
  assert.ok(flowEvent([{ type: "put", strike: 800, expiry: "2026-08-21", premium: 1_200_000 }])!.detail.includes("$1.2M"));
  assert.ok(flowEvent([{ premium: 900_000 }, { premium: 800_000 }, { premium: 600_000 }])!.detail.includes("across 3 lines"));
  assert.equal(flowEvent([{ premium: 400_000 }]), null);
  assert.equal(flowEvent([]), null);
});
