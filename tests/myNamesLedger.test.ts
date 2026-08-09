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

// ── P2: the union composition (lib/myNames.composeMyNames — pure) ──

test("composeMyNames: book first with net side, watch-only after, both-sources tagged, zero-net book lines drop", async () => {
  const { composeMyNames } = await import("../lib/myNames");
  const out = composeMyNames(
    ["eat", "KVUE", "FLAT"],
    [
      { symbol: "NVDA", shares: 100 },
      { symbol: "nvda", shares: 50 }, // dupes net
      { symbol: "KVUE", shares: -200 }, // in both lists → book side wins, both sources
      { symbol: "FLAT", shares: 100 },
      { symbol: "FLAT", shares: -100 }, // nets to zero → drops from the book, stays via watch
    ],
  );
  const by = Object.fromEntries(out.map((n) => [n.symbol, n]));
  assert.deepEqual(by.NVDA, { symbol: "NVDA", sources: ["book"], side: "long" });
  assert.deepEqual(by.KVUE, { symbol: "KVUE", sources: ["book", "watch"], side: "short" });
  assert.deepEqual(by.FLAT, { symbol: "FLAT", sources: ["watch"], side: null });
  assert.deepEqual(by.EAT, { symbol: "EAT", sources: ["watch"], side: null });
  assert.deepEqual(out.slice(0, 2).map((n) => n.sources[0]), ["book", "book"], "book names lead");
});

// ── accounts unshelving: the prefs merge doctrine ──

test("mergePrefs: cloud wins where present, local fills empty cloud columns (and uploads the fill)", async () => {
  const { mergePrefs } = await import("../lib/userPrefs");
  const local = { last_seen: "2026-08-01T00:00:00Z", push_topic: "tape-abc", book_text: "NVDA 100" };
  // Signed out / unconfigured → use local, nothing to upload anywhere.
  assert.deepEqual(mergePrefs(local, null).use, local);
  // Cloud has a cursor but no topic/book → cloud cursor wins, local fills the rest and uploads.
  const cloud = { last_seen: "2026-08-09T00:00:00Z", push_topic: null, book_text: null };
  const m = mergePrefs(local, cloud);
  assert.equal(m.use.last_seen, "2026-08-09T00:00:00Z");
  assert.equal(m.use.push_topic, "tape-abc");
  assert.deepEqual(m.upload, { push_topic: "tape-abc", book_text: "NVDA 100" });
  // Fully-populated cloud → cloud verbatim, no upload.
  const full = { last_seen: "2026-08-09T00:00:00Z", push_topic: "tape-xyz", book_text: "AAPL 1" };
  const m2 = mergePrefs(local, full);
  assert.deepEqual(m2.use, full);
  assert.equal(m2.upload, null);
});
