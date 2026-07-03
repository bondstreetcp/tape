-- Research-lake views. {{LAKE}} is replaced with the lake root at load time:
--   • local:  ./lake        (npm run q, or `duckdb -init` after substituting by hand)
--   • R2:     s3://<bucket>  (once LAKE_S3_* is configured)
-- `npm run q` substitutes it and loads these automatically. For the DuckDB CLI, see docs/RESEARCH-LAKE.md.

-- Raw daily cross-section: one row per (symbol, universe, dt). Fundamentals (P/E, P/B, div yield…) +
-- snapshot returns. Forward-accumulating — one file per trading day.
CREATE OR REPLACE VIEW equity_panel AS
  SELECT * FROM read_parquet('{{LAKE}}/equity_panel/*.parquet', union_by_name = true);

-- Deep daily close history (~6yr), the backbone for returns.
CREATE OR REPLACE VIEW prices AS
  SELECT * FROM read_parquet('{{LAKE}}/prices/*.parquet');

-- Deduped US cross-section: one row per (symbol, dt), preferring the broadest universe a name is in.
CREATE OR REPLACE VIEW us_panel AS
  SELECT * EXCLUDE (rn) FROM (
    SELECT *, row_number() OVER (
      PARTITION BY symbol, dt
      ORDER BY CASE universe WHEN 'russell3000' THEN 0 WHEN 'sp1500' THEN 1 WHEN 'russell1000' THEN 2 WHEN 'sp500' THEN 3 ELSE 4 END
    ) AS rn
    FROM equity_panel
  ) WHERE rn = 1;

-- Price-derived factors at EVERY past date (momentum, trend, 52w position). Because these come from the
-- deep price history, factor studies work back years — even before the fundamental panel started
-- accumulating. NOTE: current index constituents only, so pre-today history has survivorship bias.
CREATE OR REPLACE VIEW price_factors AS
  SELECT symbol, dt, close,
    close / lag(close, 21)  OVER wpf - 1                     AS ret_1m,
    close / lag(close, 63)  OVER wpf - 1                     AS ret_3m,
    close / lag(close, 126) OVER wpf - 1                     AS ret_6m,
    close / lag(close, 252) OVER wpf - 1                     AS ret_12m,
    lag(close, 21) OVER wpf / lag(close, 252) OVER wpf - 1   AS mom_12_1,  -- 12-month return skipping the last month (classic momentum)
    avg(close) OVER (wpf ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) AS ma_50,
    avg(close) OVER (wpf ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS ma_200,
    close / max(close) OVER (wpf ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) - 1 AS pct_from_52w_hi
  FROM prices
  WINDOW wpf AS (PARTITION BY symbol ORDER BY dt);

-- Forward returns from each date — the dependent variable for any backtest.
CREATE OR REPLACE VIEW prices_fwd AS
  SELECT symbol, dt, close,
    lead(close, 21) OVER wpr / close - 1 AS fwd_1m,
    lead(close, 63) OVER wpr / close - 1 AS fwd_3m
  FROM prices
  WINDOW wpr AS (PARTITION BY symbol ORDER BY dt);

-- The workhorse: price factors + forward returns per (symbol, dt), ready to bucket into deciles.
CREATE OR REPLACE VIEW factor_study AS
  SELECT f.*, r.fwd_1m, r.fwd_3m
  FROM price_factors f
  JOIN prices_fwd r USING (symbol, dt);
