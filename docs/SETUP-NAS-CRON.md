# NAS-driven scheduling — the DS1621+ is the clock, GitHub stays the compute

## Why

GitHub's **shared cron scheduler** is the unreliable part of the pipeline: scheduled runs get
delayed 1–2 hours at busy times and are sometimes silently dropped (the 2026-07-08 morning tick
never fired, so the Desk Brief never generated). The compute itself — the runners — has been fine.

Fix: the Synology dispatches `workflow_dispatch` API calls on an exact schedule. **Dispatched runs
start within seconds** — they don't sit in the cron queue. Nothing else changes: same workflow, same
runners, same secrets (which stay in GitHub, not on home hardware). Bonus: the desk-brief ticks are
now scheduled in ET, so they stop drifting an hour every DST change (GitHub cron is UTC-only).

Security note: this is deliberately NOT a self-hosted GitHub runner. On a **public repo** a
self-hosted runner would let a fork PR execute code on the NAS — never do that. The only credential
the NAS holds is a fine-grained PAT that can start workflows on this one repo and nothing else.

## Part A — create the PAT (~2 min)

1. GitHub (as **bondstreetcp**) → Settings → Developer settings → **Fine-grained tokens** → Generate.
2. Name `nas-dispatch`; expiry 1 year (set a rotation reminder).
3. Repository access: **Only select repositories** → `bondstreetcp/tape`.
4. Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
5. Generate and copy the token (shown once).

## Part B — install the script (~5 min)

1. Copy [`scripts/nas/tape-dispatch.sh`](../scripts/nas/tape-dispatch.sh) to the NAS, e.g.
   `/volume1/homes/<you>/tape/tape-dispatch.sh` (File Station upload or `scp`).
2. Save the PAT into `/volume1/homes/<you>/.tape-pat` (a one-line file), then via SSH:
   `chmod 600 ~/.tape-pat && chmod 700 ~/tape/tape-dispatch.sh`
3. Quick test from SSH — force a lightweight tick regardless of the hour by dispatching directly:
   the script only fires on tick hours, so for a smoke test run the curl by hand or wait for the
   next tick hour and check the log: `tail /var/log/tape-dispatch.log` and the repo's Actions tab
   (the run shows as "Daily data refresh" triggered by `workflow_dispatch`).

## Part C — one Task Scheduler entry (~2 min)

DSM → Control Panel → **Task Scheduler** → Create → **Scheduled task → User-defined script**:

- General: name `tape-dispatch`, user **root** (or your user — then adjust `TAPE_LOG` to a writable
  path, e.g. `TAPE_LOG=/volume1/homes/<you>/tape/dispatch.log`).
- Schedule: **Daily**, first run time **00:00**, Frequency **Every 1 hour** (last run 23:00).
- Task Settings → Run command:
  ```sh
  TAPE_PAT_FILE=/volume1/homes/<you>/.tape-pat /volume1/homes/<you>/tape/tape-dispatch.sh
  ```
- Task Settings → check **Send run details by email → only when the script terminates abnormally**
  (a failed dispatch exits 1, so you get emailed exactly when the clock breaks).

The script holds the whole schedule (hour → tick map in its header) and exits instantly on
non-tick hours and weekends — an hourly no-op costs nothing. On an SHA pair the scheduled task
runs on the active node; nothing special needed.

## Transition plan

- **Week 1:** run BOTH schedulers. The workflow's concurrency group serializes overlapping runs
  (never cancels an in-flight one), and every step is idempotent + hydrate-first, so a double-fired
  tick is just harmless redundancy. Watch `/var/log/tape-dispatch.log` and the Actions tab: every
  tick should now appear ~on the hour via `workflow_dispatch`.
- **After a clean week:** delete all `schedule:` crons from `refresh-data.yml` EXCEPT `47 22 * * 1-5`
  (the FULL rebuild stays as a GitHub-side fallback — if the NAS is ever down, the site's core data
  still refreshes nightly, at worst a couple hours late). The freshness gate + Ops-alerts workflow
  stay on GitHub as the independent watchdog either way.

## Phase 2: move the COMPUTE onto the NAS (drag-and-drop container)

The whole pipeline runs in one self-scheduling Docker container on the DS1621+ — no SSH, no DSM
task, no dispatch PAT. The orchestrator [`scripts/run-tick.ts`](../scripts/run-tick.ts) replicates
refresh-data.yml **step for step** (same order, same continue-on-error, hydrate-first hard gate,
freshness-gate-blocks-deploy) and owns the hourly schedule in `auto` mode. When the workflow gains a
step, add it to run-tick's STEPS table in the same commit.

### What runs where after the move

| GitHub workflow | Ported to the NAS as | Notes |
|---|---|---|
| `refresh-data.yml` (11 crons) | `run-tick.ts` — `full`/`quotes`/`intl`/`desk`, via `auto` | the whole data pipeline |
| `refresh-narration.yml` (button) | `run-tick.ts narration` | run by hand when narration blanks |
| `binary-digest.yml` (Mon) | `run-tick.ts digest` — via `auto` Monday 13:00 UTC | weekly webhook/email |
| `freshness-alert.yml` (watchdog) | **stays on GitHub — by design** | a smoke detector must run on *different* hardware than the pipeline it watches, so it can alert you when the NAS itself dies. Free + independent. |
| `ci.yml` (tsc+tests on push) | **stays on GitHub** | tied to `git push`, not a schedule — nothing to move |

So every *scheduled* job is on the NAS; only the independent watchdog and push-CI stay on GitHub,
both deliberately. Tradeoff accepted here: **the API keys now live on the NAS** (`tape.env`) — keep
it `chmod 600`, ideally on an encrypted shared folder.

### The setup — 3 files, one click (~10 min, no SSH)

1. **File Station** → make a folder, e.g. `/docker/tape`, and drop in **three files**:
   - [`scripts/nas/docker-compose.yml`](../scripts/nas/docker-compose.yml)
   - [`scripts/nas/tape-entrypoint.sh`](../scripts/nas/tape-entrypoint.sh)
   - `tape.env` — copy [`scripts/nas/tape.env.example`](../scripts/nas/tape.env.example) to
     `tape.env` and fill in your keys (or copy your dev `.env.local` and add the `VERCEL_DEPLOY_HOOK`
     line). Then right-click → Properties → set it read-only to you.
2. **Container Manager** → **Project** → **Create** → name `tape`, point at that `/docker/tape`
   folder (it reads the compose file) → **Build** → **Run**.

That's it. On first boot the container clones the repo into a Docker-managed volume, runs `npm ci`,
then runs a tick immediately and every hour after. Watch it in **Container Manager → Container →
tape-runner → Log** (everything goes to stdout — there's no host log file with the named-volume
setup). The first quotes/desk tick should end `done: N/N steps ok` (hydrate → refresh → R2 upload →
deploy hook); the nightly `full` (23:00 UTC) runs all 58 steps.

New code ships automatically — each tick `git pull`s `main` first (and re-runs `npm ci` only when
the lockfile changed), so you never rebuild the image for a code change.

### Cutover (the flip)

Once one NAS `full` run has gone green (the tape-runner Log after 23:00 UTC shows `done: …/58 steps
ok`, freshness gate ✓, deploy hook 200/201), tell Claude to **remove the `schedule:` crons from
`refresh-data.yml`** (one commit). Keep on GitHub afterward:

- **`workflow_dispatch`** — the from-anywhere fallback if the NAS is down:
  `gh workflow run refresh-data.yml -f mode=full` (GitHub still holds its own copy of the secrets).
- **`freshness-alert.yml`** — the watchdog. Set `ALERT_WEBHOOK_URL` in its GitHub secrets so it can
  actually reach you when the NAS pipeline goes stale (it reads the R2 heartbeat, so a dead NAS trips
  it automatically).

### Rollback

The GitHub path never goes away — `git revert` the cutover commit to restore the crons and stop the
NAS container. Both sides read/write the same R2 bucket, so switching back is one commit + one click.

### Alternative: external scheduler instead of the self-scheduling loop

If you'd rather DSM own the clock (each tick a fresh `docker exec` rather than an in-container loop),
set the compose `entrypoint`/`command` to idle (`sleep infinity`) and use
[`scripts/nas/tape-tick.sh`](../scripts/nas/tape-tick.sh) from a DSM Task Scheduler entry (daily,
00:00, every 1 hour). ⚠ Never run this *and* the phase-1 dispatch — two writers race on the R2
tarball.

## The five-minute news tick (`/news`)

The market news tape is the one feed that cannot ride the hourly clock: the wires expose only their
newest ~20 items and forget the rest, so **a tick that does not run is history that cannot be
recovered**. It gets its own DSM entry.

This one *is* required — the container's self-scheduling loop only runs `run-tick.ts auto`, which is
hourly by construction. There is no in-container path to a 5-minute cadence.

DSM → Control Panel → **Task Scheduler** → Create → **Scheduled Task → User-defined script**:

- Task: `tape news tick`   ·   User: **root**
- Schedule: **Daily**, first run **00:00**, **Repeat every 5 minutes**, last run **23:55**
- Settings → tick **"Send run details when the script terminates abnormally"**
- Run command:

```sh
/volume1/docker/tape/tape-news-tick.sh
```

Source of truth is [`scripts/nas/tape-news-tick.sh`](../scripts/nas/tape-news-tick.sh) — copy it to
`/volume1/docker/tape/` and `chmod +x`. It is a plain `docker exec` wrapper that bounds its own log
(288 runs/day) and exits non-zero so DSM emails on failure.

**Why this is safe to overlap with the hourly tick.** `run-tick.ts news` runs *ahead of* the main
lock and skips the git checkout, on its own `.tick-news.lock`. It touches exactly one R2 object
(`site-data/news-tape.json.gz`) and never reads or writes the data tree, so it cannot race a FULL
run. ⚠ Do **not** "simplify" it onto the shared lock — a FULL run holds that for hours, and the tape
would go dark through the entire nightly rebuild, which is precisely when the wires are busiest.

**The web side has a matching clock.** `tape-web-entrypoint.sh` pulls this one object every
`CHECK_SECONDS` via `refresh_news_in_place`, deliberately *not* gated on `REBUILD_SECONDS`. Without
that the compute box would poll every 5 minutes while the page updated hourly — a 5-minute tick in
name only. ⚠ Do not "fix" it by lowering `REBUILD_SECONDS` instead: that drags the whole data tree
onto a 5-minute cadence to move one file.

Verify a single tick by hand before trusting the schedule:

```sh
docker exec tape-runner sh -c "cd /app && npx tsx scripts/run-tick.ts news"
```
