import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveIpoMetrics } from "../lib/ipoFinancials";

// Valuation math for the IPO deep-dive. Numbers are Reddit-like (revenue 1.3B→2.2B, GP via COGS).
test("deriveIpoMetrics: growth, margins, P/S from the annual series + market cap", () => {
  const m = deriveIpoMetrics({
    years: [
      { year: "2023", revenue: 804_000_000, grossProfit: 693_000_000, netIncome: -90_800_000 },
      { year: "2024", revenue: 1_300_000_000, grossProfit: 1_176_000_000, netIncome: -484_000_000 },
      { year: "2025", revenue: 2_202_000_000, grossProfit: 2_008_000_000, netIncome: 529_000_000 },
    ],
    cash: 954_000_000,
    debt: null,
    sharesOutstanding: 200_000_000,
    price: 200, // → $40B market cap
  });
  assert.equal(m.revenue, 2_202_000_000);
  assert.equal(m.revenueGrowthPct, 69.4); // (2202-1300)/1300
  assert.equal(m.grossMarginPct, 91.2); // 2008/2202
  assert.equal(m.netMarginPct, 24.0); // 529/2202
  assert.equal(m.profitable, true);
  assert.equal(m.marketCap, 40_000_000_000);
  assert.equal(m.priceToSales, 18.2); // 40B / 2.2B
  assert.equal(m.years.length, 3);
});

test("deriveIpoMetrics: no market cap → null P/S, still computes fundamentals", () => {
  const m = deriveIpoMetrics({
    years: [
      { year: "2024", revenue: 100_000_000, grossProfit: 40_000_000, netIncome: -20_000_000 },
      { year: "2025", revenue: 150_000_000, grossProfit: 60_000_000, netIncome: -10_000_000 },
    ],
    cash: 50_000_000, debt: 10_000_000, sharesOutstanding: null, price: null,
  });
  assert.equal(m.revenueGrowthPct, 50);
  assert.equal(m.grossMarginPct, 40);
  assert.equal(m.profitable, false);
  assert.equal(m.marketCap, null);
  assert.equal(m.priceToSales, null);
});

test("deriveIpoMetrics: empty series is null-safe", () => {
  const m = deriveIpoMetrics({ years: [], cash: null, debt: null, sharesOutstanding: null, price: null });
  assert.equal(m.revenue, null);
  assert.equal(m.revenueGrowthPct, null);
  assert.equal(m.profitable, null);
});
