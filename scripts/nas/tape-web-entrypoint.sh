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
# 300s, not 900: this interval also bounds how long a DEAD server stays dead before the supervisor
# notices, and 15 minutes of downtime waiting for a liveness probe is too long. Cheap — a tick is one
# `git ls-remote` plus a localhost curl. The hourly data refresh is gated on REBUILD_SECONDS, not this,
# so a shorter tick does NOT mean more R2 pulls. SIGHUP short-circuits the wait entirely.
CHECK_SECONDS="${TAPE_WEB_CHECK_SECONDS:-300}"     # how often to look for work (5 min)
REBUILD_SECONDS="${TAPE_WEB_REBUILD_SECONDS:-3600}" # force a rebuild this often, to bake fresh R2 data (1 h)
HEALTH_TRIES="${TAPE_WEB_HEALTH_TRIES:-45}"        # × 2s = 90s for a new slot to answer

log() { echo "[tape-web] $(date -u +%FT%TZ) $*"; }

# The web container never runs the embedder (refresh-filing-index runs in the COMPUTE container), so
# skip onnxruntime-node's CUDA-EP download — without this, EVERY hourly `npm ci` re-downloads the CUDA
# binaries from the vendor CDN (npm's cache can't help; it's the package's own install script), and a
# slow/failed download fails the whole slot build. Mirrors tape-entrypoint.sh; the CPU runtime bundled
# with the package is all `next start` could ever need.
export ONNXRUNTIME_NODE_INSTALL=skip

# This container has NO legitimate "run without R2 credentials" mode — every byte of data/ comes from
# the lake. Without this flag, scripts/data-from-r2.ts treats unset LAKE_S3_* as "local dev" and exits
# 0 reusing whatever data/ is already in the docker volume. That volume SURVIVES restarts, so a
# truncated tape.env or a container recreated without env_file would freeze the served data while
# every refresh reported success, the 3-failure alert never fired, and the freshness monitor watched
# R2 (which is fine) rather than this box. Exactly the shape of the 47h-stale-data incident.
export LAKE_REQUIRE_R2=1

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
  # Reinstall only when the lockfile actually changed. `npm ci` DELETES node_modules and refetches all
  # ~1,100 packages — minutes on this box — and most deploys here are app-code commits that don't touch
  # a single dependency. The stamp lives INSIDE node_modules on purpose: wipe the tree and the stamp
  # goes with it, so the two can never disagree.
  #
  # ⚠ PROBE A DEV BINARY, and note WHY it is `tsx` and not just `next`. Skipping the install removes the
  # self-heal the unconditional `npm ci` used to provide for a damaged tree, so the guard has to fail
  # CLOSED. `next` is a PRODUCTION dependency, so it survives exactly the corruption that matters here:
  # an out-of-band `npm install`/`npm prune` in this container dev-prunes the tree (NODE_ENV=production)
  # WITHOUT wiping node_modules, so the stamp survives and still matches. `next` is present, the install
  # is skipped, and the very next step dies with `tsx: not found` — deterministically, every cycle,
  # forever, because the lockfile never changes. `tsx` is the exact binary that step invokes and the
  # first devDependency to disappear, so testing it restores the self-heal.
  lock_now=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)
  lock_had=$(cat node_modules/.installed-from 2>/dev/null || echo "")
  if [ -n "$lock_now" ] && [ "$lock_now" = "$lock_had" ] && [ -x node_modules/.bin/next ] && [ -x node_modules/.bin/tsx ]; then
    log "slot $slot: package-lock unchanged and node_modules intact — skipping npm ci"
  else
    log "slot $slot: npm ci (incl. devDependencies — needed to build)"
    npm ci --include=dev --no-audit --no-fund || return 1
    # AFTER the install (npm ci wipes node_modules, which would take the stamp with it).
    [ -n "$lock_now" ] && echo "$lock_now" > node_modules/.installed-from
  fi
  # The SAME hydrate Vercel's build runs — data/ comes from R2, never from git (data/ is gitignored).
  log "slot $slot: hydrating data/ from R2"
  npm run data-from-r2 || return 1
  # nice'd: the build shares 4 cores with the LIVE server, and a logged-in user waiting on a stock page
  # matters more than shaving a minute off a deploy nobody is watching. Only affects CPU contention —
  # on an idle box the build runs at full speed.
  log "slot $slot: next build (this is the slow part — the live slot is still serving)"
  # Marker for merge_static's generation test — see there for why. It lives OUTSIDE the worktree
  # ($ROOT/<slot>.build-started, not inside $dir) because `next build` cleans distDir and `git clean -fd`
  # runs on every prepare: anywhere inside the slot, it would be deleted before it could be read.
  # Backdated a minute on purpose: merge_static prunes with `find ! -newer`, which means "older OR
  # EQUAL". A build output landing in the same second as the marker would be treated as the previous
  # generation and retired. The build takes minutes so this is already unlikely, but a one-minute skew
  # makes "this build's own output is strictly newer than its marker" true by construction.
  touch -d '1 minute ago' "$ROOT/$slot.build-started" 2>/dev/null || touch "$ROOT/$slot.build-started"
  nice -n 19 npm run build || return 1
  # ⚠ Stamp WHICH COMMIT THIS BUILD CAME FROM, and only after the build succeeds.
  #
  # A slot's git HEAD is NOT evidence of what is built. `git reset --hard origin/main` above runs
  # BEFORE npm ci, the R2 hydrate and the build — and `git clean -fd` deliberately preserves the
  # ignored .next/ — so any failure in between (the 2026-07-24 bad-R2-credential incident, an npm
  # registry blip, an OOM-killed build) leaves the slot at the NEW commit with the OLD build. Every
  # consumer that asks `git rev-parse HEAD` then believes that slot is up to date when it is not.
  # This file is the only place that knows the difference, so it records it.
  git rev-parse HEAD > "$dir/.next/BUILT_FROM" || return 1
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
  # ⚠ `wait` returns EARLY when a TRAPPED signal arrives while it is waiting — and SIGHUP ("deploy
  # now") is trappable as of this file's instant-deploy support. Returning here with `next start` still
  # bound to $PORT would make the caller's start_server fail EADDRINUSE, the health probe fail, and a
  # perfectly good swap look broken. So confirm the process is actually gone. Bounded at ~20s, then
  # SIGKILL, so a wedged process cannot hang the update loop forever.
  i=0
  while kill -0 "$SERVER_PID" 2>/dev/null && [ "$i" -lt 20 ]; do
    wait "$SERVER_PID" 2>/dev/null || sleep 1
    i=$((i + 1))
  done
  kill -9 "$SERVER_PID" 2>/dev/null || true
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

# SIGHUP = "stop waiting, look for work NOW". The loop sleeps with `sleep & wait $!` precisely so a
# caught signal cuts the wait short, so this turns a deploy from "push, then wait up to CHECK_SECONDS"
# into "push, then `docker kill -s HUP tape-web`". The handler does nothing on purpose — interrupting
# `wait` is the entire effect; doing the work here would run it on the signal stack, concurrently with
# whatever the loop was already doing.
trap 'log "SIGHUP — checking for work now"' HUP

# A slot is serveable only once `next build` has COMPLETED.
#
# ⚠ BUILD_ID, not `-d .next`. next build writes .next incrementally and stamps BUILD_ID last, so a
# build that was killed midway (OOM, `docker stop`, a DSM reboot) leaves a .next directory that
# `next start` refuses to run. Testing the directory is exactly what makes a half-built slot look
# serveable, and it was the old boot fallback's test.
built() { [ -f "$ROOT/$1/.next/BUILD_ID" ]; }

# The commit a slot's CURRENT BUILD came from — empty if unknown. Empty is the safe answer: it never
# equals origin/main, so an unstamped slot is ranked last at boot and reads as "behind" in the update
# loop, which costs exactly one rebuild and re-establishes the stamp. That is what lets this change
# deploy onto the two already-built slots on the NAS without forcing a cold 10-20 min build.
#
# Deliberately NOT folded into built(): serveability and up-to-dateness are different questions, and
# conflating them is the bug this whole stamp exists to fix.
built_rev() { cat "$ROOT/$1/.next/BUILT_FROM" 2>/dev/null || echo ""; }

# Carry the OUTGOING build's static assets into the INCOMING slot before swapping to it.
#
# Next fingerprints every chunk by content, and a page already open in someone's browser holds the OLD
# filenames. Swap slots without this and that tab's next navigation requests
# /_next/static/chunks/<old-hash>.js from a slot that never built it — a hard 404, and the app breaks
# until the user reloads. Vercel never had this problem because old deployments stay fetchable; an A/B
# slot swap is a hard cutover, so the assets have to be carried across by hand.
#
# ⚠ `cp -a`, NOT `cp -r`. Preserving mtimes is what makes the generation test below work at all.
# ⚠ `-n` (no-clobber) so the incoming build's own files always win — we are only ADDING old hashes.
#
# ⚠ RETIRE BY GENERATION, NOT BY WALL-CLOCK AGE. The obvious `find -mtime +2 -delete` is WRONG here and
# fails silently: `cp -a` gives every carried file the mtime of the build that PRODUCED it, so the clock
# starts when the assets were built rather than when they left service. A slot that had been live longer
# than the window — one quiet weekend is enough — has all of its assets deleted milliseconds after being
# copied, while this function still logs success. The 404 it exists to prevent comes back, now disguised
# as handled. Widening the window cannot fix it either, because the gap between deploys is unbounded.
#
# The generation test instead: every file the INCOMING build produced, and every file the OUTGOING build
# produced, is newer than the moment the outgoing slot's build STARTED. Anything older than that marker
# is what the outgoing slot had itself inherited — generation N-2, off the wire for a full deploy cycle.
# So the destination always holds exactly two generations, with no dependence on the clock.
merge_static() {
  from="$ROOT/$1/.next/static"; to="$ROOT/$2/.next/static"
  [ -d "$from" ] && [ -d "$to" ] || return 0
  cp -a -n "$from/." "$to/" 2>/dev/null || true
  # Guarded: on the first swap after this ships the marker doesn't exist yet, and `! -newer <missing>`
  # is unpredictable. Skipping costs one extra generation, once.
  if [ -f "$ROOT/$1.build-started" ]; then
    find "$to" -type f ! -newer "$ROOT/$1.build-started" -delete 2>/dev/null || true
    find "$to" -type d -empty -delete 2>/dev/null || true
  fi
  log "carried slot $1's static assets into slot $2 (open tabs keep resolving their old chunks)"
}

# A single fast liveness probe (vs healthy(), which waits up to 90s for a slot that is starting up).
alive() {
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)
  case "$code" in [1-4]*) return 0 ;; esac
  return 1
}

# ── boot ────────────────────────────────────────────────────────────────────────────────────────
# Boot's job is to make the site ANSWER, not to make it FRESH — those are different goals, and the
# old boot conflated them. It ran a full `prepare a` (npm ci + R2 hydrate + a ~1200-page build)
# BEFORE start_server, so every container restart cost 10-20 minutes of hard downtime even when a
# perfectly good build was already sitting on disk from the last cycle. That is the tax on every
# `docker restart` — and since this file is bind-mounted, restart is the ONLY way to deploy it.
#
# So: if any slot has a completed build, serve it NOW and let the update loop close the gap. A slot
# already at origin/main just needs its data refreshed, which the loop now does in place; a slot
# behind origin/main takes the normal build-into-idle-then-swap path with the site UP throughout.
# The blocking build is reserved for the one case that genuinely has nothing to serve.
#
# ⚠ `prepare a` MUST stay under `if !`, never bare. A bare call is a failing command under `set -e`,
# so a boot-time build failure would kill the script → the container restart-loops → the site is
# DOWN. That became reachable the moment a broken R2 hydrate turned fatal (2026-07-24): a bad
# credential would take the whole site offline rather than leaving it stale. Doctrine is DEGRADE TO
# STALE, NEVER EMPTY.
# ⚠ TIMEOUT. Boot must not block on the network: without it, a hung DNS/TLS handshake (the tunnel
# flapping, DSM still bringing up the network stack) stalls the whole fast path and the site stays
# DOWN for the length of the hang — the exact failure this section exists to remove. On timeout the
# pipeline still exits 0 through `cut`, so boot_remote is simply empty and we serve any completed
# build, which is the correct degraded answer.
boot_remote=$(timeout 20 git ls-remote "$REPO_URL" refs/heads/main 2>/dev/null | cut -f1)
[ -n "$boot_remote" ] || log "boot: could not reach origin (offline or slow) — serving whatever is built and letting the loop sort it out"

# Try a slot whose BUILD is already at origin/main first (it needs no rebuild at all), then any other
# completed build. Unquoted on purpose — this is a word-split list of slot names.
boot_pref=""
boot_rest=""
for s in a b; do
  built "$s" || continue
  if [ -n "$boot_remote" ] && [ "$(built_rev "$s")" = "$boot_remote" ]; then
    boot_pref="$boot_pref $s"
  else
    boot_rest="$boot_rest $s"
  fi
done

# ⚠ Among slots that are NOT at origin/main — which includes the case where origin was unreachable and
# we cannot tell — break the tie on DATA FRESHNESS, not on the alphabet. Only the LIVE slot gets
# hydrated in place, so "newest data/" identifies the slot that was actually serving before the
# restart, which is also the one carrying the newer build.
#
# OBSERVED IN PRODUCTION 2026-07-26 13:36Z, which is why this exists: after a deploy moved origin ahead
# of BOTH slots, boot served slot a (no BUILT_FROM at all, data 11:55Z) over slot b (built 632925c,
# data 12:33Z) purely because "a" sorts first — demoting a good slot to the stale rollback and serving
# 38-minute-older data until the loop rebuilt. The BUILT_FROM stamp alone does not cover this: it
# answers "is this slot CURRENT?", and when the answer is no for everything, something still has to
# choose between the losers.
if [ "$boot_rest" = " a b" ]; then
  a_at=$(stat -c %Y "$ROOT/a/data" 2>/dev/null || echo 0)
  b_at=$(stat -c %Y "$ROOT/b/data" 2>/dev/null || echo 0)
  if [ "$b_at" -gt "$a_at" ]; then boot_rest=" b a"; fi
fi
boot_order="$boot_pref$boot_rest"

LIVE=""
for s in $boot_order; do
  if [ "$(built_rev "$s")" = "$boot_remote" ] && [ -n "$boot_remote" ]; then why="its build is at origin/main"; else why="its build is BEHIND origin/main — the loop will rebuild with the site up"; fi
  log "boot: serving slot $s NOW ($why)"
  start_server "$s"
  if healthy; then break; fi
  log "boot: slot $s built but will not serve — trying the next candidate"
  stop_server
  LIVE=""
done

if [ -n "$LIVE" ]; then
  # Age the data from the hydrated tree itself rather than assuming the worst, so a double restart
  # doesn't re-pull the whole lake for nothing. Falls back to "due now" if it can't be stat'd.
  LAST_BUILD=$(stat -c %Y "$ROOT/$LIVE/data" 2>/dev/null || echo 0)
else
  # Build into a slot that ISN'T holding a completed build, so a slot that merely failed its health
  # probe survives as a rollback instead of being destroyed by the `git reset --hard` + npm ci below.
  # Losing the last build on the box and THEN failing to build is how a container starts restart-
  # looping with nothing to serve.
  cold=a
  for s in a b; do built "$s" || { cold="$s"; break; }; done
  log "boot: no slot has a serveable build — full build of slot $cold; expect ~10-20 min before the site answers"
  if prepare "$cold"; then
    start_server "$cold"
    LAST_BUILD=$(date +%s)
    healthy || log "WARNING: the freshly built slot did not answer health — check the log above for a runtime error"
  else
    log "boot: slot $cold FAILED to build and no previous build exists — exiting so the container restarts"
    alert "boot build FAILED (hydrate or build) and NO previous build exists — the site is DOWN"
    exit 1
  fi
fi

# ── update loop ─────────────────────────────────────────────────────────────────────────────────
# TWO paths, because the two triggers need completely different work:
#
#   CODE moved  → full A/B rebuild + swap. Unavoidable: new code needs npm ci and a next build.
#   DATA is due → hydrate the LIVE slot IN PLACE. No npm ci, no build, no restart.
#
# The old loop did the full rebuild for BOTH, once an hour, forever — a ~1200-page build competing
# with the live server for a 4-core box, ~3s of hard downtime per swap (24×/day), and every
# in-process cache wiped each time, purely to pick up a new data tarball. The entrypoint's own
# comment already conceded ISR re-reads data/ from disk; the rebuild was never what made data fresh,
# it was just the only thing that replaced the FILES.
#
# What makes the in-place path safe is lib/jsonCache keying its entries on file mtime+size: a
# re-hydrated file gets a new stamp and invalidates itself on the very next read, with no restart and
# no TTL to wait out. Cache design and deploy design agreeing is the whole trick.
#
# The write is ATOMIC PER FILE: scripts/data-from-r2.ts extracts to a staging dir and rename(2)s each
# feed into place, so a concurrent reader sees either the whole old file or the whole new one, never a
# truncated one. That matters more here than it looks — an empty render does not just affect the
# request that hit the window, it gets pinned into Next's ISR route cache for the full revalidate
# period. lib/jsonCache also carries the last good parse across a brief unparseable window as a second
# line of defence. Neither is optional now that the refresh happens under a live server.
refresh_data_in_place() {
  slot="$1"
  log "data refresh: hydrating slot $slot in place — no npm ci, no build, no restart"
  (cd "$ROOT/$slot" && npm run data-from-r2) || return 1
  return 0
}

# ── the news tape rides its OWN clock ────────────────────────────────────────────────────────────
# Everything else on the site is baked nightly, so hydrating the data tree on REBUILD_SECONDS (1 h) is
# right for it and deliberately cheap. The news tape is the one feed where that cadence is a PRODUCT
# DEFECT rather than a rounding error: the compute box polls the wires every five minutes, and if the
# web container only picked the result up on the rebuild clock the page would sit up to an hour behind
# a tape that advertises itself as live — on top of the ~10 min the free wires are already behind.
#
# So it is pulled separately, every loop pass (CHECK_SECONDS), and NOT gated on REBUILD_SECONDS.
# That is affordable only because it is one small object fetched on its own: ~200 KB of JSON that
# gzips ~5:1, versus the whole data tree. Do NOT "simplify" this by lowering REBUILD_SECONDS instead —
# that would drag the entire tree (and an npm build) onto a five-minute cadence to move one file.
#
# Failure is a NO-OP by construction: news-tape-sync's pull leaves the existing file alone and exits 0
# when R2 is unreachable or the object is missing, so a bad fetch degrades to a stale tape, never an
# empty one. It is kept out of the FAILS counter for the same reason — a tape that is 20 minutes cold
# is not the site being down, and must not trip the "3 consecutive failures" page-out.
refresh_news_in_place() {
  slot="$1"
  # `if !` rather than `|| return 1` — `set -e` is disabled inside a function called from an `if`,
  # and this must never abort the loop that keeps the site alive.
  if ! (cd "$ROOT/$slot" && npm run news-tape-pull >/dev/null 2>&1); then
    log "news tape: pull failed — slot $slot keeps the tape it has (not counted as a data failure)"
    return 1
  fi
  return 0
}

while true; do
  # `sleep &` + `wait` rather than a bare `sleep`, so a caught signal (SIGHUP = "deploy now") cuts the
  # wait short — verified in the container's actual dash, not assumed.
  # The kill afterwards REAPS the sleep: when a signal ends the wait early the child is still sleeping
  # out its full term, so without this every HUP leaks a process that lingers for up to CHECK_SECONDS.
  # Harmless no-op when the sleep simply ran to completion.
  sleep "$CHECK_SECONDS" & SLEEP_PID=$!
  wait "$SLEEP_PID" || true
  kill "$SLEEP_PID" 2>/dev/null || true
  now=$(date +%s)

  # ── supervisor ────────────────────────────────────────────────────────────────────────────────
  # Nothing else restarts a dead `next start`. That used to be handled by ACCIDENT: the old loop tore
  # the server down and brought it back every hour, so a process killed by the OOM killer was
  # resurrected within the hour. Splitting the rebuild out removed that side effect, so the liveness
  # check it was silently providing has to become explicit — otherwise a crashed server means the site
  # is down until someone pushes a commit.
  #
  # Probes the PORT rather than `kill -0 $SERVER_PID`: a child the shell has not reaped is a zombie,
  # and kill -0 reports a zombie as alive. It also catches a process that is up but wedged.
  if [ -n "$LIVE" ] && ! alive; then
    log "supervisor: slot $LIVE is not answering — restarting it"
    stop_server
    start_server "$LIVE"
    if healthy; then
      log "supervisor: slot $LIVE is answering again"
      alert "the web server had stopped answering and was restarted (slot $LIVE) — check the log for an OOM or crash"
    else
      log "supervisor: slot $LIVE STILL not answering after a restart"
      alert "CRITICAL: the web server will not answer even after a restart (slot $LIVE) — the site is DOWN"
    fi
  fi

  # ── news tape (every pass) ────────────────────────────────────────────────────────────────────
  # Placed ABOVE the "nothing to do" early-continue on purpose. Every branch below this point either
  # skips the rest of the loop (code unchanged + bake still fresh) or does something much heavier,
  # so anything that must happen on the CHECK_SECONDS cadence has to happen here or not at all.
  # jsonCache keys on mtime+size, so a freshly pulled file self-invalidates on the next read — no
  # restart, and no cutover, which is why this is safe to do underneath a live server.
  [ -n "$LIVE" ] && refresh_news_in_place "$LIVE" || true

  remote=$(timeout 20 git ls-remote "$REPO_URL" refs/heads/main 2>/dev/null | cut -f1)
  # ⚠ The BUILT commit, not the CHECKED-OUT one. prepare() advances the worktree to origin/main before
  # npm ci / hydrate / build, so a half-failed prepare leaves HEAD at origin/main with an older build.
  # Asking git here would make this test read "up to date" forever and the rebuild below unreachable —
  # the site would serve stale CODE indefinitely while logging "data refresh OK" hourly. An unstamped
  # slot yields "" which never matches, so it heals via the rebuild path. See built_rev().
  current=$(built_rev "$LIVE")
  age=$((now - LAST_BUILD))

  if [ -n "$remote" ] && [ "$remote" = "$current" ] && [ "$age" -lt "$REBUILD_SECONDS" ]; then
    continue # code unchanged and the data bake is still fresh — nothing to do
  fi

  # DATA-ONLY path: code is where we left it, only the hourly data refresh is due.
  if [ -n "$remote" ] && [ "$remote" = "$current" ]; then
    if refresh_data_in_place "$LIVE"; then
      FAILS=0
      LAST_BUILD=$(date +%s)
      log "data refresh OK — slot $LIVE serving fresh data (caches self-invalidate on mtime)"
    else
      FAILS=$((FAILS + 1))
      log "data refresh FAILED (consecutive failures: $FAILS) — slot $LIVE keeps serving what it has, retrying next cycle"
      [ "$FAILS" -eq 3 ] && alert "3 consecutive data refreshes failed — served data is drifting stale; check the tape-web log (R2 creds/clock?)"
    fi
    continue
  fi

  reason="main moved → $(echo "$remote" | cut -c1-7)"
  idle=$([ "$LIVE" = "a" ] && echo b || echo a)
  log "update: $reason — building slot $idle"
  if ! prepare "$idle"; then
    FAILS=$((FAILS + 1))
    log "slot $idle FAILED to build (consecutive failures: $FAILS) — slot $LIVE stays live, retrying next cycle"
    # Fire ONCE at the threshold (not every retry); a later success resets the counter. Three
    # CONSECUTIVE failures ≈ 15 min at the 300s tick — a single npm/registry blip resets the counter on
    # the next success, so reaching three means genuinely stuck, not noisy. (Was ~45 min when the tick
    # was 900s; the arithmetic moves with CHECK_SECONDS, so re-read it if that changes again.)
    [ "$FAILS" -eq 3 ] && alert "3 consecutive slot-build failures — served data is drifting stale; check the tape-web container log for the failing step"
    continue
  fi
  FAILS=0

  prev="$LIVE"
  # Before the cutover, not after: a tab that requests an old chunk during the swap must already find
  # it on the incoming slot. Doing this afterwards leaves a window where the 404 is still reachable.
  merge_static "$prev" "$idle"
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
