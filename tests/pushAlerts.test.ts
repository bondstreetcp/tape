import { test } from "node:test";
import assert from "node:assert/strict";
import { evalPushRules, type PushFeeds } from "../lib/pushAlerts";

// P3's contract: exactly three event classes notify, only for a sub's OWN symbols, once ever
// (the sent-set), and stale filings never greet a new subscriber (the 7-day freshness gates).

const TODAY = "2026-08-09";
const FEEDS: PushFeeds = {
  targets: [
    { ticker: "KVUE", name: "Kenvue Inc.", filedAt: "2025-12-16" }, // months old — must NOT ping a new sub
    { ticker: "FRESH", name: "Fresh Deal Co", filedAt: "2026-08-07" }, // 2d old — pings
  ],
  campaigns: [
    { id: "acc-1", ticker: "CZWI", type: "activist", form: "SCHEDULE 13D", date: "2026-08-08T12:00:00Z", campaigner: "Schornack group" },
    { id: "acc-2", ticker: "OLDD", type: "activist", form: "SCHEDULE 13D", date: "2026-06-01", campaigner: "Old Fund" }, // stale
    { id: "acc-3", ticker: "PASV", type: "activist", form: "SC 13G", date: "2026-08-08", campaigner: "Passive LP" }, // 13G — never
  ],
  earnRows: [
    { symbol: "EAT", earningsDate: "2026-08-10T12:30:00.000Z", impliedMovePct: 10.9 }, // tomorrow
    { symbol: "ARMK", earningsDate: "2026-08-09T12:30:00.000Z", impliedMovePct: null }, // today, no priced move
    { symbol: "LATER", earningsDate: "2026-08-14", impliedMovePct: 5 }, // outside 36h
  ],
  preannounced: { IBM: { date: "2026-08-05" } },
};

const sub = (topic: string, symbols: string[]) => ({ topic, symbols });

test("the three classes fire for a sub's own names only, with the freshness gates", () => {
  const msgs = evalPushRules([sub("t1", ["EAT", "ARMK", "LATER", "FRESH", "KVUE", "CZWI", "OLDD", "PASV", "IBM"])], FEEDS, new Set(), TODAY);
  const keys = msgs.map((m) => m.key).sort();
  assert.deepEqual(keys, [
    "13d|CZWI|acc-1",
    "deal|FRESH|2026-08-07",
    "pre|IBM|2026-08-05",
    "rep|ARMK|2026-08-09",
    "rep|EAT|2026-08-10",
  ]);
  assert.match(msgs.find((m) => m.key.startsWith("rep|EAT"))!.body, /±10\.9%/);
  assert.match(msgs.find((m) => m.key.startsWith("rep|EAT"))!.title, /tomorrow/);
  assert.match(msgs.find((m) => m.key.startsWith("rep|ARMK"))!.title, /today/);
});

test("a sub only hears about ITS symbols; the sent-set silences repeats per topic", () => {
  const subs = [sub("mine", ["EAT"]), sub("other", ["IBM"])];
  const first = evalPushRules(subs, FEEDS, new Set(), TODAY);
  assert.deepEqual(first.map((m) => `${m.topic}:${m.key}`).sort(), ["mine:rep|EAT|2026-08-10", "other:pre|IBM|2026-08-05"]);
  const sent = new Set(["mine|rep|EAT|2026-08-10"]);
  const second = evalPushRules(subs, FEEDS, sent, TODAY);
  assert.deepEqual(second.map((m) => `${m.topic}:${m.key}`), ["other:pre|IBM|2026-08-05"], "EAT silenced for mine only");
});

test("empty subs / empty feeds → no messages, no throws", () => {
  assert.deepEqual(evalPushRules([], FEEDS, new Set(), TODAY), []);
  assert.deepEqual(evalPushRules([sub("t", ["EAT"])], { targets: [], campaigns: [], earnRows: [], preannounced: {} }, new Set(), TODAY), []);
});
