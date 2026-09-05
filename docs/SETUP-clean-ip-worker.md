# The clean-IP worker — the two feeds the NAS can't fetch itself

**Why this box exists.** The NAS's home IP is throttled by Yahoo (the per-stock company cache) and
refused outright by Investing.com (same-day earnings-call transcripts); GitHub's runners are refused
too. Both feeds were therefore hung on a Windows PC being awake — the company cache went 21 days stale
in August–September 2026 when it wasn't. A small always-on machine with a clean IP runs both jobs and
publishes to R2; the NAS and the site hydrate the results every tick. Nothing else changes.

Any Linux box with Node 20+, git, curl and a residential-reputation IP works: a $5 VPS whose provider's
ranges aren't on Cloudflare's block lists, a Mac mini at the office, a Pi. Test the IP first (step 2).

## 1. Install

```bash
git clone https://github.com/bondstreetcp/tape.git ~/tape && cd ~/tape
npm ci
cp scripts/worker/env.example .env.local     # then fill in the four LAKE_S3_* values + OPENROUTER_API_KEY
chmod 600 .env.local
```

## 2. Prove the IP is clean

```bash
npx tsx scripts/worker/probe.ts
```

It must print `investing.com: ok` and `yahoo: ok`. A `403`/`blocked` on Investing.com means this IP is on
the same list as the NAS — pick another box; the code cannot route around an IP block.

## 3. Run once by hand

```bash
bash scripts/worker/run.sh
```

The script hydrates `data/` from R2, bakes the company cache as writer `worker` and uploads it, then reads
every transcript from the last week and publishes `site-data/call-digests.json`. The NAS's next tick
merges both in. Watch for `upload-company-cache: … as writer "worker"` and `published N digests → R2`.

## 4. Schedule it

06:30 ET catches last night's after-close calls before the 08:00 desk tick; 18:30 ET catches the day's
morning calls for the evening brief. The company cache is cheap when nothing aged, so it rides along.

systemd (Linux):

```bash
sudo cp scripts/worker/tape-worker.service scripts/worker/tape-worker.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tape-worker.timer
systemctl list-timers tape-worker.timer
```

Windows Task Scheduler (the interim PC): two daily triggers running, from the repo folder,

```
cmd /c "bash scripts/worker/run.sh >> worker.log 2>&1"
```

## 5. What to watch

- Daily Desk → Earnings Calls: the footer says which source served the run; "Investing.com N" means the
  worker's rows arrived.
- `npm run check-freshness` on the NAS: "Per-stock cache" back inside its 30-hour floor.
- The worker's own log: a `[llm-usage]` line per run (a peak day is ~$0.40 on the flash tier).

## Secrets

`.env.local` holds R2 write credentials and the OpenRouter key. Keep it `chmod 600`, never copy it into
the repo, and rotate the two keys if the box is ever retired without wiping it.
