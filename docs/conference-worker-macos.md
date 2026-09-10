# Mac-owned conference queue

The Mac owns browser capture, recordings, local whisper.cpp transcription and requests to the configured LLM server. Windows and Codex are not runtime dependencies. The worker writes mapped records into its own Tape `data/calls` archive; production publication is a separate step.

## Install

Use Node 22+, the repo's `npm ci` dependencies, Chrome, FFmpeg, yt-dlp and whisper.cpp on the Mac. Create `.conference-runner/config.json` with absolute tool paths:

```json
{
  "channel": "chrome",
  "ytdlp": "/opt/homebrew/bin/yt-dlp",
  "ffmpeg": "/opt/homebrew/bin/ffmpeg",
  "loginTimeoutMs": 3600000,
  "asr": {
    "mode": "whispercpp",
    "cli": "/opt/homebrew/bin/whisper-cli",
    "modelPath": "/Users/YOUR_USER/whisper-models/ggml-large-v3-turbo.bin",
    "language": "en"
  },
  "llm": { "mode": "local", "url": "http://YOUR_LLM_HOST:8000/v1", "model": "YOUR_MODEL" },
  "symbols": { "Freshpet": "FRPT" }
}
```

From the repo directory in a logged-in Mac account:

```sh
npm run conference:install-mac
npm run conference:queue -- "CONFERENCE_URL"
npm run conference:status
```

The LaunchAgent starts at login and restarts the worker after a crash. `caffeinate -i` prevents idle system sleep while the service runs; logout, explicit sleep, shutdown and power loss still interrupt it. For gated conferences, complete registration in the dedicated Chrome window on the Mac (locally or via Screen Sharing). Its persistent profile belongs to the Mac; Windows browser sessions are not copied.

On recent macOS versions, grant the worker Local Network access in System Settings → Privacy & Security → Local Network to reach a LAN LLM server. A successful test over SSH does not establish permission for a LaunchAgent: Apple exempts SSH-launched command-line tools, but not agents. If the service gets `EHOSTUNREACH` while the same URL succeeds over SSH, inspect that permission before changing addresses or routing. See [Apple's local network privacy guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). Without permission, local Whisper transcription can continue, but summaries will fail and remain pending retry.

Capture finishes before inference begins. State and append-only logs live in `.conference-runner/queue/<conference-id>.json` and `.log`. Errors trigger at most three attempts per phase with increasing delays; exhausted jobs remain visibly failed. Completed artifacts are retained. Duplicate submissions are rejected rather than overwriting work. Future jobs are picked up every five seconds. A browser registration timeout currently counts as a failed capture attempt; the log identifies it.

## Resume recordings from another machine

Copy only `.conference-runner/runs/<conference-id>/` into the same relative path on the Mac. Preserve `manifest.json`, `audio.mp3`, `transcript.txt` and `digest.json`; do not copy browser profiles, cookies, private SSH keys or `run.lock`. Then:

```sh
npm run conference:queue -- "CONFERENCE_URL" --process-only
```

This uses local Whisper and reuses existing transcripts/summaries. No browser is opened. Do not run the old coordinator against these files at the same time. The worker can reclaim a runner lock only when it matches the worker's recorded child PID on this host and that child is no longer alive; unrelated locks remain errors.

## Operate and publish

`npm run conference:status` counts actual committed files and reports child liveness, not just a stale status label. The job manifest records company errors. Inspect `.conference-runner/worker-errors.log` for worker/service failures. A failed job requires operator review before resetting its state/attempts; there is no endless retry loop.

To stop the service from the Mac account:

```sh
launchctl bootout gui/$(id -u)/com.bondstreetcp.tape-conferences
```

The source queue interface is a CLI, not yet a submission form on live Tape. Stock attachment still requires verified company/ticker mappings. Production publication must merge records into the authoritative archive before its existing sync; never replace the full production archive with this worker's partial archive.

### Publish completed summaries

Conference summaries now use four or five connected shareholder takeaways: each explains the claim, supporting evidence and business implication, with relevant uncertainty. For compatibility with the existing live summary card, these are stored in `digest.kpis`; conference bullets allow up to 650 characters, while earnings KPI limits stay unchanged. The prompt distinguishes targets from results, potential initiatives from announced plans, and one-time cash proceeds from recurring cash generation. Existing completed summaries are reused, so prompt changes affect newly generated digests; older digests require an explicit editorial update or regeneration. Freshpet's September 2026 conference summary was editorially reviewed against the transcript.

Transfer the run's `manifest.json` plus completed `transcript.txt` and `digest.json` files to a staging directory on the authoritative NAS. Audio, browser profiles and credentials are not needed. From the NAS Tape checkout:

```sh
node --import tsx scripts/import-conference-run.ts /path/to/staged-run
node --import tsx scripts/import-conference-run.ts /path/to/staged-run --apply
npm run sync-calls-archive
```

The first command previews ticker matches and unmapped companies; the second merges completed records under separate `conference-...` keys and preserves newer summaries. Conflicting transcripts stop the import. Unmapped companies remain in staging rather than appearing on the wrong stock. The existing archive's R2 credentials must already be loaded for the last command. The web container normally hydrates the archive on its hourly data refresh; verify the selected conference record through `/api/calls/<symbol>?q=conference-<conference-id>-<webcast-id>` before claiming it is live. This publication step is currently operator-run, not an automatic Mac queue hook.
