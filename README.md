# Tape

A self-hosted equity-research terminal. About a hundred boards — screens, earnings, options,
event-driven, research, macro — across 18 index universes (S&P 500, Nasdaq 100, Russell 1000/3000,
S&P 1500 and thirteen international indices), rebuilt every night by a pipeline of ~100 scripts and
served from static JSON feeds. Live at `https://tape.truporchhomesvm.com` from a Synology NAS behind a
Cloudflare tunnel.

![Next.js 16](https://img.shields.io/badge/Next.js-16-black) ![node:test](https://img.shields.io/badge/tests-800%2B-green) ![data](https://img.shields.io/badge/data-R2%20hydrated-blueviolet)

Public disclosures and market data, organised for a desk. Not investment advice.

## What it does

- **Screens** — universe screener with fundamentals, 52-week and trend signals, coiled/dispersion/
  breadth boards, insiders, buybacks, super-investor 13Fs, Congress trades, government contracts,
  lobbying, activism and short campaigns.
- **Earnings** — the earnings desk and calendar, a pre-earnings prep engine with a graded track
  record, implied vs realised moves, guidance credibility, the two-year comp-stack analyzer, and
  same-day earnings-call digests.
- **Options** — dealer gamma, realised-vol cone, put-writing and covered-call/wheel workbenches, skew
  and term structure, catalyst and biotech event vol.
- **Event-driven** — overnight SEC filings with AI desk notes and risk-factor redlines, spin-offs,
  IPOs and lock-ups, tenders, merger and SPAC arb, convertibles, holdco NAV, CEF discounts.
- **Markets** — the morning desk (desk note, market headlines wire, call digests), macro and rates
  dashboards with free alt-data, sector rotation, positioning, the Fed and policy trackers.
- **Research** — per-stock pages with financials, filings, transcripts, compensation and supply
  chain; a research lake (Parquet on R2) queried with DuckDB; Ask, briefing and compare routes.

The doctrine throughout: **code verifies, models propose.** Models write narrative; code owns every
number, every quote and every ticker, and a feed that fails a night degrades to *stale*, never to
*empty*.

## Quick start

```bash
npm install
npm run data-from-r2      # hydrate data/ from R2 (needs the four LAKE_S3_* values in .env.local)
npm run dev               # http://localhost:3000 → /u/sp500
```

Without R2 access, build a small tree yourself: `npm run fetch-constituents` then
`LIMIT=60 npm run refresh-data`. Every other feed has an `npm run refresh-<feed>` script; most run
without keys, the model-backed ones need `OPENROUTER_API_KEY`. See [docs/ENV.md](docs/ENV.md) for
every knob and its default.

## Verify a change

```bash
npm test                  # node:test, 800+ pure tests; the registry, mirror and manifest tests enforce the contracts
npx tsc --noEmit
npx next build            # required for anything a page imports — an fs import reached from a client component only fails here
```

## How it runs

```
GitHub main ──▶ tape-runner (NAS): run-tick hourly · quotes / desk / news / FULL at 23:00 UTC
                    │ hydrate prior tree from R2 (hard gate) → ~100 refresh steps → upload
                    ▼
              Cloudflare R2: site-data/data.tar.gz + per-object feeds + the runner's secrets channel
                    │
                    ▼
              tape-web (NAS, A/B slots) ── cloudflared ──▶ tape.<domain>      Vercel = paused read replica
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the two-page map: topology, the feed contracts
(registry, write guard, incremental gates, counted suppressed errors, tick history), the LLM layer and
its guards, observability, and how to add a feed, a knob or a model call without breaking the tests.

## Docs

| Doc | What |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | the system map |
| [ENV.md](docs/ENV.md) | every environment knob (generated from `lib/envManifest.ts`) |
| [SETUP-NAS-CRON.md](docs/SETUP-NAS-CRON.md) · [SETUP-NAS-WEB.md](docs/SETUP-NAS-WEB.md) · [SETUP-NAS-BACKUP.md](docs/SETUP-NAS-BACKUP.md) | the runner, the web slots, backups |
| [SETUP-clean-ip-worker.md](docs/SETUP-clean-ip-worker.md) | the box that bakes the per-stock cache and the call digests |
| [SETUP-local-llm.md](docs/SETUP-local-llm.md) · [SETUP-auth.md](docs/SETUP-auth.md) | the local model tier; Supabase auth |
| [DATA-ON-R2.md](docs/DATA-ON-R2.md) · [RESEARCH-LAKE.md](docs/RESEARCH-LAKE.md) | the data tree on R2; the Parquet lake |
| [LLM-INTEGRITY-AUDIT.md](docs/LLM-INTEGRITY-AUDIT.md) | how model output is validated, feed by feed |

## Layout

```
app/          routes — boards under app/u/[universe]/, API routes under app/api/
components/   one client view per board
lib/          shared code: feed registry + guards, llm + validation, scriptKit, nav, universes
scripts/      the pipeline: run-tick, refresh-* (one per feed), build-*, worker/, nas/
tests/        node:test suites
docs/         the docs above
data/         the feed tree — gitignored, hydrated from R2, written only by the runner
```

## Caveats

- Yahoo Finance is an unofficial source and degrades some payloads by IP; the per-stock cache and
  the call transcripts are baked on a clean-IP box for that reason.
- International universes get the boards whose data paths exist for them; SEC-only boards show a
  notice there.
- Everything on the site is derived from public disclosures and market data with model-written
  narrative on top. It is research tooling, not advice.
