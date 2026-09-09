#!/bin/sh
# ============================================================================
#  Tape — FETCH → TRANSCRIBE → ARCHIVE + SUMMARIZE a talk from a MEDIA URL.
#  The link-driven front of the audio pipeline. Run it in the tape repo on a box that has yt-dlp + ffmpeg + curl +
#  jq, can reach your Whisper (ASR_URL) and the digest rig (CALL_DIGEST_LOCAL_URL).
#
#  Usage:  sh scripts/fetch-transcribe.sh <MEDIA-URL | LOCAL-AUDIO-FILE> <SYMBOL> [YYYY-MM-DD] [source label]
#    e.g.  sh scripts/fetch-transcribe.sh 'https://…/replay.mp3' STZ 2026-09-08 'Barclays Consumer 2026'
#    e.g.  sh scripts/fetch-transcribe.sh ./downloads/MSFT_2026-09-09.mp3 MSFT 2026-09-09 'Goldman Communicopia 2026'
#
#  Two input kinds:
#    · A LOCAL audio file (already on disk) is transcribed directly — no yt-dlp/ffmpeg, no network fetch. This is
#      how the --audio-dir bulk path processes audio you captured yourself.
#    · A MEDIA-URL is fetched with yt-dlp — it must be a real audio/video/stream URL (a public replay MP3, a
#      YouTube talk, or a stream URL you legitimately obtained from a player you're authenticated to). This script
#      NEVER passes an auth wall — hand it a gated portal page (.../agenda.jsp?...) and yt-dlp gets no media. The
#      capture (getting the file/URL) is yours; internal-research use.
#
#  Transcriber — two modes:
#    · whisper.cpp CLI (no server): set WHISPER_MODEL=/path/to/ggml*.bin and it runs the local binary. Best on an
#      M4 (Metal). WHISPER_CLI (default whisper-cli), WHISPER_LANG (default en). Needs ffmpeg + jq.
#    · HTTP Whisper (OpenAI shape): the default when WHISPER_MODEL is unset — POSTs to ASR_URL. Needs curl + jq.
#
#  Config (env, with defaults):
#    WHISPER_MODEL   ggml*.bin path -> use whisper.cpp CLI (unset = use the HTTP endpoint below)
#    WHISPER_CLI     whisper.cpp binary (default whisper-cli)   WHISPER_LANG  language (default en)
#    ASR_URL   Whisper endpoint, OpenAI /audio/transcriptions shape   (default http://127.0.0.1:8000/v1)
#    ASR_MODEL transcription model                                    (default whisper-1)
#    ASR_KEY   bearer token, only if your Whisper server needs one    (default: none)
#    CALL_DIGEST_LOCAL_URL / _MODEL   the rig digest model            (default http://192.168.1.76:8000/v1 / argus-vlm)
#    DROP_DIR  where the transcript drop is written                   (default <repo>/data/incoming-transcripts)
#    CAPTURE_ONLY=1  write the drop then STOP — no Node/ingest; for a capture box (Mac mini) split from the NAS
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
WHISPER_MODEL="${WHISPER_MODEL:-}"; WHISPER_CLI="${WHISPER_CLI:-whisper-cli}"; WHISPER_LANG="${WHISPER_LANG:-en}"
CLI_ASR=""; [ -n "$WHISPER_MODEL" ] && CLI_ASR=1    # WHISPER_MODEL set -> whisper.cpp CLI; else HTTP endpoint

have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || { echo "missing dependency: $1 (install it, e.g. brew install $1)"; exit 1; }; }

# Transcriber deps.
need jq
if [ -n "$CLI_ASR" ]; then
  need ffmpeg
  have "$WHISPER_CLI" || { echo "whisper CLI '$WHISPER_CLI' not found (brew install whisper-cpp), or unset WHISPER_MODEL to use an HTTP Whisper."; exit 1; }
  [ -f "$WHISPER_MODEL" ] || { echo "WHISPER_MODEL not found: $WHISPER_MODEL (download a ggml model, e.g. ggml-large-v3-turbo.bin)"; exit 1; }
else
  need curl
fi

# Get the audio: a LOCAL file is used directly; a URL is fetched with yt-dlp (needs ffmpeg too).
if [ -f "$URL" ]; then
  AUDIO="$URL"; TMP=""
  echo "-> using local audio file: $AUDIO"
else
  need yt-dlp; need ffmpeg
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  echo "-> fetching audio: $URL"
  yt-dlp -q -x --audio-format mp3 -o "$TMP/audio.%(ext)s" "$URL"
  AUDIO="$(ls "$TMP"/audio.* 2>/dev/null | head -1 || true)"
  [ -n "${AUDIO:-}" ] || { echo "no audio produced from that URL (a gated portal page has no media — pass a real stream/replay URL, or a local audio file)"; exit 1; }
fi

# Transcribe -> TEXT.
if [ -n "$CLI_ASR" ]; then
  echo "-> transcribing with whisper.cpp ($WHISPER_CLI · $(basename "$WHISPER_MODEL"))"
  WTMP="$(mktemp -d)"
  # whisper.cpp wants 16kHz mono PCM WAV — convert first so any input format (mp3/m4a/mp4/…) works.
  ffmpeg -nostdin -loglevel error -y -i "$AUDIO" -ar 16000 -ac 1 -c:a pcm_s16le "$WTMP/a.wav" </dev/null \
    || { echo "ffmpeg conversion failed for $AUDIO"; rm -rf "$WTMP"; exit 1; }
  "$WHISPER_CLI" -m "$WHISPER_MODEL" -f "$WTMP/a.wav" -l "$WHISPER_LANG" -otxt -of "$WTMP/out" >/dev/null 2>&1 \
    || { echo "whisper.cpp failed on $AUDIO"; rm -rf "$WTMP"; exit 1; }
  TEXT="$(cat "$WTMP/out.txt" 2>/dev/null || true)"
  rm -rf "$WTMP"
else
  echo "-> transcribing on Whisper HTTP: $ASR_URL ($ASR_MODEL)"
  if [ -n "${ASR_KEY:-}" ]; then
    TEXT="$(curl -sf -H "Authorization: Bearer $ASR_KEY" -F "file=@$AUDIO" -F "model=$ASR_MODEL" -F "response_format=text" "$ASR_URL/audio/transcriptions")"
  else
    TEXT="$(curl -sf -F "file=@$AUDIO" -F "model=$ASR_MODEL" -F "response_format=text" "$ASR_URL/audio/transcriptions")"
  fi
fi
[ "$(printf %s "$TEXT" | wc -c)" -ge 100 ] || { echo "transcript too short — check Whisper (model / endpoint)"; exit 1; }

mkdir -p "$DROP_DIR"
OUT="$DROP_DIR/${SYM}_${DATE}.json"
jq -n --arg s "$SYM" --arg t "$SYM - $SOURCE ($DATE)" --arg d "$DATE" --arg src "$SOURCE" --arg txt "$TEXT" \
  '{symbol:$s, title:$t, date:$d, source:$src, text:$txt}' > "$OUT"
echo "-> wrote drop: $OUT"

# CAPTURE_ONLY=1 stops here — for running the audio→text half on a box that has yt-dlp+ffmpeg+Whisper (a Mac mini)
# but NOT the ingest half (Node, the repo deps, R2 creds, rig access — those live on the NAS). Move the drop(s) to
# the NAS's data/incoming-transcripts/ and run `npm run ingest-transcript-text` (then ingest-transcripts) there.
if [ "${CAPTURE_ONLY:-}" = "1" ]; then
  echo "OK (capture-only): $OUT — copy it to the NAS data/incoming-transcripts/ then run 'npm run ingest-transcript-text' there."
  exit 0
fi

# Archive + summarize via the existing pipeline. If the rig is unreachable the drop is still archived and the NAS
# nightly ingest will digest it later, so the digest step is best-effort.
cd "$REPO"
npm run -s ingest-transcript-text
if INGEST_ONLY="$SYM" INGEST_LIMIT=1 npm run -s ingest-transcripts; then
  echo "OK: $SYM $DATE — fetched, transcribed, archived, summarized. Run sync-calls-archive to publish."
else
  echo "NOTE: transcript archived; digest deferred (rig unreachable?) — the nightly ingest will summarize it."
fi
