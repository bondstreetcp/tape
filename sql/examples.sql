-- Worked examples for the research lake. Run one with:  npm run q -- "<paste a query>"
-- or paste into a DuckDB CLI session that has loaded sql/views.sql (see docs/RESEARCH-LAKE.md).

-- 1) FACTOR BACKTEST — 12-1 momentum decile vs the next month's return, over the full history.
--    ntile is a window fn, so bucket in a subquery, then aggregate. (This is the flagship.)
SELECT decile, round(avg(fwd_1m) * 100, 2) AS avg_fwd_1m_pct, count(*) AS n
FROM (
  SELECT ntile(10) OVER (PARTITION BY dt ORDER BY mom_12_1) AS decile, fwd_1m
  FROM factor_study
  WHERE mom_12_1 IS NOT NULL AND fwd_1m IS NOT NULL
)
GROUP BY decile ORDER BY decile;

-- 2) MARKET BREADTH over time — % of names above their 200-day average, by month.
SELECT date_trunc('month', dt) AS month, round(avg((close > ma_200)::INT) * 100, 1) AS pct_above_200dma, count(*) AS n
FROM price_factors
WHERE ma_200 IS NOT NULL
GROUP BY month ORDER BY month DESC
LIMIT 18;

-- 3) POINT-IN-TIME SCREEN on the latest panel — cheap, profitable-looking large caps with momentum.
SELECT symbol, name, sector, round(market_cap / 1e9, 1) AS mktcap_bn, round(pe, 1) AS pe,
       round(ret_6m, 1) AS ret_6m_pct, round(pct_from_hi, 1) AS pct_from_52w_hi
FROM us_panel
WHERE dt = (SELECT max(dt) FROM us_panel)
  AND market_cap > 5e9 AND pe BETWEEN 5 AND 18 AND ret_6m > 0
ORDER BY ret_6m DESC
LIMIT 25;

-- 4) CROSS-SECTIONAL SPREAD — how wide is valuation dispersion in each sector right now?
SELECT sector, count(*) AS n,
       round(median(pe), 1) AS median_pe,
       round(quantile_cont(pe, 0.9), 1) AS p90_pe,
       round(quantile_cont(pe, 0.1), 1) AS p10_pe
FROM us_panel
WHERE dt = (SELECT max(dt) FROM us_panel) AND pe BETWEEN 0 AND 200
GROUP BY sector HAVING count(*) >= 20 ORDER BY median_pe DESC;

-- 5) 52-WEEK-HIGH PROXIMITY as a signal — do names near their high keep winning? (deep history)
SELECT bucket, round(avg(fwd_3m) * 100, 2) AS avg_fwd_3m_pct, count(*) AS n
FROM (
  SELECT CASE WHEN pct_from_52w_hi >= -0.02 THEN 'at/near high'
              WHEN pct_from_52w_hi >= -0.10 THEN 'within 10%'
              WHEN pct_from_52w_hi >= -0.25 THEN '10-25% below'
              ELSE '>25% below' END AS bucket,
         fwd_3m
  FROM factor_study
  WHERE pct_from_52w_hi IS NOT NULL AND fwd_3m IS NOT NULL
)
GROUP BY bucket ORDER BY avg_fwd_3m_pct DESC;
