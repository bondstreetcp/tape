# Local backup refresh (`refresh-local.bat`)

A laptop-side safety net for the data refresh. **The GitHub Actions cron
(`.github/workflows/refresh-data.yml`) is the primary** — this just supplements it
when the machine is on, in case GitHub's scheduler is slow or you want a manual pull.

What it does: runs `npm run refresh-quotes` (re-prices every `data/<universe>/snapshot.json`
from fresh Yahoo quotes — snapshots only, history series untouched), commits **only `data/`**,
and pushes to `main` → Vercel redeploys.

It's safe on a timer: it no-ops if the working tree has uncommitted changes (won't touch
your edits) or if no prices moved, and it's conflict-proof against the bot's pushes.

## Run it once (test)

Double-click `scripts\refresh-local.bat`, or from a terminal at the repo root:

```
scripts\refresh-local.bat
```

Check `scripts\refresh-local.log` for the outcome.

## Schedule it (Task Scheduler)

Run every 2 hours (from an **Administrator** terminal — replace `<REPO>` with the full path to
this checkout, e.g. `%USERPROFILE%\Documents\stock chart screener`):

```cmd
schtasks /create /tn "Tape backup refresh" ^
  /tr "\"<REPO>\scripts\refresh-local.bat\"" ^
  /sc hourly /mo 2 /st 00:30
```

Or via the GUI: Task Scheduler → Create Basic Task → trigger *Daily, repeat every 2 hours* →
action *Start a program* → browse to `refresh-local.bat`. Tick "Run whether user is logged on
or not" if you want it to run while locked.

Remove it later with: `schtasks /delete /tn "Tape backup refresh" /f`

## Caveats

- **Only runs when the laptop is on and awake** — it can't cover a power outage or a closed lid.
  For a backup that doesn't depend on this machine, point a free external cron (e.g. cron-job.org)
  at the GitHub API to `workflow_dispatch` the workflow on a schedule — `workflow_dispatch` runs
  fire immediately and aren't subject to the scheduler congestion that delays the built-in crons.
- Quotes only — the per-symbol **history series** still rebuild via the cloud's nightly full run
  (`refresh-data` / `refresh-intl`), not here.
