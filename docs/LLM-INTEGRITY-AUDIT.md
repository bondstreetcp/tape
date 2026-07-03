# LLM data-integrity audit — 2026-07-03

Full-codebase sweep of the LLM surface (22 nightly scripts + 11 live routes) against the failure
taxonomy proven this week (unvalidated numbers, blind rejects, merge/null-clobber, unvalidated
tickers, bad dates, shape guards, silent drops, staleness honesty). Status: ☐ open · ☐ fixed.

## Tier 1 — data destroyed or blanked (fix first)
- ☐ **guidance F1**: `refresh-guidance.ts` — a chatJSON null (LLM outage) was stored as "no guidance"
  (`guides:[]`) AND `lastAccession` advanced → standing guides erased until next quarter. Also the
  no-text path stamped lastAccession. Fix: null ≠ empty; don't advance the gate on failure.
- ☐ **overnight F2**: `refresh-overnight-filings.ts` — no `llmConfigured()` preflight; dead key ⇒
  writes `items:[]` with fresh generatedAt = a convincing fake "quiet night". Fix: preflight + refuse
  the write when LLM-null rate is high; count nulls separately from NONE-gated.
- ☐ **trump A3**: `refresh-trump-truth.ts:179-190` — every run re-prices ALL posts; a Yahoo 429 nulls
  a series → ticker dropped as "hallucinated" → old posts permanently deleted. Fix: hard-drop filter
  only for NEW posts; prior posts keep ticker with `perf:null` on fetch failure.
- ☐ **policy A4**: `refresh-policy.ts:104-108` — re-validates ALL stored tickers nightly; one fetch
  blip strips the ticker → item dropped forever (window has moved on). Fix: validate NEW items only.
- ☐ **catalysts F5**: `refresh-catalysts.ts:125-127` — an ask() throw overwrites a good "why it
  moved" with `{why:""}` stamped fresh (suppresses retry for the whole TTL). Fix: carry forward the
  prior entry on error.
- ☐ **catalyst-vol A5**: unpriced-but-known future events are dropped before storage; once the 8-K
  ages out of the EFTS window the catalyst is lost. Fix: persist calendar rows with null pricing;
  UI shows priced only. (Needs type + UI tolerance — medium.)

## Tier 2 — wrong data shown
- ☐ **ipo A2**: `refresh-ipo.ts` num() had floor only — price 17500 or size-in-dollars renders
  "$500000.0B". Fix: bounds price ≤ $1,000, size ≤ $100,000M.
- ☐ **campaigns/corp-events A1**: LLM tickers stored with regex-clean only (policy/biotech have the
  Yahoo `validTicker` pattern; these don't) → a wrong-but-real symbol prices the wrong company's
  move. Fix: validate NEW items' tickers; null (don't drop) on failure.
- ☐ **guidance F3**: rev ranges unbounded, no low≤high check; `reportedEps` feeds beatGuide() with
  no consensus gate → one misread poisons the sandbagger stat.
- ☐ **guidance F4**: "verbatim" quote never substring-grounded (SSS pattern exists at refresh-sss).
- ☐ **valuation-explain F8**: verdicts accepted for symbols outside the candidate list can pin a
  "value trap" badge on the wrong row. Fix: `if (!cand.some(c=>c.sym===sym)) continue;`.
- ☐ **overnight F10**: keyMetrics stored as unknown passthrough (renders `[object Object]`); no
  figure grounded against the filing clip.
- ☐ **research F11/F12**: extract ticker/publishDate unvalidated (misfiled docs blend two companies'
  consensus); unbounded estimate revisions can mint "+99,900%" and top the actionable scan.

## Tier 3 — hallucinated-ticker links in syntheses (inputs known → whitelist)
- ☐ **desk note F6**: tickers not filtered against the input movers/filings/flow set; rendered as
  /stock/ links. ☐ **congress F7** same. ☐ **13f-story F9** same (filter vs names.keys()).

## Tier 4 — blind rejects / silent drops
- ☐ **ipo A6**: `classifyUpcoming` lacks the PRO second-opinion its 424B4 sibling has.
- ☐ **campaigns/corp-events A7**: material=false indistinguishable from transport failure; no
  reject counters; no second opinion on the low-volume short-report bucket.
- ☐ **policy A8**: batch classify `.catch(()=>({}))` — a dead batch is invisible. Log kept/total.
- ☐ **A9**: shared mapPool swallows exceptions with no counter (all 8 event scripts).

## Tier 5 — guards & honesty
- ☐ **A10 dates**: unguarded `new Date(raw).toISOString()` — campaigns:120 (kills one firm's feed),
  fed:58 (crashes the whole run), trump:82 (kills RSS fallback). Fix: Date.parse + skip.
- ☐ **A11**: catalyst-vol extractDate accepts "2026-13-45" (NaN passes bounds by accident).
- ☐ **A12**: trump tickers array unguarded (string → throws, batch lost).
- ☐ **F13 staleness**: catalysts.json has no generatedAt; congress-AI + valuation-explain badges
  show no as-of; desk note falls back to dateless "overnight".
- ☐ **F14**: confluence `(r.thesis||"").trim()` throws on non-string → whole board write dies.
- ☐ **A-low**: perf fields overwritten with null on transient Yahoo errors (self-heals next run);
  campaigns short-report URL-vs-x.com dup rows; dedupeUpcoming ticker-recycling edge; EFTS missing
  file_date stores "T12:00:00Z".

## Live routes (auditor C) — Tier 1-2 equivalents
- ☐ **routes C1 supply-chain**: map generated from model knowledge, tickers only charset-scrubbed,
  rendered as /stock/ links, cached 24h+48h SWR — wrong-company click-throughs. Fix: Yahoo-validate
  each ticker, blank on failure (route.ts:25-32; SupplyChain.tsx:26).
- ☐ **routes C2 segment-economics**: revenue/OI rendered with no reconciliation vs known company
  revenue (thousands-vs-millions / YTD-column risk), cached 24h. Fix: gate Σsegments within 0.5-2×
  of period revenue.
- ☐ **routes C3 cache-poisoning**: earnings-prep caches {ai:null} 3h and {why:null} 24h (chatJSON
  returns null, never throws → success path caches). risk-factors caches a degenerate {} as 'No
  material changes' 24h. Fix: no-store whenever the LLM payload is null/empty.
- ☐ **routes C5-C7 nl-screen**: unknown filter fields silently DROPPED (screen results confidently
  wrong); non-number value crashes render (v.toFixed); bad op/limit → empty/truncated silently.
  Fix: whitelist-validate field/op, coerce value, clamp limit [1,100], surface ignored criteria.
- ☐ **routes C8-C9 injection**: stocktwits posts are an adversarial prompt channel into a shared
  30-60m cached summary (wrap as DATA-not-instructions); earnings-prep 'sig' GET param is spliced
  in as "this terminal's own analysis" and CDN-cached — recompute server-side or POST+untrusted.
- ☐ **routes C10 error honesty**: LLM failure rendered as facts ('No transcript found', 'isn't
  broken out in the latest filing') — return a distinct error flag; clients say 'AI read failed'.
- ☐ **routes C11**: earnings-prep 'why' confidence not enum-coerced.
- ☐ **routes C12 (accepted-risk)**: free-narrative numbers in ask/compare/digest unvalidated by
  construction — disclaimed, uncached, no links; cheapest hardening = substring-check quoted figures
  for 'high' confidence in part=why.
- Clean: ivScenario/trade payloads are mechanical (not LLM); zero dangerouslySetInnerHTML;
  MarkdownLite emits no links; success-only caching everywhere except C3/C4; nl-screen has no
  eval/dynamic-property risk.

## Clean bills worth knowing
fed = cleanest event feed; biotech = best logging; confluence numbers all code-computed; desk-note
skip-write preserves old note; 13f/congress skip-write same; guidance per-symbol checkpointing good.
