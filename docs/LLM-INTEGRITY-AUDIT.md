# LLM data-integrity audit — 2026-07-03

Full-codebase sweep of the LLM surface (22 nightly scripts + 11 live routes) against the failure
taxonomy proven this week (unvalidated numbers, blind rejects, merge/null-clobber, unvalidated
tickers, bad dates, shape guards, silent drops, staleness honesty). Status: ☐ open · ☑ fixed.
34 of 38 closed 2026-07-03 (commits a48f869f + d377ed06 + 2ea3a481). Remaining: the accepted-risk
backlog only (C12, A-low).

## Tier 1 — data destroyed or blanked (fix first)
- ☑ **guidance F1** (fixed 2026-07-03): `refresh-guidance.ts` — a chatJSON null (LLM outage) was stored as "no guidance"
  (`guides:[]`) AND `lastAccession` advanced → standing guides erased until next quarter. Also the
  no-text path stamped lastAccession. Fix: null ≠ empty; don't advance the gate on failure.
- ☑ **overnight F2** (fixed 2026-07-03): `refresh-overnight-filings.ts` — no `llmConfigured()` preflight; dead key ⇒
  writes `items:[]` with fresh generatedAt = a convincing fake "quiet night". Fix: preflight + refuse
  the write when LLM-null rate is high; count nulls separately from NONE-gated.
- ☑ **trump A3** (fixed 2026-07-03): `refresh-trump-truth.ts:179-190` — every run re-prices ALL posts; a Yahoo 429 nulls
  a series → ticker dropped as "hallucinated" → old posts permanently deleted. Fix: hard-drop filter
  only for NEW posts; prior posts keep ticker with `perf:null` on fetch failure.
- ☑ **policy A4** (fixed 2026-07-03): `refresh-policy.ts:104-108` — re-validates ALL stored tickers nightly; one fetch
  blip strips the ticker → item dropped forever (window has moved on). Fix: validate NEW items only.
- ☑ **catalysts F5** (fixed 2026-07-03): `refresh-catalysts.ts:125-127` — an ask() throw overwrites a good "why it
  moved" with `{why:""}` stamped fresh (suppresses retry for the whole TTL). Fix: carry forward the
  prior entry on error.
- ☑ **catalyst-vol A5** (fixed 2026-07-03, d377ed06): unpriced-but-known future events were dropped before storage; once
  the 8-K ages out of the EFTS window the catalyst is lost. Fix: CatalystRow pricing fields nullable;
  pricing failure returns the row unpriced (re-priced a later run); view/type-predicate shows priced
  only. Verified live: 1 priced + 3 kept unpriced.

## Tier 2 — wrong data shown
- ☑ **ipo A2** (fixed 2026-07-03): `refresh-ipo.ts` num() had floor only — price 17500 or size-in-dollars renders
  "$500000.0B". Fix: bounds price ≤ $1,000, size ≤ $100,000M.
- ☑ **campaigns/corp-events A1** (fixed 2026-07-03): LLM tickers stored with regex-clean only (policy/biotech have the
  Yahoo `validTicker` pattern; these don't) → a wrong-but-real symbol prices the wrong company's
  move. Fix: validate NEW items' tickers; null (don't drop) on failure.
- ☑ **guidance F3** (fixed 2026-07-03, d377ed06): rev ranges bounded vs the name's own market cap ([0.1%, 10×], absolute
  band fallback) + low/high swap when inverted; EPS gated vs consensus (≤ max(5×|cons|, $5)) feeding
  beatGuide().
- ☑ **guidance F4** (fixed 2026-07-03, d377ed06): quotes normalized-substring-grounded against the release text (SSS
  pattern); ungrounded quotes nulled.
- ☑ **valuation-explain F8** (fixed 2026-07-03): verdicts accepted for symbols outside the candidate list can pin a
  "value trap" badge on the wrong row. Fix: `if (!cand.some(c=>c.sym===sym)) continue;`.
- ☑ **overnight F10** (fixed 2026-07-03, d377ed06): keyMetrics coerced to string/number only (80-char cap) and each
  numeric must appear in the filing clip ("some" not "every" — a vs-consensus figure legitimately
  isn't in the clip).
- ☑ **research F11/F12** (fixed 2026-07-03, d377ed06): extract warns when the ticker never appears in the report text,
  publishDate regex-validated (else ""), docType Set-coerced to the real enum; synthesize skips
  |revision| > 300% (unit inconsistency) in signalsFor.

## Tier 3 — hallucinated-ticker links in syntheses (inputs known → whitelist)
- ☑ **desk note F6** (fixed 2026-07-03, d377ed06): cleanTickers filters against the snapshot + overnight-filing symbol
  set. ☑ **congress F7** (fixed 2026-07-03, d377ed06): highlight tickers must exist in the disclosed trades.
  ☑ **13f-story F9** fixed 2026-07-03 (a48f869f).

## Tier 4 — blind rejects / silent drops
- ☑ **ipo A6** (fixed 2026-07-03): `classifyUpcoming` lacks the PRO second-opinion its 424B4 sibling has.
- ☑ **campaigns/corp-events A7** (fixed 2026-07-03, d377ed06): classify returns "llmfail" (retried next run — the item
  isn't stored so the gate re-offers it) distinct from material=false (judgment); kept/rejected/failed
  counters logged; short-report items get a PRO second opinion before being dropped.
- ☑ **policy A8** (fixed 2026-07-03, d377ed06): per-batch .catch logs the failure; kept/total + dead-batch count logged.
- ☑ **A9** (fixed 2026-07-03, d377ed06): mapPool counts swallowed exceptions and warns "N/M tasks threw" in all 8 event
  scripts (campaigns, corp-events, policy, fed, biotech, ipo, catalyst-vol, trump-truth).

## Tier 5 — guards & honesty
- ☑ **A10 dates** (fixed 2026-07-03): unguarded `new Date(raw).toISOString()` — campaigns:120 (kills one firm's feed),
  fed:58 (crashes the whole run), trump:82 (kills RSS fallback). Fix: Date.parse + skip.
- ☑ **A11** (fixed 2026-07-03): catalyst-vol extractDate accepts "2026-13-45" (NaN passes bounds by accident).
- ☑ **A12** (fixed 2026-07-03): trump tickers array unguarded (string → throws, batch lost).
- ☑ **F13 staleness** (fixed 2026-07-03, d377ed06): catalysts.json → { generatedAt, bySymbol } (loader + script accept
  the legacy bare map); congress AI block + valuation-history badges show "as of"; desk-note fallback
  label carries the date ("overnight · Jul 3").
- ☑ **F14** (fixed 2026-07-03): confluence `(r.thesis||"").trim()` throws on non-string → whole board write dies.
- ☐ **A-low**: perf fields overwritten with null on transient Yahoo errors (self-heals next run);
  campaigns short-report URL-vs-x.com dup rows; dedupeUpcoming ticker-recycling edge; EFTS missing
  file_date stores "T12:00:00Z".

## Live routes (auditor C) — Tier 1-2 equivalents
- ☑ **routes C1 supply-chain** (fixed 2026-07-03, a48f869f): tickers validated against the universe snapshots' known-
  symbol set + a company-name token match; ticker blanked on identity mismatch.
- ☑ **routes C2 segment-economics** (fixed 2026-07-03, 2ea3a481): Σ(segment revenues) gated within 0.5–2× of TTM
  revenue (new CompanyStats.totalRevenue, else FY consensus) OR quarterly consensus — both bases
  tested since a 10-K note is annual and a 10-Q's quarterly/YTD. Outside both → { aiFailed } no-store
  (retry UI); no reference → gate skipped with a log; matched basis logged + `reconciledVs` in the
  payload; prompt demands MILLIONS explicitly. Verified live: AAPL Σ$416,161M vs TTM $451,442M (0.92×).
- ☑ **routes C3 cache-poisoning** (fixed 2026-07-03, a48f869f): earnings-prep no-store on null ai/why; risk-factors
  requires substantive content before the CDN may hold it.
- ☑ **routes C5-C7 nl-screen** (fixed 2026-07-03, a48f869f): OPS/FIELD_KEYS whitelists, Number coercion, limit clamped
  [1,100], ignored criteria returned + shown in NlScreener (all-ignored → error).
- ☑ **routes C8-C9 injection** (fixed 2026-07-03, d377ed06): stocktwits posts wrapped in an explicit DATA-not-
  instructions boundary (system + user + end-marker); earnings-prep QUANT SIGNALS recomputed server-
  side via a shared computeQuant (options/reactions/vol) + guidance/SSS/momentum — the ?sig= GET
  param is gone from route and component.
- ☑ **routes C10 error honesty** (fixed 2026-07-03, d377ed06): transcript-analysis / segment-economics / risk-factors
  return { aiFailed: true } (no-store) on chatJSON null, degenerate replies, and thrown transport
  errors; CallAnalysis / SegmentEconomics / RiskFactorPanel render "AI read failed — try again" with
  a retry, and available:false keeps meaning "source genuinely absent". Segment `read` now renders
  when OI isn't disclosed (was silently blank).
- ☑ **routes C11** (fixed 2026-07-03): earnings-prep 'why' confidence not enum-coerced.
- ☐ **routes C12 (accepted-risk)**: free-narrative numbers in ask/compare/digest unvalidated by
  construction — disclaimed, uncached, no links; cheapest hardening = substring-check quoted figures
  for 'high' confidence in part=why.
- Clean: ivScenario/trade payloads are mechanical (not LLM); zero dangerouslySetInnerHTML;
  MarkdownLite emits no links; success-only caching everywhere except C3/C4; nl-screen has no
  eval/dynamic-property risk.

## Clean bills worth knowing
fed = cleanest event feed; biotech = best logging; confluence numbers all code-computed; desk-note
skip-write preserves old note; 13f/congress skip-write same; guidance per-symbol checkpointing good.
