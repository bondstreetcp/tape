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

## Phase 2: the COMPUTE moves to the NAS

The pipeline itself runs in a Docker container on the DS1621+; GitHub keeps CI-on-push, the
Ops-alerts watchdog, and `workflow_dispatch` as the manual fallback. The orchestrator
([`scripts/run-tick.ts`](../scripts/run-tick.ts)) replicates refresh-data.yml **step for step**
(same order, same continue-on-error, hydrate-first hard gate, freshness-gate-blocks-deploy) and
holds the hourly schedule in one place (`auto` mode) — when the workflow gains a step, add it to
run-tick's STEPS table in the same commit.

Tradeoff accepted in this phase: **the API keys move onto the NAS** (`tape.env`). Keep that file
`chmod 600` on an encrypted-at-rest volume if available.

### B2.1 — bootstrap (~15 min, SSH)

```sh
mkdir -p /volume1/docker/tape
# 1) secrets: copy your working .env.local from the dev machine as tape.env, then ADD one line:
#    VERCEL_DEPLOY_HOOK=<from Vercel → Project → Settings → Git → Deploy Hooks>
vi /volume1/docker/tape/tape.env && chmod 600 /volume1/docker/tape/tape.env
# 2) the repo (public — no creds needed):
git clone https://github.com/bondstreetcp/tape.git /volume1/docker/tape/repo
```

### B2.2 — the container (~5 min)

Container Manager → **Project** → Create → name `tape`, path `/volume1/docker/tape`, paste
[`scripts/nas/docker-compose.yml`](../scripts/nas/docker-compose.yml) → build/up. Then one-time
dependency install + smoke test from SSH:

```sh
docker exec tape-runner sh -c "cd /app && npm ci"
docker exec tape-runner sh -c "cd /app && npx tsx scripts/run-tick.ts quotes --dry"   # plan check
docker exec tape-runner sh -c "cd /app && npx tsx scripts/run-tick.ts quotes"        # real ~1-min tick
tail -20 /volume1/docker/tape/tick.log 2>/dev/null || true
```

The real tick should end `done: 2/2 steps ok` (hydrate → quotes → alerts → R2 upload → deploy hook).

### B2.3 — swap the hourly task

Copy [`scripts/nas/tape-tick.sh`](../scripts/nas/tape-tick.sh) to `/volume1/docker/tape/` and
`chmod 700` it. Edit the phase-1 Task Scheduler entry (or create it now if you skipped phase 1):
same schedule (daily, 00:00, every 1 hour, user **root**, email on abnormal exit), command:

```sh
/volume1/docker/tape/tape-tick.sh
```

⚠ **Never run phase 1 dispatch AND phase 2 exec together** — two writers interleave on the R2
tarball. The hourly task runs exactly one of them.

### B2.4 — cutover (the flip)

Once a NAS FULL run has gone green (check `tick.log` after 23:00 UTC: `done: …/58 steps ok`,
freshness gate ✓, deploy hook 200/201):

1. Remove ALL `schedule:` crons from `.github/workflows/refresh-data.yml` (ask Claude — one commit).
   `workflow_dispatch` stays: from anywhere, `gh workflow run refresh-data.yml -f mode=full` is the
   emergency fallback if the NAS is down (GitHub still has all the secrets).
2. The Ops-alerts watchdog (freshness-alert.yml) stays on GitHub — an independent system that
   alerts when the NAS pipeline goes stale. Set `ALERT_WEBHOOK_URL` so it can actually reach you.
3. binary-digest.yml (Monday push digest) stays on GitHub — delay-tolerant, secrets already there.

### Rollback

The GitHub path never goes away: re-add the crons (git revert the cutover commit) and disable the
NAS task. Both sides read/write the same R2 bucket, so switching back is one commit + one checkbox.
