# Index Sector Screener

A local dashboard for tracking index constituents by sector and industry,
spotting **52-week highs and lows**, and comparing stocks on **line charts** with
technical indicators. Switch between index universes, click a sector (e.g. XLV)
for a price chart + a finviz-style treemap, then click an industry to see every
constituent compared on one chart.

![flow](https://img.shields.io/badge/Next.js-16-black) ![data](https://img.shields.io/badge/data-Yahoo%20Finance-blueviolet)

## Features

- **Four index universes** — switch between **S&P 500**, **Nasdaq 100**,
  **Russell 1000**, and **Broad 1500 (S&P 1500)** from any page. (The true
  Russell 3000 holdings aren't available from free sources, so the broad
  ~1,500-name S&P 1500 stands in for it.)
- **11 sector ETFs** (XLK, XLV, XLF, XLY, XLC, XLI, XLP, XLE, XLU, XLRE, XLB) as
  entry points, sorted by performance and color-coded.
- **Eight timeframes** — 1D, 1W, 3M, 6M, YTD, 1Y, **3Y, 5Y** — switchable
  everywhere; the treemap recolors and charts re-slice instantly.
- **Industry line-chart comparison** — click an industry (a chip on the sector
  page, or its label in the treemap) to see **every constituent as its own
  line**. Lines are rebased to % change so stocks at very different price levels
  are directly comparable, and the sector ETF is overlaid as a dashed reference.
  The legend is interactive: click to hide/show a line, hover to highlight,
  sorted by performance with 52-week badges.
- **Technical indicators** — toggle **SMA (20/50/200), EMA (12/26), Bollinger
  Bands** as overlays on any single-stock or sector-ETF chart, plus **MACD** and
  **RSI** as sub-panels. Computed client-side, so they add no data cost.
- **Treemap heatmap** per sector: market-cap-weighted boxes grouped by GICS
  sub-industry, green→red by the selected timeframe's return.
- **52-week high/low highlighting** — badges (▲/▼) on stocks within a chosen
  threshold (1/2/5/10%) of their 52-week extreme, plus a filter that dims the
  rest so candidates pop.
- **Click any stock** for a detail panel: its own price chart with indicators, a
  52-week range bar, and returns across all eight timeframes.
- **Index breadth** on the home page: advancers/decliners and counts near highs
  and lows.

## Setup

```bash
npm install

# 1. Build the constituent lists for every universe (Wikipedia)
npm run fetch-constituents

# 2. Pull prices for the union of all universes + the 11 sector ETFs
npm run refresh-data        # ~1,650 symbols, 5y daily — several minutes

# 3. Run it
npm run dev                 # http://localhost:3000  → redirects to /u/sp500
```

> Testing quickly? `LIMIT=60 npm run refresh-data` builds a subset of the union.

## How data works

All prices come from Yahoo Finance via [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2)
— **no API key, no signup**. `npm run refresh-data` fetches the **union** of all
universes' symbols once (deduped), pulls **5 years** of daily history (for 3Y/5Y),
and writes static JSON:

- `data/constituents/<universe>.json` — membership + GICS classification per
  universe (committed seed; regenerate with `npm run fetch-constituents`).
- `data/series/symbols/<SYM>.json` — `{ daily, intraday }` compact `[t, c]`
  series, shared across universes (deduped). Intraday is fetched only for S&P 500
  & Nasdaq 100 names (enables 1D/1W comparison lines); Russell universes are
  daily-only.
- `data/<universe>/snapshot.json` — every stock's returns, market cap, and
  52-week distances, plus sector aggregates, for that universe.

The app only reads those files, so browsing is instant and never hits Yahoo's
rate limits. Re-run `npm run refresh-data` after market close to refresh.

### Keeping it fresh automatically

Schedule the refresh after each US market close — e.g. a Windows Task Scheduler
job running `npm run refresh-data` around 4:30pm ET on weekdays. The running app
picks up new data on the next page load.

## Project layout

```
app/
  page.tsx                                  redirect → /u/sp500
  u/[universe]/page.tsx                     home dashboard (sector grid + breadth)
  u/[universe]/sector/[etf]/page.tsx        sector detail (chart + treemap + industries)
  u/[universe]/sector/[etf]/[industry]/...  industry line-chart comparison
  api/series/[symbol]/route.ts              lazy per-symbol series (stock detail chart)
components/
  HomeDashboard / SectorView / IndustryView   page orchestrators
  UniverseSwitcher.tsx     index-universe dropdown
  IndicatorChart.tsx       single-series chart + SMA/EMA/BB/MACD/RSI toggles
  MultiLineChart.tsx       rebased multi-line industry comparison
  Treemap.tsx              d3-hierarchy treemap, 52w badges, clickable industries
lib/
  universes.ts             the 4 index universes
  sectors.ts               GICS sector ↔ SPDR ETF mapping
  timeframes.ts            8 timeframes, lookbacks, color clamps
  indicators.ts            SMA / EMA / MACD / RSI / Bollinger math
  compute.ts               52w helpers, series slicing, rebased comparison
scripts/
  fetch-constituents.ts    build per-universe lists from Wikipedia
  build-data.ts            pull Yahoo data → data/**.json
```

## Notes & caveats

- Sector membership is each universe's stocks grouped by GICS sector — close to,
  but not identical to, each SPDR ETF's exact holdings.
- Russell 1000 & S&P 1500 are **daily-only**, so their 1D/1W comparison lines are
  limited; 3M and longer work everywhere. S&P 500 & Nasdaq 100 have intraday.
- Indicators like SMA 200 need long windows — they're most meaningful on 3M+.
- 52-week high/low come from Yahoo's `fiftyTwoWeekHigh`/`Low` (intraday-inclusive).
- Yahoo is an unofficial source; if a refresh starts failing, per-symbol
  fallbacks keep partial data flowing — check `yahoo-finance2` for breaking changes.
```
