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

test("1D MIXED population: a daily-fallback series must not stretch the shared axis left of the session", () => {
  // The 2026-08-15 fan bug: 8 sector ETFs had their intraday clobbered to [] (refresh-hedge-etfs)
  // while 3 kept dense bars. The fallback's [priorClose, lastClose] admitted a PRIOR-session bar
  // onto the shared axis — every sparse series drew a straight line from the chart's left edge.
  // Post-fix: the prior bar stays as the % BASELINE but is dropped from the RENDER, so the sparse
  // series contributes only its in-session point and the axis spans just the session.
  const d = new Date(); d.setHours(14, 0, 0, 0);
  const now = d.getTime();
  const sessionStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dense: ComparisonItem = {
    symbol: "XLC",
    intraday: [
      { t: sessionStart + 10 * 3600_000, c: 100 },
      { t: sessionStart + 12 * 3600_000, c: 101 },
      { t: sessionStart + 14 * 3600_000, c: 102 },
    ],
    daily: mkDaily(now, [98, 99, 100]),
  };
  const sparse: ComparisonItem = {
    symbol: "XLK",
    intraday: [], // clobbered/absent intraday → daily fallback
    daily: [
      { t: sessionStart - 3 * DAY + 13.5 * 3600_000, c: 100 }, // prior session (a "Friday")
      { t: sessionStart + 13.5 * 3600_000, c: 104 }, // today's bar
    ],
  };
  const { rows, meta } = buildComparison([dense, sparse], "1d", now);
  // The sparse series' endPct is still measured from the PRIOR close (+4%)…
  assert.ok(Math.abs(meta[1].endPct! - 4) < 0.05, `sparse endPct should be ≈+4%, got ${meta[1].endPct}`);
  // …but no rendered row may predate the shared session start (the axis must not stretch back).
  assert.ok(rows.every((r) => r.t >= sessionStart), "no row may predate the shared session start");
  // And the sparse series still contributes its in-session point (visible as a dot, not invisible).
  assert.ok(rows.some((r) => r["XLK"] !== undefined), "sparse series must still contribute a point");
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
