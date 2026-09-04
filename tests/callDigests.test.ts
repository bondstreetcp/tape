import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetMinutes, chunkTranscript, isRecentCallDate, kpiGrounded, mergeDigests, sanitizeDigest, sanitizeSynthesis, scopedLocalEnv, sessionWindow, sessionDigests, type CallDigest } from "../lib/callDigests";

test("scopedLocalEnv: CALL_DIGEST_LOCAL_* become LLM_LOCAL_* for this job only; unset = null (fleet untouched)", () => {
  assert.equal(scopedLocalEnv({}), null);
  assert.equal(scopedLocalEnv({ CALL_DIGEST_LOCAL_URL: "http://192.168.1.76:8000/v1" }), null); // both required
  assert.deepEqual(scopedLocalEnv({ CALL_DIGEST_LOCAL_URL: " http://192.168.1.76:8000/v1 ", CALL_DIGEST_LOCAL_MODEL: "argus-vlm" }), {
    LLM_LOCAL_BASE_URL: "http://192.168.1.76:8000/v1",
    LLM_LOCAL_MODEL: "argus-vlm",
  }); // no key → lib/llm's default bearer, for a server run without --api-key
  assert.deepEqual(scopedLocalEnv({ CALL_DIGEST_LOCAL_URL: "http://x/v1", CALL_DIGEST_LOCAL_MODEL: "m", CALL_DIGEST_LOCAL_API_KEY: "tok" }), {
    LLM_LOCAL_BASE_URL: "http://x/v1", LLM_LOCAL_MODEL: "m", LLM_LOCAL_API_KEY: "tok",
  });
});

test("budgetMinutes: 12 on a desk tick (the note must not slip past the open), 40 on FULL, 30 elsewhere; override wins", () => {
  assert.equal(budgetMinutes("desk", undefined), 12);
  assert.equal(budgetMinutes("full", undefined), 40);
  assert.equal(budgetMinutes(undefined, undefined), 30); // a manual run or the GitHub fallback
  assert.equal(budgetMinutes("desk", "25"), 25);
  assert.equal(budgetMinutes("full", "0"), 40); // a nonsense override is ignored
  assert.equal(budgetMinutes("full", "abc"), 40);
});

// The earnings-call digests read every transcript from the last session on the local box. These pin the
// parts code owns: which session a run covers, how a transcript is cut for the box's context window, and
// the verification the model's reply must survive (verbatim quotes, transcript-grounded numbers, no shells).

const T = (iso: string) => Date.parse(iso);

test("sessionWindow: the previous completed trading day — weekends skipped, UTC-anchored", () => {
  const wed = sessionWindow(T("2026-09-02T12:00:00Z")); // Wednesday 08:00 ET desk tick
  assert.equal(wed.sessionDay, "2026-09-01");
  assert.equal(wed.today, "2026-09-02");
  assert.equal(wed.since, T("2026-09-01T00:00:00Z"));
  assert.equal(sessionWindow(T("2026-09-07T12:00:00Z")).sessionDay, "2026-09-04"); // Monday → Friday
  assert.equal(sessionWindow(T("2026-09-06T12:00:00Z")).sessionDay, "2026-09-04"); // Sunday → Friday
  assert.equal(sessionWindow(T("2026-09-05T12:00:00Z")).sessionDay, "2026-09-04"); // Saturday → Friday
  // The evening tick (21:00 UTC) still keys on YESTERDAY, so today's morning calls fall inside [since, now].
  assert.equal(sessionWindow(T("2026-09-02T21:00:00Z")).sessionDay, "2026-09-01");
});

test("isRecentCallDate: the transcript's own date must sit in [sessionDay, today]", () => {
  const w = { sessionDay: "2026-09-01", today: "2026-09-02" };
  assert.equal(isRecentCallDate("2026-09-01", w), true);
  assert.equal(isRecentCallDate("2026-09-02", w), true); // an after-close call dated the next morning
  assert.equal(isRecentCallDate("2026-08-31", w), false); // last week's call
  assert.equal(isRecentCallDate("2026-09-03", w), false);
  assert.equal(isRecentCallDate("", w), false);
  assert.equal(isRecentCallDate(null, w), false);
});

test("chunkTranscript: paragraph-aligned pieces under the cap, nothing lost, oversize paragraphs split at sentences", () => {
  const paras = Array.from({ length: 40 }, (_, i) => `Speaker ${i}: ${"word ".repeat(60)}end of turn ${i}.`);
  const text = paras.join("\n\n");
  const chunks = chunkTranscript(text, 1200);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1200, `chunk of ${c.length} exceeds the cap`);
  // Every paragraph survives intact and in order (no mid-turn cut).
  assert.deepEqual(chunks.join("\n\n").split("\n\n"), paras);
  // A single paragraph longer than the cap is split at a sentence end, never mid-word.
  const monster = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} runs on for a while to fill space.`).join(" ");
  const pieces = chunkTranscript(monster, 400);
  assert.ok(pieces.length > 1);
  for (const p of pieces) { assert.ok(p.length <= 400); assert.match(p, /\.$/); }
  assert.equal(pieces.join(" "), monster);
  assert.deepEqual(chunkTranscript("", 100), []);
});

test("kpiGrounded: a figure must appear in the transcript; qualitative lines pass", () => {
  const src = "Revenue was $1,262 million, up 22.9%, and comparable sales increased 14.1%.";
  assert.equal(kpiGrounded("Net sales $1.26B (+22.9%)", src), true); // 22.9 is in the transcript
  assert.equal(kpiGrounded("Comps +14.1% vs +12.4% a year ago", src), true); // "some", not "every"
  assert.equal(kpiGrounded("Comps +9.8%", src), false); // a number the call never said
  assert.equal(kpiGrounded("Traffic and ticket both grew", src), true);
});

const TRANSCRIPT =
  "Operator: Good afternoon and welcome to the Five Below second quarter fiscal 2026 earnings call.\n\n" +
  "Winnie Park: Thanks. Comparable sales increased 14.1% in the quarter, and net sales grew 22.9% to $1.26 billion. We are raising our full-year outlook to comparable sales growth of 10% to 12%.\n\n" +
  "Analyst: How much of the comp is trading cards?\n\n" +
  "Winnie Park: Trading cards were a meaningful contributor, but the comp was broad-based across worlds.";

const META = {
  symbol: "FIVE", name: "Five Below", sector: "Consumer Discretionary", marketCap: 9e9, callDate: "2026-09-02",
  title: "Five Below (FIVE) Q2 2026 Earnings Call Transcript", url: "https://www.fool.com/x/", source: "The Motley Fool",
  chars: TRANSCRIPT.length, chunks: 1, model: "local:test", digestedAt: "2026-09-03T12:00:00Z",
};

test("sanitizeDigest: verbatim quotes kept, paraphrases and off-transcript numbers dropped, enums coerced", () => {
  const d = sanitizeDigest({
    tldr: "A clean beat-and-raise: comps +14.1% and the FY comp guide moves to +10-12%.",
    tone: "UPBEAT",
    guidance: { action: "raised", detail: "FY comps +10% to +12% (from +6-8%)" },
    kpis: ["Comparable sales +14.1%", "Net sales $1.26B, +22.9%", "Comps +9.8% in the first two weeks of Q3"],
    drivers: ["Trading cards a meaningful contributor; comp broad-based across worlds", "…"],
    qa: [
      { analyst: "Analyst", question: "How much of the comp is trading cards?", answer: "Meaningful, but broad-based across worlds.", directness: "direct" },
      { analyst: "", question: "…", answer: "…", directness: "direct" },
    ],
    readThrough: ["Positive for DLTR's multi-price rollout"],
    watch: ["Q3 comp against a +14.3% compare"],
    quotes: [
      { speaker: "Winnie Park", text: "the comp was broad-based across worlds" },
      { speaker: "Winnie Park", text: "we crushed it this quarter" }, // never said — a paraphrase/fabrication
    ],
  }, TRANSCRIPT, META);
  assert.ok(d);
  assert.equal(d.tone, "measured"); // "UPBEAT" is not a valid enum value → the safe default
  assert.equal(d.guidance.action, "raised");
  assert.deepEqual(d.kpis, ["Comparable sales +14.1%", "Net sales $1.26B, +22.9%"]); // 9.8 is not in the transcript
  assert.deepEqual(d.drivers, ["Trading cards a meaningful contributor; comp broad-based across worlds"]); // shell dropped
  assert.equal(d.qa.length, 1); // the shell exchange dropped
  assert.equal(d.quotes.length, 1);
  assert.equal(d.quotes[0].text, "the comp was broad-based across worlds");
  assert.equal(d.symbol, "FIVE");
  assert.equal(d.callDate, "2026-09-02");
});

test("sanitizeDigest: THE SHELL TRAP — a '…' tldr, or a tldr with nothing behind it, is no digest", () => {
  assert.equal(sanitizeDigest({ tldr: "…", tone: "measured", kpis: ["…"], drivers: [], qa: [] }, TRANSCRIPT, META), null);
  assert.equal(sanitizeDigest({ tldr: "A fine quarter.", kpis: [], drivers: ["Demand was strong"], qa: [] }, TRANSCRIPT, META), null); // one element only
  assert.equal(sanitizeDigest(null, TRANSCRIPT, META), null);
  assert.equal(sanitizeDigest("not an object", TRANSCRIPT, META), null);
});

test("sanitizeSynthesis: tickers whitelisted to the digested set; a shell is rejected", () => {
  const s = sanitizeSynthesis(
    { tldr: "Discount retail is taking share while premium discretionary stalls.", themes: [
      { heading: "Trade-down is real", detail: "FIVE and DG both cited value-seeking traffic.", tickers: ["FIVE", "DG", "NVDA"] },
      { heading: "…", detail: "…", tickers: [] },
    ] },
    ["FIVE", "DG"],
    { sessionDay: "2026-09-02", n: 2, model: "local:test", generatedAt: "2026-09-03T12:00:00Z" },
  );
  assert.ok(s);
  assert.equal(s.themes.length, 1);
  assert.deepEqual(s.themes[0].tickers, ["FIVE", "DG"]); // NVDA was not digested → dropped
  assert.equal(sanitizeSynthesis({ tldr: "…", themes: [] }, ["FIVE"], { sessionDay: "", n: 1, model: "", generatedAt: "" }), null);
});

const mk = (symbol: string, callDate: string, marketCap = 1, tldr = "x"): CallDigest => ({
  symbol, name: symbol, sector: null, marketCap, callDate, title: "", url: "", source: "", tldr, tone: "measured",
  guidance: { action: "none", detail: "" }, kpis: [], drivers: [], qa: [], readThrough: [], watch: [], quotes: [], chars: 0, chunks: 1, model: "", digestedAt: "",
});

test("mergeDigests: one row per (symbol, call date), fresh wins, newest call then largest cap first, capped", () => {
  const prior = [mk("AAPL", "2026-09-01", 3e12, "old"), mk("FIVE", "2026-09-02", 9e9), mk("DG", "2026-08-28", 2e10)];
  const fresh = [mk("AAPL", "2026-09-01", 3e12, "new"), mk("NVDA", "2026-09-02", 4e12)];
  const out = mergeDigests(prior, fresh, 10);
  assert.deepEqual(out.map((d) => `${d.symbol}|${d.callDate}`), ["NVDA|2026-09-02", "FIVE|2026-09-02", "AAPL|2026-09-01", "DG|2026-08-28"]);
  assert.equal(out.find((d) => d.symbol === "AAPL")!.tldr, "new");
  assert.equal(mergeDigests(prior, fresh, 2).length, 2);
  // sessionDigests: everything from the run's session day forward (an AMC call dated the next morning counts).
  const sess = sessionDigests({ digests: out, lastRun: { sessionDay: "2026-09-01" } as any });
  assert.deepEqual(sess.map((d) => d.symbol), ["NVDA", "FIVE", "AAPL"]);
});
