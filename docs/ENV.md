# Environment reference

Generated from `lib/envManifest.ts` by `npm run gen-env-reference` — edit the table there, not this file.
149 knobs. Secrets live in the NAS `tape.env`, the R2 runner-env channel (`npm run add-runner-secret`)
or GitHub secrets; everything else is optional and documented with its default.

## Secrets and endpoints

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | — | lib/llm, alert-llm-credits, run-tick | OpenRouter key behind every cloud model call; run-tick skips the LLM steps without it and alert-llm-credits reads the balance with it. |
| `GEMINI_API_KEY` | — | lib/ask, refresh-catalysts, refresh-trump, refresh-desk-note | Google AI Studio key: the grounded 'why it moved' lookups (desk note), catalyst extraction, the Trump-trades OCR clean-up, and /api/ask's Gemini path. |
| `ALPHAVANTAGE_API_KEY` | — | patch-margins-av | Alpha Vantage key for the margins backfill (also read from .env.local when unset). |
| `SIMFIN_API_KEY` | — | patch-margins-simfin | SimFin key for the alternative margins backfill. |
| `OPENFIGI_API_KEY` | — | refresh-13f | OpenFIGI key: CUSIP → ticker resolution for 13F holdings (keyless works, rate-limited). |
| `FRED_API_KEY` | — | lib/fred, lib/econCalendar | FRED key for the macro series and the economic-release calendar. |
| `EIA_API_KEY` | — | refresh-energy | EIA key for the Energy dashboard's inventories/production half; a bad key surfaces as HTTP 403 API_KEY_INVALID. |
| `LDA_API_KEY` | — | refresh-lobbying | Senate LDA API key; without it the script falls back to keyless anonymous pulls of the public filings list. |
| `LAKE_S3_ENDPOINT` | — | lib/r2, build-lake, data-from-r2, q | Cloudflare R2 S3 endpoint host (scheme, quotes and trailing slash are tolerated). |
| `LAKE_S3_BUCKET` | — | lib/r2, build-lake, q | R2 bucket holding site-data/ (the data tarball, feeds, runner env) and the research lake. |
| `LAKE_S3_KEY_ID` | — | lib/r2, build-lake, q | R2 access key id. Write access lives only in the tape-runner container and the clean-IP worker. |
| `LAKE_S3_SECRET` | — | lib/r2, build-lake, q | R2 secret key. A stray \r from a CRLF env file shows up as SignatureDoesNotMatch. |
| `RESEARCH_DATABASE_URL` | — | ingest-research, ingest-slack, eval-alerts, ping-research-db | Postgres (Supabase) connection string for the research lake tables. |
| `SUPABASE_URL` | — | lib/research/blob, /api/auth | Supabase project URL for server-side storage and auth calls. |
| `SUPABASE_SECRET_KEY` | — | lib/research/blob, /api/auth | Supabase service-role key — server only, never NEXT_PUBLIC. |
| `RESEND_API_KEY` | — | push-binary-digest | Resend key for the weekly binary-events digest email. |

## Runner and pipeline

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `ALERT_WEBHOOK_URL` | — | lib/alertNotify, run-tick, check-freshness, push-binary-digest, /api/feedback | The ntfy topic URL every alert goes to: run-tick pages on any failed step, the freshness gate on a floor breach; the digest and feedback routes fall back to it. Delivered to the runner through the R2 runner-env channel. |
| `DIGEST_WEBHOOK_URL` | — | push-binary-digest | Webhook for the weekly digest specifically; falls back to ALERT_WEBHOOK_URL. |
| `DIGEST_EMAIL_TO` | — | push-binary-digest | Recipient for the weekly digest email (with RESEND_API_KEY). |
| `DIGEST_EMAIL_FROM` | `Tape <onboarding@resend.dev>` | push-binary-digest | Sender for the weekly digest email. |
| `VERCEL_DEPLOY_HOOK` | — | run-tick, backfill-staples | Vercel deploy-hook URL hit after an upload so the read replica rebuilds (unused while Vercel is paused). |
| `SITE_URL` | — | push-binary-digest | Public base URL used for links inside the weekly digest. |
| `SITE_HEALTH_URL` | `https://tape.truporchhomesvm.com/api/health/data` | check-site-health | Health endpoint the post-deploy check pings. |
| `DEPLOY_CHECK_URL` | — | check-deploy-data | Base URL of the deployment whose served data is compared against the tree just uploaded. |
| `DEPLOY_CHECK_UNIVERSE` | `sp500` | check-deploy-data | Universe the deploy check samples. |
| `DEPLOY_CHECK_SYMBOL` | `AAPL` | check-deploy-data | Symbol the deploy check samples. |
| `PUSH_ALERTS_FORCE` | — | push-alerts | =1 sends push alerts even when this process is not the NAS writer (TAPE_WRITER≠nas). |
| `SEC_USER_AGENT` | `stock-chart-screener (research; jameslyeh@gmail.com)` | refresh-news-tape | User-Agent for the SEC news-tape pull (the SEC asks for a contact). |
| `LLM_CREDIT_MIN` | `10` | alert-llm-credits | Page when the OpenRouter balance (USD) drops under this. |
| `TAPE_WRITER` | `github in Actions, else local` | data-to-r2, push-alerts, lib/companyArchive | Who this process is when it stamps R2: nas \| pc \| worker \| github \| local. The CI pipeline stands down to a fresh nas stamp; push-alerts sends only as nas. |
| `GITHUB_ACTIONS` | — | data-to-r2, lib/companyArchive | Set by GitHub itself; makes the default writer 'github'. |
| `TAPE_TICK_MODE` | — | run-tick → refresh-call-digests | Set by run-tick for its child steps (full \| desk \| quotes \| …) so a step can size its budget to the tick. |
| `TAPE_PULL` | — | run-tick | =1 makes run-tick itself `git pull` (and `npm ci` on a lockfile change) before the steps; the container entrypoint normally does this. |
| `TAPE_RUNNER_ENV_FILE` | `/app/.alert-env` | sync-runner-env | Where the R2 runner-env channel is written for the entrypoint to source. |
| `NEWS_ARCHIVE` | — | run-tick → lib/newsArchive | Set to 1 by run-tick and the workflow so every getNews call tees its headlines into the persistent archive; never set on the read-only web/Vercel filesystems. |
| `FULL` | — | data-to-r2 | =true marks a FULL tick's upload so the FULL-only writes (the per-object feeds) fire. |
| `TICK_FAILS` | — | run-tick → data-to-r2 | Failed-step count of the tick being uploaded, stamped into the R2 manifest heartbeat. |
| `TICK_TOTAL` | — | run-tick → data-to-r2 | Planned-step count of the tick being uploaded (with TICK_FAILS: a majority-failed heartbeat alarms even when fresh). |
| `LAKE_REQUIRE_R2` | — | data-from-r2 | =1 (set by the web entrypoint) makes a missing R2 config a hard failure instead of a silent reuse of the old data/ tree. |
| `FRESH_MAX_HOURS` | `28` | alert-freshness | Heartbeat age (hours) past which the freshness alert fires. |
| `STAPLES_SCAN_DIR` | `./staples-scans` | refresh-staples-scanner, backfill-staples | Folder of licensed NielsenIQ scan PDFs (outside data/, never uploaded). |
| `LAKE_DIR` | `lake` | build-lake, q | Local folder for the Parquet research lake before it ships to R2. |
| `CALL_DIGEST_PUBLISH` | — | refresh-call-digests | =1 merges the output with R2's site-data/call-digests.json and publishes it — the clean-IP worker's mode. |

## Web server

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `FEEDBACK_WEBHOOK_URL` | — | /api/feedback | Where the in-app feedback widget posts; falls back to ALERT_WEBHOOK_URL. |
| `NTFY_BASE` | `https://ntfy.sh` | lib/pushSubs | ntfy server for the site's push subscriptions. |
| `PUSH_CLICK_BASE` | — | lib/pushSubs | Base URL the push notifications' click-through links point at. |
| `RESEARCH_BUCKET` | `research` | lib/research/blob | Supabase storage bucket for research blobs. |
| `NEXT_RUNTIME` | — | lib/llmUsage | Set by Next itself in the server process; marks the web slot so the daily AI ceiling applies there and never to the nightly scripts. |
| `LLM_WEB_DAILY_CAP_USD` | `5` | lib/llmUsage | Daily ceiling on the web process's live model spend; past it lib/llm declines calls and routes fall to their 'couldn't generate' paths. 0 disables. |
| `LLM_ROUTE_IP_BURST` | `40` | lib/llmGuard | Per-IP token bucket on the 16 LLM routes: burst size. |
| `LLM_ROUTE_IP_PER_MIN` | `10` | lib/llmGuard | Per-IP refill, requests per minute. |
| `LLM_ROUTE_GLOBAL_BURST` | `200` | lib/llmGuard | Site-wide token bucket on the LLM routes: burst size. |
| `LLM_ROUTE_GLOBAL_PER_MIN` | `40` | lib/llmGuard | Site-wide refill, requests per minute. |
| `ASK_PRIMARY_TIMEOUT_MS` | `40000` | lib/ask | /api/ask: how long the primary model may take before the rescue path starts. |
| `ASK_RESCUE_TIMEOUT_MS` | `15000` | lib/ask | /api/ask: the rescue model's ceiling. |

## Build-time

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_APP_VERSION` | — | next.config → status page, VersionBadge, FeedbackWidget | package.json version, shown by the version badge and the status page. |
| `NEXT_PUBLIC_GIT_SHA` | — | next.config → status page, VersionBadge, InstallPWA, FeedbackWidget | Short git SHA of the build, so 'did my fix deploy?' is answerable from the page. |
| `NEXT_PUBLIC_BUILD_TIME` | — | next.config → status page, VersionBadge | ISO build timestamp. |
| `NEXT_PUBLIC_SUPABASE_URL` | — | lib/supabase client + server | Supabase project URL for the browser client (public by design; committed in next.config). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | lib/supabase client + server | Supabase publishable key (public by design; RLS does the guarding). |

## Per-script tuning

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | lib/llm | OpenAI-compatible base URL for the cloud tier. |
| `LLM_MODEL` | `z-ai/glm-5.2` | lib/llm | Default model for chatJSON calls that don't pin one. |
| `LLM_PRO_MODEL` | `z-ai/glm-5.2` | lib/llm | The PRO tier (second opinions, syntheses). |
| `LLM_FLASH_MODEL` | `google/gemini-2.5-flash-lite` | lib/llm | The FLASH tier (bulk extraction: filings, transcripts, guidance). |
| `LLM_PROVIDER_IGNORE` | `DeepSeek,Moonshot AI,Z.AI,Alibaba,SiliconFlow,Chutes` | lib/llm | OpenRouter providers excluded from routing (comma list). |
| `LLM_PROVIDER_ORDER` | — | lib/llm | Preferred OpenRouter provider order (comma list). |
| `LLM_PROVIDER_OPEN` | — | lib/llm | =1 drops the provider constraints entirely (any provider may serve the call). |
| `LLM_LOCAL_BASE_URL` | — | lib/llm, refresh-call-digests, bench-prefill | OpenAI-compatible URL of a local model server (vLLM on the rig). Calls opting in with local:true go here; the call digests scope it through CALL_DIGEST_LOCAL_URL instead. |
| `LLM_LOCAL_MODEL` | — | lib/llm, refresh-call-digests, bench-prefill | Model name served by the local server. |
| `LLM_LOCAL_API_KEY` | `local` | lib/llm, bench-prefill | Key for the local server, if it wants one. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | lib/ask, refresh-trump | Gemini model for /api/ask and the Trump-trades OCR clean-up. |
| `GEMINI_FALLBACK_MODEL` | `gemini-2.5-flash` | lib/ask | Gemini model for /api/ask's rescue path. |
| `DESK_GROUNDED_MODEL` | `gemini-2.5-flash` | refresh-desk-note | Gemini model for the grounded 'why it moved' lookups in the desk note. |
| `DESK_GROUNDED_MAX` | `10` | refresh-desk-note | Most grounded lookups per desk note. |
| `DESK_GROUNDED_BIG` | `8` | refresh-desk-note | Move size (%) from which a name earns a grounded lookup. |
| `OVERNIGHT_BUDGET_MIN` | `38` | refresh-overnight-filings | Wall-clock budget (minutes) for the overnight filings digest. |
| `OVERNIGHT_MODEL` | `LLM_FLASH_MODEL` | refresh-overnight-filings | Model for the filing digests. |
| `OVERNIGHT_SECTIONS` | — | refresh-overnight-filings | =1 section-targets long filings (head + first material section) instead of a blind head-slice. Off until a night's digests are compared. |
| `OVERNIGHT_SECTION_CAP` | `70000` | refresh-overnight-filings | Character cap for the section-targeted clip. |
| `OVERNIGHT_PRIOR_CAP` | `50000` | refresh-overnight-filings | Character cap on the PRIOR filing (a comparison baseline only) — the biggest input-token line in the bill. |
| `WINDOW_HOURS` | `36` | refresh-overnight-filings | How far back the filings scan looks. |
| `SCAN_BROAD` | — | refresh-overnight-filings | =1 scans the broad universe rather than the core one. |
| `CALL_DIGEST_BUDGET_MIN` | `desk 12 / full 40 / else 30` | refresh-call-digests | Wall-clock budget (minutes); sized by tick mode when unset. |
| `CALL_DIGEST_CAP` | `30` | refresh-call-digests | Most transcripts digested per run. |
| `CALL_DIGEST_CONCURRENCY` | `6 cloud / 2 local` | refresh-call-digests | Transcripts in flight at once. |
| `CALL_DIGEST_LOOKBACK_DAYS` | `7` | refresh-call-digests | How many days back a call may be (the sources lag). |
| `CALL_DIGEST_LOCAL_ONLY` | — | refresh-call-digests | =1 refuses the cloud tier (local model or nothing). |
| `BUYBACK_BUDGET_MIN` | `30` | refresh-buybacks | Wall-clock budget (minutes). |
| `BUYBACK_MAX_AGE_DAYS` | `7` | refresh-buybacks | Re-read a name's facts only when older than this. |
| `FRAMES` | — | refresh-buybacks, refresh-valuation-history | =0 forces the blanket age rule instead of the XBRL frames detector when deciding what to re-read. |
| `BACKFILL` | `0` | refresh-guidance, refresh-sss, refresh-sss-intl | 0 = incremental (latest 8-K only); N = walk the last N filings to seed the history. |
| `MAXTOK` | `16000` | refresh-guidance, refresh-sss, refresh-sss-intl | max_tokens for the extraction calls (a reasoning model eats the budget before it answers). |
| `GUIDANCE_MODEL` | `LLM_FLASH_MODEL` | refresh-guidance | Model for guidance extraction. |
| `COMP_GUIDE_MODEL` | `LLM_FLASH_MODEL` | refresh-sss | Model for the comp-outlook schema fill. |
| `GUIDE_MAX` | `80` | refresh-sss | Most comp-outlook backfills per run. |
| `TAKE` | `BACKFILL or 1` | refresh-sss-intl | Results announcements read per name. |
| `COMPANY_CACHE_BUDGET_MIN` | `30` | refresh-company-cache | Wall-clock budget (minutes). |
| `COMPANY_CACHE_CONCURRENCY` | `6` | refresh-company-cache | Yahoo fetches in flight. |
| `COMPANY_CACHE_MAX` | `100000` | refresh-company-cache | Safety cap on fetches per run. |
| `COMPANY_CACHE_STALE_DAYS` | `2` | refresh-company-cache | A cached name is re-fetched when older than this. |
| `COMPANY_CACHE_EXTRA` | — | refresh-company-cache | Comma list of symbols to cache beyond the universes. |
| `COMPANY_CACHE_PC_DARK_WARN_H` | `26` | refresh-company-cache | Page when the clean-IP writer's stamp is older than this many hours. |
| `EARNINGS_MOVE_BUDGET_MIN` | `30` | refresh-earnings-move | Wall-clock budget (minutes). |
| `PAIRS_BUDGET_MIN` | `15` | refresh-pairs | Wall-clock budget (minutes). |
| `PAIRS_MAX_PER_SECTOR` | `120` | refresh-pairs | Most pairs scored per sector. |
| `PAIRS_MAX_STALE_DAYS` | `10` | refresh-pairs | Carry a pair forward at most this many days without a fresh read. |
| `VALUATION_BUDGET_MIN` | `25` | refresh-valuation-history | Wall-clock budget (minutes). |
| `GRID_BUDGET_MIN` | `20` | refresh-signal-grid | Wall-clock budget (minutes). |
| `GRID_UNIVERSES` | `sp500,nasdaq100,russell1000,russell3000` | refresh-signal-grid | Universes the signal grid covers. |
| `GAMMA_TOP` | `140` | refresh-gamma-board | Names on the gamma board. |
| `GAMMA_MAX_EXP` | `3` | refresh-gamma-board | Expirations read per name. |
| `DISP_TOP` | `100` | refresh-dispersion | Names on the dispersion board. |
| `VOL_UNIVERSE` | `russell1000` | refresh-vol-universe | Universe the vol probe scans. |
| `VOL_MIN_MKTCAP` | `1e9` | refresh-vol-universe | Market-cap floor (USD) for the vol universe. |
| `PREVIEW_LOG_CAP` | `60` | refresh-preview-log | Most new earnings forecasts per run. |
| `TRADE_PICKS` | `8` | refresh-trade-ideas | Trade ideas written per run. |
| `SPAC_LIMIT` | `unlimited` | refresh-spac-arb | Cap on SPACs processed. |
| `DEBATE_WINDOW_DAYS` | `120` | refresh-debates | How far back a debate candidate may be. |
| `DEBATE_KEEP` | `4000` | refresh-debates | Ledger rows retained. |
| `INDEX_KEEP` | `10000` | refresh-filing-index | Filing-index rows retained (newest first). |
| `INDEX_REL_K` | `6` | refresh-filing-index | Nearest neighbours kept per note. |
| `INDEX_REL_MIN` | `0.5` | refresh-filing-index | Minimum cosine similarity to count as related. |
| `NEWS_TAPE_KEEP` | `20000` | refresh-news-tape | Headlines retained in the news tape. |
| `NEWS_TAPE_TIMEOUT_MS` | `20000` | refresh-news-tape | Per-source fetch timeout. |
| `EVENTS_PER_NIGHT` | `150` | refresh-regime-replay | Earnings events graded per night by the (currently orphaned) regime replay. |
| `LOBBY_YEAR` | `2026` | refresh-lobbying | Filing year pulled. |
| `LOBBY_MAX_PAGES` | `1200 (4000 with SEED)` | refresh-lobbying | Page budget per run. |
| `STAPLES_SCAN_CAP` | `30000` | refresh-staples-scanner | Characters of each scan note sent to the model. |
| `AV_BUDGET` | `24` | patch-margins-av | Alpha Vantage calls per run (the free tier is 25/day). |

## Lab, evals and benches

| Knob | Default | Read by | Purpose |
|---|---|---|---|
| `TEST_SYMBOLS` | — | refresh-overnight-filings, refresh-call-digests | Comma list of symbols to run alone — a bounded test run. |
| `CALL_DIGEST_DEBUG` | — | refresh-call-digests | =1 logs each stage's raw reply shape and why a digest was rejected. |
| `FORCE` | — | refresh-call-digests, refresh-staples-scanner | =1 re-processes items already done (ignores the seen/extracted caches). |
| `CAP` | `0` | refresh-buybacks | Limit the number of names (quick test run); 0 = all. |
| `ONLY` | — | refresh-buybacks, refresh-guidance, refresh-sss, refresh-quotes | Comma list of symbols (or universes, for refresh-quotes) to process alone. |
| `LIMIT` | — | build-data, refresh-guidance, refresh-vol-tags | Cap on names processed this run (build-data: 0 = all; vol-tags: the top-N budget, default 24). |
| `INDUSTRY` | — | refresh-sss | Restrict the same-store-sales run to one industry (e.g. Restaurants). |
| `SEED` | — | refresh-lobbying | Set to seed the store from the start of the year instead of advancing the cursor. |
| `CHUNK_LIMIT` | `unlimited` | refresh-trump | Cap on OCR chunks processed (a bounded test run). |
| `FORCE_CAPTURE` | — | capture-trade-spreads | Set to capture spreads outside market hours. |
| `CANDIDATE` | `qwen/qwen-2.5-72b-instruct` | eval-local-model | Model under test. |
| `MODELS` | `z-ai/glm-5.2,moonshotai/kimi-k3` | eval-model-shootout | Contenders (comma list). |
| `JUDGES` | `google/gemini-3.1-pro-preview,google/gemini-3.7-flash` | eval-model-shootout | Judge models (comma list). |
| `LEGS` | `abcd` | eval-model-shootout | Which legs to run (letters). |
| `RUNS` | `1` | eval-model-shootout | Repetitions per leg (1–10). |
| `CONCURRENCY` | `1,4` | bench-prefill | Concurrency levels to bench (comma list). |
| `PROMPT_TOKENS` | `12000` | bench-prefill | Prompt size to bench. |
| `NIGHT_TOKENS` | `4500000` | bench-prefill | A night's input tokens, for the projection. |
| `ROUNDS` | `5` | bench-prefill | Rounds per level. |
| `STEP_MIN` | `45` | bench-prefill | run-tick's per-step ceiling, for the projection. |
