# Earnings-call ingest — operator runbook

Digest the ~24,480 raw earnings-call transcripts in `data/calls/` into structured
`CallDigest` notes on the AMD rig (free local compute), newest-call-first, and
publish to R2 so the live site picks them up. Runs on the **NAS**
(`TPH-1621CLUSTER`, ssh alias `argus-nas`), repo at `~/tape-ops/repo`.

## Golden rules (learned the hard way)

- **Never run NAS commands as one-shot `ssh argus-nas '…'` from Windows PowerShell.**
  PowerShell 5.1 mangles embedded quotes (`tr: missing operand`, `cut: delimiter
  must be a single character`) and doesn't understand `&&`. **Always open an
  interactive session first — `ssh argus-nas` — and run commands at the NAS prompt**,
  where quoting is normal Linux.
- Git on the NAS needs `GIT_CONFIG_NOSYSTEM=1` (the Synology system gitconfig is
  unreadable). The `gitattributes: Permission denied` warnings on pull are harmless.
- Node isn't on the default PATH; prefix with
  `PATH=/volume1/@appstore/Node.js_v22/usr/local/bin:$PATH`.
- The archive lives in `~/tape-ops` (a home dir, not a shared folder). Confirm it's
  on a persistent volume; DSM warns that non-shared-folder data can be wiped on update.

## Check status

```sh
ssh argus-nas
cd ~/tape-ops/repo
# how many digested vs total:
TOTAL=$(find data/calls -type f -name '*.json' | wc -l)
UND=$(grep -rlF '"digest":null' data/calls | wc -l)
echo "digested $((TOTAL-UND)) / $TOTAL   (undigested $UND)"
# is it running?
ps -ef | grep -E '[i]ngest'
# progress log (newest):
ls -t ~/tape-ops/supervisor-*.log | head -1 | xargs tail -n 20
```

Digests are written atomically per record and published after each supervisor cycle
(`sync-calls-archive` → `calls.tar.gz` on R2), so the site is never left half-updated.

## Start / restart the supervisor (manual)

The **supervisor** runs the ingest and restarts it on death (OOM/hiccup), pausing
during Georgia-Power on-peak (weekdays 2–7pm ET, thru Sep 30), and exits cleanly
once the backlog is drained. From an interactive `ssh argus-nas` session:

```sh
cd ~/tape-ops/repo
GIT_CONFIG_NOSYSTEM=1 git pull                        # get latest scripts
GIT_CONFIG_NOSYSTEM=1 PATH=/volume1/@appstore/Node.js_v22/usr/local/bin:$PATH \
  setsid sh scripts/ingest-supervisor.sh > ~/tape-ops/supervisor-manual.log 2>&1 &
sleep 30; ps -ef | grep -E '[i]ngest'; tail -n 20 ~/tape-ops/supervisor-manual.log
```

You should see a `sh scripts/ingest-supervisor.sh` process **and** an
`npm/tsx/node … ingest-transcripts` process, with the log scrolling
`… N/23485 digested`.

To stop everything (e.g. before a clean restart):

```sh
ps -ef | grep -E '[i]ngest' | awk '{print $2}' | xargs kill
```

## The durable way — DSM Task Scheduler (recommended)

A `setsid` process launched over SSH can still be caught by Synology session cleanup.
Task Scheduler runs the job outside any SSH session, immune to that. Set it up once:

1. DSM → **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**.
2. **General:** name `tape-nightly-ingest`; **User:** `richard` (must reach the rig LAN
   and read `/volume1/docker/tape/tape.env`).
3. **Schedule:** Daily, ~22:00.
4. **Task Settings → Run command → User-defined script:**
   ```
   cd /var/services/homes/richard/tape-ops/repo && PATH=/volume1/@appstore/Node.js_v22/usr/local/bin:$PATH GIT_CONFIG_NOSYSTEM=1 sh scripts/nightly-ingest.sh
   ```
5. Save, select the task, **Run** (to start now). It launches the supervisor if one
   isn't already alive and publishes the digested archive to R2. The supervisor exits
   when the backlog is drained; the next night's run restarts it for new transcripts.

`nightly-ingest.sh` writes to `~/tape-ops/nightly-ingest.log`; the supervisor to
`~/tape-ops/supervisor-<timestamp>.log`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `pgrep: command not found` | Synology has no pgrep. Fixed — guards fall back to `ps -ef \| grep`. |
| Supervisor log: `another (live) supervisor … exiting` | A live supervisor already owns the lock. Expected; don't start a second. |
| Supervisor log: `stale lock … reclaiming` | A previous supervisor was hard-killed; the lock is auto-reclaimed. No action. |
| Everything exits instantly, nothing digests | Pre-fix stale lock at `/tmp/tape-ingest-supervisor.lock`. If on old code: `rmdir /tmp/tape-ingest-supervisor.lock` then restart. |
| `ingest-transcripts: no CALL_DIGEST_LOCAL_URL/MODEL` | Rig endpoint not set. Defaults to `http://192.168.1.76:8000/v1` / `argus-vlm`; check the rig is up. |
| Two ingest processes running | Duplicate launch. Kill all (`… \| xargs kill`) and start one supervisor. |
| PowerShell `The token '&&' is not a valid statement separator` | You pasted a NAS command into PowerShell. Use an interactive `ssh argus-nas` session. |

## Rate

~500–700 digests/day (rig-bound, one call at a time, peak-paused). The full backfill
is weeks of rig time — but **newest-first**, so the most move-relevant quarters land
first. See [conference-audio-pipeline] and `scripts/ingest-transcripts.ts` for detail.
