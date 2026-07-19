/**
 * Hydrate data/ from R2 before `next build` (Vercel Build Command → `npm run vercel-build`). Downloads
 * the single tarball scripts/data-to-r2.ts uploaded and extracts it into the project, so the app reads
 * data/ from the local filesystem exactly as it does today — the difference is the data came from R2,
 * not a git checkout. This is what lets data/ eventually leave the repo. See docs/DATA-ON-R2.md.
 *
 * Fail-safe: if R2 is unreachable/unset BUT a committed data/ is present (the migration's safety phase,
 * where we still commit data/), fall back to it rather than shipping an empty site. Only when there's
 * neither R2 nor committed data does the build hard-fail (better than deploying with no data).
 */
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { getObject, r2Configured } from "../lib/r2";

const KEY_TAR = "site-data/data.tar.gz";
const KEY_COMPANY = "site-data/company.tar.gz";
const haveCommitted = () => existsSync(path.join("data", "russell3000", "snapshot.json"));

async function main() {
  if (!r2Configured()) {
    if (haveCommitted()) { console.log("data-from-r2: R2 not configured — using committed data/."); return; }
    console.error("data-from-r2: R2 not configured AND no committed data/ — cannot hydrate the site.");
    process.exit(1);
  }
  const tmp = path.join("lake", ".tmp");
  mkdirSync(tmp, { recursive: true });

  // Two objects: the every-tick data tree (KEY_TAR) + the FULL-only per-stock cache (KEY_COMPANY, split
  // out of the tarball so intraday ticks don't re-ship ~14 MB of unchanged cache). Fetch both in
  // parallel; the trees are disjoint (data/company/* lives ONLY in company.tar.gz), so extraction order
  // is moot. allSettled so a missing/failed company object can't reject the required data download.
  const [dataRes, companyRes] = await Promise.allSettled([getObject(KEY_TAR), getObject(KEY_COMPANY)]);

  // The main data tree is REQUIRED — unchanged fatal-with-committed-fallback contract. Extract is inside
  // the guard too, so a corrupt download falls back to committed data/ exactly as before.
  try {
    if (dataRes.status === "rejected") throw dataRes.reason;
    const buf = dataRes.value;
    const tarPath = path.join(tmp, "site-data.tar.gz");
    writeFileSync(tarPath, buf);
    execFileSync("tar", ["-xzf", tarPath], { stdio: ["ignore", "ignore", "inherit"] }); // extracts data/ into cwd
    console.log(`data-from-r2: hydrated data/ from R2 (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e: any) {
    // Endpoint (account host) is not a secret — log it so a bad value (e.g. a pasted scheme) is obvious.
    const diag = `${String(e?.message || e).slice(0, 140)} [endpoint="${process.env.LAKE_S3_ENDPOINT || ""}"]`;
    if (haveCommitted()) { console.warn(`data-from-r2: R2 download failed — falling back to committed data/. (${diag})`); return; }
    console.error(`data-from-r2: R2 download failed and no committed data/ — build cannot proceed. (${diag})`);
    process.exit(1);
  }

  // Per-stock cache: OPTIONAL, best-effort. A missing company.tar.gz (no FULL has shipped it yet) or a
  // failed download/extract must NOT fail the build — lib/companyCache live-fetches on a miss until the
  // next FULL bakes and ships it (degrade to live-fallback, never break the deploy).
  if (companyRes.status === "fulfilled") {
    try {
      const cPath = path.join(tmp, "company.tar.gz");
      writeFileSync(cPath, companyRes.value);
      execFileSync("tar", ["-xzf", cPath], { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`data-from-r2: hydrated data/company/ from R2 (${(companyRes.value.length / 1e6).toFixed(1)} MB)`);
    } catch (e: any) {
      console.warn(`data-from-r2: per-stock cache extract failed (${String(e?.message || e).slice(0, 100)}) — stock pages live-fetch.`);
    }
  } else {
    console.warn(`data-from-r2: per-stock cache not hydrated (${String(companyRes.reason?.message || companyRes.reason).slice(0, 100)}) — stock pages live-fetch until the next FULL ships it.`);
  }
}

main().catch((e) => { console.error("data-from-r2:", String(e?.message || e)); process.exit(1); });
