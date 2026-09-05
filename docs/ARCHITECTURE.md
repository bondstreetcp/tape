# Architecture

Tape is a self-hosted equity-research terminal: ~100 boards across six groups (Screens, Research,
Options, Earnings, Event-Driven, Markets) over 18 index universes, rebuilt nightly by a pipeline of
~100 scripts and served as static JSON feeds plus a handful of live routes. This is the two-page map
of the thing that actually runs. Setup guides are in the `SETUP-*.md` files next to this one; every
environment knob is in [ENV.md](ENV.md).

## 1. Topology

```
                     ┌──────────────────────── Synology DS1621+ ────────────────────────┐
  GitHub main ──git pull per tick──▶ tape-runner   run-tick.ts   hourly (auto) ──┐         │
                                     │  quotes/intl/desk/news/full ticks        │ upload  │
                                     │  ~100 refresh-* steps → data/*.json      ▼         │
  Cloudflare R2 ◀──────────────── site-data/data.tar.gz (+company.tar.gz, feeds, runner.env)
        │                             ▲                                                   │
        │ hydrate (data-from-r2)      │ read at the START of every tick (hard gate)        │
        ▼                                                                                 │
     tape-web  A/B slots: npm ci → data-from-r2 → next build → next start  ◀── cloudflared ─┼──▶ tape.<domain>
                                                                                          │
  GitHub Actions refresh-data.yml: the mirror of run-tick; STANDS DOWN while the NAS stamp is fresh
  Vercel: a read replica that hydrates the same way at build time (paused since 2026-07; see F11 in the review)
```

- **The runner is the only writer of `data/`.** `scripts/run-tick.ts` maps the hour to a tick mode
  (`quotes`, `intl`, `desk` at 08:00/17:00 ET, `news`, `full` at 23:00 UTC weekdays), runs the STEPS
  array with continue-on-error, and uploads the tree. Hydrating the prior tree from R2 is a hard gate:
  no read, no tick, so a partial tree can never overwrite the full one.
- **The web slot never computes.** It hydrates `data/` from R2 and reads files. The few live routes
  (`/api/ask`, company briefing, earnings prep, …) call models at request time and are the only paid
  surface a visitor can touch — see §4.
- **R2 objects** (`docs/DATA-ON-R2.md`): `site-data/data.tar.gz` every tick, `company.tar.gz` FULL
  only, per-object feeds written by other writers (`news-tape.json.gz` on a 5-minute clock,
  `call-digests.json` from the clean-IP worker), `runner.env` (the secrets channel, merged by
  `npm run add-runner-secret`), and `manifest.json` (writer stamp + heartbeat that CI stands down to).
- **Clean-IP dependencies.** Two feeds need an IP Yahoo and Investing.com don't degrade: the per-stock
  company cache and the earnings-call transcripts. They come from a separate box
  (`docs/SETUP-clean-ip-worker.md`) that publishes to R2; the NAS only hydrates them.
- **tests/pipelineMirror** fails when run-tick's STEPS and `refresh-data.yml` drift apart.

## 2. Feed contracts

Every board reads one or more `data/*.json` files. The contracts that keep a bad night from becoming
a bad board:

- **Registry** — `lib/dataFreshness.ts` lists every feed with a tier (core 30h / event 96h / synthesis
  96h), an optional row count (`countPath` + `minCount`) and the boards it feeds (`affects`). The
  status page, `/api/health/data`, the CI freshness gate and the ntfy alerts all read this one table.
  `tests/feedRegistry` fails on any `data/*.json` a script writes that is neither registered nor a
  named intermediate.
- **Degrade to stale, never to empty** — `lib/feedGuard.writeFeedOrExit` is the default writer.
  A write is blocked (exit 1, the tick shows ✗, ntfy pages) when the new file both shrank by more than
  15% and fell under the registry floor; the prior file stays and reads as *stale*, which is honest.
  Accumulating feeds carry unchanged rows forward with their original dates.
- **Incremental gates** — a feed that walks a per-name cursor (guidance, comps, buybacks) advances it
  only on a successful read (`lib/incrementalGate`), so a failed night is retried, not skipped.
- **Suppressed errors are counted** — `lib/scriptKit.swallow` (used by `mapPoolSafe`, `readJson` and
  the scrapers) counts deliberately swallowed errors per label; run-tick lifts them into
  `data/tick-report.json` and the status page shows them, so "nothing today" and "every fetch failed"
  are distinguishable.
- **History** — `data/tick-report.json` is the last tick; `data/tick-history.json`
  (`lib/tickHistory`) is the last 30 days. Both ride the tar, so a broken runner is diagnosable from
  any machine with R2 read access.

## 3. The doctrine: code verifies, models propose

Models write narrative; code owns every number and every claim about the world.

- Every model reply goes through `lib/llmValidate` (`narrative`, `narrativeList`, `groundedQuote`,
  `whitelistTickers`, `coerceEnum`, `isPlaceholderText`). A quote must appear in the source text; a
  ticker must be in the universe; a KPI in a digest must be grounded in the transcript.
- `lib/llm.ts` is the one client: `DEFAULT`/`PRO` (`z-ai/glm-5.2`) and `FLASH`
  (`google/gemini-2.5-flash-lite`) tiers on OpenRouter, an opt-in local tier (`local: true`, vLLM on
  the rig), per-call usage metering (`lib/llmUsage`, `npm run llm-costs`), and a mass-failure backstop
  (`isMassLlmFailure`) so a provider outage keeps yesterday's synthesis instead of publishing blanks.
- Every synthesis feed carries `generatedAt`, its sources and its `lastRun` diagnostics, so a reader
  can see what the model was given.

## 4. The web surface

- `app/u/[universe]/<board>/page.tsx` server components read feeds and hand typed props to a client
  view in `components/`. Most boards are ISR (10 minutes); the status page is dynamic.
- Navigation, search keywords and "what breaks when a feed dies" all come from `lib/nav.ts` — the
  status page maps failing feeds to boards through it, so a renamed board can't drift.
- The 16 model-backed routes are open (no sign-in) and rate-limited by `lib/llmGuard` (per-IP and
  site-wide token buckets, HTTP 429 with Retry-After); `lib/llmUsage.webSpendCapped` stops live calls
  past a daily dollar ceiling (`LLM_WEB_DAILY_CAP_USD`) while cached answers keep serving.
- Auth is Supabase magic-link with Row-Level Security (`docs/SETUP-auth.md`); today it gates only the
  personal surfaces (watchlist sync, positions). The publishable key ships in the bundle by design.

## 5. Observability

| Signal | Where | Who reads it |
|---|---|---|
| Feed freshness + affected boards | `/u/<universe>/status`, `/api/health/data` | humans, the uptime monitor |
| Runner history, failed steps, suppressed errors | the status page's Runner section | humans |
| Paging | ntfy topic in `ALERT_WEBHOOK_URL` | run-tick (any failed step), check-freshness (floor breach), company-cache (writer dark) |
| Model spend | `data/llm-usage.json`, `npm run llm-costs` | monthly review |
| Remote diagnosis | `site-data/runner-diag.json`, `tick-report.json` in the tar | anyone with R2 read |

## 6. Where things live

```
app/            routes (universe-scoped boards under app/u/[universe]/, API under app/api/)
components/     client views, one per board; StatusView + RunnerHistory are the ops surface
lib/            everything shared — feed registry, guards, llm, scriptKit, nav, universes, format
scripts/        the pipeline: run-tick (orchestrator), refresh-* (one feed each), build-* (snapshots),
                worker/ (clean-IP box), nas/ (container files), lab-grade eval-*/bench-*/patch-*
tests/          node:test suites — 800+ pure tests; the registry, mirror and manifest tests enforce
                the contracts above
docs/           this map, ENV.md (generated), SETUP-* guides, the research-lake and R2 notes
data/           the feed tree — gitignored, hydrated from R2, written only by the runner
```

## 7. Adding things without breaking the contracts

- **A feed**: write it with `writeFeedOrExit`, register it in `lib/dataFreshness.ts` with a floor and
  the boards it affects, add the step to BOTH `run-tick.ts` STEPS and `refresh-data.yml`. Three tests
  will tell you what you forgot.
- **A knob**: read it through `process.env`, describe it in `lib/envManifest.ts`, run
  `npm run gen-env-reference`. The manifest test fails until you do.
- **A model call**: `chatJSON` from `lib/llm`, validate the reply with `lib/llmValidate`, never let a
  number or a quote through unchecked, and give the feed a carry-forward path for a failed night.
- **Verify** with `npm test`, `npx tsc --noEmit` and — for anything a page imports — `npx next build`
  (an `fs` import reached from a client component only fails there).
