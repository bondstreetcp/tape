#!/bin/sh
# tape-web-entrypoint.sh — serve the Tape site FROM the DS1621+, self-updating, with zero-downtime
# deploys. Same drag-and-drop shape as tape-entrypoint.sh (the compute container): no image build, no
# SSH, no DSM task. Container Manager → Project → Run.
#
# A/B SLOTS are the whole trick. Two complete checkouts live side by side:
#
#     /app/a   ← one of these is LIVE (next start is serving out of it)
#     /app/b   ← the other is IDLE: we pull + npm ci + hydrate + build INTO it
#
# The expensive part (npm ci + a ~37 MB R2 hydrate (~150 MB on disk) + a ~1200-page next build, minutes on this box)
# happens entirely in the IDLE slot while the LIVE slot keeps serving. Only when the new slot builds
# clean do we swap the server over — so downtime is one process restart (~3s), a broken build can
# never take the site down (we just keep serving the old slot), and the previous slot stays intact on
# disk as an instant rollback. Costs ~5 GB of disk for the second slot. That is cheap.
#
# This is app-layer resilience on ONE box. It is NOT Synology High Availability — SHA needs a second
# identical NAS. The box, its PSU and your uplink remain single points of failure. See docs/SETUP-NAS-WEB.md.
set -e

REPO_URL="https://github.com/bondstreetcp/tape.git"
ROOT=/app
PORT="${PORT:-3000}"
CHECK_SECONDS="${TAPE_WEB_CHECK_SECONDS:-900}"     # how often to look for work (15 min)
REBUILD_SECONDS="${TAPE_WEB_REBUILD_SECONDS:-3600}" # force a rebuild this often, to bake fresh R2 data (1 h)
HEALTH_TRIES="${TAPE_WEB_HEALTH_TRIES:-45}"        # × 2s = 90s for a new slot to answer

log() { echo "[tape-web] $(date -u +%FT%TZ) $*"; }

# The web container never runs the embedder (refresh-filing-index runs in the COMPUTE container), so
# skip onnxruntime-node's CUDA-EP download — without this, EVERY hourly `npm ci` re-downloads the CUDA
# binaries from the vendor CDN (npm's cache can't help; it's the package's own install script), and a
# slow/failed download fails the whole slot build. Mirrors tape-entrypoint.sh; the CPU runtime bundled
# with the package is all `next start` could ever need.
export ONNXRUNTIME_NODE_INSTALL=skip

# Best-effort ops ping (Slack {text} / Discord {content} — each ignores the other's key). Inert unless
# ALERT_WEBHOOK_URL is set in tape.env. This is the "green watchdog, stale site" fix: R2-side freshness
# alerts stay green when THIS container's rebuilds fail, so the failure must page from here.
alert() {
  [ -n "$ALERT_WEBHOOK_URL" ] || return 0
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"[tape-web] $1\",\"content\":\"[tape-web] $1\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}

SERVER_PID=""
LIVE=""
LAST_BUILD=0
FAILS=0

git config --global --add safe.directory '*' 2>/dev/null || true

# Build a slot from scratch-or-pull. Returns non-zero on ANY failure (clone/deps/hydrate/build) —
# callers must treat that as "keep serving what we have".
#
# ⚠ EVERY step needs its own `|| return 1`. `set -e` is DISABLED inside a function invoked from an
# `if` condition (POSIX), which is exactly how the update loop calls this — so without the explicit
# guards a failed `npm ci` would fall straight through into the hydrate and the build.
prepare() {
  slot="$1"
  dir="$ROOT/$slot"
  if [ ! -d "$dir/.git" ]; then
    log "slot $slot: first build — cloning $REPO_URL"
    rm -rf "$dir" || return 1
    mkdir -p "$dir" || return 1
    git clone --depth 20 "$REPO_URL" "$dir" || return 1
  else
    log "slot $slot: fetching origin/main"
    # git clean -fd drops files deleted between commits; it does NOT touch ignored dirs
    # (node_modules/, data/, .next/), so deps + the hydrated data survive.
    (cd "$dir" && git fetch --depth 20 origin main && git reset --hard origin/main && git clean -fd) || return 1
  fi
  cd "$dir" || return 1
  # ⚠ --include=dev is MANDATORY. The container sets NODE_ENV=production (correct for `next start`),
  # and npm reads that as --omit=dev, so a bare `npm ci` installs ONLY the 10 production deps and
  # silently skips the entire build toolchain — tsx (which runs data-from-r2), typescript, tailwind,
  # @types/*. The symptom is `sh: 1: tsx: not found` right after "hydrating data/ from R2", then a
  # boot restart-loop. Do not "simplify" this flag away.
  log "slot $slot: npm ci (incl. devDependencies — needed to build)"
  npm ci --include=dev --no-audit --no-fund || return 1
  # The SAME hydrate Vercel's build runs — data/ comes from R2, never from git (data/ is gitignored).
  log "slot $slot: hydrating data/ from R2"
  npm run data-from-r2 || return 1
  log "slot $slot: next build (this is the slow part — the live slot is still serving)"
  npm run build || return 1
  log "slot $slot: build OK @ $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  return 0
}

start_server() {
  cd "$ROOT/$1"
  node_modules/.bin/next start -p "$PORT" &
  SERVER_PID=$!
  LIVE="$1"
  log "serving slot $1 (pid $SERVER_PID) on :$PORT"
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

# Any 1xx-4xx answer counts as up: "/" 307s to /u/<default>, and a stale-data 503 from the freshness
# endpoint must NOT be read as "the web server is down" (that would restart-loop a healthy site).
# 000 (connection refused) and 5xx are down.
#
# ⚠ curl, NOT `node -e "fetch(...).then(r=>process.exit(...))"`. Calling process.exit() from inside a
# resolved fetch promise trips a libuv assertion (UV_HANDLE_CLOSING) and exits 127 — i.e. the probe
# reports FAILURE against a perfectly healthy server. curl ships in the image: node:22-bookworm
# descends from buildpack-deps:bookworm-curl (the same reason git is available).
healthy() {
  i=0
  while [ "$i" -lt "$HEALTH_TRIES" ]; do
    # curl prints 000 and exits non-zero when nothing is listening; `|| true` keeps set -e out of it.
    code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)
    case "$code" in [1-4]*) return 0 ;; esac
    i=$((i + 1))
    sleep 2
  done
  return 1
}

trap 'log "SIGTERM — stopping"; stop_server; exit 0' TERM INT

# ── boot ────────────────────────────────────────────────────────────────────────────────────────
# ⚠ `prepare a` MUST be called under `if !`, never bare. A bare call is a failing command under
# `set -e`, so any boot-time build failure kills the script → the container restart-loops → the site
# is DOWN. That became reachable the moment a broken R2 hydrate turned fatal (2026-07-24): a bad
# credential would take the whole site offline rather than leaving it stale. Doctrine is DEGRADE TO
# STALE, NEVER EMPTY — so on a failed boot build, serve a slot that was built successfully before
# (its data may be old, but the site answers) and let the update loop keep retrying. Only when NO
# slot has ever built is there nothing to serve.
log "boot — slot a is the first build; expect ~10-20 min on this box before the site answers"
if prepare a; then
  start_server a
  LAST_BUILD=$(date +%s)
else
  log "boot: slot a FAILED to build — looking for a previously built slot to serve"
  alert "boot build FAILED (hydrate or build) — serving the last good build if one exists; data will be STALE until this is fixed"
  for s in a b; do
    if [ -d "$ROOT/$s/.next" ]; then
      log "boot: serving slot $s's PREVIOUS build — data may be STALE; the update loop retries every ${CHECK_SECONDS}s"
      start_server "$s"
      break
    fi
  done
  if [ -z "$SERVER_PID" ]; then
    log "boot: no slot has ever built — nothing to serve; exiting so the container restarts"
    exit 1
  fi
  LAST_BUILD=0 # force the update loop to retry the build on its very next check, not in an hour
fi
healthy || log "WARNING: the served slot did not answer health — check the log above for a build/runtime error"

# ── update loop ─────────────────────────────────────────────────────────────────────────────────
# Rebuild when main moves (deploy) OR every REBUILD_SECONDS (bake the tick's fresh R2 data — the same
# cadence the Vercel deploy hook fires at today). ISR (revalidate=600) already re-reads data/ from
# disk, but only the slot's OWN data/, so a rebuild is what actually pulls the new tarball in.
while true; do
  sleep "$CHECK_SECONDS" & wait $! || true
  now=$(date +%s)
  remote=$(git ls-remote "$REPO_URL" refs/heads/main 2>/dev/null | cut -f1)
  current=$(cd "$ROOT/$LIVE" && git rev-parse HEAD 2>/dev/null || echo "")
  age=$((now - LAST_BUILD))

  if [ -n "$remote" ] && [ "$remote" = "$current" ] && [ "$age" -lt "$REBUILD_SECONDS" ]; then
    continue # code unchanged and the data bake is still fresh — nothing to do
  fi
  if [ -n "$remote" ] && [ "$remote" != "$current" ]; then
    reason="main moved → $(echo "$remote" | cut -c1-7)"
  else
    reason="scheduled data rebuild (${age}s since last)"
  fi

  idle=$([ "$LIVE" = "a" ] && echo b || echo a)
  log "update: $reason — building slot $idle"
  if ! prepare "$idle"; then
    FAILS=$((FAILS + 1))
    log "slot $idle FAILED to build (consecutive failures: $FAILS) — slot $LIVE stays live, retrying next cycle"
    # Fire ONCE at the threshold (not every retry); a later success resets the counter. Three failures
    # ≈ 45 min of a stuck pipeline — past transient npm/network noise, into served-data-drifting-stale.
    [ "$FAILS" -eq 3 ] && alert "3 consecutive slot-build failures — served data is drifting stale; check the tape-web container log for the failing step"
    continue
  fi
  FAILS=0

  prev="$LIVE"
  stop_server
  start_server "$idle"
  if healthy; then
    LAST_BUILD=$(date +%s)
    log "switched live → slot $idle (slot $prev kept as rollback)"
  else
    log "slot $idle built but will not serve — ROLLING BACK to slot $prev"
    stop_server
    start_server "$prev"
    healthy || { log "CRITICAL: rollback slot $prev is also unhealthy — the container will be restarted by its healthcheck"; alert "CRITICAL: new slot won't serve AND the rollback slot is unhealthy — site may be down"; }
  fi
done
