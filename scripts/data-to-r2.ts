/**
 * Upload the operational data/ tree to R2 as ONE compressed tarball (build-time hydration). Runs in
 * the nightly job after the data refreshes. Pairs with scripts/data-from-r2.ts, which the Vercel build
 * runs to download + extract it — so the site's data can live in R2 instead of being committed to git
 * (the repo-bloat fix). One object per push = trivial R2 ops, atomic, well within the free tier.
 *
 * Inert without the LAKE_S3_* creds. During the migration's safety phase we ALSO still commit data/,
 * so R2 and git carry the same data until the Vercel cutover is proven. See docs/DATA-ON-R2.md.
 */
import { execFileSync } from "child_process";
import { readFileSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { putObject, r2Configured } from "../lib/r2";

const KEY_TAR = "site-data/data.tar.gz";
const KEY_MANIFEST = "site-data/manifest.json";
const KEY_HEARTBEAT = "site-data/full-heartbeat.json";

async function main() {
  if (!r2Configured()) { console.log("data-to-r2: R2 not configured (LAKE_S3_*) — skipping."); return; }
  const tmp = path.join("lake", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const tarPath = path.join(tmp, "site-data.tar.gz");
  // The operational tree the app reads. Exclude the licensed research corpus + the lake scratch dir.
  execFileSync("tar", ["--exclude=data/.research", "--exclude=data/.tmp", "-czf", tarPath, "data"], { stdio: ["ignore", "ignore", "inherit"] });
  const buf = readFileSync(tarPath);
  await putObject(KEY_TAR, buf, "application/gzip");
  await putObject(KEY_MANIFEST, Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), bytes: buf.length })), "application/json");
  // FULL-only heartbeat: the freshness alert (scripts/alert-freshness.ts) checks THIS, not the manifest.
  // Every 2-hourly intraday tick refreshes the manifest, so it can look fresh while the FULL run — which
  // alone rebuilds the options/earnings feeds — has been dead for days. This object only moves on a FULL.
  if (process.env.FULL === "true") {
    await putObject(KEY_HEARTBEAT, Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), bytes: buf.length })), "application/json");
  }
  rmSync(tarPath, { force: true });
  console.log(`data-to-r2: uploaded ${KEY_TAR} (${(buf.length / 1e6).toFixed(1)} MB) + manifest${process.env.FULL === "true" ? " + FULL heartbeat" : ""} to R2`);
}

main().catch((e) => { console.error("data-to-r2:", String(e?.message || e)); process.exit(1); });
