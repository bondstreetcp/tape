#!/bin/sh
# tape-entrypoint.sh — the container bootstraps AND schedules itself. Nothing else to configure:
# drop this + docker-compose.yml + tape.env into a folder, hit "Run" in Container Manager, done.
#   1. clone the repo into the mounted volume on first boot (git pull thereafter, per tick)
#   2. npm ci on first boot (run-tick re-runs it later only when the lockfile changes)
#   3. loop forever: at the top of every hour, run `run-tick.ts auto`, which maps the hour to a
#      tick (quotes/intl/desk/full + Monday digest) and no-ops off-tick. No DSM task required.
set -e
REPO_URL="https://github.com/bondstreetcp/tape.git"
APP=/app

echo "[entrypoint] $(date -u +%FT%TZ) starting"
# A lock left by the previous (now-dead) container process must not suppress this fresh boot's ticks.
rm -f "$APP/.tick.lock" 2>/dev/null || true
git config --global --add safe.directory "$APP" 2>/dev/null || true

cd "$APP"
if [ ! -d "$APP/.git" ]; then
  echo "[entrypoint] first boot — cloning $REPO_URL"
  git clone --depth 50 "$REPO_URL" "$APP"
fi
git pull --ff-only origin main || echo "[entrypoint] git pull failed — using the current checkout"

# ALERT_WEBHOOK_URL for run-tick's alarms (checkout-age, freshness) — from the persistent /app
# volume rather than tape.env, because env_file edits need a container DELETE+recreate on Synology
# while this file lands with one `docker exec` + restart. Never commit the real topic.
# This boot-time source covers the immediate tick below; the loop re-sources per tick (see there) so a
# secret rotated in via sync-runner-env goes live on the next tick without a restart.
[ -f "$APP/.alert-env" ] && . "$APP/.alert-env"

# onnxruntime-node (pulled in by @huggingface/transformers, the filing-index embedder) downloads the
# CUDA 12 EP binaries on linux/x64 BY DEFAULT (its install metadata lists requirements["linux/x64"] =
# ["cuda12"]; only the CPU runtime ships bundled). This box is CPU-only AND on a slow home uplink, so
# that download is pure waste — exactly the fetch this whole NAS design avoids. `skip` is the official
# opt-out (onnxruntime-node README → "CUDA EP Installation"); CPU inference uses the bundled
# libonnxruntime, so the nightly embed is unaffected. Exported so the `npm ci` below AND the one
# run-tick fires when the lockfile changes both inherit it.
export ONNXRUNTIME_NODE_INSTALL=skip

echo "[entrypoint] npm ci (first boot can take a few minutes)…"
npm ci

echo "[entrypoint] ready — running an immediate tick, then hourly on the top of each hour."
npx tsx scripts/run-tick.ts auto || true

while true; do
  now=$(date +%s)
  next=$(( (now / 3600 + 1) * 3600 )) # top of the next hour
  sleep=$(( next - now + 3 ))
  echo "[entrypoint] sleeping ${sleep}s until $(date -u -d "@${next}" +%FT%TZ 2>/dev/null || echo 'next hour')"
  sleep "$sleep"
  cd "$APP"
  # Pull PER TICK, not per boot — the header always claimed this, but the pull sat above the loop
  # and the runner silently ran a 3-week-stale checkout (found 2026-08-09: the nightly was missing
  # every fix of that window). Failure-tolerant like boot; the sha log line makes drift visible.
  git pull --ff-only origin main >/dev/null 2>&1 || echo "[entrypoint] git pull failed — ticking on the current checkout"
  echo "[entrypoint] checkout @ $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  # Re-source PER TICK, not just at boot — run-tick's first step (sync-runner-env) writes new/rotated
  # R2 secrets into .alert-env, and sourcing here means the value it wrote LAST tick is in this tick's
  # env. Sourcing only above the loop (as it did before) silently required a container restart for any
  # rotation to take effect — the exact "takes effect next tick" contract run-tick documents was a lie.
  [ -f "$APP/.alert-env" ] && . "$APP/.alert-env"
  npx tsx scripts/run-tick.ts auto || echo "[entrypoint] tick exited non-zero (continue-on-error; check tick.log)"
done
