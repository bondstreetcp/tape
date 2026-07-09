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

## Phase 2 (optional, later): move the COMPUTE to the NAS too

Only worth it if you want off GitHub runners entirely (privacy, longer runs, more RAM — the 1621+'s
64 GB dwarfs the 7 GB runner). Sketch, if/when wanted:

- **Container Manager** (Docker) → a `node:22` container with the repo cloned to a NAS volume and
  the API keys in a mounted env file (this DOES move all secrets onto the NAS — the main tradeoff).
- A `run-tick.sh <mode>` orchestrator replicating refresh-data.yml's step order (hydrate-from-R2 →
  refresh steps per mode → data-to-r2 → check-freshness → curl the Vercel Deploy Hook), each step
  `|| true` to mirror `continue-on-error`.
- The same hourly Task Scheduler pattern, running `docker exec` instead of the dispatch curl.
- Keep the GitHub `47 22` FULL cron as fallback and the Ops-alerts workflow as the watchdog — and
  set BOTH schedulers' write paths through the same R2 bucket only ONE at a time (disable one side's
  upload before enabling the other; two independent writers can interleave tarball uploads).

Don't start phase 2 until phase 1 has run clean for a while — phase 1 already eliminates the
observed failure mode (dropped/late ticks), which is the actual problem.
