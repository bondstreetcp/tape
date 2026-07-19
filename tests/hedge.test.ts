import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHedge } from "../lib/hedge";
import type { FactorTilt } from "../lib/factors";

const tilt = (key: FactorTilt["key"], t: number, coverage = 1): FactorTilt => ({ key, label: key, tilt: t, coverage });

test("buildHedge: market leg exact, top style legs sized ~|tilt|·gross", () => {
  const tilts: FactorTilt[] = [ // pre-sorted by |tilt| desc, as computeFactorTilts returns
    tilt("momentum", 1.5),
    tilt("value", -0.8),
    tilt("quality", 0.3), // below minTilt → skipped
  ];
  const legs = buildHedge(tilts, 1_000_000, 5_000_000);
  assert.equal(legs[0].etf, "SPY");
  assert.equal(legs[0].action, "Short");
  assert.equal(legs[0].notional, 1_000_000); // exact = Σ value·β
  assert.equal(legs[0].exact, true);
  const mtum = legs.find((l) => l.etf === "MTUM")!;
  assert.equal(mtum.action, "Short"); // +momentum tilt → short MTUM to cut it
  assert.equal(mtum.notional, 1.5 * 5_000_000);
  const vlue = legs.find((l) => l.etf === "VLUE")!;
  assert.equal(vlue.action, "Buy"); // −value tilt → buy VLUE
  assert.equal(vlue.notional, 0.8 * 5_000_000);
  assert.equal(legs.some((l) => l.etf === "QUAL"), false); // 0.3σ < 0.5σ threshold
});

test("buildHedge: no market leg when ~beta-neutral; caps style legs", () => {
  const tilts: FactorTilt[] = [tilt("momentum", 2), tilt("value", 1.5), tilt("growth", 1.2), tilt("yield", 1)];
  const legs = buildHedge(tilts, 1000, 10_000_000, { maxLegs: 2 }); // beta $1k on $10M gross = 0.01% → skip
  assert.equal(legs.some((l) => l.etf === "SPY"), false);
  assert.equal(legs.length, 2); // capped
  assert.deepEqual(legs.map((l) => l.etf), ["MTUM", "VLUE"]);
});

test("buildHedge: skips factors with no coverage or no ETF proxy", () => {
  const legs = buildHedge([tilt("size", 2), tilt("momentum", 1, 0)], null, 1_000_000);
  assert.equal(legs.length, 0); // size has no proxy; momentum has 0 coverage
});
