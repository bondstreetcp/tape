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
#  BULK from a folder (simplest for a whole conference — no URLs, no yt-dlp, no per-talk fiddling):
#    sh scripts/barclays-transcribe.sh --audio-dir <DIR>
#    DIR holds one audio file per talk, named TICKER.ext or TICKER_YYYY-MM-DD.ext
#    (mp3/m4a/wav/mp4/aac/flac/ogg). Transcribes + summarizes every file you've already downloaded.
#
#  Flags (before the URL / --batch / --audio-dir):
#    --audio-dir <D> bulk: transcribe + summarize every audio file in folder D (local files, no download)
#    --capture-only  audio→text only, write the drop, STOP (same as CAPTURE_ONLY=1) — for the Mac mini
#    --preflight     check deps + ping Whisper, print status, and exit (no capture)
#    --no-preflight  skip the auto deps+Whisper check that otherwise runs before any real run
#
#  Prefilled defaults (override via env):
#    CONF          source label (default "Barclays Consumer 2026"); e.g. CONF='Barclays Financials 2026'
#    CONF_DATE     fallback date (default today) when a line/arg omits one
#    WHISPER_MODEL ggml*.bin path -> transcribe with whisper.cpp locally (no server; best on an M4).
#                  Needs whisper-cpp + ffmpeg. Unset = use an HTTP Whisper at ASR_URL instead.
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
FETCH="${FETCH:-$REPO/scripts/fetch-transcribe.sh}"
[ -f "$FETCH" ] || { echo "can't find $FETCH — run this from inside the tape checkout"; exit 1; }

CONF="${CONF:-Barclays Consumer 2026}"
DEFDATE="${CONF_DATE:-$(date +%Y-%m-%d)}"
ASR_URL="${ASR_URL:-http://127.0.0.1:8000/v1}"   # pinged by preflight; fetch-transcribe reads the same var
LOCAL_AUDIO=""; AUDIO_DIR=""                      # set by --audio-dir (local files -> no yt-dlp/ffmpeg needed)

usage() {
  sed -n '2,43p' "$0" | sed 's/^# \{0,1\}//'
}

# Fail in ~2s, not on file 1 of 150: confirm the tooling is here and the transcriber is usable.
preflight() {
  miss=""
  if [ -n "${WHISPER_MODEL:-}" ]; then
    # whisper.cpp CLI mode: need jq + ffmpeg + the CLI binary + the model file (a URL run also needs yt-dlp).
    need="jq ffmpeg ${WHISPER_CLI:-whisper-cli}"; [ -n "$LOCAL_AUDIO" ] || need="$need yt-dlp"
    for dep in $need; do command -v "$dep" >/dev/null 2>&1 || miss="$miss $dep"; done
    if [ -n "$miss" ]; then echo "preflight FAIL — missing:$miss  (brew install whisper-cpp ffmpeg jq)"; return 1; fi
    [ -f "$WHISPER_MODEL" ] || { echo "preflight FAIL — WHISPER_MODEL not found: $WHISPER_MODEL"; return 1; }
    echo "preflight OK — whisper.cpp ($(basename "$WHISPER_MODEL")) + deps present"
    return 0
  fi
  # HTTP Whisper mode: local audio (--audio-dir) skips the download tooling; a URL/batch run needs yt-dlp+ffmpeg.
  need="jq curl"; [ -n "$LOCAL_AUDIO" ] || need="yt-dlp ffmpeg jq curl"
  for dep in $need; do command -v "$dep" >/dev/null 2>&1 || miss="$miss $dep"; done
  if [ -n "$miss" ]; then echo "preflight FAIL — missing:$miss  (brew install$miss)"; return 1; fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$ASR_URL/models" 2>/dev/null || true)"
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    echo "preflight FAIL — Whisper not reachable at $ASR_URL. Set WHISPER_MODEL to use whisper.cpp (no server), or point ASR_URL at a running Whisper."
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
    --audio-dir)    LOCAL_AUDIO=1; AUDIO_DIR="${2:?--audio-dir needs a folder of audio files}"; shift 2 ;;
    --preflight)    if preflight; then exit 0; else exit 1; fi ;;   # standalone check
    -h | --help)    usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "unknown option: $1"; usage; exit 2 ;;
    *) break ;;
  esac
done

# Auto-preflight before any real run (skippable) — catches missing deps / a down Whisper before work starts.
if [ -z "$SKIP_PREFLIGHT" ] && { [ -n "${1:-}" ] || [ -n "$AUDIO_DIR" ]; }; then
  if ! preflight; then echo "(bypass with --no-preflight)"; exit 1; fi
fi

# ── bulk mode: a FOLDER of already-downloaded audio files ────────────────────
# One file per presentation, named TICKER.ext or TICKER_YYYY-MM-DD.ext (mp3/m4a/wav/mp4/aac/flac/ogg).
# Transcribes + summarizes every one (add --capture-only to just transcribe now and ingest on the NAS later).
if [ -n "$AUDIO_DIR" ]; then
  [ -d "$AUDIO_DIR" ] || { echo "no such folder: $AUDIO_DIR"; exit 1; }
  DROP_DIR="${DROP_DIR:-$REPO/data/incoming-transcripts}"   # same default fetch-transcribe writes to
  ok=0; fail=0; skip=0; n=0
  for f in "$AUDIO_DIR"/*.mp3 "$AUDIO_DIR"/*.m4a "$AUDIO_DIR"/*.wav "$AUDIO_DIR"/*.mp4 "$AUDIO_DIR"/*.aac "$AUDIO_DIR"/*.flac "$AUDIO_DIR"/*.ogg; do
    [ -f "$f" ] || continue                      # unmatched glob -> literal pattern -> skip
    n=$((n + 1))
    base="$(basename "$f")"; stem="${base%.*}"
    sym="${stem%%_*}"                            # TICKER (everything before the first "_")
    rest="${stem#"$sym"}"; rest="${rest#_}"
    date=""; case "$rest" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*) date="${rest%%_*}" ;; esac
    # Idempotent: skip a talk whose transcript drop already exists (re-run after adding more files; FORCE=1 redoes).
    if [ -z "${FORCE:-}" ] && [ -f "$DROP_DIR/${sym}_${date:-$DEFDATE}.json" ]; then
      echo "=== $sym  (skip — already transcribed) ==="; skip=$((skip + 1)); continue
    fi
    echo "=== $sym  ($CONF)  <- $base ==="
    if one "$f" "$sym" "$date"; then ok=$((ok + 1)); else fail=$((fail + 1)); echo "  (failed: $sym — continuing)"; fi
  done
  [ "$n" -gt 0 ] || echo "no audio files in $AUDIO_DIR (looked for mp3/m4a/wav/mp4/aac/flac/ogg)"
  echo "audio-dir done: $ok ok, $skip skipped, $fail failed of $n files  ->  run sync-calls-archive to publish"
  exit 0
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
