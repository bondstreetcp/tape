# My Names — the monitoring layer (spec)

*Drafted 2026-08-08 from Sam's workflow review: "we need something that will monitor the ideas or
stock once it's in the portfolio and watchlist." Status: SPEC — not built. Phases are independently
shippable; each lands value without the next.*

## Problem

The app's three workflows are asymmetric. **News of the day** (Daily Desk, 3 tabs) and **idea
generation** (~30 boards, graded by /signal-record) are strong. **Monitoring what you've committed
to** is structurally weak, in three specific ways:

1. **Pull-only.** The alert engine was built but shelved with user accounts. Nothing tells you a
   watched name preannounced, drew a 13D, or reports tonight — you find out if you happen to open
   the desk.
2. **Two disconnected lists.** The watchlist (client state / per-user table) feeds the new
   watchlist wire; the portfolio (holdings in the Risk Cockpit) feeds /portfolio-radar and
   /portfolio-income. Neither sees the other. Your "book + bench" is not one monitored universe.
3. **No per-name change ledger.** Estimate revisions, insider buys, borrow-fee spikes, FTD builds,
   filing diffs, guidance changes all EXIST as universe-wide boards — but nothing filters them down
   to *your names* and answers "what changed in MY names since I last looked."

## Shape

One concept: **My Names = portfolio ∪ watchlist**, one **Change Ledger** over that set, one
**"since you last looked" cursor**, and (later) a **push channel** for the few events that
shouldn't wait for a visit.

### The list (`lib/myNames.ts`, client)

- `useMyNames()` → `{ names: string[], sources: Record<sym, ("watchlist"|"portfolio")[]> }`,
  composed from `useWatchlist()` and the portfolio holdings store. Pure union, no new storage —
  the two lists stay independently editable where they live today.
- Every consumer that currently reads only the watchlist (the desk wire) migrates to `useMyNames`
  with a source chip (▲ book / ☆ watch) so a holding is visually distinct from a bench name.

### The Change Ledger (`/api/my-names-ledger` + `lib/myNamesLedger.ts`)

The client sends its symbols (the watchlist-wire pattern — client state, server join, per-name
degradation, memo keyed on the symbol set, never cache empty). The route joins each name against
feeds that ALREADY exist — **no new collectors, no LLM in the ledger path; every event links to
its source row** (code verifies, models propose):

| Event kind | Source (existing) | Threshold to ledger |
|---|---|---|
| `reported` | detectRecentReport (results 8-K) | filed ≤7d |
| `preannounce` | lib/preannounce flag | any live flag |
| `deal` / `review` / `spin` | catalystOverlay (merger-arb targets + corp-events) | any live flag |
| `headline` | getNews + pickHeadlines | ≤3 sessions, junk-filtered |
| `filing` | overnight-filings items | any note on the name |
| `estimate` | revisions board data | 30d up/down count changed, or ≥2 revisions in 7d |
| `insider` | insiders.json | any cluster-buy row |
| `borrow` | IBKR borrow (live, US) | fee crossed 1% / availability < 100k |
| `shorts` | short-mechanics (FTD + short-vol) | FTD notional > $1M or short-vol > 60% 5d-avg |
| `earnings-ahead` | earnings-move / catalyst calendar | reports ≤5d (with implied move when priced) |
| `options` | options flow feed | unusual-flow row on the name |

Each event: `{ sym, kind, ts (calendar-square when the source is a date), title, detail?, magnitude?,
href }` — `href` deep-links the source board row or filing. Ordering reuses the wire doctrine:
actionable-first (reported/preannounce/deal → earnings-ahead → magnitude), then recency.

### The cursor ("since you last looked")

- `localStorage["myNames.lastSeen"]` (ISO) per device, set on ledger view. Events newer than the
  cursor render **NEW**; the nav item shows a count badge (client-computed — no accounts needed).
- Honest limitation, stated in-UI: the cursor is per-browser. Cross-device cursors ride the
  existing Supabase user table if/when accounts unshelve — same column pattern as the watchlist.

### Surface

- **`/my-names`** — new page, top-bar link replacing the bare Watchlist link (Watchlist remains as
  the list-management view, linked from the page). Tabs: **Ledger** (default) · **Quotes** (the
  current watchlist table) · **Radar** (the existing portfolio-radar view widened to the union).
- The Daily Desk wire stays — it's the *morning* slice of the same data. The ledger is the *full*
  answer with history and the cursor.
- Nav/guide/⌘K registration in the ship commit, per doctrine.

### Push (phase 3 — the only part that needs a decision)

Three event classes earn a push; everything else stays pull: **preannounce**, **new deal/13D on a
held name**, **reports-tonight** (with the implied move). Channel options, cheapest first:
1. **ntfy topic per user** — the ALERT_WEBHOOK pattern already proven for ops alerts; user
   subscribes to their topic in the ntfy app. No accounts needed; topic string lives next to the
   watchlist in localStorage. ~an evening of work.
2. Web Push via the existing PWA service worker — no third-party app, but needs a push service +
   subscription storage (accounts, realistically).
3. Email — needs accounts + a sender; most familiar, most plumbing.
Recommendation: ship ntfy first (opt-in, zero accounts), revisit Web Push when accounts unshelve.
The nightly runner evaluates push rules right after the feeds it reads land (feed-order doctrine).

## Phasing

- **P1 — Ledger** (the core): `lib/myNamesLedger` joins + `/api/my-names-ledger` + `/my-names`
  page with the cursor + nav/guide. Watchlist-only at first if the portfolio store join is messy.
- **P2 — Union**: `useMyNames`, source chips, radar tab widened, desk wire migrated.
- **P3 — Push**: ntfy rules for the three classes, evaluated in the nightly.

## Traps to respect (from the memory index)

- Client-safe libs: no fs in anything the page imports (`no-fs-in-client-lib` — only `npm run
  build` catches it).
- Calendar squares for filing/report dates (`fmtDate`/`daysUntil`, never Date roundtrips).
- Per-name degradation everywhere; never cache an empty join (the ep:data lesson, twice).
- Feeds referenced must self-register freshness if any NEW nightly artifact appears (none planned —
  the ledger is a read-time join over existing feeds).
- CallSuggestion yields are already % (portfolio-income join).
