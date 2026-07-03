# Research lake — ad-hoc historical cross-sections (DuckDB + Parquet)

A columnar copy of the site's data for factor research: point-in-time panels + ~6yr of daily prices as
**Parquet**, queried with **DuckDB**. Purpose-built for "rank every name by X on each date and measure
the forward return" — the queries the JSON blobs can't answer. Runs at **$0** (Cloudflare R2 free tier +
embedded DuckDB), and the data lives in R2, **not** the git repo.

## What's in it

Built by `scripts/build-lake.ts` from the existing JSON:

| Dataset | Grain | Source | Depth |
|---|---|---|---|
| `equity_panel` | one row per (symbol, universe, day) | the US universe snapshots | forward-accumulating (one file/day) |
| `prices` | one row per (symbol, day) | the per-symbol series files | ~6 years daily |

`sql/views.sql` layers analysis-ready views on top: `us_panel` (deduped US cross-section), `price_factors`
(momentum / trend / 52w-position, computable at **every past date** from the deep price history),
`prices_fwd` (forward 1m/3m returns), and `factor_study` (factors ⋈ forward returns — the workhorse).

## Build it

```bash
npm run build-lake        # append TODAY's equity panel  (nightly)
npm run backfill-prices   # rebuild the ~6yr price history (fast; also run nightly to add the new bar)
```

Writes to a local `./lake/` by default (gitignored) — so you can build and query it with **zero cloud
setup**. Point it at R2 by setting four env vars (`.env.local` for you, GitHub Actions secrets for the
nightly job); the exporter then writes `s3://<bucket>/…` instead:

```
LAKE_S3_ENDPOINT=<account_id>.r2.cloudflarestorage.com
LAKE_S3_KEY_ID=<r2 access key id>
LAKE_S3_SECRET=<r2 secret>
LAKE_S3_BUCKET=<bucket name>
```

R2 setup (one-time, ~20 min): create a Cloudflare account → R2 → a bucket → an S3-API token (Object
Read & Write). Free tier = 10 GB storage, 10M reads + 1M writes/month, **zero egress** — the lake is ~25 MB,
so this is $0 indefinitely. The nightly workflow step is inert until these secrets are set.

## Query it

Quick hits from the repo (loads the views automatically):

```bash
npm run q -- "SELECT * FROM us_panel ORDER BY market_cap DESC LIMIT 10"
npm run q -- "SELECT symbol, ret_6m FROM price_factors WHERE dt = (SELECT max(dt) FROM prices) ORDER BY ret_6m DESC LIMIT 20"
```

Worked examples (factor-decile backtest, market breadth over time, point-in-time screens, valuation
dispersion by sector, 52-week-high signal) live in **`sql/examples.sql`** — paste one into `npm run q -- "…"`.

For heavier / interactive work, use the **DuckDB CLI** ([install](https://duckdb.org/docs/installation/))
against the same views. Local lake:

```sql
-- duckdb
.read sql/views_local.sql   -- a copy of sql/views.sql with {{LAKE}} replaced by './lake'
SELECT decile, avg(fwd_1m)*100 FROM ( SELECT ntile(10) OVER (PARTITION BY dt ORDER BY mom_12_1) decile, fwd_1m FROM factor_study WHERE mom_12_1 IS NOT NULL AND fwd_1m IS NOT NULL) GROUP BY 1 ORDER BY 1;
```

Against R2, connect once then read the views (replace `{{LAKE}}` with `s3://<bucket>`):

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET r2 (TYPE S3, KEY_ID '…', SECRET '…', ENDPOINT '<acct>.r2.cloudflarestorage.com', URL_STYLE 'path', REGION 'auto');
-- then .read your substituted views file, or read_parquet('s3://<bucket>/prices/*.parquet') directly
```

## Caveats (read before trusting a backtest)

- **Survivorship bias** in the price history — it's built from *current* index constituents, so pre-today
  history excludes names that have since dropped out. The forward-accumulating panel is clean; the price
  backfill is hypothesis-generation grade, not trade-blind grade.
- **Look-ahead on fundamentals** — the panel's P/E, estimates, etc. are *current* snapshots, not as-of, so
  fundamental factors are only clean going forward as the panel accumulates. Price/momentum factors ARE
  clean deep (they come from actual historical prices). (The site's `valuation-history` is true
  point-in-time via EDGAR filing dates — a good candidate to fold in next.)
- **Depth** — panel starts the day the nightly export first runs and thickens daily; prices go back ~6yr.
- **Exact-date joins** — the panel/factor join is on an exact trading day; a snapshot generated on a
  non-trading day won't join to a price. Use an ASOF join if that ever bites.

## Cost & footprint

$0 (R2 free tier + DuckDB). The lake is ~25 MB of Parquet vs ~145 MB of source JSON, and it lives in R2,
so it does **not** grow the git repo. DuckDB is a `devDependency` (`@duckdb/node-api`) used only by the
export + `q` tooling — it is not in the app bundle.
