#!/bin/sh
# tape-news-tick.sh — the FIVE-MINUTE news tape tick. Sibling of tape-tick.sh (hourly), NOT a
# replacement: they do different work, on different clocks, against different R2 objects.
#
# DSM Task Scheduler: Scheduled Task > User-defined script
#   User:     root
#   Schedule: daily, first run 00:00, "Repeat every 5 minutes", last run 23:55
#   Command:  /volume1/docker/tape/tape-news-tick.sh
#
# WHY THIS RUNS LOCALLY AND NOT VIA tape-dispatch.sh's workflow_dispatch:
# the actual work is six keyless HTTP GETs and a regex pass — about two seconds. Firing a GitHub
# Actions run for it 288 times a day would spend a minute of checkout + npm ci to do two seconds of
# work, and would put the archive's only writer behind GitHub's queue.
#
# SAFE TO OVERLAP WITH THE HOURLY TICK. run-tick.ts's `news` mode runs ahead of the main lock and
# skips the git checkout, on its own .tick-news.lock. It never reads or writes the data tree — only
# site-data/news-tape.json.gz — so it cannot race a FULL run. Do NOT "simplify" it back onto the
# shared lock: a FULL run holds that for hours and the tape would go dark through the whole rebuild.
#
# The tape is an APPEND-ONLY archive and the wires keep only ~20 items each, so a tick that does not
# run is history that cannot be recovered. Prefer a noisy failure to a silent skip.

LOG="${TAPE_NEWS_LOG:-/volume1/docker/tape/news-tick.log}"

# 288 runs/day appends fast — keep the log bounded rather than letting it eat the volume.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

docker exec tape-runner sh -c "cd /app && npx tsx scripts/run-tick.ts news" >> "$LOG" 2>&1
rc=$?
[ $rc -ne 0 ] && echo "$(date -u +%FT%TZ) news tick FAILED rc=$rc" >> "$LOG"
exit $rc # non-zero -> DSM emails (enable "send run details when abnormal" on the task)
