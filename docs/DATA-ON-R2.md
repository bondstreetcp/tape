# Moving operational data off git → R2 (build-time hydration)

The repo bloats because `data/` (snapshots, price series, all the feeds — ~145 MB) is committed ~7×/day,
so `.git` grows ~1 GB/month even though the data is regenerable. This migration moves that data to R2
and **hydrates it at build time**, so the app code is unchanged (it still reads local `data/` files) but
git stops carrying the churn. Done in stages so nothing breaks; the git-history cleanup is the last step.

## How it works

- **Nightly** (`npm run data-to-r2`, wired into refresh-data.yml): tars the `data/` tree into
  `s3://tape-lake/site-data/data.tar.gz` (+ a manifest) on **every** tick. The per-stock cache
  (`data/company/*`) is **excluded** from that tarball and shipped as a **separate, FULL-only** object
  `site-data/company.tar.gz` — it only changes on a FULL run, so keeping its ~14 MB out of the every-tick
  tarball stops intraday quote ticks re-uploading (and the NAS re-downloading) unchanged cache.
- **Vercel build** (`npm run vercel-build` = `data-from-r2` then `next build`): downloads **both**
  objects in parallel and extracts them into the project before building, so `next build` sees `data/`
  exactly as if it were committed. The data tree is required (byte-identical round-trip, verified); the
  per-stock cache is best-effort — a missing/failed `company.tar.gz` just means stock pages live-fetch
  (via `lib/companyCache`) until the next FULL ships it, and never fails the build. Falls back to
  committed `data/` if R2 is unreachable (matters only during the safety phase below).

The licensed `data/.research/` corpus is excluded (it's gitignored today too, so no change).

## Status

- ✅ **Step 1 (built + verified):** the pipeline works; a real `data/` upload → download → extract is
  byte-identical. The nightly job now uploads to R2 **and still commits `data/`** (safety phase — R2 and
  git carry the same data, so nothing can break while we prove the Vercel side).
- ⏳ **You do (Vercel dashboard):** wire the build to hydrate from R2 (below), then confirm a deploy.
- ⏳ **Cutover + history cleanup:** only after the Vercel deploy is proven.

## What you set in Vercel (one time)

1. **Project → Settings → Environment Variables** — add the four R2 values (Production + Preview):
   `LAKE_S3_ENDPOINT`, `LAKE_S3_BUCKET`, `LAKE_S3_KEY_ID`, `LAKE_S3_SECRET` (same values as `.env.local` /
   the GitHub secrets).
2. **Project → Settings → Build & Development Settings → Build Command** — override to:
   `npm run vercel-build`
3. Redeploy. In the build log you should see **`data-from-r2: hydrated data/ from R2 (35.x MB)`**, and
   the deployed site should render normally.

⚠️ **The one thing to verify on that first hydrated deploy:** that Next's output file-tracing includes
the build-time-downloaded `data/` files in the serverless bundle the same way it includes committed
ones — i.e., open a few pages (a universe screener, a stock page, a research board) and confirm data
shows. It should (tracing keys off the filesystem at build time, not git), but this is the assumption to
confirm before we stop committing `data/`.

## Cutover (later, after the deploy is proven)

1. Create a **Vercel Deploy Hook** (Settings → Git → Deploy Hooks) and point the nightly job at it
   (curl the hook after `data-to-r2`) — since we'll no longer `git push` data to trigger a build.
2. Stop committing `data/` in the workflow; add `data/` to `.gitignore` (keep a tiny seed for local dev).
3. **History cleanup** — back up first (a `git clone --mirror` + a tag), then purge `data/` from history
   (`git filter-repo --path data --invert-paths`) or squash to a fresh root, then **force-push** and
   resync the bot + Vercel. This reclaims the ~460 MB. This step rewrites shared history and is
   irreversible — do it deliberately, with the backup in hand.
