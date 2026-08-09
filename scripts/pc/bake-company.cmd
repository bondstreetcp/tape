@echo off
rem Nightly company-cache bake from the Windows desktop — the box Yahoo serves clean stats to
rem (the NAS/GH egress IPs get degraded quoteSummary payloads; GH Actions is billing-limited).
rem Scheduled via Task Scheduler ("Tape company-cache bake", daily 21:30 + 3h retries).
rem Protocol: lib/companyArchive.ts — this writer ("pc") stamps R2; NAS/GH bakes stand down to a
rem fresh stamp and only bake as the fallback, so a dark PC degrades to STALE, never breaks.
cd /d "C:\Users\TruPorch Homes\Documents\stock chart screener"
if not exist lake\.tmp mkdir lake\.tmp
set TAPE_WRITER=pc
echo [%date% %time%] bake start >> lake\.tmp\pc-bake.log
call npx tsx --env-file=.env.local scripts/refresh-company-cache.ts >> lake\.tmp\pc-bake.log 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] bake FAILED rc=%errorlevel% >> lake\.tmp\pc-bake.log
  exit /b %errorlevel%
)
call npx tsx --env-file=.env.local scripts/upload-company-cache.ts >> lake\.tmp\pc-bake.log 2>&1
echo [%date% %time%] done rc=%errorlevel% >> lake\.tmp\pc-bake.log
