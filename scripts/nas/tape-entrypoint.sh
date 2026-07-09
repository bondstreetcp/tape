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
  npx tsx scripts/run-tick.ts auto || echo "[entrypoint] tick exited non-zero (continue-on-error; check tick.log)"
done
