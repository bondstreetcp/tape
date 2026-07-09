#!/bin/sh
# tape-tick.sh — Phase 2 hourly task: run the tick ON the NAS (replaces tape-dispatch.sh's
# curl once the compute moves here — never run both; two writers race on R2).
# DSM Task Scheduler: daily, first run 00:00, every 1 hour, user root.
# scripts/run-tick.ts decides the mode from the hour ("auto") and no-ops off-tick — the schedule
# lives in ONE place (run-tick.ts autoMode), not in this wrapper.

LOG="${TAPE_LOG:-/volume1/docker/tape/tick.log}"

echo "$(date -u +%FT%TZ) tick fired" >> "$LOG"
docker exec tape-runner sh -c "cd /app && npx tsx scripts/run-tick.ts auto" >> "$LOG" 2>&1
rc=$?
echo "$(date -u +%FT%TZ) tick done rc=$rc" >> "$LOG"
exit $rc # non-zero → DSM emails (set the task's "send run details when abnormal")
