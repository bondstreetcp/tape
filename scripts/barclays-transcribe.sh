#!/bin/sh
# ============================================================================
#  Tape — BARCLAYS conference helper. Prefills the source label and hands off to
#  scripts/fetch-transcribe.sh (fetch audio -> Whisper -> archive + digest), so per
#  presentation you only supply the media URL + ticker.
#
#  Single:  sh scripts/barclays-transcribe.sh <MEDIA-URL> <SYMBOL> [YYYY-MM-DD]
#    e.g.   sh scripts/barclays-transcribe.sh 'https://.../STZ-replay.mp3' STZ
#
#  Batch:   sh scripts/barclays-transcribe.sh --batch <FILE>
#    FILE has one presentation per line:   SYMBOL   <MEDIA-URL>   [YYYY-MM-DD]
#    (whitespace-separated; blank lines and #comments are skipped). One conference =
#    one file of ~150 lines -> one run. Failures are logged and skipped, not fatal.
#
#  Prefilled defaults (override via env):
#    CONF       source label   (default "Barclays Consumer 2026"); e.g. CONF='Barclays Financials 2026'
#    CONF_DATE  fallback date  (default today) when a line/arg omits one
#
#  IMPORTANT: <MEDIA-URL> must be a REAL fetchable replay/stream URL — the .mp3/.m3u8
#  the authenticated player actually loads (grab it from the browser Network tab), NOT
#  the gated agenda page (.../agenda.jsp?...). This wrapper never passes an auth wall;
#  the capture is yours to make. Internal-research use.
#
#  Runs the SAME environment as fetch-transcribe.sh: needs yt-dlp + ffmpeg + jq + curl,
#  and must reach your Whisper (ASR_URL, default http://127.0.0.1:8000/v1) and the rig.
# ============================================================================
set -eu

# Resolve the repo root from THIS script's location, so it works from any cwd once
# invoked by path (e.g. `sh ~/tape-ops/repo/scripts/barclays-transcribe.sh ...`).
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
FETCH="$REPO/scripts/fetch-transcribe.sh"
[ -f "$FETCH" ] || { echo "can't find $FETCH — run this from inside the tape checkout"; exit 1; }

CONF="${CONF:-Barclays Consumer 2026}"
DEFDATE="${CONF_DATE:-$(date +%Y-%m-%d)}"

usage() {
  sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
}

one() { # <url> <symbol> [date]
  sh "$FETCH" "$1" "$2" "${3:-$DEFDATE}" "$CONF"
}

case "${1:-}" in
  "" | -h | --help)
    usage
    exit 0
    ;;
  --batch)
    FILE="${2:?--batch needs a file: sh scripts/barclays-transcribe.sh --batch presentations.txt}"
    [ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
    ok=0; fail=0
    while read -r sym url date _rest; do
      case "$sym" in "" | \#*) continue ;; esac
      [ -n "${url:-}" ] || { echo "skip (no url): $sym"; continue; }
      echo "=== $sym  ($CONF) ==="
      if one "$url" "$sym" "${date:-}"; then ok=$((ok + 1)); else fail=$((fail + 1)); echo "  (failed: $sym — continuing)"; fi
    done < "$FILE"
    echo "batch done: $ok ok, $fail failed  ->  run sync-calls-archive to publish"
    ;;
  *)
    URL="$1"
    SYM="${2:?usage: sh scripts/barclays-transcribe.sh <MEDIA-URL> <SYMBOL> [YYYY-MM-DD]}"
    one "$URL" "$SYM" "${3:-$DEFDATE}"
    ;;
esac
