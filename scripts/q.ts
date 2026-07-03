/**
 * Ad-hoc query runner for the research lake. Loads sql/views.sql (with {{LAKE}} bound to the local
 * ./lake or your R2 bucket), then runs whatever SQL you pass:
 *
 *   npm run q -- "SELECT * FROM us_panel ORDER BY market_cap DESC LIMIT 10"
 *   npm run q -- "$(cat sql/examples.sql | head -20)"          # or paste an example
 *
 * For heavier / interactive sessions use the DuckDB CLI directly against the same views — see
 * docs/RESEARCH-LAKE.md. This wrapper is just the quick-hit path.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { promises as fs } from "fs";
import { loadLocalEnv } from "../lib/localEnv";

loadLocalEnv(); // pick up LAKE_S3_* from .env.local on local runs (CI injects the real env vars)

const LOCAL_DIR = process.env.LAKE_DIR || "lake";
const S3 = { endpoint: (process.env.LAKE_S3_ENDPOINT || "").trim().replace(/^["']|["']$/g, "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""), keyId: process.env.LAKE_S3_KEY_ID, secret: process.env.LAKE_S3_SECRET, bucket: process.env.LAKE_S3_BUCKET };
const useS3 = !!(S3.endpoint && S3.keyId && S3.secret && S3.bucket);
const base = useS3 ? `s3://${S3.bucket}` : LOCAL_DIR;
const lit = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
// bigint → number; DuckDB date/timestamp value wrappers → their SQL string; everything else as-is.
const j = (v: unknown) => (typeof v === "bigint" ? Number(v) : v && typeof v === "object" ? String(v) : v);

async function main() {
  const sql = process.argv.slice(2).join(" ").trim();
  if (!sql) { console.error('usage: npm run q -- "SELECT ... FROM factor_study ..."'); process.exit(1); }
  const conn = await (await DuckDBInstance.create()).connect();
  await conn.run("SET TimeZone='UTC';");
  if (useS3) {
    await conn.run("INSTALL httpfs; LOAD httpfs;");
    try {
      await conn.run(`CREATE OR REPLACE SECRET r2 (TYPE S3, KEY_ID ${lit(S3.keyId!)}, SECRET ${lit(S3.secret!)}, ENDPOINT ${lit(S3.endpoint!)}, URL_STYLE 'path', REGION 'auto');`);
    } catch {
      console.error("Failed to configure R2 credentials — check the LAKE_S3_* values.");
      process.exit(1);
    }
  }
  const views = (await fs.readFile("sql/views.sql", "utf8")).replaceAll("{{LAKE}}", base);
  await conn.run(views);
  const reader = await conn.runAndReadAll(sql);
  const out = reader.getRowObjects().map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, j(v)])));
  console.table(out);
  console.log(`${out.length} row(s) · lake: ${base}`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
