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
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { putObject, r2Configured } from "../lib/r2";

const KEY_TAR = "site-data/data.tar.gz";
const KEY_COMPANY = "site-data/company.tar.gz";
const KEY_MANIFEST = "site-data/manifest.json";
const KEY_HEARTBEAT = "site-data/full-heartbeat.json";

async function main() {
  if (!r2Configured()) { console.log("data-to-r2: R2 not configured (LAKE_S3_*) — skipping."); return; }
  const isFull = process.env.FULL === "true";
  const tmp = path.join("lake", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const tarPath = path.join(tmp, "site-data.tar.gz");
  // The operational tree the app reads. Exclude the licensed research corpus + the lake scratch dir, AND
  // the per-stock cache (data/company/*): scripts/refresh-company-cache.ts only rebuilds it on a FULL
  // run, but it weighs ~14 MB gzipped, so shipping it inside the EVERY-tick tarball re-uploaded 14 MB on
  // every intraday quote tick — and made the NAS slot re-download it — for nothing. It rides its own
  // FULL-only object (KEY_COMPANY) instead; data-from-r2 pulls both.
  execFileSync("tar", ["--exclude=data/.research", "--exclude=data/.tmp", "--exclude=data/company", "-czf", tarPath, "data"], { stdio: ["ignore", "ignore", "inherit"] });
  const buf = readFileSync(tarPath);
  await putObject(KEY_TAR, buf, "application/gzip");
  await putObject(KEY_MANIFEST, Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), bytes: buf.length })), "application/json");

  // Per-stock cache → its own object, FULL-only. An intraday tick leaves the last FULL's company.tar.gz
  // untouched (it's the ONLY writer), so it's never stale beyond one FULL cycle. BEST-EFFORT end to end
  // (own try/catch, mirroring the download side): the core data.tar.gz + manifest are already uploaded
  // above, so a tar/PUT failure on this OPTIONAL object must never throw — that would skip the FULL
  // heartbeat below and flunk run-tick's `uploaded` deploy gate, stranding fresh core data undeployed
  // over a cache blip. Worst case the prior company.tar.gz stands and stock pages live-fetch.
  let companyMsg = "";
  if (isFull) {
    try {
      if (existsSync(path.join("data", "company"))) {
        const companyTar = path.join(tmp, "company.tar.gz");
        execFileSync("tar", ["-czf", companyTar, "data/company"], { stdio: ["ignore", "ignore", "inherit"] });
        const cbuf = readFileSync(companyTar);
        await putObject(KEY_COMPANY, cbuf, "application/gzip");
        rmSync(companyTar, { force: true });
        companyMsg = ` + company.tar.gz (${(cbuf.length / 1e6).toFixed(1)} MB)`;
      } else {
        console.warn("data-to-r2: FULL run but data/company/ is missing — leaving the prior company.tar.gz in place.");
      }
    } catch (e: any) {
      console.warn(`data-to-r2: per-stock cache upload failed (${String(e?.message || e).slice(0, 120)}) — leaving the prior company.tar.gz; heartbeat + deploy proceed.`);
    }
  }

  // FULL-only heartbeat: the freshness alert (scripts/alert-freshness.ts) checks THIS, not the manifest.
  // Every 2-hourly intraday tick refreshes the manifest, so it can look fresh while the FULL run — which
  // alone rebuilds the options/earnings feeds — has been dead for days. This object only moves on a FULL.
  if (isFull) {
    await putObject(KEY_HEARTBEAT, Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), bytes: buf.length })), "application/json");
  }
  rmSync(tarPath, { force: true });
  console.log(`data-to-r2: uploaded ${KEY_TAR} (${(buf.length / 1e6).toFixed(1)} MB) + manifest${companyMsg}${isFull ? " + FULL heartbeat" : ""} to R2`);
}

main().catch((e) => { console.error("data-to-r2:", String(e?.message || e)); process.exit(1); });
