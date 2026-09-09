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
#  Flags (before the URL / --batch):
#    --capture-only  audio→text only, write the drop, STOP (same as CAPTURE_ONLY=1) — for the Mac mini
#    --preflight     check deps + ping Whisper, print status, and exit (no capture)
#    --no-preflight  skip the auto deps+Whisper check that otherwise runs before any real run
#
#  Prefilled defaults (override via env):
#    CONF          source label (default "Barclays Consumer 2026"); e.g. CONF='Barclays Financials 2026'
#    CONF_DATE     fallback date (default today) when a line/arg omits one
#    CAPTURE_ONLY=1  run the audio→text half only (Mac mini: has Whisper + brew tooling), write the drop, and
#                    STOP — then copy the drop to the NAS's data/incoming-transcripts/ and ingest there. Passed
#                    straight through to fetch-transcribe. Whisper is localhost-bound on the mini, so run this
#                    ON the mini (default ASR_URL=127.0.0.1:8000 works); it is NOT reachable over Tailscale.
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
ASR_URL="${ASR_URL:-http://127.0.0.1:8000/v1}"   # pinged by preflight; fetch-transcribe reads the same var

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
}

# Fail in ~2s, not on file 1 of 150: confirm the capture tooling is here and Whisper actually answers.
preflight() {
  miss=""
  for dep in yt-dlp ffmpeg jq curl; do command -v "$dep" >/dev/null 2>&1 || miss="$miss $dep"; done
  if [ -n "$miss" ]; then echo "preflight FAIL — missing:$miss  (brew install$miss)"; return 1; fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$ASR_URL/models" 2>/dev/null || true)"
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    echo "preflight FAIL — Whisper not reachable at $ASR_URL. Run this ON the box where Whisper listens (it's localhost-bound on the mini), or set ASR_URL=..."
    return 1
  fi
  echo "preflight OK — deps present · Whisper reachable at $ASR_URL (HTTP $code)"
  return 0
}

one() { # <url> <symbol> [date]
  sh "$FETCH" "$1" "$2" "${3:-$DEFDATE}" "$CONF"
}

# ── leading flags (any order, before the URL / --batch) ──────────────────────
SKIP_PREFLIGHT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --capture-only) export CAPTURE_ONLY=1; shift ;;
    --no-preflight) SKIP_PREFLIGHT=1; shift ;;
    --preflight)    if preflight; then exit 0; else exit 1; fi ;;   # standalone check
    -h | --help)    usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "unknown option: $1"; usage; exit 2 ;;
    *) break ;;
  esac
done

# Auto-preflight before any real run (skippable) — catches missing deps / a down Whisper before work starts.
if [ -z "$SKIP_PREFLIGHT" ] && [ -n "${1:-}" ]; then
  if ! preflight; then echo "(bypass with --no-preflight)"; exit 1; fi
fi

case "${1:-}" in
  "")
    usage
    exit 0
    ;;
  --batch)
    FILE="${2:?--batch needs a file: sh scripts/barclays-transcribe.sh [--capture-only] --batch presentations.txt}"
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
    SYM="${2:?usage: sh scripts/barclays-transcribe.sh [--capture-only] <MEDIA-URL> <SYMBOL> [YYYY-MM-DD]}"
    one "$URL" "$SYM" "${3:-$DEFDATE}"
    ;;
esac
