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
const haveCommitted = () => existsSync(path.join("data", "russell3000", "snapshot.json"));

async function main() {
  if (!r2Configured()) {
    if (haveCommitted()) { console.log("data-from-r2: R2 not configured — using committed data/."); return; }
    console.error("data-from-r2: R2 not configured AND no committed data/ — cannot hydrate the site.");
    process.exit(1);
  }
  try {
    const buf = await getObject(KEY_TAR);
    const tmp = path.join("lake", ".tmp");
    mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, "site-data.tar.gz");
    writeFileSync(tarPath, buf);
    execFileSync("tar", ["-xzf", tarPath], { stdio: ["ignore", "ignore", "inherit"] }); // extracts data/ into cwd
    console.log(`data-from-r2: hydrated data/ from R2 (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 140);
    if (haveCommitted()) { console.warn(`data-from-r2: R2 download failed — falling back to committed data/. (${msg})`); return; }
    console.error(`data-from-r2: R2 download failed and no committed data/ — build cannot proceed. (${msg})`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("data-from-r2:", String(e?.message || e)); process.exit(1); });
