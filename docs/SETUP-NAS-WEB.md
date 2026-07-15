# Serve Tape from the DS1621+ (a second origin, via Cloudflare Tunnel)

A complete, independent copy of the site running on the NAS — and, while Vercel is capped, the only
one. Same drag-and-drop shape as the compute container ([SETUP-NAS-CRON.md](SETUP-NAS-CRON.md)): no
image to build, no SSH, no DSM task, **no ports opened on your router**.

```
GitHub (public repo, main)          Cloudflare R2 (data.tar.gz, written by the nightly tick)
        │ git pull (poll)                    │ npm run data-from-r2 (hydrate, 150 MB)
        ▼                                    ▼
┌──────────────────────── DS1621+ ───────────────────────┐
│  tape-web       A/B slots → npm ci → build → next start│
│  tape-tick      (the existing compute container)       │
│  cloudflared ───────── outbound only ──────────────────┼──▶ Cloudflare edge ──▶ tape.<your-domain>
└────────────────────────────────────────────────────────┘
```

---

## Read this first — what this is and isn't

**This is NOT Synology High Availability.** SHA is an active/passive cluster of **two identical NAS
units**; you have one DS1621+, so it isn't available at any price short of a second box. The NAS, its
PSU, and your home uplink stay single points of failure.

What you *do* get, which is the part that actually bites in practice:

| Failure | Covered? | How |
|---|---|---|
| A bad commit breaks the build | ✅ | The build runs in the **idle** slot. It fails → the live slot keeps serving, untouched. |
| A build succeeds but won't boot | ✅ | Health check on the new slot fails → **automatic rollback** to the previous slot. |
| Deploys causing downtime | ✅ | The minutes-long part (npm ci + hydrate + build) happens off to the side. Downtime = one process restart, ~3s. |
| The site process crashes / OOMs | ✅ | Docker health check + `restart: unless-stopped`. |
| A Cloudflare edge PoP goes down | ✅ | cloudflared holds 4 connections across ≥2 edge datacenters. |
| **The NAS dies / power cut / ISP down** | ❌ | Needs a second origin. See "Real HA" at the bottom. |

**Why not Coolify?** Coolify's proxy wants ports **80 and 443 — DSM already owns both** for its own
web UI. Coolify also expects a plain Linux host with systemd and full control of Docker; DSM's
Container Manager is a curated wrapper it fights with, and Coolify does not support DSM. The
supported route is Coolify inside a Synology **VM** (Virtual Machine Manager). For *one* app on a box
that already runs a proven self-updating container, that's a PaaS layer whose value (multi-app UI,
webhooks, env management) duplicates the ~60 lines of shell in `tape-web-entrypoint.sh`. If you want
the Coolify UI later, see "Adding Coolify" — nothing here is wasted.

---

## 1. Cloudflare: create the tunnel (5 min, your clicks)

1. Cloudflare dashboard → **Zero Trust** → **Networks → Tunnels** → **Create a tunnel**.
2. Connector: **Cloudflared**. Name it e.g. `tape-nas`. → **Save**.
3. The install command it shows contains `--token eyJhbGci...`. **Copy just that token string.**
   (It's a credential — anyone with it can publish through your tunnel. Treat it like a password.)
4. **Public Hostname** tab → **Add a public hostname**:
   - Subdomain `tape` · Domain `<your-domain>` (the DNS record is created for you)
   - Service: **HTTP** → `tape-web:3000`
     ← the container name; cloudflared reaches it over the compose network, not over your LAN.
5. Save. Leave the dashboard open — you'll confirm the connector goes green in step 4.

> **Want it private?** Zero Trust → Access → Applications → add `tape.<your-domain>` with a policy of
> *Emails = your address*. Cloudflare then demands a login before anyone reaches the NAS at all. The
> site currently ships no auth of its own, so this is the only thing standing between the URL and the
> public — decide deliberately.

## 2. NAS: drop in four files (5 min)

File Station → create `/docker/tape-web/` and put in:

| File | From |
|---|---|
| `docker-compose.yml` | `scripts/nas/docker-compose.web.yml` (**rename it** — Container Manager expects this name) |
| `tape-web-entrypoint.sh` | `scripts/nas/tape-web-entrypoint.sh` |
| `tape.env` | the **same file** the compute container uses (copy it from `/docker/tape/`) |
| `tunnel.env` | `scripts/nas/tunnel.env.example` → paste the token from step 1.3 |

Both `.env` files hold secrets: **chmod 600**, and they're gitignored — never commit them.

## 3. Container Manager: run it

**Project → Create** → name `tape-web` → path `/docker/tape-web` → it detects the compose → **Next →
Done** (it builds and runs).

## 4. Watch the first boot (~10–20 min)

Container Manager → Container → **tape-web** → **Log**. Expect, in order:

```
[tape-web] boot — slot a is the first build; expect ~10-20 min on this box before the site answers
[tape-web] slot a: first build — cloning https://github.com/bondstreetcp/tape.git
[tape-web] slot a: npm ci
[tape-web] slot a: hydrating data/ from R2
data-from-r2: hydrated data/ from R2 (36.8 MB)            ← the R2 tarball (~150 MB once extracted); creds are good
[tape-web] slot a: next build (this is the slow part — the live slot is still serving)
[tape-web] slot a: build OK @ 7793bd0
[tape-web] serving slot a (pid NN) on :3000
```

Then **tape-tunnel** → Log should show `Registered tunnel connection` ×4, and the Cloudflare dashboard
connector flips to **HEALTHY**. Visit `https://tape.<your-domain>` — the version badge in the header
should show the same short SHA the log printed.

**If the first boot fails**, the container exits and Docker restarts it — it will retry the clone from
scratch. The log line above the failure names the culprit (almost always `tape.env`: a bad
`LAKE_S3_ENDPOINT` shows as `data-from-r2: R2 download failed`; the endpoint is printed in the error
because it isn't a secret).

## 5. Steady state

Every 15 min the container checks for work and rebuilds when either is true:

- **`main` moved** → your push is live within ~15 min + build time. This is your deploy pipeline now.
- **an hour has passed** → rebuilds to bake the tick's fresh R2 data (the same cadence
  `VERCEL_DEPLOY_HOOK` fires at today).

Each rebuild goes into the **idle** slot; the live slot serves throughout; the switch is a ~3s
restart; a failed build or a slot that won't answer rolls back automatically. Tune with
`TAPE_WEB_CHECK_SECONDS` / `TAPE_WEB_REBUILD_SECONDS` in the compose.

**Disk:** ~5 GB (two slots × repo + node_modules + 150 MB data + `.next`). **CPU:** a build is a few
minutes of the box's 4c/8t, ~once an hour. It coexists with `tape-tick` fine on 64 GB.

### Once Vercel is back

`VERCEL_DEPLOY_HOOK` in `tape.env` is now redundant — blank it and the tick logs
`not set — skipping deploy trigger` and moves on. Keeping the NAS as the primary origin also makes
the Fluid-CPU cap that started this a non-issue permanently.

---

## Real HA (needs a second origin — optional)

Once Vercel resets you have two working origins. To fail between them automatically:

- **Cloudflare Load Balancer** (~$5/mo): two origin pools (NAS tunnel, Vercel) + a health monitor;
  Cloudflare drains to Vercel the moment the NAS stops answering. This is the only *automatic* option,
  and it's the honest answer to "HA" without buying a second NAS.
- **Free / manual**: keep the Vercel deployment warm and swap the DNS record when the NAS is down.
  Minutes of downtime, zero cost.
- **A second NAS** is what buys true Synology HA (storage-level failover). Overkill here — the NAS
  isn't the fragile part; your home uplink is.

## Adding Coolify later (if you want the UI)

Don't install it on DSM (ports 80/443 belong to DSM; it's unsupported and it fights Container
Manager). Instead: **Package Center → Virtual Machine Manager** → an Ubuntu 24.04 VM (4 vCPU / 8 GB
is comfortable, you have 64) → run Coolify's installer in the VM → point it at this repo. The
container recipe here maps over directly: same clone, same `npm ci → data-from-r2 → build → start`,
same `tape.env` as Coolify env vars. You'd trade ~60 lines of shell for a UI plus a VM to maintain.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Tunnel connector red, site 502 | Public Hostname service must be `http://tape-web:3000` (the container name), not `localhost` or the NAS IP. |
| `data-from-r2: R2 not configured` | `tape.env` didn't load — check it's in `/docker/tape-web/` and named exactly `tape.env`. |
| Log stops after `npm ci` | Out of RAM/disk. `df -h` on the volume; a `next build` wants ~4 GB. |
| Site is fine but stale | The rebuild bakes data hourly. Check the tick container actually uploaded (`data-to-r2` in its log). |
| Want a clean slate | Container Manager → Project → Stop, delete the **`tape-web-app` volume**, Run. It re-clones from scratch. |
| Need LAN access to test | Uncomment `ports: - "3000:3000"` in the compose → `http://<nas-ip>:3000`. |
