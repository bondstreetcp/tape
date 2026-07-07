import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSmartMoneySell } from "../lib/smartMoneySell";
import type { SuperInvestorsData } from "../lib/superinvestors";

const inv = (manager: string, soldOut: string[], trims: [string, number][]): any => ({
  slug: manager, name: manager, manager, cik: "1", asOf: "2026-03-31", filedAt: "", priorAsOf: "2025-12-31",
  totalValue: 0, count: 0, holdings: [], newBuys: [], topAdds: [],
  soldOut: soldOut.map((t) => ({ ticker: t, name: t, cusip: t })),
  topTrims: trims.map(([t, d]) => ({ ticker: t, name: t, deltaPct: d })),
});

const si = (): SuperInvestorsData => ({
  generatedAt: "2026-05-15T00:00:00Z",
  investors: [
    inv("A", ["XYZ"], [["ABC", -0.4]]), // deltaPct is a FRACTION (−0.4 = −40% trimmed)
    inv("B", ["XYZ"], [["ABC", -0.6]]),
    inv("C", [], [["XYZ", -0.3]]), // also trimmed XYZ → but two others EXITED it
    inv("D", ["LONE"], []), // only one manager → below the ≥2 bar
  ],
  mostOwned: [],
});

test("buildSmartMoneySell: aggregates exits/trims, requires ≥2 managers, ranks by score", () => {
  const ctx = new Map<string, any>([
    ["XYZ", { name: "Xyz Corp", sector: "Tech", marketCap: 5e9, price: 10, returns: { ytd: -20 }, pctFromHigh: -35 }],
    ["ABC", { name: "Abc Inc", sector: "Health", marketCap: 2e9, price: 20, returns: { ytd: 12 }, pctFromHigh: -5 }],
  ]);
  const rows = buildSmartMoneySell(si(), ctx);
  const syms = rows.map((r) => r.symbol);
  assert.ok(syms.includes("XYZ") && syms.includes("ABC"));
  assert.ok(!syms.includes("LONE")); // one manager only → excluded

  const xyz = rows.find((r) => r.symbol === "XYZ")!;
  assert.equal(xyz.exitedN, 2); // A + B sold out
  assert.equal(xyz.trimmedN, 1); // C trimmed
  assert.equal(xyz.tone, "capitulation"); // YTD −20% → selling into weakness
  assert.ok(xyz.score >= 5); // 2×2 (exits) + 1 (trim) + magnitude bonus

  const abc = rows.find((r) => r.symbol === "ABC")!;
  assert.equal(abc.exitedN, 0);
  assert.equal(abc.trimmedN, 2);
  assert.equal(abc.tone, "profit-taking"); // YTD +12% → into strength
  // XYZ (2 exits) outranks ABC (2 trims)
  assert.equal(rows[0].symbol, "XYZ");
});

test("buildSmartMoneySell: a manager who both trimmed and exited counts once as 'exited'", () => {
  const data: SuperInvestorsData = {
    generatedAt: "", investors: [inv("A", ["DUP"], [["DUP", -0.5]]), inv("B", ["DUP"], [])], mostOwned: [],
  };
  const rows = buildSmartMoneySell(data, new Map());
  const dup = rows.find((r) => r.symbol === "DUP")!;
  assert.equal(dup.exitedN, 2);
  assert.equal(dup.trimmedN, 0); // A's trim is subsumed by A's exit
  assert.equal(dup.sellers.length, 2);
});

test("buildSmartMoneySell: null/empty is safe", () => {
  assert.deepEqual(buildSmartMoneySell(null, new Map()), []);
});
