# NAS backup — Synology DS1621+ pulls the R2 bucket nightly

## Why

The **code** is safe on GitHub, but every data artifact lives in exactly **one Cloudflare R2 bucket**
(the `LAKE_S3_BUCKET` in `.env.local` / the Actions secrets): the nightly `data/` tarball the site
hydrates from at build time, AND the research-lake Parquet files. Some of those feeds are
**forward-accumulating and cannot be rebuilt** if the bucket is ever lost or corrupted:

- `trade-log.json` — the earnings-play track record (logged live; history is unrecoverable)
- `short-history.json` — our own short-interest history (Yahoo dropped the prior-month field)
- `iv-history.json` / `putwrite-ivhist.json` — accumulated implied-vol history
- `trump-truth-stocks.json`, guidance history inside `guidance.json`, `congress.json` PTR archive

One bucket + one provider = a single point of failure. The DS1621+ mirrors it nightly, and Btrfs
snapshots turn the mirror into a real point-in-time backup.

**Design: the NAS pulls straight from R2** (Cloud Sync speaks S3; R2 is S3-compatible). No
dependence on any PC being powered on, and it works unchanged on an SHA (high-availability) pair —
Cloud Sync runs on the active node.

---

## Part A — Cloudflare: create a READ-ONLY R2 token (~2 min)

The NAS must never be able to write or delete in R2 — give it a read-only token, not the LAKE_S3
credentials the pipeline uses.

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens** → **Create API Token**
2. Name: `nas-backup-readonly`
3. Permissions: **Object Read only**
4. Scope: **Apply to specific buckets only** → select the bucket (the `LAKE_S3_BUCKET` name from
   `.env.local`)
5. TTL: no expiry (or set a yearly rotation reminder)
6. Create, then copy the **Access Key ID** and **Secret Access Key** somewhere safe — the secret is
   shown once.

You'll also need the **S3 endpoint**: it's the `LAKE_S3_ENDPOINT` value in `.env.local`
(`https://<account-id>.r2.cloudflarestorage.com`). Do not commit or paste it anywhere public — the
account id is treated as a secret in this repo.

## Part B — DSM: Cloud Sync, download-only (~5 min)

1. **Package Center** → install **Cloud Sync** (if not already).
2. Cloud Sync → **+** → provider **S3 Storage**.
3. Fill in:
   - **Server address**: the R2 endpoint host from Part A (strip the `https://`)
   - **Access key / Secret key**: the read-only token from Part A
   - **Bucket name**: the `LAKE_S3_BUCKET` name
4. Task settings:
   - **Local path**: a dedicated shared folder, e.g. `/tape-backup` (create it on a **Btrfs** volume
     — the DS1621+ default — so Part C works)
   - **Remote path**: root of the bucket
   - **Sync direction**: **Download remote changes only** ← the critical setting; the NAS must never
     push back into R2
   - Leave "Don't remove files in the destination…" **unchecked** (a true mirror; snapshots below
     provide the history) — or check it if you prefer an accumulate-only copy and will prune manually
5. Schedule: continuous is fine (the bucket only changes ~11×/weekday); or Settings → **Schedule**
   → allow syncing 23:00–06:00 only, comfortably after the ~22:47 UTC FULL rebuild uploads.

## Part C — turn the mirror into a backup: Btrfs snapshots (~2 min)

A mirror faithfully replicates a corrupted or deleted object. Snapshots keep history:

1. **Snapshot Replication** package → **Snapshots** → select the `tape-backup` shared folder
2. Schedule: **daily**, e.g. 07:00 (after the overnight sync window)
3. Retention: **30 daily** (the whole tree is only a few GB; 30 days ≈ nothing on a 1621+)
4. Optional: enable **Immutable Snapshots** (DSM 7.2+) for ransomware-proofing.

Restore path: Snapshot Replication → Recover, or browse `#snapshot` in File Station.

## Verify (once, after the first sync)

- Cloud Sync task shows **Up to date**; the shared folder contains `site-data/data.tar.gz` (or the
  tarball key the pipeline writes) and the `lake/` Parquet tree.
- Spot-check: download `data.tar.gz` from the NAS copy, open it, confirm `trade-log.json` parses.
- After 2 days: confirm 2 snapshots exist and differ.

## What this does NOT cover (already covered elsewhere)

- **Code / git history** — GitHub (`bondstreetcp/tape`).
- **Supabase** (research-desk PDFs, auth tables) — Supabase's own daily backups; export via its
  dashboard if you want a NAS copy of those too (Hyper Backup can then archive the export).
- **Vercel** — stateless; rebuilt from GitHub + R2 on every deploy.
