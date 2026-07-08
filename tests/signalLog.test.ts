import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickNewEntries, applyDueMarks, eventReturn, edgeOf, summarizeSignals, daysBetween,
  type SignalEvent,
} from "../lib/signalLog";

const ev = (o: Partial<SignalEvent> & { signal: SignalEvent["signal"]; symbol: string; date: string }): SignalEvent => ({
  id: `${o.signal}|${o.symbol}|${o.date}`, name: o.symbol, entryPrice: 100, spxEntry: 5000, marks: {}, ...o,
});

test("daysBetween: exact calendar days, UTC-pinned", () => {
  assert.equal(daysBetween("2026-07-07", "2026-07-07"), 0);
  assert.equal(daysBetween("2026-07-07", "2026-07-14"), 7);
  assert.equal(daysBetween("2026-06-30", "2026-07-07"), 7);
  assert.equal(daysBetween("2026-07-07", "2026-10-06"), 91);
});

test("pickNewEntries: first run seeds the whole board; later runs log only fresh appearances", () => {
  const cur = [{ symbol: "AAA", name: "A" }, { symbol: "BBB", name: "B" }];
  // first run: prevMembers undefined → everything logs, flagged seed
  const seeded = pickNewEntries("confluence", cur, undefined, undefined, [], "2026-07-07");
  assert.equal(seeded.length, 2);
  assert.ok(seeded.every((s) => s.seed));
  // next run: AAA stays (in prev), CCC appears → only CCC logs, not seed
  const next = pickNewEntries("confluence", [{ symbol: "AAA", name: "A" }, { symbol: "CCC", name: "C" }], ["AAA", "BBB"], { AAA: "2026-07-07", BBB: "2026-07-07" }, [], "2026-07-08");
  assert.deepEqual(next.map((x) => x.member.symbol), ["CCC"]);
  assert.equal(next[0].seed, false);
});

test("pickNewEntries: 30d cooldown stops churny re-logs; other signals unaffected", () => {
  const events = [ev({ signal: "confluence", symbol: "AAA", date: "2026-06-20" })]; // logged 17d ago
  // AAA reappears after a real 10d absence — still inside the 30d log cooldown → no re-log
  const r = pickNewEntries("confluence", [{ symbol: "AAA", name: "A" }], [], { AAA: "2026-06-27" }, events, "2026-07-07");
  assert.equal(r.length, 0);
  // but the SAME symbol on a DIFFERENT signal logs fine
  const r2 = pickNewEntries("warnings", [{ symbol: "AAA", name: "A" }], [], undefined, events, "2026-07-07");
  assert.equal(r2.length, 1);
  // and once both the cooldown and the absence threshold pass, it re-logs
  const r3 = pickNewEntries("confluence", [{ symbol: "AAA", name: "A" }], [], { AAA: "2026-07-01" }, events, "2026-07-21"); // logged 31d ago, absent 20d
  assert.equal(r3.length, 1);
});

test("pickNewEntries: a one-night dip off the board is a flicker, not a new signal (lastSeen guard)", () => {
  // AAA logged 45d ago, on the board continuously (lastSeen = yesterday), dips off ONE night, returns:
  // outside the 30d log-cooldown but absent only 1 day → must NOT duplicate-log.
  const events = [ev({ signal: "smartmoney", symbol: "AAA", date: "2026-05-24" })]; // 45d ago
  const flicker = pickNewEntries("smartmoney", [{ symbol: "AAA", name: "A" }], [], { AAA: "2026-07-07" }, events, "2026-07-08");
  assert.equal(flicker.length, 0);
  // absent a real 7+ days → genuine re-entry, logs
  const reentry = pickNewEntries("smartmoney", [{ symbol: "AAA", name: "A" }], [], { AAA: "2026-07-01" }, events, "2026-07-08");
  assert.equal(reentry.length, 1);
});

test("applyDueMarks: fills exactly the due horizons, skips missing prices, never overwrites", () => {
  const e = ev({ signal: "leaders", symbol: "AAA", date: "2026-07-07" });
  const prices = new Map([["AAA", 110]]);
  // day 6: nothing due
  assert.equal(applyDueMarks([e], prices, 5100, "2026-07-13"), 0);
  // day 7: 1w due, 1m/3m not
  assert.equal(applyDueMarks([e], prices, 5100, "2026-07-14"), 1);
  assert.deepEqual(e.marks.w1, { date: "2026-07-14", price: 110, spx: 5100 });
  assert.equal(e.marks.m1, undefined);
  // day 40: 1m fills; w1 NOT re-filled (already marked) and not overwritten
  prices.set("AAA", 120);
  assert.equal(applyDueMarks([e], prices, 5200, "2026-08-16"), 1);
  assert.equal(e.marks.w1!.price, 110);
  assert.equal(e.marks.m1!.price, 120);
});

test("applyDueMarks: a null S&P close defers the whole fill (no permanently benchmark-less marks)", () => {
  const e = ev({ signal: "leaders", symbol: "AAA", date: "2026-07-07" });
  const prices = new Map([["AAA", 110]]);
  assert.equal(applyDueMarks([e], prices, null, "2026-07-14"), 0); // spx fetch failed → nothing fills
  assert.equal(e.marks.w1, undefined);
  assert.equal(applyDueMarks([e], prices, 5100, "2026-07-15"), 1); // next night fills, one day late
  assert.equal(e.marks.w1!.spx, 5100);
});

test("applyDueMarks: a mark more than 14d late is never filled (a 5-month price is not a 1-week return)", () => {
  const zombie = ev({ signal: "leaders", symbol: "GONE", date: "2026-01-01" }); // 5 months overdue
  const prices = new Map([["GONE", 40]]);
  assert.equal(applyDueMarks([zombie], prices, 5100, "2026-06-01"), 0); // all horizons past grace → skip
  assert.deepEqual(zombie.marks, {});
  // but a mark inside the grace window still fills: w1 due day 7, filled day 14 (7+14 grace ok at 14d age? 14 <= 7+14 ✓)
  const late = ev({ signal: "leaders", symbol: "LATE", date: "2026-07-01" });
  assert.equal(applyDueMarks([late], new Map([["LATE", 50]]), 5100, "2026-07-15"), 1); // age 14, w1 only
  assert.equal(late.marks.w1!.price, 50);
  assert.equal(late.marks.m1, undefined);
});

test("eventReturn + edgeOf: bullish rewards excess, bearish rewards the inverse, move needs the benchmark", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-07", entryPrice: 100, spxEntry: 5000 });
  e.marks.w1 = { date: "2026-07-14", price: 105, spx: 5050 }; // stock +5%, spx +1%
  const r = eventReturn(e, "w1")!;
  assert.ok(Math.abs(r.ret - 0.05) < 1e-12);
  assert.ok(Math.abs(r.excess! - 0.04) < 1e-12);
  assert.ok(Math.abs(edgeOf("bullish", r)! - 0.04) < 1e-12);
  assert.ok(Math.abs(edgeOf("bearish", r)! - -0.04) < 1e-12); // a bearish signal that rose 5% is a loss
  assert.ok(Math.abs(edgeOf("move", r)! - 0.04) < 1e-12); // |5%| − |1%|
  const noSpx = { ret: 0.05, spxRet: null, excess: null };
  assert.equal(edgeOf("move", noSpx), null); // edge is benchmark-relative for EVERY direction —
  assert.equal(edgeOf("bullish", noSpx), null); // no benchmark → no edge (raw return would report
  assert.equal(edgeOf("bearish", noSpx), null); // pure market beta as "edge")
});

test("summarizeSignals: per-direction hit rates (bearish hit = the stock FELL) + bearish edge sign", () => {
  const up = ev({ signal: "warnings", symbol: "UP", date: "2026-06-01" });
  up.marks.w1 = { date: "2026-06-08", price: 110, spx: 5000 }; // +10%, flat S&P → bearish MISS, edge −0.10
  const dn = ev({ signal: "warnings", symbol: "DN", date: "2026-06-01" });
  dn.marks.w1 = { date: "2026-06-08", price: 90, spx: 5000 }; // −10%, flat S&P → bearish HIT, edge +0.10
  const s = summarizeSignals([up, dn]).find((x) => x.signal === "warnings")!;
  const h = s.horizons.w1!;
  assert.equal(h.n, 2);
  assert.equal(h.hitRate, 0.5);
  assert.ok(Math.abs(h.avgRet - 0) < 1e-12); // +10% and −10% average to 0 raw
  assert.ok(Math.abs(h.avgEdge! - 0) < 1e-12); // −0.10 and +0.10 edges average to 0
  assert.equal(s.open, 2); // no m3 marks yet
  // asymmetric case pins the bearish edge sign: only the faller → edge must be POSITIVE
  const only = summarizeSignals([dn]).find((x) => x.signal === "warnings")!.horizons.w1!;
  assert.ok(Math.abs(only.avgEdge! - 0.10) < 1e-12);
});

test("summarizeSignals: a tracked signal with zero events still gets a scorecard row", () => {
  const one = ev({ signal: "confluence", symbol: "AAA", date: "2026-06-01" });
  const rows = summarizeSignals([one]);
  const coiled = rows.find((x) => x.signal === "coiled");
  assert.ok(coiled, "coiled must appear even with no events");
  assert.equal(coiled!.events, 0);
  assert.deepEqual(coiled!.horizons, {});
});

test("summarizeSignals: move-direction hit = out-moved the index (benchmark-gated)", () => {
  const big = ev({ signal: "coiled", symbol: "BIG", date: "2026-06-01" });
  big.marks.w1 = { date: "2026-06-08", price: 92, spx: 5050 }; // |−8%| > |+1%| → HIT (direction-agnostic)
  const quiet = ev({ signal: "coiled", symbol: "QT", date: "2026-06-01" });
  quiet.marks.w1 = { date: "2026-06-08", price: 100.2, spx: 5050 }; // |0.2%| < |1%| → MISS
  const nobench = ev({ signal: "coiled", symbol: "NB", date: "2026-06-01", spxEntry: null });
  nobench.marks.w1 = { date: "2026-06-08", price: 150, spx: null }; // no benchmark → excluded from hit
  const s = summarizeSignals([big, quiet, nobench]).find((x) => x.signal === "coiled")!;
  const h = s.horizons.w1!;
  assert.equal(h.n, 3); // all three have returns
  assert.equal(h.hitN, 2); // but only two are hit-gradable
  assert.equal(h.hitRate, 0.5);
});

test("summarizeSignals: seed filter", () => {
  const seed = ev({ signal: "squeeze", symbol: "S1", date: "2026-06-01", seed: true });
  seed.marks.w1 = { date: "2026-06-08", price: 105, spx: 5000 };
  const fresh = ev({ signal: "squeeze", symbol: "S2", date: "2026-06-10" });
  fresh.marks.w1 = { date: "2026-06-17", price: 95, spx: 5000 };
  assert.equal(summarizeSignals([seed, fresh]).find((x) => x.signal === "squeeze")!.horizons.w1!.n, 2);
  assert.equal(summarizeSignals([seed, fresh], { includeSeed: false }).find((x) => x.signal === "squeeze")!.horizons.w1!.n, 1);
});
