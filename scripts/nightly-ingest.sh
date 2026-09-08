#!/bin/sh
# ============================================================================
#  Tape — NIGHTLY earnings-call INGEST + PUBLISH driver (Synology NAS). Point DSM
#  Task Scheduler at this to run daily (same PATH/user setup as refresh-local.sh's
#  task — needs git + node/npm on PATH, run as the user that can reach the rig LAN
#  and read tape.env).
#
#  Each run:
#    1. Starts the transcript ingest (scripts/ingest-transcripts) ONLY if one is not
#       already running — so a daily driver never stacks a 2nd GPU job on the rig and
#       coexists with a long continuous pass. The ingest is newest-call-first,
#       peak-aware (INGEST_PAUSE_PEAK), incremental + resumable.
#    2. Syncs the digested archive to R2 (sync-calls-archive) so the live site picks
#       up whatever has been digested so far. Safe alongside a running ingest —
#       records are written atomically.
#
#  Net effect: the archive digests itself over time and publishes daily, hands-off.
#  When the backlog is fully digested the ingest exits; the next night's run restarts
#  it for any newly-backfilled transcripts, and the sync keeps the site current
#  regardless (this also covers the "publish at the end" case).
# ============================================================================
set -u
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" || exit 1
LOG="$HOME/tape-ops/nightly-ingest.log"
echo "" >> "$LOG"; echo "==== $(date +%Y-%m-%dT%H:%M) ====" >> "$LOG"

# Secrets for the R2 sync (LAKE_S3_*). Adjust the path if tape.env lives elsewhere.
[ -f /volume1/docker/tape/tape.env ] && { set -a; . /volume1/docker/tape/tape.env; set +a; }

# Rig routing for the free local digest model + peak-pause (override via the environment if needed).
export CALL_DIGEST_LOCAL_URL="${CALL_DIGEST_LOCAL_URL:-http://192.168.1.76:8000/v1}"
export CALL_DIGEST_LOCAL_MODEL="${CALL_DIGEST_LOCAL_MODEL:-argus-vlm}"
export INGEST_PAUSE_PEAK="${INGEST_PAUSE_PEAK:-1}"

if pgrep -f "scripts/ingest-transcripts" >/dev/null 2>&1; then
  echo "ingest already running — not starting another" >> "$LOG"
else
  STAMP="$(date +%Y%m%dT%H%M)"
  echo "starting ingest -> $HOME/tape-ops/ingest-$STAMP.log" >> "$LOG"
  nohup npm run ingest-transcripts > "$HOME/tape-ops/ingest-$STAMP.log" 2>&1 &
fi

# Publish whatever is digested so far (daily → the live site stays current).
if npm run sync-calls-archive >> "$LOG" 2>&1; then
  echo "sync ok" >> "$LOG"
else
  echo "sync failed (rc $?)" >> "$LOG"
fi
