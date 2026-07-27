import { test } from "node:test";
import assert from "node:assert/strict";
import {
  polarity, assignEvidence, mergeLedgerAccumulate, ledgerBalance, summarise,
  DEFAULT_TAU, type Debate, type Candidate, type EvidenceEntry,
} from "../lib/debates";
import { DEBATES, debateById } from "../lib/debateRegistry";

// The load-bearing claim of this feature is that polarity is RELATIVE TO THE THESIS. Measured on
// data/overnight-filings.json (400 filings): sentiment is {neutral 215, bullish 174, bearish 11}. That
// is a real base rate, not a broken classifier — voluntary 8-Ks mostly announce good things. So an
// absolute-sentiment ledger is ~97% bull-or-neutral and is not a debate at all. These pin the fix.

const DEBATE: Debate = {
  id: "d1",
  question: "Q?",
  bullPole: "bull",
  bearPole: "bear",
  anchorText: "anchor",
  anchorPhrases: ["ai capex"],
  roster: [
    { ticker: "NVDA", role: 1, why: "benefits" },
    { ticker: "META", role: -1, why: "pays for it" },
  ],
  opened: "2026-07-01",
};

const C = (o: Partial<Candidate> = {}): Candidate => ({
  at: "2026-07-27T12:00:00Z", ticker: "NVDA", direction: 1, source: "filing",
  headline: "h", detail: "d", url: "u", weight: 1, vec: [1, 0], ...o,
});
// Cosine stub: identical vectors -> 1, orthogonal -> 0. Enough to exercise the gate.
const cos = (a: ArrayLike<number>, b: ArrayLike<number>) => (a[0] === b[0] && a[1] === b[1] ? 1 : 0);
const ANCHOR = [1, 0];

test("polarity inverts on a SHORT-side roster name — the whole point", () => {
  assert.equal(polarity(1, 1), "bull");
  assert.equal(polarity(1, -1), "bear", "good news at a name the thesis is short is BEAR evidence");
  assert.equal(polarity(-1, -1), "bull", "bad news at a short-side name supports the bull pole");
  assert.equal(polarity(-1, 1), "bear");
});

test("a NEUTRAL item is not evidence for either pole and never enters the ledger", () => {
  assert.equal(polarity(0, 1), null);
  assert.equal(polarity(0, -1), null);
  const out = assignEvidence(DEBATE, ANCHOR, [C({ direction: 0 })], {}, cos);
  assert.deepEqual(out, [], "215 of 400 filings are neutral — they must not pad the ledger");
});

test("a bull-skewed corpus still produces a TWO-SIDED ledger via role signs", () => {
  // Every candidate is bullish — the real base rate. The roster is what creates the bear side.
  const out = assignEvidence(DEBATE, ANCHOR, [
    C({ ticker: "NVDA", direction: 1, headline: "a" }),
    C({ ticker: "META", direction: 1, headline: "b" }),
  ], {}, cos);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => [e.ticker, e.pole]).sort(), [["META", "bear"], ["NVDA", "bull"]]);
});

test("BOTH gates are required — a roster ticker alone is not enough", () => {
  // NVDA announcing a buyback is a roster name, but off-thesis: orthogonal vector, no phrase.
  const off = assignEvidence(DEBATE, ANCHOR, [C({ vec: [0, 1], headline: "buyback" })], {}, cos);
  assert.deepEqual(off, [], "a routine filing at a roster name is not debate evidence");
  const on = assignEvidence(DEBATE, ANCHOR, [C({ vec: [1, 0] })], {}, cos);
  assert.equal(on.length, 1, "…but an on-thesis one is");
});

test("…and relevance alone is not enough either — an unattached name is dropped", () => {
  const out = assignEvidence(DEBATE, ANCHOR, [C({ ticker: "ZZZZ", vec: [1, 0] })], {}, cos);
  assert.deepEqual(out, [], "topically close but nobody put it on the roster and no phrase hit");
});

test("NO ROSTER ROLE, NO ENTRY — you cannot sign evidence you cannot polarise", () => {
  // The real run's lesson. The rate-cuts ledger filled with small regional banks (FRST, FIBK, MSBI)
  // scoring 0.45-0.57 against the anchor and every one tagged "bull" — not because they supported the
  // bull pole but because, being unrostered, they defaulted to +1. A bank's filings genuinely ARE
  // about interest rates; being topically about the subject is not the same as bearing on the argument.
  const unrostered = assignEvidence(DEBATE, ANCHOR, [
    C({ ticker: "ZZZZ", vec: [1, 0], headline: "Raises AI capex guidance", detail: "" }),
  ], {}, cos);
  assert.deepEqual(unrostered, [], "topically perfect, phrase hit, still dropped — no declared role");
});

test("a phrase rescues a ROSTER name whose embedding sits just under the bar", () => {
  const out = assignEvidence(DEBATE, ANCHOR, [
    C({ ticker: "META", vec: [0, 1], headline: "Guides AI capex sharply higher", detail: "" }),
  ], {}, cos);
  assert.equal(out.length, 1, "roster attachment + explicit phrase = admitted");
  assert.equal(out[0].via, "phrase", "records that the phrase, not the embedding, met relevance");
  assert.equal(out[0].pole, "bear", "and the role sign still inverts it — META is the -1 side");
});

test("every admitted row records the gate and score that admitted it", () => {
  const out = assignEvidence(DEBATE, ANCHOR, [C()], {}, cos);
  assert.equal(out[0].via, "roster");
  assert.equal(out[0].score, 1);
});

test("the window is bounded by CALENDAR age, and old evidence is excluded", () => {
  const age = (iso: string) => Math.round((Date.parse("2026-07-27T00:00:00Z") - Date.parse(iso)) / 86_400_000);
  const out = assignEvidence(DEBATE, ANCHOR, [
    C({ at: "2026-07-26T12:00:00Z", headline: "recent" }),
    C({ at: "2026-01-01T12:00:00Z", headline: "ancient" }),
  ], { windowDays: 30, ageDays: age }, cos);
  assert.deepEqual(out.map((e) => e.headline), ["recent"]);
});

test("embedding unavailable: only ROSTER names with an explicit phrase get through", () => {
  // Degrading to phrase-only is safe now that attachment is roster-mandatory — the blast radius is a
  // handful of declared names, not the tape. Before the roster became mandatory this was a flood risk
  // and the test asserted the opposite; the constraint moved, so the guarantee moved with it.
  const out = assignEvidence(DEBATE, null, [
    C({ headline: "no phrase here" }),                              // roster, but nothing signals relevance
    C({ headline: "AI capex rising", ticker: "META" }),              // roster + phrase
    C({ headline: "AI capex rising", ticker: "ZZZZ" }),              // phrase, but not on the roster
  ], {}, cos);
  assert.deepEqual(out.map((e) => e.ticker), ["META"]);
  assert.equal(out[0].pole, "bear", "role sign still applies with no embedding in play");
});

test("ledger merge dedups on source+url+ticker and keeps the newest version", () => {
  const a: EvidenceEntry[] = [{ debateId: "d1", at: "2026-07-01T00:00:00Z", ticker: "NVDA", pole: "bull", source: "filing", headline: "old", detail: "", url: "u1", score: 0.5, via: "roster", weight: 1 }];
  const b: EvidenceEntry[] = [{ ...a[0], at: "2026-07-27T00:00:00Z", headline: "new" }];
  const m = mergeLedgerAccumulate(a, b, 100);
  assert.equal(m.length, 1);
  assert.equal(m[0].headline, "new");
});

test("balance buckets weighted bull vs bear and reports the net", () => {
  const e = (at: string, pole: "bull" | "bear", weight = 1): EvidenceEntry =>
    ({ debateId: "d1", at, ticker: "X", pole, source: "s", headline: "h", detail: "", url: at + pole, score: 1, via: "roster", weight });
  const b = ledgerBalance([
    e("2026-07-01T00:00:00Z", "bull", 2), e("2026-07-02T00:00:00Z", "bear", 1),
    e("2026-07-20T00:00:00Z", "bear", 3),
  ], 7);
  assert.equal(b.length, 2, "two buckets ~19 days apart at a 7-day width");
  assert.equal(b[0].net, 1, "first bucket: 2 bull − 1 bear");
  assert.equal(b[1].net, -3);
});

test("an empty ledger yields an empty balance, never a fabricated zero bucket", () => {
  assert.deepEqual(ledgerBalance([], 7), []);
});

test("summarise counts both poles and both admission gates", () => {
  const out = assignEvidence(DEBATE, ANCHOR, [
    C({ ticker: "NVDA" }), C({ ticker: "META" }),
    C({ ticker: "META", vec: [0, 1], headline: "AI capex up" }), // roster + phrase => admitted via phrase
  ], {}, cos);
  const s = summarise(DEBATE, out, null);
  assert.equal(s.counts.bull + s.counts.bear, out.length);
  assert.equal(s.counts.phrase, 1, "one row met relevance by phrase");
  assert.equal(s.counts.roster, 2, "two met it by embedding");
});

// ── the registry itself is editorial content, so it gets structural gates ────────────────────────

test("REGISTRY: every debate is genuinely two-sided — a roster of all +1 is a theme, not a debate", () => {
  for (const d of DEBATES) {
    const signs = new Set(d.roster.map((m) => m.role));
    assert.ok(signs.has(1) && signs.has(-1), `${d.id} has no opposing side — it cannot produce bear evidence`);
  }
});

test("REGISTRY: ids unique, tickers unique within a debate, poles and anchors non-empty", () => {
  assert.equal(new Set(DEBATES.map((d) => d.id)).size, DEBATES.length, "duplicate debate id");
  for (const d of DEBATES) {
    const t = d.roster.map((m) => m.ticker);
    assert.equal(new Set(t).size, t.length, `${d.id} lists a ticker twice`);
    assert.ok(d.bullPole.length > 20 && d.bearPole.length > 20, `${d.id} poles must be real claims`);
    assert.ok(d.anchorText.length > 120, `${d.id} anchorText is embedded — it must describe the MECHANISM`);
    assert.ok(d.anchorPhrases.length > 0, `${d.id} needs at least one escape-hatch phrase`);
    for (const m of d.roster) {
      assert.match(m.ticker, /^[A-Z.-]{1,6}$/, `${d.id}: implausible ticker ${m.ticker}`);
      assert.ok(m.why.length > 10, `${d.id}/${m.ticker} needs a reason it is on the roster`);
    }
    assert.match(d.opened, /^\d{4}-\d{2}-\d{2}$/, `${d.id} opened must be a bare calendar date`);
  }
});

test("REGISTRY: anchor phrases are specific enough not to admit the whole tape", () => {
  for (const d of DEBATES) {
    for (const p of d.anchorPhrases) {
      assert.ok(p.length >= 3, `${d.id}: phrase "${p}" is too short to be selective`);
      assert.equal(p, p.toLowerCase(), `${d.id}: phrase "${p}" must be lower-cased (matching is lower-cased)`);
    }
  }
});

test("debateById resolves and misses cleanly", () => {
  assert.equal(debateById(DEBATES[0].id)?.id, DEBATES[0].id);
  assert.equal(debateById("nope"), undefined);
});

test("DEFAULT_TAU is a sane cosine threshold", () => {
  assert.ok(DEFAULT_TAU > 0 && DEFAULT_TAU < 1);
});

test("merge RE-APPLIES today's bar to yesterday's rows — a bug's output cannot become permanent", () => {
  // The real incident: 19 rows entered the rate-cuts ledger through a phrase gate that skipped the
  // relevance test, all with score 0. Appending alone preserved every one of them after the fix.
  const stale: EvidenceEntry[] = [
    { debateId: "d1", at: "2026-07-20T00:00:00Z", ticker: "MTB", pole: "bull", source: "filing", headline: "admitted by the old bypass", detail: "", url: "u-old", score: 0, via: "phrase", weight: 1 },
  ];
  const good: EvidenceEntry[] = [
    { debateId: "d1", at: "2026-07-27T00:00:00Z", ticker: "NVDA", pole: "bull", source: "filing", headline: "clears the bar", detail: "", url: "u-new", score: 0.44, via: "roster", weight: 1 },
  ];
  assert.equal(mergeLedgerAccumulate(stale, good, 100, 0).length, 2, "no bar: the bad row survives");
  const healed = mergeLedgerAccumulate(stale, good, 100, DEFAULT_TAU);
  assert.deepEqual(healed.map((e) => e.url), ["u-new"], "with the bar, the sub-threshold row is purged");
});
