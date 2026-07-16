import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickNewEntries, applyDueMarks, eventReturn, edgeOf, summarizeSignals, summarizeTags, joinFlagged,
  applySplitsToEvent, daysBetween,
  type SignalEvent, type SignalLogFile,
} from "../lib/signalLog";
import type { SplitEvent } from "../lib/splits";

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

test("summarizeTags: per-kind attribution — multi-tag entries count toward each kind, untagged excluded", () => {
  // Two tagged confluence entries + one legacy untagged one (pre-2026-07-12 log format).
  const a = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-12", tags: ["value", "insider"] });
  a.marks.w1 = { date: "2026-07-19", price: 105, spx: 5000 }; // +5% vs flat S&P → edge +0.05
  const b = ev({ signal: "confluence", symbol: "BBB", date: "2026-07-12", tags: ["value"] });
  b.marks.w1 = { date: "2026-07-19", price: 95, spx: 5000 }; // −5% vs flat → edge −0.05
  const legacy = ev({ signal: "confluence", symbol: "OLD", date: "2026-07-08" }); // no tags
  legacy.marks.w1 = { date: "2026-07-15", price: 200, spx: 5000 }; // must NOT pollute any kind

  const mix = summarizeTags([a, b, legacy], "confluence");
  assert.deepEqual(mix.map((t) => t.tag), ["value", "insider"]); // sorted by entry count desc
  const value = mix.find((t) => t.tag === "value")!;
  assert.equal(value.events, 2); // AAA + BBB carry it
  assert.ok(Math.abs(value.horizons.w1!.avgEdge! - 0) < 1e-12); // +0.05 and −0.05 average out
  const insider = mix.find((t) => t.tag === "insider")!;
  assert.equal(insider.events, 1); // only AAA
  assert.ok(Math.abs(insider.horizons.w1!.avgEdge! - 0.05) < 1e-12);
  assert.equal(insider.horizons.w1!.hitRate, 1); // AAA rose
  // a different signal's events never leak in
  assert.deepEqual(summarizeTags([a, b], "warnings"), []);
});

test("summarizeTags: direction comes from the SIGNAL (warnings tags grade bearish) + seed filter", () => {
  const w = ev({ signal: "warnings", symbol: "DN", date: "2026-07-12", tags: ["distribution"] });
  w.marks.w1 = { date: "2026-07-19", price: 90, spx: 5000 }; // fell 10%, flat S&P → bearish WIN
  const mix = summarizeTags([w], "warnings");
  assert.ok(Math.abs(mix[0].horizons.w1!.avgEdge! - 0.10) < 1e-12); // edge positive for a bearish hit
  assert.equal(mix[0].horizons.w1!.hitRate, 1);
  // seed exclusion mirrors the scorecard's checkbox
  const seeded = ev({ signal: "warnings", symbol: "S", date: "2026-07-12", tags: ["distribution"], seed: true });
  assert.equal(summarizeTags([w, seeded], "warnings")[0].events, 2);
  assert.equal(summarizeTags([w, seeded], "warnings", { includeSeed: false })[0].events, 1);
});

test("summarizeTags: a duplicated tag inside one event never double-counts it", () => {
  const e = ev({ signal: "confluence", symbol: "DUP", date: "2026-07-12", tags: ["value", "value"] });
  e.marks.w1 = { date: "2026-07-19", price: 105, spx: 5000 };
  const mix = summarizeTags([e], "confluence");
  assert.equal(mix.length, 1);
  assert.equal(mix[0].events, 1); // not 2
  assert.equal(mix[0].open, 1); // no m3 yet → open
  assert.equal(mix[0].horizons.w1!.n, 1);
});

test("joinFlagged: latest stint wins, NEW only for non-seeds on the latest run, legacy logs degrade", () => {
  const log = (events: SignalEvent[], lastSeen?: SignalLogFile["lastSeen"]): SignalLogFile =>
    ({ generatedAt: "", since: "2026-07-08", events, lastMembership: {}, lastSeen });
  const seedEv = ev({ signal: "confluence", symbol: "SEED", date: "2026-07-08", entryPrice: 50, seed: true });
  const oldEv = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 100 });
  const reEv = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-12", entryPrice: 120 }); // re-entry
  const stale = ev({ signal: "confluence", symbol: "BBB", date: "2026-07-09", entryPrice: 80 });
  const zero = ev({ signal: "confluence", symbol: "ZERO", date: "2026-07-12", entryPrice: 0 }); // unpriceable
  const wrongSig = ev({ signal: "warnings", symbol: "AAA", date: "2026-07-12", entryPrice: 999 });
  const seen = { confluence: { AAA: "2026-07-12", BBB: "2026-07-12", SEED: "2026-07-12" } };
  const syms = new Set(["AAA", "BBB", "SEED", "ZERO", "MISSING"]);

  const f = joinFlagged(log([seedEv, oldEv, reEv, stale, zero, wrongSig], seen), "confluence", syms)!;
  assert.equal(f.AAA.date, "2026-07-12"); // the LATEST stint, not the July 1 entry
  assert.equal(f.AAA.entryPrice, 120); // measures from the re-entry price
  assert.equal(f.AAA.isNew, true); // dated on the latest run (max lastSeen = 07-12)
  assert.equal(f.BBB.isNew, false); // logged on an earlier run
  assert.equal(f.SEED.isNew, false); // seeds never badge as NEW
  assert.equal(f.SEED.seed, true);
  assert.ok(!("ZERO" in f)); // entryPrice must be > 0
  assert.ok(!("MISSING" in f)); // never logged → no entry (view shows a plain card)
  // a warnings event never leaks into a confluence join
  assert.equal(f.AAA.entryPrice, 120);

  // legacy log without lastSeen (older file format): everything joins, nothing is NEW
  const legacy = joinFlagged(log([oldEv]), "confluence", new Set(["AAA"]))!;
  assert.equal(legacy.AAA.isNew, false);
  // nothing relevant in the log → null (view degrades wholesale)
  assert.equal(joinFlagged(log([wrongSig], seen), "confluence", new Set(["NOPE"])), null);
});

// ── split re-base ────────────────────────────────────────────────────────────────────────────────
// priceMult brings PRE-split prices onto the post-split basis (lib/splits): forward 10:1 → 0.1.
const dayMs = (d: string) => Date.parse(d + "T00:00:00Z");
const fwd10 = (d: string): SplitEvent => ({ date: dayMs(d), priceMult: 0.1 }); // 10-for-1
const rev2 = (d: string): SplitEvent => ({ date: dayMs(d), priceMult: 2 }); // 1-for-2 reverse

test("splits: a 10:1 AFTER the entry re-bases entryPrice (the '−90% since flagged' bug)", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 500 });
  const moved = applySplitsToEvent(e, [fwd10("2026-07-20")]);
  assert.equal(moved, 1);
  assert.equal(e.entryPrice, 50); // 500 pre-split ⇒ 50 on today's basis
  // the card would now read ~flat against a $52 live price, not −90%
  assert.deepEqual(e.splitAdj, [dayMs("2026-07-20")]);
});

test("splits: IDEMPOTENT — the nightly re-run must not adjust twice", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 500 });
  applySplitsToEvent(e, [fwd10("2026-07-20")]);
  const after1 = e.entryPrice;
  for (let i = 0; i < 5; i++) applySplitsToEvent(e, [fwd10("2026-07-20")]); // five more nights
  assert.equal(e.entryPrice, after1, "re-running must be a no-op");
  assert.equal(e.entryPrice, 50);
});

test("splits: a mark filled BETWEEN entry and the split is re-based; the RETURN stays true", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 500, spxEntry: 5000 });
  e.marks.w1 = { date: "2026-07-08", price: 550, spx: 5050 }; // +10% pre-split
  applySplitsToEvent(e, [fwd10("2026-07-20")]);
  assert.equal(e.entryPrice, 50);
  assert.equal(e.marks.w1!.price, 55); // both legs moved ⇒ ratio preserved
  const r = eventReturn(e, "w1")!;
  assert.ok(Math.abs(r.ret - 0.1) < 1e-12, "the +10% week must survive the split untouched");
});

test("splits: a mark taken AFTER the split is left alone (it's already post-split)", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 500 });
  applySplitsToEvent(e, [fwd10("2026-07-20")]); // fold it in first (entry → 50)
  // next night applyDueMarks fills w1 with a POST-split price; the split is already recorded as done
  e.marks.w1 = { date: "2026-07-22", price: 55, spx: 5050 };
  applySplitsToEvent(e, [fwd10("2026-07-20")]);
  assert.equal(e.marks.w1!.price, 55, "a post-split mark must not be scaled again");
  const r = eventReturn(e, "w1")!;
  assert.ok(Math.abs(r.ret - 0.1) < 1e-12);
});

test("splits: one BEFORE the entry changes nothing (both legs already post-split)", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 50 });
  e.marks.w1 = { date: "2026-07-08", price: 55, spx: 5050 };
  const moved = applySplitsToEvent(e, [fwd10("2026-06-01")]);
  assert.equal(moved, 0);
  assert.equal(e.entryPrice, 50);
  assert.equal(e.marks.w1!.price, 55);
});

test("splits: effective ON the entry date is NOT applied (that close is already post-split)", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-20", entryPrice: 50 });
  const moved = applySplitsToEvent(e, [fwd10("2026-07-20")]);
  assert.equal(moved, 0, "strictly-after: the evening's logged close already reflects the split");
  assert.equal(e.entryPrice, 50);
});

test("splits: reverse split scales UP; trivial ratios are ignored", () => {
  const e = ev({ signal: "warnings", symbol: "RVS", date: "2026-07-01", entryPrice: 3 });
  applySplitsToEvent(e, [rev2("2026-07-10")]);
  assert.equal(e.entryPrice, 6); // 1-for-2 ⇒ $3 becomes $6
  // a ~1.0 ratio is a data artifact, not a split
  const e2 = ev({ signal: "warnings", symbol: "NOP", date: "2026-07-01", entryPrice: 100 });
  assert.equal(applySplitsToEvent(e2, [{ date: dayMs("2026-07-10"), priceMult: 1.02 }]), 0);
  assert.equal(e2.entryPrice, 100);
});

test("splits: several splits compound, and no splits is a clean no-op", () => {
  const e = ev({ signal: "confluence", symbol: "AAA", date: "2026-07-01", entryPrice: 500 });
  applySplitsToEvent(e, [fwd10("2026-07-10"), rev2("2026-07-20")]); // ×0.1 then ×2
  assert.ok(Math.abs(e.entryPrice - 100) < 1e-9);
  const clean = ev({ signal: "confluence", symbol: "BBB", date: "2026-07-01", entryPrice: 42 });
  assert.equal(applySplitsToEvent(clean, []), 0);
  assert.equal(clean.entryPrice, 42);
  assert.equal(clean.splitAdj, undefined, "no splits ⇒ no bookkeeping noise on the event");
});

test("summarizeSignals: seed filter", () => {
  const seed = ev({ signal: "squeeze", symbol: "S1", date: "2026-06-01", seed: true });
  seed.marks.w1 = { date: "2026-06-08", price: 105, spx: 5000 };
  const fresh = ev({ signal: "squeeze", symbol: "S2", date: "2026-06-10" });
  fresh.marks.w1 = { date: "2026-06-17", price: 95, spx: 5000 };
  assert.equal(summarizeSignals([seed, fresh]).find((x) => x.signal === "squeeze")!.horizons.w1!.n, 2);
  assert.equal(summarizeSignals([seed, fresh], { includeSeed: false }).find((x) => x.signal === "squeeze")!.horizons.w1!.n, 1);
});
