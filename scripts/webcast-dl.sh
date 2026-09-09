#!/bin/sh
# ============================================================================
#  Tape — download ONE webcast talk's audio (webcasts.com securehds HLS) into the
#  audio folder, named TICKER_DATE.mp3 and ready for `barclays-transcribe.sh --audio-dir`.
#
#  Usage:
#    sh scripts/webcast-dl.sh <TICKER> <YYYY-MM-DD> '<playlist.m3u8 URL>'
#    sh scripts/webcast-dl.sh <TICKER> '<playlist.m3u8 URL>'        # date defaults to today
#
#  Grab the playlist.m3u8?t=… URL FRESH from each talk's viewer (DevTools → Network → the
#  playlist.m3u8 row → Copy URL). The signed token is short-lived, so download right after copying.
#
#  Config (env):
#    AUDIO_DIR     where files land         (default ~/communicopia-audio)
#    REFERER       sent to the CDN          (default https://event.webcasts.com/  — securehds checks it)
#    UA            user-agent              (default Mozilla/5.0)
#    COOKIES_FROM  browser to pull cookies from (e.g. chrome) IF a stream is session-bound
# ============================================================================
set -eu
SYM="$(printf %s "${1:?usage: webcast-dl <TICKER> [YYYY-MM-DD] '<m3u8-url>'}" | tr 'a-z' 'A-Z')"
case "${2:-}" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) DATE="$2"; URL="${3:?m3u8 URL required}" ;;
  *)                                          DATE="$(date +%Y-%m-%d)"; URL="${2:?m3u8 URL required}" ;;
esac

AUDIO_DIR="${AUDIO_DIR:-$HOME/communicopia-audio}"
REFERER="${REFERER:-https://event.webcasts.com/}"
UA="${UA:-Mozilla/5.0}"
command -v yt-dlp >/dev/null 2>&1 || { echo "yt-dlp not found (brew install yt-dlp)"; exit 1; }

mkdir -p "$AUDIO_DIR"
OUT="$AUDIO_DIR/${SYM}_${DATE}.mp3"
set -- --referer "$REFERER" --user-agent "$UA" -x --audio-format mp3 -o "$OUT" "$URL"
[ -n "${COOKIES_FROM:-}" ] && set -- --cookies-from-browser "$COOKIES_FROM" "$@"

echo "-> $SYM $DATE  ->  $OUT"
if yt-dlp "$@"; then
  echo "OK: $OUT"
else
  echo "FAILED: $SYM — the signed token likely expired (re-grab the playlist.m3u8 URL), or the stream is"
  echo "  session-bound: re-run with COOKIES_FROM=chrome (on the machine you're logged in on)."
  exit 1
fi
