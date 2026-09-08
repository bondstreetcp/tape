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
- [ ] **5. Real Economy → Energy charts don't render on click** (the Real-Economy ones do). 🐞 @8:42
- [ ] **6. Valuation chart: add an "i" info button** — it's log price + trend line + 2σ bands = technical exhaustion, not PE valuation; label it. 🔵 @9:00–11:21
- [ ] **7. Positioning (+ others): click-to-expand a bigger chart**, consistently. 🔵 @11:45
- [ ] **8. Economy Calendar release links go to a generic BLS index page**, not the specific release. 🐞 @12:30–12:56
- [ ] **9. Daily Desk: "economic releases today / this week" section** (CPI etc. front-and-center). 🔵 @13:27–14:00
- [ ] **10. Verify the surprise-index tracker records each new release going forward** (did it catch Fri's unemployment?). ✅ @14:00
- [ ] **11. "Attention" (Wikipedia page-views): move out of Economy** — flag new surging names + add zoom, OR delete. ⚖️ @14:23–16:17
- [ ] **12. Walter Bloomberg headlines: move out of the Economy section** (good feed, wrong place). 🔀 @16:17–17:19

## Rates / FedWatch
- [ ] **13. Embed/link the CME FedWatch chart** (market-implied hikes by maturity). 🔵 @18:32–19:00
- [ ] **14. Fixed-income link loads very slowly / "does nothing" at first** — check perf. 🐞 @17:52–18:19

## ARB tool
- [ ] **15. Monitor: filter by deal type** — cash / cash+stock / all-stock / all (4 buttons). 🔵 @38:44–39:40
- [ ] **16. Extend the backtest window (~2 years)**. 🔵 @36:33–36:46
- [ ] **17. Improve deal/news data-validation accuracy** (~70–80%; paid sources unfindable). 🔧 @35:26–35:58

## Staples & lower-priority
- [ ] **18. Easier NielsenIQ/sell-side PDF drop** — an upload portal (vs the `staples-scans/` folder) so it's not memory-dependent. 🔵 @5:14–6:49
- [ ] **19. Truth Social feed stale / not updating** — Trump posts are noise; de-emphasize or fix lag. 🔵 low @29:47
- [ ] **20. Convertible Watch: no live convert pricing / hedge ratio** (hard to source) — ack, phase-2. 📋 @20:14

Legend: 🐞 bug · 🔵 feature · ⚖️ decision · 🔀 move · ✅ verify · 📋 backlog · [~]/[≈] in progress.
