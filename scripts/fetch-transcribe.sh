#!/bin/sh
# ============================================================================
#  Tape — FETCH → TRANSCRIBE → ARCHIVE + SUMMARIZE a talk from a MEDIA URL.
#  The link-driven front of the audio pipeline. Run it in the tape repo on a box that has yt-dlp + ffmpeg + curl +
#  jq, can reach your Whisper (ASR_URL) and the digest rig (CALL_DIGEST_LOCAL_URL).
#
#  Usage:  sh scripts/fetch-transcribe.sh <MEDIA-URL> <SYMBOL> [YYYY-MM-DD] [source label]
#    e.g.  sh scripts/fetch-transcribe.sh 'https://…/replay.mp3' STZ 2026-09-08 'Barclays Consumer 2026'
#
#  IMPORTANT: <MEDIA-URL> must be a fetchable audio/video/stream URL (a public replay MP3, a YouTube talk, or a
#  stream URL you legitimately obtained from a player you're authenticated to). This script NEVER passes an auth
#  wall — hand it a gated portal page (e.g. .../agenda.jsp?...) and yt-dlp simply gets no media. Internal-research
#  use; the capture is yours to make.
#
#  Config (env, with defaults):
#    ASR_URL   Whisper endpoint, OpenAI /audio/transcriptions shape   (default http://127.0.0.1:8000/v1)
#    ASR_MODEL transcription model                                    (default whisper-1)
#    ASR_KEY   bearer token, only if your Whisper server needs one    (default: none)
#    CALL_DIGEST_LOCAL_URL / _MODEL   the rig digest model            (default http://192.168.1.76:8000/v1 / argus-vlm)
#    DROP_DIR  where the transcript drop is written                   (default <repo>/data/incoming-transcripts)
# ============================================================================
set -eu
URL="${1:?usage: fetch-transcribe <MEDIA-URL> <SYMBOL> [YYYY-MM-DD] [source]}"
SYM="$(printf %s "${2:?symbol required}" | tr 'a-z' 'A-Z')"
DATE="${3:-$(date +%Y-%m-%d)}"
SOURCE="${4:-conference}"
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ASR_URL="${ASR_URL:-http://127.0.0.1:8000/v1}"
ASR_MODEL="${ASR_MODEL:-whisper-1}"
DROP_DIR="${DROP_DIR:-$REPO/data/incoming-transcripts}"
export CALL_DIGEST_LOCAL_URL="${CALL_DIGEST_LOCAL_URL:-http://192.168.1.76:8000/v1}"
export CALL_DIGEST_LOCAL_MODEL="${CALL_DIGEST_LOCAL_MODEL:-argus-vlm}"

for dep in yt-dlp jq curl; do
  command -v "$dep" >/dev/null 2>&1 || { echo "missing dependency: $dep (install it, e.g. brew install $dep)"; exit 1; }
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "-> fetching audio: $URL"
yt-dlp -q -x --audio-format mp3 -o "$TMP/audio.%(ext)s" "$URL"
AUDIO="$(ls "$TMP"/audio.* 2>/dev/null | head -1 || true)"
[ -n "${AUDIO:-}" ] || { echo "no audio produced from that URL (a gated portal page has no media — pass a real stream/replay URL)"; exit 1; }

echo "-> transcribing on Whisper: $ASR_URL ($ASR_MODEL)"
if [ -n "${ASR_KEY:-}" ]; then
  TEXT="$(curl -sf -H "Authorization: Bearer $ASR_KEY" -F "file=@$AUDIO" -F "model=$ASR_MODEL" -F "response_format=text" "$ASR_URL/audio/transcriptions")"
else
  TEXT="$(curl -sf -F "file=@$AUDIO" -F "model=$ASR_MODEL" -F "response_format=text" "$ASR_URL/audio/transcriptions")"
fi
[ "$(printf %s "$TEXT" | wc -c)" -ge 100 ] || { echo "transcript too short — check the Whisper endpoint / response_format"; exit 1; }

mkdir -p "$DROP_DIR"
OUT="$DROP_DIR/${SYM}_${DATE}.json"
jq -n --arg s "$SYM" --arg t "$SYM - $SOURCE ($DATE)" --arg d "$DATE" --arg src "$SOURCE" --arg txt "$TEXT" \
  '{symbol:$s, title:$t, date:$d, source:$src, text:$txt}' > "$OUT"
echo "-> wrote drop: $OUT"

# Archive + summarize via the existing pipeline. If the rig is unreachable the drop is still archived and the NAS
# nightly ingest will digest it later, so the digest step is best-effort.
cd "$REPO"
npm run -s ingest-transcript-text
if INGEST_ONLY="$SYM" INGEST_LIMIT=1 npm run -s ingest-transcripts; then
  echo "OK: $SYM $DATE — fetched, transcribed, archived, summarized. Run sync-calls-archive to publish."
else
  echo "NOTE: transcript archived; digest deferred (rig unreachable?) — the nightly ingest will summarize it."
fi
