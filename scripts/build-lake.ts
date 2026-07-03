/**
 * Research lake exporter — turns the JSON data into columnar Parquet for ad-hoc historical
 * cross-sections (DuckDB). Two modes:
 *
 *   npm run build-lake                 # nightly: append TODAY's equity panel (one row per US name)
 *   npm run build-lake -- --backfill   # one-time: fold the 5yr per-symbol price series into prices.parquet
 *
 * Writes to a LOCAL ./lake dir by default (so the whole thing is verifiable with zero cloud setup);
 * writes to Cloudflare R2 instead when LAKE_S3_* env vars are set (the graceful-degradation pattern —
 * the nightly step is inert until you create the bucket). The lake is NOT committed to git (see
 * .gitignore) — the whole point is to keep bulk data out of the repo history.
 *
 * DuckDB is a devDependency (@duckdb/node-api) used only by this tooling + scripts/q.ts; it is NOT in
 * the app bundle, so the runtime dependency count is unchanged.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { promises as fs } from "fs";
import path from "path";
import { loadLocalEnv } from "../lib/localEnv";

loadLocalEnv(); // pick up LAKE_S3_* from .env.local on local runs (CI injects the real env vars)

// US universes to fold into the panel — uniform snapshot schema (build-data). Broadest first; the
// `universe` column keeps them distinguishable and the us_panel view dedups (see sql/views.sql).
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "sp500", "nasdaq100"];

const LOCAL_DIR = process.env.LAKE_DIR || "lake";
const S3 = {
  // host-only endpoint — tolerate a pasted https:// / quotes / trailing slash (DuckDB wants no scheme)
  endpoint: (process.env.LAKE_S3_ENDPOINT || "").trim().replace(/^["']|["']$/g, "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
  keyId: process.env.LAKE_S3_KEY_ID,
  secret: process.env.LAKE_S3_SECRET,
  bucket: process.env.LAKE_S3_BUCKET,
};
const useS3 = !!(S3.endpoint && S3.keyId && S3.secret && S3.bucket);
const base = useS3 ? `s3://${S3.bucket}` : LOCAL_DIR;

// SQL string literal — single-quote escaped. Used for secrets, so the value is NEVER logged.
const lit = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const jstr = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);

async function rows(conn: any, sql: string): Promise<any[]> {
  const r = await conn.runAndReadAll(sql);
  return r.getRowObjects();
}

async function buildPanel(conn: any) {
  const fileList = "[" + US_UNIVERSES.map((u) => lit(`data/${u}/snapshot.json`)).join(", ") + "]";
  // panel date = the snapshot's own generation date (all US snaps share ~one FULL-run timestamp)
  const [{ dt }] = await rows(conn, `SELECT CAST(generatedAt AS DATE) AS dt FROM read_json_auto('data/russell3000/snapshot.json')`);
  const dtStr = String(jstr(dt));
  const dest = `${base}/equity_panel/panel-${dtStr}.parquet`;

  const select = `
    WITH raw AS (
      SELECT filename, generatedAt, unnest(stocks) AS s
      FROM read_json_auto(${fileList}, filename = true, union_by_name = true, sample_size = -1)
    )
    SELECT
      regexp_extract(replace(filename, '\\', '/'), '([^/]+)/snapshot\\.json$', 1) AS universe,
      CAST(generatedAt AS DATE)               AS dt,
      s.symbol                                AS symbol,
      s.name                                  AS name,
      s.sector                                AS sector,
      s.industry                              AS industry,
      CAST(s.marketCap AS DOUBLE)             AS market_cap,
      CAST(s.price AS DOUBLE)                 AS price,
      CAST(s.returns['1d'] AS DOUBLE)         AS ret_1d,
      CAST(s.returns['1w'] AS DOUBLE)         AS ret_1w,
      CAST(s.returns['3m'] AS DOUBLE)         AS ret_3m,
      CAST(s.returns['6m'] AS DOUBLE)         AS ret_6m,
      CAST(s.returns['ytd'] AS DOUBLE)        AS ret_ytd,
      CAST(s.returns['1y'] AS DOUBLE)         AS ret_1y,
      CAST(s.trailingPE AS DOUBLE)            AS pe,
      CAST(s.forwardPE AS DOUBLE)             AS fwd_pe,
      CAST(s.priceToBook AS DOUBLE)           AS pb,
      CAST(s.dividendYield AS DOUBLE)         AS div_yield,
      CAST(s.fiftyTwoWeekHigh AS DOUBLE)      AS hi_52w,
      CAST(s.fiftyTwoWeekLow AS DOUBLE)       AS lo_52w,
      CAST(s.pctFromHigh AS DOUBLE)           AS pct_from_hi,
      CAST(s.pctFromLow AS DOUBLE)            AS pct_from_lo,
      CAST(s.epsForward AS DOUBLE)            AS eps_fwd
    FROM raw
    WHERE s.symbol IS NOT NULL`;

  await conn.run(`COPY (${select}) TO '${dest}' (FORMAT PARQUET, OVERWRITE_OR_IGNORE);`);
  const [{ n, u }] = await rows(conn, `SELECT count(*) n, count(DISTINCT symbol) u FROM '${dest}'`);
  console.log(`panel ${dtStr}: ${jstr(n)} rows (${jstr(u)} distinct symbols across ${US_UNIVERSES.length} universes) -> ${dest}`);
}

async function buildPrices(conn: any) {
  const dir = "data/series/symbols";
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const outDir = `${base}/prices`;
  const BATCH = 100; // small groups keep each COPY's memory bounded over 3,600+ files
  // fresh part files each run (local); on S3 each key is overwritten by the COPY
  if (!useS3) { await fs.rm(path.join(LOCAL_DIR, "prices"), { recursive: true, force: true }); await fs.mkdir(path.join(LOCAL_DIR, "prices"), { recursive: true }); }

  let part = 0;
  for (let i = 0; i < files.length; i += BATCH, part++) {
    const list = "[" + files.slice(i, i + BATCH).map((f) => lit(path.posix.join(dir, f))).join(", ") + "]";
    const dest = `${outDir}/prices-${String(part).padStart(3, "0")}.parquet`;
    // Read ONLY the `daily` column ([[epochMs, close], …]) — skipping the big `intraday` arrays; the
    // filename IS the ticker. columns={daily:'DOUBLE[][]'} avoids per-file schema sniffing + the OOM.
    const select = `
      WITH raw AS (
        SELECT filename, unnest(daily) AS d
        FROM read_json(${list}, filename = true, columns = {daily: 'DOUBLE[][]'})
      )
      SELECT
        regexp_extract(replace(filename, '\\', '/'), '([^/]+)\\.json$', 1) AS symbol,
        CAST(to_timestamp(CAST(d[1] AS BIGINT) / 1000) AS DATE)           AS dt,
        d[2]                                                              AS close
      FROM raw
      WHERE d[2] IS NOT NULL`;
    await conn.run(`COPY (${select}) TO '${dest}' (FORMAT PARQUET, OVERWRITE_OR_IGNORE);`);
  }
  const [{ n, u, d0, d1 }] = await rows(conn, `SELECT count(*) n, count(DISTINCT symbol) u, min(dt) d0, max(dt) d1 FROM read_parquet('${outDir}/*.parquet')`);
  console.log(`prices: ${jstr(n)} bars, ${jstr(u)} symbols, ${jstr(d0)} .. ${jstr(d1)} in ${part} part files -> ${outDir}`);
}

async function main() {
  const mode = process.argv.includes("--backfill") ? "prices" : "panel";
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();
  const tmp = path.join(LOCAL_DIR, ".tmp");
  await fs.mkdir(tmp, { recursive: true });
  await conn.run("SET TimeZone='UTC';"); // deterministic epoch→date casting
  await conn.run("SET memory_limit='3GB';");
  await conn.run("SET preserve_insertion_order=false;"); // stream the big unnest instead of buffering to keep order
  await conn.run(`SET temp_directory=${lit(tmp)};`); // allow spill-to-disk on the big backfill

  if (useS3) {
    await conn.run("INSTALL httpfs; LOAD httpfs;");
    // secret held in memory only; the try/catch keeps a bad-credential error from echoing the key
    try {
      await conn.run(`CREATE OR REPLACE SECRET r2 (TYPE S3, KEY_ID ${lit(S3.keyId!)}, SECRET ${lit(S3.secret!)}, ENDPOINT ${lit(S3.endpoint!)}, URL_STYLE 'path', REGION 'auto');`);
    } catch {
      console.error("Failed to configure R2 credentials — check the LAKE_S3_* values (error suppressed to avoid leaking the secret).");
      process.exit(1);
    }
    console.log(`lake target: s3://${S3.bucket} (Cloudflare R2)`);
  } else {
    await fs.mkdir(path.join(LOCAL_DIR, mode === "prices" ? "prices" : "equity_panel"), { recursive: true });
    console.log(`lake target: ./${LOCAL_DIR} (local — set LAKE_S3_* to write R2 instead)`);
  }

  if (mode === "prices") await buildPrices(conn);
  else await buildPanel(conn);
}

main().catch((e) => { console.error(e); process.exit(1); });
