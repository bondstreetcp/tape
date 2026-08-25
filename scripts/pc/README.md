# The company-cache "PC bake" box

`bake-company.cmd` runs nightly on a dedicated **good-IP Windows desktop** and is the **primary** source
for the per-stock company cache (`data/company/*` → `company.tar.gz` in R2, stamped as writer `"pc"`).

**Why a separate box:** Yahoo serves *degraded / null* `quoteSummary` payloads to the NAS's and GitHub
Actions' egress IPs (a 2026-08 incident baked `stats:null` for ~75% of the tree from the NAS). A normal
residential/office IP gets clean data. The NAS/CI still bake as a **fallback**, but they can't fetch
clean Yahoo data, so **if this box goes dark, the company cache silently drifts STALE and nothing can
cover it** (that's exactly what happened for ~10 days in 2026-08). AlphaVantage/SimFin can't replace
Yahoo here — they only carry P&L line items, not the analyst estimates / recommendations / ownership /
short-interest that the bundle needs. So this box (or a clean-IP proxy for the NAS) is load-bearing.

The pipeline: `refresh-company-cache.ts` (bake) → `upload-company-cache.ts` (tar + push to R2). The NAS
stands down to a fresh `"pc"` stamp (`lib/companyArchive.ts`, 24h window) and only fallback-bakes when
the stamp is stale. As of 2026-08, `refresh-company-cache` **pages `ALERT_WEBHOOK_URL` once/day when the
`"pc"` stamp is >26h old** — so a dark box is now caught within a day instead of going unnoticed.

---

## Keep it always-on (so 21:30 never gets skipped)

Run these **on the bake box**, elevated (PowerShell as Administrator):

```powershell
# 1) Never sleep / hibernate on AC power (a sleeping box misses the 21:30 bake)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15    # screen can still turn off; the machine stays awake
# If it's a laptop, also on battery — and set "do nothing" on lid close:
powercfg /change standby-timeout-dc 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /S SCHEME_CURRENT
```

```powershell
# 2) (Re)create the scheduled task with wake-to-run, catch-up-if-missed, and hourly retries
$repo    = 'C:\Users\TruPorch Homes\Documents\stock chart screener'
$action  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$repo\scripts\pc\bake-company.cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At 9:30PM
$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `                       # wake the machine from sleep to run (needs wake timers allowed)
  -StartWhenAvailable `              # if the box was OFF at 21:30, run as soon as it's back up
  -RestartCount 3 -RestartInterval (New-TimeSpan -Hours 1) `   # the "+3h retries" the .cmd assumes
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Tape company-cache bake' `
  -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
```

```powershell
# 3) Allow wake timers for the active power plan (WakeToRun is inert without this)
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /S SCHEME_CURRENT
```

**"Run whether the user is logged on or not":** the bake needs the user's environment (Node on PATH,
`.env.local` creds). Easiest reliable setup is to keep the box **logged in** and run in the user
context (the default above). If you want it to run while logged off, set that in the Task Scheduler GUI
(General → "Run whether user is logged on or not") — Windows will prompt for the account password;
don't script the password in. Modern-standby ("S0") laptops can still doze with the lid closed even
with wake timers — a desktop (or lid-open + the settings above) is the robust choice.

---

## Check health / recover

```powershell
# Did it run, and did it succeed? (rc=0 in the log = success)
Get-Content "C:\Users\TruPorch Homes\Documents\stock chart screener\lake\.tmp\pc-bake.log" -Tail 15
Get-ScheduledTaskInfo -TaskName 'Tape company-cache bake' | Format-List LastRunTime, LastTaskResult, NextRunTime
```

```powershell
# Force a bake+upload right now (recovers a stale feed immediately)
& "C:\Users\TruPorch Homes\Documents\stock chart screener\scripts\pc\bake-company.cmd"
```

A healthy tail ends with `done rc=0`. `bake FAILED rc=…` means `refresh-company-cache` errored (check
`.env.local` creds / Node / Yahoo); a nonzero rc on the `done` line means the R2 upload failed
(check `LAKE_S3_*` in `.env.local`). After a successful run, the served `/api/health/data` shows
`company-cache.json` fresh within a few hours (once the NAS re-hydrates from R2).
