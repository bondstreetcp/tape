/**
 * Hydrate data/ from R2 before `next build` (Vercel Build Command → `npm run vercel-build`). Downloads
 * the single tarball scripts/data-to-r2.ts uploaded and extracts it into the project, so the app reads
 * data/ from the local filesystem exactly as it does today — the difference is the data came from R2,
 * not a git checkout. This is what lets data/ eventually leave the repo. See docs/DATA-ON-R2.md.
 *
 * Fail-safe: if R2 is NOT CONFIGURED but a local data/ is present (the migration's safety phase, and
 * local dev without creds), fall back to it rather than shipping an empty site. With no R2 and no
 * local data the build hard-fails (better than deploying with no data).
 *
 * ⚠ A CONFIGURED-BUT-FAILED download is FATAL — it must never fall back (2026-07-24 incident). That
 * fallback was written when data/ lived in git, where "stale" meant "the commit's data". On the NAS
 * the slot's data/ PERSISTS in a docker volume, so falling back means serving the last successful
 * hydrate — for days — while `npm run data-from-r2` exits 0, prepare() succeeds, the A/B slot swaps,
 * and every signal stays green. That is precisely how the site served 47h-old data under FRESH code
 * with no alert. Failing here is the safe outcome everywhere it runs: the NAS keeps the live slot up
 * and retries next cycle (and now pages after 3 failures), the nightly workflow refuses to compute on
 * and re-upload a stale tree (the 07-04 clobber lesson), and CI surfaces it as a red run.
 */
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";
import path from "path";
import { getObject, r2Configured } from "../lib/r2";
import { mergeCallDigestFiles } from "../lib/callDigests";
import { extractAtomic } from "../lib/atomicExtract";

const KEY_TAR = "site-data/data.tar.gz";
const KEY_COMPANY = "site-data/company.tar.gz";
const KEY_NEWS_TAPE = "site-data/news-tape.json.gz"; // must match scripts/news-tape-sync.ts
const KEY_CALL_DIGESTS = "site-data/call-digests.json"; // must match scripts/refresh-call-digests.ts (CALL_DIGEST_PUBLISH)
const haveCommitted = () => existsSync(path.join("data", "russell3000", "snapshot.json"));

/** Untar into a staging dir, then rename each file into place — see lib/atomicExtract for why. The
 *  staging dir sits under lake/.tmp, inside the same slot as data/, so renames never cross a mount. */
function hydrate(tarPath: string, stage: string, label: string): void {
  const moved = extractAtomic(tarPath, stage, ".", (tp, into) =>
    execFileSync("tar", ["-xzf", tp, "-C", into], { stdio: ["ignore", "ignore", "inherit"] }));
  console.log(`data-from-r2: ${label} — ${moved} files swapped into place atomically`);
}

async function main() {
  if (!r2Configured()) {
    // ⚠ On a SERVER this fallback is the silent-staleness trap, not a safety net. The NAS keeps data/
    // in a docker volume that survives restarts, so an unset LAKE_S3_* (a truncated tape.env, a
    // container recreated without env_file) would let every hourly refresh exit 0 while the served
    // data froze — the entrypoint would log "data refresh OK" forever and the 3-failure alert could
    // never fire. LAKE_REQUIRE_R2=1 (set by tape-web-entrypoint.sh) says "this context has no
    // legitimate no-creds mode": fail loudly instead. Local dev and the migration path are unchanged.
    if (process.env.LAKE_REQUIRE_R2 === "1") {
      console.error("data-from-r2: LAKE_REQUIRE_R2=1 but R2 is NOT CONFIGURED — refusing to silently reuse the existing data/ tree. Check LAKE_S3_* in the environment.");
      process.exit(1);
    }
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
    hydrate(tarPath, path.join(tmp, "stage-data"), "data/");
    console.log(`data-from-r2: hydrated data/ from R2 (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e: any) {
    // Endpoint (account host) is not a secret — log it so a bad value (e.g. a pasted scheme, or a
    // trailing \r from a CRLF-saved env file) is obvious. NO fallback: see the header — R2 was
    // configured, so a failure here is a real breakage, and silently serving the volume's stale data/
    // is the failure mode this exit exists to prevent.
    // 400, not 140: lib/r2 now appends R2's XML error CODE plus both clocks, and truncating at 140
    // threw away the only two fields that tell InvalidAccessKeyId / SignatureDoesNotMatch / clock
    // skew apart — all of which arrive as a bare 403.
    const diag = `${String(e?.message || e).slice(0, 400)} [endpoint="${process.env.LAKE_S3_ENDPOINT || ""}"]`;
    console.error(`data-from-r2: R2 IS configured but the download failed — refusing to build on stale local data/. Fix the LAKE_S3_* creds/endpoint (or unset them to fall back deliberately). (${diag})`);
    if (haveCommitted()) console.error("data-from-r2: a local data/ tree EXISTS but is NOT trusted — its age is unknown and it may be days old.");
    // exitCode + return, NOT process.exit(): exiting from inside a settled fetch promise trips libuv's
    // UV_HANDLE_CLOSING assertion and reports 127 instead of 1 (the same trap as the old healthcheck).
    process.exitCode = 1;
    return;
  }

  // Per-stock cache: OPTIONAL, best-effort. A missing company.tar.gz (no FULL has shipped it yet) or a
  // failed download/extract must NOT fail the build — lib/companyCache live-fetches on a miss until the
  // next FULL bakes and ships it (degrade to live-fallback, never break the deploy).
  if (companyRes.status === "fulfilled") {
    try {
      const cPath = path.join(tmp, "company.tar.gz");
      writeFileSync(cPath, companyRes.value);
      hydrate(cPath, path.join(tmp, "stage-company"), "data/company/");
      console.log(`data-from-r2: hydrated data/company/ from R2 (${(companyRes.value.length / 1e6).toFixed(1)} MB)`);
    } catch (e: any) {
      console.warn(`data-from-r2: per-stock cache extract failed (${String(e?.message || e).slice(0, 100)}) — stock pages live-fetch.`);
    }
  } else {
    console.warn(`data-from-r2: per-stock cache not hydrated (${String(companyRes.reason?.message || companyRes.reason).slice(0, 100)}) — stock pages live-fetch until the next FULL ships it.`);
  }

  // News tape: its OWN object, for the same reason data/company has one — it is on a different clock.
  // The tape is rewritten every few minutes by the `news` tick and is deliberately excluded from
  // data.tar.gz (see data-to-r2), so this is the only way a web slot ever sees it. Best-effort: a
  // missing object just means no tape has shipped yet, and /news renders its own empty state.
  try {
    const gz = await getObject(KEY_NEWS_TAPE);
    const json = gunzipSync(gz);
    const parsed = JSON.parse(json.toString("utf8")) as { items?: unknown[] };
    if (!Array.isArray(parsed.items)) throw new Error("object has no items array");
    // Written directly rather than through the tar staging path: it is one small file, and parsing
    // before writing already guarantees we never replace a good copy with a truncated one.
    writeFileSync(path.join("data", "news-tape.json"), json);
    console.log(`data-from-r2: hydrated news-tape.json (${parsed.items.length} rows, ${(gz.length / 1024).toFixed(0)} KB gz)`);
  } catch (e: any) {
    console.warn(`data-from-r2: news tape not hydrated (${String(e?.message || e).slice(0, 100)}) — /news shows its empty state.`);
  }

  // Earnings-call digests: its OWN object too — written by a clean-IP box's `refresh-call-digests` with
  // CALL_DIGEST_PUBLISH=1 (the same-day transcript source refuses the NAS's home IP). MERGED with the local
  // copy, never clobbered, so the runner's own Fool-sourced rows and the box's Investing.com rows both
  // survive. Best-effort: no object = nothing published yet.
  try {
    const raw = await getObject(KEY_CALL_DIGESTS);
    const remote = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(remote?.digests)) throw new Error("object has no digests array");
    const localPath = path.join("data", "call-digests.json");
    let merged = remote;
    try { merged = mergeCallDigestFiles(JSON.parse(readFileSync(localPath, "utf8")), remote); } catch { /* no local copy yet */ }
    writeFileSync(localPath, JSON.stringify(merged));
    console.log(`data-from-r2: hydrated call-digests.json (${merged.digests.length} digests; ${remote.digests.length} in R2)`);
  } catch (e: any) {
    console.warn(`data-from-r2: call digests not hydrated (${String(e?.message || e).slice(0, 100)}) — the runner's own copy stands.`);
  }
}

main().catch((e) => { console.error("data-from-r2:", String(e?.message || e)); process.exitCode = 1; });
