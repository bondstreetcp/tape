import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioCatalysts, eventImpact } from "../lib/portfolioCatalysts";
import type { CatalystEvent } from "../lib/catalystCalendar";

const ev = (o: Partial<CatalystEvent> & { ticker: string; daysTo: number; kind: CatalystEvent["kind"] }): CatalystEvent => ({
  date: "2026-08-01", company: o.ticker, label: o.kind, ...o,
} as CatalystEvent);

const CAL: CatalystEvent[] = [
  ev({ ticker: "AAPL", daysTo: 3, kind: "earnings", movePct: 8 }), // high (big move)
  ev({ ticker: "KO", daysTo: 10, kind: "earnings", movePct: 2 }), // low (small move)
  ev({ ticker: "MRNA", daysTo: 6, kind: "biotech" }), // high (binary)
  ev({ ticker: "ABNB", daysTo: 20, kind: "lockup" }), // medium
  ev({ ticker: "NVDA", daysTo: 150, kind: "earnings", movePct: 9 }), // beyond horizon
];

test("filters the calendar to owned names and tags the position side", () => {
  const r = buildPortfolioCatalysts([{ symbol: "AAPL", shares: 100 }, { symbol: "MRNA", shares: -50 }], CAL);
  assert.equal(r.catalysts.length, 2);
  const aapl = r.catalysts.find((c) => c.ticker === "AAPL")!;
  const mrna = r.catalysts.find((c) => c.ticker === "MRNA")!;
  assert.equal(aapl.side, "long");
  assert.equal(mrna.side, "short"); // negative shares → short (catalyst is directional risk against you)
  assert.equal(mrna.shares, 50); // absolute
});

test("soonest-first ordering, with impact breaking ties", () => {
  const cal = [ev({ ticker: "X", daysTo: 5, kind: "earnings", movePct: 1 }), ev({ ticker: "Y", daysTo: 5, kind: "biotech" })];
  const r = buildPortfolioCatalysts([{ symbol: "X", shares: 1 }, { symbol: "Y", shares: 1 }], cal);
  assert.deepEqual(r.catalysts.map((c) => c.ticker), ["Y", "X"]); // same day → high-impact biotech first
});

test("impact tiers: biotech binary=high, earnings scale with implied move, lockup=medium", () => {
  assert.equal(eventImpact(ev({ ticker: "A", daysTo: 1, kind: "biotech" })), "high");
  assert.equal(eventImpact(ev({ ticker: "A", daysTo: 1, kind: "earnings", movePct: 9 })), "high");
  assert.equal(eventImpact(ev({ ticker: "A", daysTo: 1, kind: "earnings", movePct: 5 })), "medium");
  assert.equal(eventImpact(ev({ ticker: "A", daysTo: 1, kind: "earnings", movePct: 2 })), "low");
  assert.equal(eventImpact(ev({ ticker: "A", daysTo: 1, kind: "lockup" })), "medium");
});

test("nets duplicate lots; a fully-hedged (0 net) name is skipped", () => {
  const r = buildPortfolioCatalysts([{ symbol: "AAPL", shares: 100 }, { symbol: "AAPL", shares: -100 }], CAL);
  assert.equal(r.totalOwned, 0);
  assert.equal(r.catalysts.length, 0);
  const net = buildPortfolioCatalysts([{ symbol: "AAPL", shares: 100 }, { symbol: "AAPL", shares: -40 }], CAL);
  assert.equal(net.catalysts.find((c) => c.ticker === "AAPL")!.side, "long"); // net +60
  assert.equal(net.catalysts.find((c) => c.ticker === "AAPL")!.shares, 60);
});

test("snapshot earnings supplement fills reporters beyond the ≤16d options feed", () => {
  const now = Date.UTC(2026, 6, 11); // fixed clock
  const iso = (days: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);
  const cal = [ev({ ticker: "AAPL", daysTo: 3, kind: "earnings", movePct: 8 })]; // AAPL already in the options feed
  const earningsDates = {
    AAPL: { date: iso(3), name: "Apple" }, // duplicate — must NOT double-count (options feed wins)
    NVDA: { date: iso(28), name: "NVIDIA" }, // 28d out → supplemented, medium (move unknown)
    TSLA: { date: iso(200), name: "Tesla", estimated: true }, // beyond horizon → dropped
  };
  const r = buildPortfolioCatalysts(
    [{ symbol: "AAPL", shares: 10 }, { symbol: "NVDA", shares: 10 }, { symbol: "TSLA", shares: 10 }],
    cal,
    { earningsDates, nowMs: now },
  );
  const aaplEarnings = r.catalysts.filter((c) => c.ticker === "AAPL" && c.kind === "earnings");
  assert.equal(aaplEarnings.length, 1); // not double-counted
  assert.equal(aaplEarnings[0].movePct, 8); // kept the options-feed version (has the implied move)
  const nvda = r.catalysts.find((c) => c.ticker === "NVDA")!;
  assert.equal(nvda.daysTo, 28);
  assert.equal(nvda.impact, "medium"); // scheduled print, move unknown
  assert.ok(!r.catalysts.some((c) => c.ticker === "TSLA")); // beyond horizon
  assert.deepEqual(r.quietNames, ["TSLA"]);
});

test("supplement floors 'now' to UTC midnight: a name reporting TODAY isn't dropped mid-session", () => {
  const midnight = Date.UTC(2026, 6, 11);
  const afternoon = midnight + 15 * 3_600_000; // 15:00Z — mid US session, same calendar day as midnight
  const today = new Date(midnight).toISOString().slice(0, 10);
  const in30 = new Date(midnight + 30 * 86_400_000).toISOString().slice(0, 10);
  const r = buildPortfolioCatalysts(
    [{ symbol: "AAPL", shares: 10 }, { symbol: "NVDA", shares: 10 }],
    [], // no options-feed events — both come from the snapshot supplement (the buggy path)
    { earningsDates: { AAPL: { date: today, name: "Apple" }, NVDA: { date: in30, name: "NVIDIA" } }, nowMs: afternoon },
  );
  const aapl = r.catalysts.find((c) => c.ticker === "AAPL");
  assert.ok(aapl, "a name reporting today is still surfaced during market hours");
  assert.equal(aapl!.daysTo, 0); // today → 0, not −1 (which would drop it)
  assert.equal(r.catalysts.find((c) => c.ticker === "NVDA")!.daysTo, 30); // 30d out, not 29
  assert.deepEqual(r.quietNames, []); // neither counts as 'quiet'
});

test("horizon drops far-dated events; quiet names + summary counts are reported", () => {
  const r = buildPortfolioCatalysts(
    [{ symbol: "AAPL", shares: 1 }, { symbol: "MRNA", shares: 1 }, { symbol: "NVDA", shares: 1 }, { symbol: "TSLA", shares: 1 }],
    CAL,
  );
  assert.equal(r.totalOwned, 4);
  assert.equal(r.ownedWithCatalysts, 2); // AAPL + MRNA (NVDA beyond horizon, TSLA has none)
  assert.deepEqual(r.quietNames, ["NVDA", "TSLA"]); // NVDA's only event is >120d out → counts as quiet
  assert.equal(r.highNext30, 2); // AAPL earnings (8%) @3d + MRNA biotech @6d
});
