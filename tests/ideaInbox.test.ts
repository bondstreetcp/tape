import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdeaInbox, boardWeights, NEUTRAL_WEIGHT } from "../lib/ideaInbox";
import type { SignalEvent, SignalSummary } from "../lib/signalLog";

// The inbox's contract: arrivals only (no seeds, window-gated), fused by name, weighted by the
// GRADED record (proven boards earn their edge, unproven get the neutral prior, negative floors
// at zero), and a bull+bear collision reads Contested instead of netting into a lie.

const NOW = Date.parse("2026-08-09T12:00:00Z");
const E = (signal: SignalEvent["signal"], symbol: string, date: string, over: Partial<SignalEvent> = {}): SignalEvent =>
  ({ id: `${signal}|${symbol}|${date}`, signal, symbol, name: symbol + " Inc", date, entryPrice: 100, spxEntry: 5000, marks: {}, ...over } as SignalEvent);
const SUM = (signal: SignalSummary["signal"], n: number, avgEdge: number | null): SignalSummary =>
  ({ signal, events: n, open: 0, horizons: { m1: n ? { n, avgRet: 0, medRet: 0, hitRate: 0.5, hitN: n, avgExcess: avgEdge, avgEdge } : undefined } } as SignalSummary);

const SUMMARIES = [
  SUM("confluence", 40, 2.5), // proven, weight 2.5
  SUM("warnings", 40, 1.2), // proven bearish board, positive EDGE
  SUM("leaders", 40, -0.8), // proven and NEGATIVE → floors at 0
  SUM("coiled", 3, 9.9), // n too small → unproven → neutral
];

test("boardWeights: proven edge, negative floor, unproven neutral", () => {
  const w = Object.fromEntries(boardWeights(SUMMARIES).map((x) => [x.signal, x]));
  assert.equal(w.confluence.weight, 2.5);
  assert.equal(w.leaders.weight, 0);
  assert.equal(w.coiled.weight, NEUTRAL_WEIGHT);
  assert.equal(w.coiled.n, 0, "unproven boards report n=0 so the page can say so");
});

test("fusion + window + seed exclusion + contested + score ordering", () => {
  const events: SignalEvent[] = [
    E("confluence", "AAA", "2026-08-09"), // today, proven board
    E("coiled", "AAA", "2026-08-08"), // second board, same name → fused
    E("confluence", "OLD", "2026-07-01"), // outside 14d → dropped
    E("confluence", "SEEDY", "2026-08-08", { seed: true }), // seed → never an arrival
    E("warnings", "BBB", "2026-08-09"), // bearish arrival
    E("confluence", "BBB", "2026-08-07"), // + bullish → contested
    E("leaders", "CCC", "2026-08-09"), // zero-weight board → score 0
  ];
  const inbox = buildIdeaInbox(events, SUMMARIES, { windowDays: 14, nowMs: NOW });
  const by = Object.fromEntries(inbox.rows.map((r) => [r.symbol, r]));
  assert.ok(!by.OLD && !by.SEEDY);
  assert.equal(by.AAA.arrivals.length, 2);
  assert.equal(by.AAA.direction, "bullish");
  assert.equal(by.BBB.direction, "contested");
  assert.equal(by.CCC.score, 0, "a negative-record board's arrival carries no weight");
  // Weights are evidence, not vibes: BBB carries TWO proven boards (warnings 1.2 today + confluence
  // 2.5 aged 2d ≈ 3.37) and outranks AAA's proven-plus-neutral pair (2.5 + 0.5 aged ≈ 2.97) even
  // though BBB is contested — the fused evidence ranks, the badge tells you it's disputed.
  assert.equal(inbox.rows[0].symbol, "BBB");
  assert.ok(by.BBB.score > by.AAA.score && by.AAA.score > by.CCC.score);
});

test("freshness decays the same board weight", () => {
  const events = [E("confluence", "NEW", "2026-08-09"), E("confluence", "STALE", "2026-07-28")];
  const inbox = buildIdeaInbox(events, SUMMARIES, { windowDays: 14, nowMs: NOW });
  const by = Object.fromEntries(inbox.rows.map((r) => [r.symbol, r]));
  assert.ok(by.NEW.score > by.STALE.score);
});
