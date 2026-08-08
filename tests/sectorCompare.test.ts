import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparison, type ComparisonItem } from "../lib/compute";

// Sector Compare (and any empty-intraday series, e.g. sector ETFs which carry NO intraday) must still
// render 1D and 1W by falling back to daily bars — the 2026-08 "1d/1w don't load" report. Names that
// DO carry intraday are unaffected (a separate assertion pins that).

const DAY = 86_400_000;
// Eight daily closes, one per day ending "today", rising 100→107.
const mkDaily = (now: number, closes: number[]) => closes.map((c, i) => ({ t: now - (closes.length - 1 - i) * DAY, c }));

test("1D falls back to the last two daily closes when intraday is empty", () => {
  const now = Date.parse("2026-08-06T20:00:00Z");
  const items: ComparisonItem[] = [{ symbol: "XLK", intraday: [], daily: mkDaily(now, [100, 101, 102, 103, 104, 105, 106, 110]) }];
  const { meta } = buildComparison(items, "1d", now);
  // last close 110 vs prior 106 = +3.77%, NOT null/zero.
  assert.ok(meta[0].endPct != null, "1D must produce a value from daily when intraday is empty");
  assert.ok(Math.abs(meta[0].endPct! - 3.77) < 0.05, `expected ≈+3.77%, got ${meta[0].endPct}`);
});

test("1W falls back to daily when intraday is empty", () => {
  const now = Date.parse("2026-08-06T20:00:00Z");
  const items: ComparisonItem[] = [{ symbol: "XLV", intraday: [], daily: mkDaily(now, [100, 100, 100, 101, 102, 103, 104, 105]) }];
  const { meta } = buildComparison(items, "1w", now);
  assert.ok(meta[0].endPct != null, "1W must produce a value from daily when intraday is empty");
  assert.ok(meta[0].endPct! > 0, `expected a positive 1w move, got ${meta[0].endPct}`);
});

test("a name WITH intraday still renders 1D (fallback is gated on empty intraday only)", () => {
  // Local-midnight-aligned so the session window is timezone-robust: prior close on the previous
  // local day, then two ticks today.
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const noonToday = d.getTime();
  const startToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const intraday = [
    { t: startToday - 6 * 3600_000, c: 200 }, // prior local day's close
    { t: startToday + 1 * 3600_000, c: 202 },
    { t: startToday + 3 * 3600_000, c: 206 },
  ];
  const items: ComparisonItem[] = [{ symbol: "AAPL", intraday, daily: mkDaily(noonToday, [190, 195, 200]) }];
  const { meta } = buildComparison(items, "1d", noonToday);
  assert.ok(meta[0].endPct != null, `intraday 1D must render, got ${meta[0].endPct}`);
});
