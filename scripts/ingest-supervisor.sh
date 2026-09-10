#!/bin/sh
# ============================================================================
#  Tape — INGEST SUPERVISOR. Keeps scripts/ingest-transcripts alive across deaths
#  (OOM kills, box hiccups) so the ~24k-call structured-digest backfill doesn't
#  stall until the next nightly. Restart-on-exit with backoff, a memory-headroom
#  gate, a single-instance lock, and a clean stop once the backlog is fully digested.
#
#  Run once and leave it (the nightly driver also launches it if it isn't running):
#    cd ~/tape-ops/repo && GIT_CONFIG_NOSYSTEM=1 nohup sh scripts/ingest-supervisor.sh \
#      > ~/tape-ops/supervisor-$(date +%Y%m%dT%H%M).log 2>&1 &
#
#  Behaviour:
#    · Runs the ingest in the foreground. Exit 0 = backlog drained -> final sync + STOP.
#    · Any other exit (137 = OOM/SIGKILL, or an error) = died with work left -> publish
#      what got digested, back off, restart.
#    · Fast repeated failures (rig down / misconfig) -> increasing backoff, then GIVE UP
#      after MAX_FAILS so it doesn't hot-loop forever (exits non-zero for visibility).
#    · Waits for >= MIN_MEM_MB available before (re)starting, so it doesn't restart
#      straight back into an OOM.
#    · Never double-runs: if an ingest is already alive (e.g. the nightly started one),
#      it waits that one out instead of stacking a 2nd GPU job on the rig.
#    · Peak-pause is handled inside the ingest (INGEST_PAUSE_PEAK); the supervisor just
#      keeps it alive.
#
#  Config (env, with defaults):
#    CALL_DIGEST_LOCAL_URL / _MODEL   rig endpoint (default http://192.168.1.76:8000/v1 / argus-vlm)
#    INGEST_PAUSE_PEAK  1   MIN_MEM_MB 1500   MAX_FAILS 6   FAST_FAIL_SECS 90   BACKOFF_BASE 30
#    SYNC_EACH 1 (publish to R2 after each run)   INGEST_CMD (override the ingest command; for tests)
# ============================================================================
set -u

REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO" || { echo "can't cd to repo"; exit 1; }

export CALL_DIGEST_LOCAL_URL="${CALL_DIGEST_LOCAL_URL:-http://192.168.1.76:8000/v1}"
export CALL_DIGEST_LOCAL_MODEL="${CALL_DIGEST_LOCAL_MODEL:-argus-vlm}"
export INGEST_PAUSE_PEAK="${INGEST_PAUSE_PEAK:-1}"
MIN_MEM_MB="${MIN_MEM_MB:-1500}"
MAX_FAILS="${MAX_FAILS:-6}"
FAST_FAIL_SECS="${FAST_FAIL_SECS:-90}"   # a run shorter than this counts as a "fast" (likely-persistent) failure
BACKOFF_BASE="${BACKOFF_BASE:-30}"       # backoff = BACKOFF_BASE * consecutive_fast_fails (capped 900s)
SYNC_EACH="${SYNC_EACH:-1}"
INGEST_CMD="${INGEST_CMD:-npm run -s ingest-transcripts}"
SYNC_CMD="${SYNC_CMD:-npm run -s sync-calls-archive}"

log() { echo "[supervisor $(date +%Y-%m-%dT%H:%M:%S)] $*"; }

# Single instance: an atomic mkdir lock, with a LIVENESS check so a hard-killed
# predecessor can't wedge every future start. (Observed: a supervisor killed with
# SIGKILL on Sep-8 left the dir behind and blocked restarts — nightly included — for a
# full day.) We record our PID in the lock and, on contention, reclaim it if the owner
# is gone.
LOCK="${SUPERVISOR_LOCK:-${TMPDIR:-/tmp}/tape-ingest-supervisor.lock}"
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid" 2>/dev/null; return 0; fi
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    return 1                                   # a LIVE supervisor owns it — stand down
  fi
  log "stale lock $LOCK (owner '${owner:-?}' not running) — reclaiming"
  rm -rf "$LOCK" 2>/dev/null || true
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid" 2>/dev/null; return 0; fi
  return 1
}
if ! acquire_lock; then
  log "another (live) supervisor holds $LOCK — exiting"
  exit 0
fi
trap 'rm -rf "$LOCK" 2>/dev/null || true' EXIT INT TERM

# Memory headroom gate. Linux only (reads /proc/meminfo); anywhere else it's a no-op so the script still runs.
mem_ok() {
  [ -r /proc/meminfo ] || return 0
  avail_kb="$(awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo 2>/dev/null || echo '')"
  [ -n "$avail_kb" ] || return 0            # couldn't parse -> don't block
  [ "$avail_kb" -ge $((MIN_MEM_MB * 1024)) ]
}
wait_for_mem() {
  while ! mem_ok; do log "low memory (< ${MIN_MEM_MB}MB avail) — waiting 60s"; sleep 60; done
}

# Is an ingest already alive? Synology/busybox has NO pgrep (the guard silently returned
# false there, so the supervisor would stack a 2nd GPU job on the rig) — fall back to ps.
ingest_running() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "scripts/ingest-transcripts" >/dev/null 2>&1
  else
    ps -ef 2>/dev/null | grep -v grep | grep -q "scripts/ingest-transcripts"
  fi
}

log "supervisor up · rig ${CALL_DIGEST_LOCAL_MODEL} @ ${CALL_DIGEST_LOCAL_URL} · peak-pause=${INGEST_PAUSE_PEAK} · min-mem=${MIN_MEM_MB}MB · max-fails=${MAX_FAILS}"

fails=0
while :; do
  # Don't stack a 2nd GPU job: if an ingest is already alive (nightly, a manual run), wait it out.
  while ingest_running; do log "an ingest is already running — waiting 120s"; sleep 120; done

  wait_for_mem
  log "starting ingest: $INGEST_CMD"
  start="$(date +%s)"
  if sh -c "$INGEST_CMD"; then rc=0; else rc=$?; fi
  end="$(date +%s)"; dur=$((end - start))

  if [ "$SYNC_EACH" = "1" ]; then
    log "publishing digested archive to R2 ($SYNC_CMD)"
    sh -c "$SYNC_CMD" || log "sync failed (rc $?) — will retry next cycle"
  fi

  if [ "$rc" = "0" ]; then
    log "ingest exited 0 — backlog drained. Supervisor done (nightly restarts it when new transcripts land)."
    exit 0
  fi

  if [ "$dur" -lt "$FAST_FAIL_SECS" ]; then
    fails=$((fails + 1))
    log "ingest died after ${dur}s (rc=$rc) — fast failure ${fails}/${MAX_FAILS}"
    if [ "$fails" -ge "$MAX_FAILS" ]; then
      log "too many fast failures — giving up. Check the rig ($CALL_DIGEST_LOCAL_URL) and the newest ingest-*.log."
      exit 1
    fi
    backoff=$((BACKOFF_BASE * fails)); [ "$backoff" -gt 900 ] && backoff=900
  else
    fails=0   # it ran a while = real progress; reset the fast-fail counter
    backoff="$BACKOFF_BASE"
    log "ingest died after ${dur}s (rc=$rc) with work remaining — restarting"
  fi
  log "backing off ${backoff}s before restart"
  sleep "$backoff"
done
