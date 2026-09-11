# Conference link → audio → transcript → AI notes

Run from the Tape checkout:

```sh
npm run conference
```

Paste the conference agenda link at the prompt. Or supply it directly:

```sh
npm run conference -- "https://event.webcasts.com/viewer/agenda.jsp?ei=1769358&tp_key=de2124f0c3"
```

The runner opens a dedicated Edge profile on Windows (Chrome by default elsewhere). Complete registration in that window when requested. That profile retains the authorized session. It is separate from Codex's in-app browser and your ordinary browser profile, so a registration completed there does not automatically carry over. It does not fill identities, accept agreements, or bypass access controls.

After the agenda appears, the runner reads its dated tabs, opens each talk, observes the actual successful `.m3u8` response belonging to that webcast ID, and immediately downloads using the observed Referer/user agent and relevant session cookies. A failed capture reopens the player once to mint a fresh token. You do not need DevTools or copied playlist URLs.

## One-time setup

1. Install Node dependencies with `npm ci`.
2. Install `yt-dlp` and `ffmpeg` from their official distributions/package managers. Put both on PATH, or set their absolute executable paths in the config. FFmpeg distributions normally include ffprobe beside ffmpeg; keep them together.
3. Copy `docs/conference-runner.config.example.json` to `.conference-runner/config.json` (create the directory first). Confirm the actual ASR and LLM endpoints; the example reflects the repository's documented topology, not a verified running service.
4. Run one talk first:

```sh
npm run conference -- "https://event.webcasts.com/viewer/agenda.jsp?ei=1769358&tp_key=de2124f0c3" --only Freshpet
```

For whisper.cpp on the same machine, replace the `asr` block with:

```json
{
  "mode": "whispercpp",
  "cli": "whisper-cli",
  "modelPath": "/absolute/path/to/ggml-large-v3-turbo.bin",
  "language": "en"
}
```

For an OpenAI-compatible HTTP ASR service, use `mode: "http"`, its `/v1` base URL and model. If it needs a bearer token, set `asr.keyEnv` to the name of an environment variable containing that token. `.env.local` is loaded. Audio is split into ten-minute 16 kHz mono WAV uploads, about 19 MB each. All chunks must succeed before the final transcript is committed. ASR does not currently produce speaker diarization or timestamp alignment.

For whisper.cpp installed on a Mac mini reachable through Tailscale, use SSH mode. This does not require exposing a Whisper HTTP server. Set the actual SSH username, host, binary and model paths after checking the Mac's installation:

```json
{
  "mode": "ssh",
  "ssh": {
    "target": "YOUR_MAC_USER@YOUR_MAC_TAILSCALE_HOST",
    "identityFile": "C:/Users/YOUR_WINDOWS_USER/.ssh/YOUR_EXISTING_KEY"
  },
  "cli": "/opt/homebrew/bin/whisper-cli",
  "modelPath": "/Users/YOUR_MAC_USER/whisper-models/ggml-large-v3-turbo.bin",
  "language": "en"
}
```

The SSH target may also be an existing alias in your SSH config; omit `identityFile` to use the configured identity or agent. SSH host verification remains enabled and authentication is noninteractive. Establish working SSH access and verify the host key before starting the runner. `ssh.binary` and `ssh.copyBinary` optionally specify executable paths for SSH/SCP. Each chunk is copied into a unique private `/tmp/tape-asr-*` directory, transcribed by the Mac's CLI, and copied back. Temporary remote files are removed after success or failure; a cleanup failure is reported. Browser cookies and conference login state remain on the capture PC.

For the existing local LLM rig, use `llm.mode: "local"` and its URL/model, or existing `CALL_DIGEST_LOCAL_URL` and `CALL_DIGEST_LOCAL_MODEL` environment values. Local mode makes one attempt per model call and does not fall through to a paid provider. To deliberately use OpenRouter, set `llm.mode: "cloud"`, optionally set `llm.model`, and provide `OPENROUTER_API_KEY` in `.env.local`. Sending audio to a remote ASR service and transcripts to a cloud LLM should match your intended processing location.

## Files and retries

Every webcast has a stable directory under `.conference-runner/runs/<conference-id>/<webcast-id>/`:

- `audio.mp3`: decoded/validated download.
- `transcript.txt`: the complete ASR text.
- `digest.json`: validated AI notes: summary, tone, guidance, KPIs, business drivers, Q&A, read-throughs, watch items, and grounded quotes.

The conference's `manifest.json` records talk name/date/source, completed stage, archive status and any error. Repeating the command skips committed artifacts and retries incomplete stages. Failures do not count as completion; the process exits nonzero when a selected talk fails. The runner proceeds to other talks after recording a failure. An unavailable/future replay can be retried with the same command later.

Recordings, transcripts, temporary cookies, configuration, and browser sessions are gitignored under `.conference-runner/`, outside Tape's normal `data/` upload tree. Temporary cookies are deleted after each download. The profile remains for future runs. A single-run lock prevents two writers using the same profile. After a hard crash, verify no runner is active before removing `.conference-runner/run.lock`.

## Tape integration

The runner uses Tape's existing transcript digest engine, with conference context and verbatim quote/number validation. It processes every conference text chunk rather than truncating at the earnings engine's legacy chunk cap.

Tickers come from explicit `symbols` mappings or unambiguous exact company-name matches in locally hydrated universe snapshots. Unknown/private companies still receive transcript and digest files under their webcast IDs; no ticker is invented. Add a mapping and rerun to attach those notes to a stock.

Mapped talks are archived under `data/calls/<ticker>/conference-<conference-id>-<webcast-id>.json`, using the existing stock transcript reader. Raw transcripts are archived as soon as transcription completes, even if the LLM fails; summaries are attached when they succeed. They carry `eventType: "conference"`; the quarterly print predictor excludes these records from its earnings-event sequence. This avoids treating a conference talk as a quarterly result. A separate conference-feature model is not implemented here.

No R2 publication is automatic. Use the existing `sync-calls-archive` workflow from the properly hydrated runner/NAS when you intend to publish the archive to Tape. Do not upload a partial archive from a fresh checkout over the production archive.

## Useful modes

For a persistent Mac-owned queue that does not depend on Windows or an SSH session, see [Mac worker setup](conference-worker-macos.md).

```sh
npm run conference -- "CONFERENCE_URL" --discover
npm run conference -- "CONFERENCE_URL" --capture-only
npm run conference -- "CONFERENCE_URL" --transcribe-only
npm run conference -- "CONFERENCE_URL" --process-only
npm run conference -- "CONFERENCE_URL" --only Freshpet --limit 1
```

`--process-only` uses the saved manifest and audio without opening a browser. It is useful when capture and inference run on separate machines: copy the run directory (not the browser profile/cookies) to the processing machine. `--config path` selects an alternative configuration file. `--only` matches a company-name substring or an exact webcast ID.

This adapter targets the dated-tab GlobalMeet/webcasts.com agenda observed at Barclays. Other conference platforms/layouts require an adapter. Registration and expiring sessions still need human attention when requested by the provider. Live conference playback is not a guarantee that an on-demand replay is ready for complete download.

## Development verification

`npm test` covers parsing, stage failures/resumption, multipart ASR requests against a local fixture server, digest validation, and predictor isolation. `npm run test:conference-browser` launches headless Edge/Chrome against intercepted fixture pages to exercise dated tabs, nested players, talk matching and fresh-token acquisition without accessing a real conference. With the binary paths configured in `.conference-runner/config.json`, `npm run test:conference-download` generates a short HLS recording and downloads/validates it with the real yt-dlp and FFmpeg binaries. These tests do not establish live provider access or ASR/model availability; use a one-talk live run to verify your deployment.

### Upgrading older conference records

The processing runner now defaults `contextSpeakers` to true when acoustic diarization is not configured. It asks the summary model for moderator/management role boundaries, reconstructs the text from the original lines, and labels these roles as inferred from the transcript. This is contextual inference, not acoustic speaker identification; names are deliberately not guessed. Original `transcript.txt` files and existing reviewed/acoustic speaker files are preserved. `context-speakers.json` records the method, source hash, model and boundaries.

On a processing pass, statistic-only legacy digests are regenerated as four or five structured shareholder takeaways. A changed speaker transcript also triggers regeneration, including after an interrupted run. The old digest remains on disk until a replacement succeeds. Long manually reviewed legacy narratives are retained. `priorityTalks` can list webcast IDs to upgrade first. Existing completed jobs still need to be explicitly resumed to run this upgrade; a new deployment alone does not rewrite their saved results.
