# Linux conference worker

Run the existing conference queue and publishing bridge as a dedicated system user. The services survive SSH logout and start on container boot. They make outgoing requests only and do not expose a new listener.

The EPYC deployment uses Proxmox container 102 (`training-pipeline`), checkout `/opt/tape-conference/repo`, dedicated user `tape-worker`, and a private Node 22 runtime at `/opt/tape-conference/runtime/node_modules/node/bin/node`. The existing vLLM server is available at `http://127.0.0.1:8000/v1`. Do not replace its service, dependencies, or model.

Prepare the checkout and dependencies, `.conference-runner/config.json`, and the private `.conference-runner/portal.json` with the existing Tape worker credentials. Give the service user ownership of its checkout. Stop the former host's queue and bridge before activating this publisher. Copy saved conference artifacts, excluding browser credentials and process locks. Enqueue the imported event with `conference:queue -- URL --process-only`; never transfer another host's live queue PID/lock state.

Install using `bash scripts/install-conference-worker-linux.sh /opt/tape-conference/repo /opt/tape-conference/runtime/node_modules/node/bin/node`. Inspect with `systemctl status tape-conferences tape-conference-portal` and `journalctl -u tape-conferences -u tape-conference-portal`. Presentation logs remain in `.conference-runner/queue/`.

The migrated conference can finish from its saved audio/transcripts without Chrome or ASR. Processing a new conference additionally requires a configured browser and transcription backend on this host; gated registration needs an interactive browser session. Do not claim those prerequisites are satisfied merely because saved-transcript processing succeeds.
