#!/bin/sh
# ============================================================================
#  Tape — LOCAL BACKUP data refresh (Linux / Synology NAS). The portable twin of
#  refresh-local.bat: re-prices each data/<universe>/snapshot.json from fresh Yahoo
#  quotes (the same `npm run refresh-quotes` the cloud cron runs), commits ONLY data/,
#  and pushes to main → Vercel auto-redeploys.
#
#  Supplements the GitHub Actions cron — run it on a timer (Synology DSM Task Scheduler).
#  Safe anytime: no-ops on a dirty working tree (never touches in-progress edits) or when
#  no prices moved (no empty commits); conflict-proof against the bot's pushes.
#
#  Requires: git + node/npm on PATH, and push auth set up for this repo (SSH deploy key
#  or a cached credential — NO token lives in this file). Pushes go to the bondstreetcp
#  remote; make sure that's what `git remote -v` shows.
# ============================================================================
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG="$(pwd)/scripts/refresh-local.log"
echo "" >> "$LOG"; echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====" >> "$LOG"

# Only act on a clean tree, so a timed run never disturbs active dev work.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "SKIP: uncommitted changes in working tree" >> "$LOG"; exit 0
fi

npm run refresh-quotes >> "$LOG" 2>&1 || { echo "refresh-quotes failed" >> "$LOG"; exit 1; }

# Nothing moved? Don't make an empty commit.
if git diff --quiet -- data/; then
  echo "no price moves — nothing to commit" >> "$LOG"; exit 0
fi

git add data/
git commit -q -m "chore: local backup quotes ($(date -u +%Y-%m-%dT%H:%MZ))" >> "$LOG" 2>&1

# Conflict-proof push: on a non-fast-forward, replay our data-only commit on top of the
# bot's latest (keep ours on conflict — the cron regenerates every file too) and retry.
i=0
while [ "$i" -lt 5 ]; do
  if git push origin main >> "$LOG" 2>&1; then echo "pushed" >> "$LOG"; exit 0; fi
  git fetch origin main >> "$LOG" 2>&1 || true
  git rebase -X theirs origin/main >> "$LOG" 2>&1 || git rebase --abort >> "$LOG" 2>&1 || true
  i=$((i + 1))
done
echo "push failed after retries" >> "$LOG"; exit 1
