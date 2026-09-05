/**
 * Every environment knob the code reads, in ONE place: name, scope, default, where it is read, what it
 * does. tests/envManifest fails when a `process.env.X` appears in scripts/, lib/, app/ or components/
 * that isn't listed here — or when a listed knob is no longer read anywhere — and docs/ENV.md is
 * rendered from this table (`npm run gen-env-reference`; the test also fails when that file is stale).
 *
 * Found in the 2026-09-05 review: 149 knobs, 27 of them in an env example; the rest were discoverable
 * only by reading each script. Pure data — safe to import from anywhere.
 */
export type EnvScope =
  | "secret"  // a credential; lives in tape.env (NAS), the R2 runner-env channel, or a GitHub secret
  | "runner"  // the NAS tick / CI pipeline: where things upload, who is paged, how the tick behaves
  | "web"     // the Next server (tape-web) at request time
  | "build"   // baked into the bundle by next.config at build time
  | "tuning"  // per-script budgets, caps, windows and model pins — safe to leave unset
  | "lab";    // one-off, eval and bench scripts; never set in production

export interface EnvKnob {
  name: string;
  scope: EnvScope;
  /** What the code uses when unset. Omit when unset means "feature off" and `purpose` says so. */
  default?: string;
  /** The script or module that reads it (npm-script or lib name, not a path — paths rot). */
  where: string;
  purpose: string;
}

const K = (name: string, scope: EnvScope, where: string, purpose: string, def?: string): EnvKnob =>
  def === undefined ? { name, scope, where, purpose } : { name, scope, where, purpose, default: def };

export const ENV_KNOBS: readonly EnvKnob[] = [
  // ── Secrets ────────────────────────────────────────────────────────────────────────────────────
  K("OPENROUTER_API_KEY", "secret", "lib/llm, alert-llm-credits, run-tick", "OpenRouter key behind every cloud model call; run-tick skips the LLM steps without it and alert-llm-credits reads the balance with it."),
  K("GEMINI_API_KEY", "secret", "lib/ask, refresh-catalysts, refresh-trump, refresh-desk-note", "Google AI Studio key: the grounded 'why it moved' lookups (desk note), catalyst extraction, the Trump-trades OCR clean-up, and /api/ask's Gemini path."),
  K("ALPHAVANTAGE_API_KEY", "secret", "patch-margins-av", "Alpha Vantage key for the margins backfill (also read from .env.local when unset)."),
  K("SIMFIN_API_KEY", "secret", "patch-margins-simfin", "SimFin key for the alternative margins backfill."),
  K("OPENFIGI_API_KEY", "secret", "refresh-13f", "OpenFIGI key: CUSIP → ticker resolution for 13F holdings (keyless works, rate-limited)."),
  K("FRED_API_KEY", "secret", "lib/fred, lib/econCalendar", "FRED key for the macro series and the economic-release calendar."),
  K("EIA_API_KEY", "secret", "refresh-energy", "EIA key for the Energy dashboard's inventories/production half; a bad key surfaces as HTTP 403 API_KEY_INVALID."),
  K("LDA_API_KEY", "secret", "refresh-lobbying", "Senate LDA API key; without it the script falls back to keyless anonymous pulls of the public filings list."),
  K("LAKE_S3_ENDPOINT", "secret", "lib/r2, build-lake, data-from-r2, q", "Cloudflare R2 S3 endpoint host (scheme, quotes and trailing slash are tolerated)."),
  K("LAKE_S3_BUCKET", "secret", "lib/r2, build-lake, q", "R2 bucket holding site-data/ (the data tarball, feeds, runner env) and the research lake."),
  K("LAKE_S3_KEY_ID", "secret", "lib/r2, build-lake, q", "R2 access key id. Write access lives only in the tape-runner container and the clean-IP worker."),
  K("LAKE_S3_SECRET", "secret", "lib/r2, build-lake, q", "R2 secret key. A stray \\r from a CRLF env file shows up as SignatureDoesNotMatch."),
  K("RESEARCH_DATABASE_URL", "secret", "ingest-research, ingest-slack, eval-alerts, ping-research-db", "Postgres (Supabase) connection string for the research lake tables."),
  K("SUPABASE_URL", "secret", "lib/research/blob, /api/auth", "Supabase project URL for server-side storage and auth calls."),
  K("SUPABASE_SECRET_KEY", "secret", "lib/research/blob, /api/auth", "Supabase service-role key — server only, never NEXT_PUBLIC."),
  K("RESEND_API_KEY", "secret", "push-binary-digest", "Resend key for the weekly binary-events digest email."),
  K("ALERT_WEBHOOK_URL", "runner", "lib/alertNotify, run-tick, check-freshness, push-binary-digest, /api/feedback", "The ntfy topic URL every alert goes to: run-tick pages on any failed step, the freshness gate on a floor breach; the digest and feedback routes fall back to it. Delivered to the runner through the R2 runner-env channel."),
  K("DIGEST_WEBHOOK_URL", "runner", "push-binary-digest", "Webhook for the weekly digest specifically; falls back to ALERT_WEBHOOK_URL."),
  K("DIGEST_EMAIL_TO", "runner", "push-binary-digest", "Recipient for the weekly digest email (with RESEND_API_KEY)."),
  K("DIGEST_EMAIL_FROM", "runner", "push-binary-digest", "Sender for the weekly digest email.", "Tape <onboarding@resend.dev>"),
  K("FEEDBACK_WEBHOOK_URL", "web", "/api/feedback", "Where the in-app feedback widget posts; falls back to ALERT_WEBHOOK_URL."),
  K("VERCEL_DEPLOY_HOOK", "runner", "run-tick, backfill-staples", "Vercel deploy-hook URL hit after an upload so the read replica rebuilds (unused while Vercel is paused)."),
  K("SITE_URL", "runner", "push-binary-digest", "Public base URL used for links inside the weekly digest."),
  K("SITE_HEALTH_URL", "runner", "check-site-health", "Health endpoint the post-deploy check pings.", "https://tape.truporchhomesvm.com/api/health/data"),
  K("DEPLOY_CHECK_URL", "runner", "check-deploy-data", "Base URL of the deployment whose served data is compared against the tree just uploaded."),
  K("DEPLOY_CHECK_UNIVERSE", "runner", "check-deploy-data", "Universe the deploy check samples.", "sp500"),
  K("DEPLOY_CHECK_SYMBOL", "runner", "check-deploy-data", "Symbol the deploy check samples.", "AAPL"),
  K("NTFY_BASE", "web", "lib/pushSubs", "ntfy server for the site's push subscriptions.", "https://ntfy.sh"),
  K("PUSH_CLICK_BASE", "web", "lib/pushSubs", "Base URL the push notifications' click-through links point at."),
  K("PUSH_ALERTS_FORCE", "runner", "push-alerts", "=1 sends push alerts even when this process is not the NAS writer (TAPE_WRITER≠nas)."),
  K("SEC_USER_AGENT", "runner", "refresh-news-tape", "User-Agent for the SEC news-tape pull (the SEC asks for a contact).", "stock-chart-screener (research; jameslyeh@gmail.com)"),
  K("RESEARCH_BUCKET", "web", "lib/research/blob", "Supabase storage bucket for research blobs.", "research"),

  // ── Build-time (next.config bakes these into the bundle) ───────────────────────────────────────
  K("NEXT_PUBLIC_APP_VERSION", "build", "next.config → status page, VersionBadge, FeedbackWidget", "package.json version, shown by the version badge and the status page."),
  K("NEXT_PUBLIC_GIT_SHA", "build", "next.config → status page, VersionBadge, InstallPWA, FeedbackWidget", "Short git SHA of the build, so 'did my fix deploy?' is answerable from the page."),
  K("NEXT_PUBLIC_BUILD_TIME", "build", "next.config → status page, VersionBadge", "ISO build timestamp."),
  K("NEXT_PUBLIC_SUPABASE_URL", "build", "lib/supabase client + server", "Supabase project URL for the browser client (public by design; committed in next.config)."),
  K("NEXT_PUBLIC_SUPABASE_ANON_KEY", "build", "lib/supabase client + server", "Supabase publishable key (public by design; RLS does the guarding)."),
  K("NEXT_RUNTIME", "web", "lib/llmUsage", "Set by Next itself in the server process; marks the web slot so the daily AI ceiling applies there and never to the nightly scripts."),

  // ── The LLM layer (lib/llm and the routes) ─────────────────────────────────────────────────────
  K("LLM_BASE_URL", "tuning", "lib/llm", "OpenAI-compatible base URL for the cloud tier.", "https://openrouter.ai/api/v1"),
  K("LLM_MODEL", "tuning", "lib/llm", "Default model for chatJSON calls that don't pin one.", "z-ai/glm-5.2"),
  K("LLM_PRO_MODEL", "tuning", "lib/llm", "The PRO tier (second opinions, syntheses).", "z-ai/glm-5.2"),
  K("LLM_FLASH_MODEL", "tuning", "lib/llm", "The FLASH tier (bulk extraction: filings, transcripts, guidance).", "google/gemini-2.5-flash-lite"),
  K("LLM_PROVIDER_IGNORE", "tuning", "lib/llm", "OpenRouter providers excluded from routing (comma list).", "DeepSeek,Moonshot AI,Z.AI,Alibaba,SiliconFlow,Chutes"),
  K("LLM_PROVIDER_ORDER", "tuning", "lib/llm", "Preferred OpenRouter provider order (comma list)."),
  K("LLM_PROVIDER_OPEN", "tuning", "lib/llm", "=1 drops the provider constraints entirely (any provider may serve the call)."),
  K("LLM_LOCAL_BASE_URL", "tuning", "lib/llm, refresh-call-digests, bench-prefill", "OpenAI-compatible URL of a local model server (vLLM on the rig). Calls opting in with local:true go here; the call digests scope it through CALL_DIGEST_LOCAL_URL instead."),
  K("LLM_LOCAL_MODEL", "tuning", "lib/llm, refresh-call-digests, bench-prefill", "Model name served by the local server."),
  K("LLM_LOCAL_API_KEY", "tuning", "lib/llm, bench-prefill", "Key for the local server, if it wants one.", "local"),
  K("LLM_WEB_DAILY_CAP_USD", "web", "lib/llmUsage", "Daily ceiling on the web process's live model spend; past it lib/llm declines calls and routes fall to their 'couldn't generate' paths. 0 disables.", "5"),
  K("LLM_ROUTE_IP_BURST", "web", "lib/llmGuard", "Per-IP token bucket on the 16 LLM routes: burst size.", "40"),
  K("LLM_ROUTE_IP_PER_MIN", "web", "lib/llmGuard", "Per-IP refill, requests per minute.", "10"),
  K("LLM_ROUTE_GLOBAL_BURST", "web", "lib/llmGuard", "Site-wide token bucket on the LLM routes: burst size.", "200"),
  K("LLM_ROUTE_GLOBAL_PER_MIN", "web", "lib/llmGuard", "Site-wide refill, requests per minute.", "40"),
  K("LLM_CREDIT_MIN", "runner", "alert-llm-credits", "Page when the OpenRouter balance (USD) drops under this.", "10"),
  K("ASK_PRIMARY_TIMEOUT_MS", "web", "lib/ask", "/api/ask: how long the primary model may take before the rescue path starts.", "40000"),
  K("ASK_RESCUE_TIMEOUT_MS", "web", "lib/ask", "/api/ask: the rescue model's ceiling.", "15000"),
  K("GEMINI_MODEL", "tuning", "lib/ask, refresh-trump", "Gemini model for /api/ask and the Trump-trades OCR clean-up.", "gemini-2.5-flash"),
  K("GEMINI_FALLBACK_MODEL", "tuning", "lib/ask", "Gemini model for /api/ask's rescue path.", "gemini-2.5-flash"),
  K("DESK_GROUNDED_MODEL", "tuning", "refresh-desk-note", "Gemini model for the grounded 'why it moved' lookups in the desk note.", "gemini-2.5-flash"),
  K("DESK_GROUNDED_MAX", "tuning", "refresh-desk-note", "Most grounded lookups per desk note.", "10"),
  K("DESK_GROUNDED_BIG", "tuning", "refresh-desk-note", "Move size (%) from which a name earns a grounded lookup.", "8"),

  // ── The runner / pipeline ──────────────────────────────────────────────────────────────────────
  K("TAPE_WRITER", "runner", "data-to-r2, push-alerts, lib/companyArchive", "Who this process is when it stamps R2: nas | pc | worker | github | local. The CI pipeline stands down to a fresh nas stamp; push-alerts sends only as nas.", "github in Actions, else local"),
  K("GITHUB_ACTIONS", "runner", "data-to-r2, lib/companyArchive", "Set by GitHub itself; makes the default writer 'github'."),
  K("TAPE_TICK_MODE", "runner", "run-tick → refresh-call-digests", "Set by run-tick for its child steps (full | desk | quotes | …) so a step can size its budget to the tick."),
  K("TAPE_PULL", "runner", "run-tick", "=1 makes run-tick itself `git pull` (and `npm ci` on a lockfile change) before the steps; the container entrypoint normally does this."),
  K("TAPE_RUNNER_ENV_FILE", "runner", "sync-runner-env", "Where the R2 runner-env channel is written for the entrypoint to source.", "/app/.alert-env"),
  K("NEWS_ARCHIVE", "runner", "run-tick → lib/newsArchive", "Set to 1 by run-tick and the workflow so every getNews call tees its headlines into the persistent archive; never set on the read-only web/Vercel filesystems."),
  K("FULL", "runner", "data-to-r2", "=true marks a FULL tick's upload so the FULL-only writes (the per-object feeds) fire."),
  K("TICK_FAILS", "runner", "run-tick → data-to-r2", "Failed-step count of the tick being uploaded, stamped into the R2 manifest heartbeat."),
  K("TICK_TOTAL", "runner", "run-tick → data-to-r2", "Planned-step count of the tick being uploaded (with TICK_FAILS: a majority-failed heartbeat alarms even when fresh)."),
  K("LAKE_REQUIRE_R2", "runner", "data-from-r2", "=1 (set by the web entrypoint) makes a missing R2 config a hard failure instead of a silent reuse of the old data/ tree."),
  K("FRESH_MAX_HOURS", "runner", "alert-freshness", "Heartbeat age (hours) past which the freshness alert fires.", "28"),
  K("STAPLES_SCAN_DIR", "runner", "refresh-staples-scanner, backfill-staples", "Folder of licensed NielsenIQ scan PDFs (outside data/, never uploaded).", "./staples-scans"),
  K("LAKE_DIR", "runner", "build-lake, q", "Local folder for the Parquet research lake before it ships to R2.", "lake"),

  // ── Per-script tuning ──────────────────────────────────────────────────────────────────────────
  K("OVERNIGHT_BUDGET_MIN", "tuning", "refresh-overnight-filings", "Wall-clock budget (minutes) for the overnight filings digest.", "38"),
  K("OVERNIGHT_MODEL", "tuning", "refresh-overnight-filings", "Model for the filing digests.", "LLM_FLASH_MODEL"),
  K("OVERNIGHT_SECTIONS", "tuning", "refresh-overnight-filings", "=1 section-targets long filings (head + first material section) instead of a blind head-slice. Off until a night's digests are compared."),
  K("OVERNIGHT_SECTION_CAP", "tuning", "refresh-overnight-filings", "Character cap for the section-targeted clip.", "70000"),
  K("OVERNIGHT_PRIOR_CAP", "tuning", "refresh-overnight-filings", "Character cap on the PRIOR filing (a comparison baseline only) — the biggest input-token line in the bill.", "50000"),
  K("WINDOW_HOURS", "tuning", "refresh-overnight-filings", "How far back the filings scan looks.", "36"),
  K("SCAN_BROAD", "tuning", "refresh-overnight-filings", "=1 scans the broad universe rather than the core one."),
  K("TEST_SYMBOLS", "lab", "refresh-overnight-filings, refresh-call-digests", "Comma list of symbols to run alone — a bounded test run."),
  K("CALL_DIGEST_BUDGET_MIN", "tuning", "refresh-call-digests", "Wall-clock budget (minutes); sized by tick mode when unset.", "desk 12 / full 40 / else 30"),
  K("CALL_DIGEST_CAP", "tuning", "refresh-call-digests", "Most transcripts digested per run.", "30"),
  K("CALL_DIGEST_CONCURRENCY", "tuning", "refresh-call-digests", "Transcripts in flight at once.", "6 cloud / 2 local"),
  K("CALL_DIGEST_LOOKBACK_DAYS", "tuning", "refresh-call-digests", "How many days back a call may be (the sources lag).", "7"),
  K("CALL_DIGEST_PUBLISH", "runner", "refresh-call-digests", "=1 merges the output with R2's site-data/call-digests.json and publishes it — the clean-IP worker's mode."),
  K("CALL_DIGEST_LOCAL_ONLY", "tuning", "refresh-call-digests", "=1 refuses the cloud tier (local model or nothing)."),
  K("CALL_DIGEST_DEBUG", "lab", "refresh-call-digests", "=1 logs each stage's raw reply shape and why a digest was rejected."),
  K("FORCE", "lab", "refresh-call-digests, refresh-staples-scanner", "=1 re-processes items already done (ignores the seen/extracted caches)."),
  K("BUYBACK_BUDGET_MIN", "tuning", "refresh-buybacks", "Wall-clock budget (minutes).", "30"),
  K("BUYBACK_MAX_AGE_DAYS", "tuning", "refresh-buybacks", "Re-read a name's facts only when older than this.", "7"),
  K("CAP", "lab", "refresh-buybacks", "Limit the number of names (quick test run); 0 = all.", "0"),
  K("FRAMES", "tuning", "refresh-buybacks, refresh-valuation-history", "=0 forces the blanket age rule instead of the XBRL frames detector when deciding what to re-read."),
  K("ONLY", "lab", "refresh-buybacks, refresh-guidance, refresh-sss, refresh-quotes", "Comma list of symbols (or universes, for refresh-quotes) to process alone."),
  K("LIMIT", "lab", "build-data, refresh-guidance, refresh-vol-tags", "Cap on names processed this run (build-data: 0 = all; vol-tags: the top-N budget, default 24)."),
  K("BACKFILL", "tuning", "refresh-guidance, refresh-sss, refresh-sss-intl", "0 = incremental (latest 8-K only); N = walk the last N filings to seed the history.", "0"),
  K("MAXTOK", "tuning", "refresh-guidance, refresh-sss, refresh-sss-intl", "max_tokens for the extraction calls (a reasoning model eats the budget before it answers).", "16000"),
  K("GUIDANCE_MODEL", "tuning", "refresh-guidance", "Model for guidance extraction.", "LLM_FLASH_MODEL"),
  K("COMP_GUIDE_MODEL", "tuning", "refresh-sss", "Model for the comp-outlook schema fill.", "LLM_FLASH_MODEL"),
  K("GUIDE_MAX", "tuning", "refresh-sss", "Most comp-outlook backfills per run.", "80"),
  K("INDUSTRY", "lab", "refresh-sss", "Restrict the same-store-sales run to one industry (e.g. Restaurants)."),
  K("TAKE", "tuning", "refresh-sss-intl", "Results announcements read per name.", "BACKFILL or 1"),
  K("COMPANY_CACHE_BUDGET_MIN", "tuning", "refresh-company-cache", "Wall-clock budget (minutes).", "30"),
  K("COMPANY_CACHE_CONCURRENCY", "tuning", "refresh-company-cache", "Yahoo fetches in flight.", "6"),
  K("COMPANY_CACHE_MAX", "tuning", "refresh-company-cache", "Safety cap on fetches per run.", "100000"),
  K("COMPANY_CACHE_STALE_DAYS", "tuning", "refresh-company-cache", "A cached name is re-fetched when older than this.", "2"),
  K("COMPANY_CACHE_EXTRA", "tuning", "refresh-company-cache", "Comma list of symbols to cache beyond the universes."),
  K("COMPANY_CACHE_PC_DARK_WARN_H", "tuning", "refresh-company-cache", "Page when the clean-IP writer's stamp is older than this many hours.", "26"),
  K("EARNINGS_MOVE_BUDGET_MIN", "tuning", "refresh-earnings-move", "Wall-clock budget (minutes).", "30"),
  K("PAIRS_BUDGET_MIN", "tuning", "refresh-pairs", "Wall-clock budget (minutes).", "15"),
  K("PAIRS_MAX_PER_SECTOR", "tuning", "refresh-pairs", "Most pairs scored per sector.", "120"),
  K("PAIRS_MAX_STALE_DAYS", "tuning", "refresh-pairs", "Carry a pair forward at most this many days without a fresh read.", "10"),
  K("VALUATION_BUDGET_MIN", "tuning", "refresh-valuation-history", "Wall-clock budget (minutes).", "25"),
  K("GRID_BUDGET_MIN", "tuning", "refresh-signal-grid", "Wall-clock budget (minutes).", "20"),
  K("GRID_UNIVERSES", "tuning", "refresh-signal-grid", "Universes the signal grid covers.", "sp500,nasdaq100,russell1000,russell3000"),
  K("GAMMA_TOP", "tuning", "refresh-gamma-board", "Names on the gamma board.", "140"),
  K("GAMMA_MAX_EXP", "tuning", "refresh-gamma-board", "Expirations read per name.", "3"),
  K("DISP_TOP", "tuning", "refresh-dispersion", "Names on the dispersion board.", "100"),
  K("VOL_UNIVERSE", "tuning", "refresh-vol-universe", "Universe the vol probe scans.", "russell1000"),
  K("VOL_MIN_MKTCAP", "tuning", "refresh-vol-universe", "Market-cap floor (USD) for the vol universe.", "1e9"),
  K("PREVIEW_LOG_CAP", "tuning", "refresh-preview-log", "Most new earnings forecasts per run.", "60"),
  K("TRADE_PICKS", "tuning", "refresh-trade-ideas", "Trade ideas written per run.", "8"),
  K("SPAC_LIMIT", "tuning", "refresh-spac-arb", "Cap on SPACs processed.", "unlimited"),
  K("DEBATE_WINDOW_DAYS", "tuning", "refresh-debates", "How far back a debate candidate may be.", "120"),
  K("DEBATE_KEEP", "tuning", "refresh-debates", "Ledger rows retained.", "4000"),
  K("INDEX_KEEP", "tuning", "refresh-filing-index", "Filing-index rows retained (newest first).", "10000"),
  K("INDEX_REL_K", "tuning", "refresh-filing-index", "Nearest neighbours kept per note.", "6"),
  K("INDEX_REL_MIN", "tuning", "refresh-filing-index", "Minimum cosine similarity to count as related.", "0.5"),
  K("NEWS_TAPE_KEEP", "tuning", "refresh-news-tape", "Headlines retained in the news tape.", "20000"),
  K("NEWS_TAPE_TIMEOUT_MS", "tuning", "refresh-news-tape", "Per-source fetch timeout.", "20000"),
  K("EVENTS_PER_NIGHT", "tuning", "refresh-regime-replay", "Earnings events graded per night by the (currently orphaned) regime replay.", "150"),
  K("LOBBY_YEAR", "tuning", "refresh-lobbying", "Filing year pulled.", "2026"),
  K("LOBBY_MAX_PAGES", "tuning", "refresh-lobbying", "Page budget per run.", "1200 (4000 with SEED)"),
  K("SEED", "lab", "refresh-lobbying", "Set to seed the store from the start of the year instead of advancing the cursor."),
  K("CHUNK_LIMIT", "lab", "refresh-trump", "Cap on OCR chunks processed (a bounded test run).", "unlimited"),
  K("STAPLES_SCAN_CAP", "tuning", "refresh-staples-scanner", "Characters of each scan note sent to the model.", "30000"),
  K("AV_BUDGET", "tuning", "patch-margins-av", "Alpha Vantage calls per run (the free tier is 25/day).", "24"),
  K("FORCE_CAPTURE", "lab", "capture-trade-spreads", "Set to capture spreads outside market hours."),

  // ── Lab: evals and benches ─────────────────────────────────────────────────────────────────────
  K("CANDIDATE", "lab", "eval-local-model", "Model under test.", "qwen/qwen-2.5-72b-instruct"),
  K("MODELS", "lab", "eval-model-shootout", "Contenders (comma list).", "z-ai/glm-5.2,moonshotai/kimi-k3"),
  K("JUDGES", "lab", "eval-model-shootout", "Judge models (comma list).", "google/gemini-3.1-pro-preview,google/gemini-3.7-flash"),
  K("LEGS", "lab", "eval-model-shootout", "Which legs to run (letters).", "abcd"),
  K("RUNS", "lab", "eval-model-shootout", "Repetitions per leg (1–10).", "1"),
  K("CONCURRENCY", "lab", "bench-prefill", "Concurrency levels to bench (comma list).", "1,4"),
  K("PROMPT_TOKENS", "lab", "bench-prefill", "Prompt size to bench.", "12000"),
  K("NIGHT_TOKENS", "lab", "bench-prefill", "A night's input tokens, for the projection.", "4500000"),
  K("ROUNDS", "lab", "bench-prefill", "Rounds per level.", "5"),
  K("STEP_MIN", "lab", "bench-prefill", "run-tick's per-step ceiling, for the projection.", "45"),
];

export const ENV_BY_NAME: ReadonlyMap<string, EnvKnob> = new Map(ENV_KNOBS.map((k) => [k.name, k]));

const SCOPE_TITLE: Record<EnvScope, string> = {
  secret: "Secrets and endpoints",
  runner: "Runner and pipeline",
  web: "Web server",
  build: "Build-time",
  tuning: "Per-script tuning",
  lab: "Lab, evals and benches",
};
const SCOPE_ORDER: EnvScope[] = ["secret", "runner", "web", "build", "tuning", "lab"];

/** docs/ENV.md, rendered from the table above. Deterministic: the test compares byte for byte. */
export function renderEnvReference(): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const out: string[] = [
    "# Environment reference",
    "",
    "Generated from `lib/envManifest.ts` by `npm run gen-env-reference` — edit the table there, not this file.",
    `${ENV_KNOBS.length} knobs. Secrets live in the NAS \`tape.env\`, the R2 runner-env channel (\`npm run add-runner-secret\`)`,
    "or GitHub secrets; everything else is optional and documented with its default.",
    "",
  ];
  for (const scope of SCOPE_ORDER) {
    const rows = ENV_KNOBS.filter((k) => k.scope === scope);
    if (!rows.length) continue;
    out.push(`## ${SCOPE_TITLE[scope]}`, "", "| Knob | Default | Read by | Purpose |", "|---|---|---|---|");
    for (const k of rows) out.push(`| \`${k.name}\` | ${k.default === undefined ? "—" : `\`${esc(k.default)}\``} | ${esc(k.where)} | ${esc(k.purpose)} |`);
    out.push("");
  }
  return out.join("\n");
}
