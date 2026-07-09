#!/bin/sh
# tape-dispatch.sh — the Synology DS1621+ is the CLOCK, GitHub Actions stays the COMPUTE.
#
# GitHub's shared cron scheduler routinely delays scheduled runs 1-2h or silently drops them
# (the 2026-07-08 morning-brief incident), but API-dispatched runs start within seconds. This
# script runs HOURLY from DSM Task Scheduler, maps the current hour to a tick type (mirroring
# .github/workflows/refresh-data.yml's cron schedule), and fires a workflow_dispatch. On
# non-tick hours and weekends it exits silently.
#
# Setup: see docs/SETUP-NAS-CRON.md. Requires a fine-grained GitHub PAT (Actions: read+write on
# the ONE repo, nothing else) in /volume1/homes/<you>/.tape-pat (chmod 600).
#
# Schedule map (ET-based ticks fix the DST drift GitHub cron had):
#   UTC 02/04/06  quotes  (Asian session ticks — the workflow wall-clock-picks the universes)
#   UTC 08        quotes  (European session)
#   UTC 10        intl    (post-Asian-close international refresh)
#   ET  08        desk    (morning brief pre-open; the desk run includes a quote refresh)
#   ET  10/12/14/16 quotes (US session)
#   ET  17        desk    (evening brief post-close)
#   UTC 23        full    (nightly rebuild, after the US close year-round)

REPO="bondstreetcp/tape"
PAT_FILE="${TAPE_PAT_FILE:-$HOME/.tape-pat}"
LOG="${TAPE_LOG:-/var/log/tape-dispatch.log}"

utc_hour=$(date -u +%H | sed 's/^0//')
utc_day=$(date -u +%u)   # 1=Mon … 7=Sun
et_hour=$(TZ=America/New_York date +%H | sed 's/^0//')
et_day=$(TZ=America/New_York date +%u)

mode=""
# UTC-clock ticks (weekday by UTC, matching the old "* * 1-5" crons)
if [ "$utc_day" -le 5 ]; then
  case "$utc_hour" in
    2|4|6|8) mode="quotes" ;;
    10) mode="intl" ;;
    23) mode="full" ;;
  esac
fi
# ET-clock ticks (weekday by ET; desk wins the hour if both matched)
if [ "$et_day" -le 5 ]; then
  case "$et_hour" in
    8|17) mode="desk" ;;
    10|12|14|16) mode="quotes" ;;
  esac
fi

[ -z "$mode" ] && exit 0 # not a tick hour

if [ ! -r "$PAT_FILE" ]; then
  echo "$(date -u +%FT%TZ) ERROR: PAT file $PAT_FILE missing/unreadable" >> "$LOG"
  exit 1
fi
PAT=$(cat "$PAT_FILE" | tr -d '[:space:]')

http=$(curl -sS -o /tmp/tape-dispatch-resp.txt -w "%{http_code}" \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $PAT" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/actions/workflows/refresh-data.yml/dispatches" \
  -d "{\"ref\":\"main\",\"inputs\":{\"mode\":\"$mode\"}}")

if [ "$http" = "204" ]; then
  echo "$(date -u +%FT%TZ) dispatched mode=$mode" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) ERROR: dispatch mode=$mode -> HTTP $http: $(cat /tmp/tape-dispatch-resp.txt)" >> "$LOG"
  exit 1 # non-zero so DSM Task Scheduler can email on failure
fi
