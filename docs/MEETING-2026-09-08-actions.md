# Tape — action items from the 2026-09-08 Richard/Sam review

Extracted from the 63-min call (fathom.video/share/FhBziGe2nvfYTtYkNaZiYB2xynVzYWzt). Priority per Sam @31:43 /
34:26: **conference transcripts + bug fixes + earnings.** Timestamps are the point in the call. Check items off as
they land.

## Priority — earnings & conference transcripts
- [x] **1. Earnings-call summary truncates** — FIXED: the /api/earnings-call route used summarizeText's 45k default, halving 50-90k transcripts; now passes 185k (the filing cap) so the whole call is summarized. 🐞 @27:14
- [~] **2. Conference audio → transcript pipeline** — replay/media URL → Whisper → archive + searchable + feed the predictor; internal-use, not republished (@59:42). *In progress: `lib/transcriptDrop.ts` + `scripts/ingest-transcript-text.ts` + `scripts/fetch-transcribe.sh` shipped; gated capture stays on the user side.* @22:47/28:14/33:44
- [ ] **3. Beat/miss predictor from transcript tone/words + backtest** — phase 2B, after the structured-digest ingest (2A). 🔵 @22:49/24:24
- [ ] **4. Transcript coverage** — mostly large-cap (~2–3k); mid/small/obscure missing. Backfill on request. 📋 @25:15

## Economy / Macro & Rates
- [x] **5. Real Economy → Energy charts don't render on click** — FIXED: extracted the shared `SeriesChartModal` and made EnergyPanel cards clickable (full history + timeframes), matching RealEconomyPanel. 🐞 @8:42
- [x] **6. Valuation chart: add an "i" info button** — DONE: the Index/Sector "valuation" panels (`IndexTrendPanel`) now carry a toggleable ⓘ that spells out it's a log-linear price trend channel with ±1σ/±2σ bands — a technical "how stretched"/mean-reversion read, **not** a P/E. 🔵 @9:00–11:21
- [x] **7. Positioning (+ others): click-to-expand a bigger chart** — DONE: `CotPanel` cards are now buttons that open the shared `SeriesChartModal` (full spec-net history + 3M/6M/1Y/3Y/Max, crowding/WoW/%OI lines). The three sparkline dashboards — Real economy, Energy, Positioning — now all expand consistently; Valuation has its own channel modal. 🔵 @11:45
- [x] **8. Economy Calendar release links go to a generic BLS index page** — FIXED: the bls_latest rollup links each indicator to its release table-of-contents (`…/empsit.toc.htm`, a page of links); `blsReleaseUrl` retargets the news-release narrative (`…/empsit.nr0.htm`). Applied to new prints and migrated onto existing entries on the next nightly refresh. 🐞 @12:30–12:56
- [x] **9. Daily Desk: "economic releases today / this week" section** — DONE: `DeskEconReleases` strip at the top of the Desk Brief tab — next-7-days macro calendar (CPI/PPI/jobs/PCE bolded), Today/Tomorrow/weekday chips, consensus attached (ForexFactory), ≈ for approximate dates. Data from `lib/econCalendar` (key-free approximate; exact on the FRED-key path). 🔵 @13:27–14:00
- [x] **10. Verify the surprise-index tracker records each new release** — VERIFIED + FIXED: it did **not** catch monthly prints (NFP/CPI/PPI/PCE/GDP…) — it matched the ForexFactory consensus off the FRED *reference month* (±7d), which for monthly series is weeks before the release, so only weekly claims ever slipped through. Now matches against the run date (FF only carries the current week), guards y/y↔m/m unit mismatches, and skips consensuses for not-yet-printed releases. Stores the release date (decay) + reference date (`obs`, dedup). Tested (`tests/econSurprise.test.ts`); live run confirmed CPI/PPI/sentiment now score. ✅ @14:00
- [x] **11. "Attention" (Wikipedia page-views)** — DECISION: **delete** (Richard, 2026-09-08). Removed the Economy tab, `AttentionPanel`, `lib/attention`/`attentionServer`, `refresh-attention` (script + tick + package.json), and the data-freshness monitor entry. ⚖️ @14:23–16:17
- [x] **12. Walter Bloomberg headlines: move out of the Economy section** — DONE: removed the redundant "Headlines" tab from the Economy dashboard; the identical `MarketHeadlinesWire` feed already lives in Daily Desk → Market Headlines, its natural home. 🔀 @16:17–17:19

## Rates / FedWatch
- [x] **13. Embed/link the CME FedWatch chart** — DONE (link): a "Market-implied rate path" card on the Fed Watch page links out to CME FedWatch, framed against our narrative digest (Fed's words vs the market's bet). CME's tool is proprietary + iframe-blocked so it can't be embedded, and we have no keyless Fed-funds-futures feed to compute our own path — a native implied-probability chart is a possible follow-up if a data source is sourced. 🔵 @18:32–19:00
- [x] **14. Fixed-income link loads very slowly / "does nothing" at first** — FIXED: the page only renders the curve + credit spreads but was awaiting the full 32-series macro pull on a cold cache; added `getRatesCached`/`getCurveCredit` which fetch just those ~14 series (measured **4.6s → 1.9s** cold, snapshot path unchanged) and a page-shaped `loading.tsx` skeleton so navigation never looks dead. (Ruled out tracing-excludes — it never strips macro.json.) 🐞 @17:52–18:19

## ARB tool
- [→] **15. Monitor: filter by deal type** — cash / cash+stock / all-stock / all (4 buttons). 🔵 @38:44–39:40 — DEFERRED: the ARB tool is a separate codebase (arb.truporchhomesvm.com); `/merger-arb` here just redirects to it and `MergerArbView` is dead code. Implement in that repo. (Backend note: `refresh-merger-arb` here already records ALL DEFM14A targets in `targets[]`, cash-only in `rows[]`; surfacing stock/mixed in `rows[]` is the feed-side prep if that tool reads this feed.)
- [→] **16. Extend the backtest window (~2 years)** — DEFERRED: build in the standalone ARB tool; no arb backtest exists in this repo. 🔵 @36:33–36:46
- [→] **17. Improve deal/news data-validation accuracy** (~70–80%; paid sources unfindable) — DEFERRED with #15/#16 (ARB deal-validation lives in the standalone ARB tool). 🔧 @35:26–35:58

## Staples & lower-priority
- [x] **18. Easier NielsenIQ/sell-side PDF drop** — DONE: a drag-drop "Add a scan" upload card on the Staples Scanner page → `POST /api/staples/upload`, which auth-gates (signed-in only, licensed content), validates (PDF magic byte + a text layer), sanitizes the filename (no path traversal), and lands it in `STAPLES_SCAN_DIR` for the next nightly scan. The raw PDF is never served back. No more SSH-ing files into the folder. 🔵 @5:14–6:49
- [x] **19. Truth Social feed stale / not updating** — DONE: the header showed `generatedAt` (bumped every nightly run even when the source returned nothing), hiding the real lag. Now surfaces the **latest post's age** as the honest freshness signal + a "possibly lagging" badge when no new stock-relevant post has landed in >10 days, and reframes it as a "low-signal, noise-heavy" feed (de-emphasized). 🔵 low @29:47
- [→] **20. Convertible Watch: no live convert pricing / hedge ratio** (hard to source) — ACKNOWLEDGED as phase-2 in the meeting; no convert-price feed to source, so arb P&L stays deferred (see the convertible-arb memory). 📋 @20:14

Legend: 🐞 bug · 🔵 feature · ⚖️ decision · 🔀 move · ✅ verify · 📋 backlog · [~]/[≈] in progress · [→] deferred (separate repo / later).
