@echo off
REM ============================================================================
REM  Tape - LOCAL BACKUP data refresh.
REM
REM  Supplements the GitHub Actions cron (.github/workflows/refresh-data.yml)
REM  for when GitHub's scheduler is slow or this is a backup you want on-hand.
REM  It re-prices each data/<universe>/snapshot.json from fresh Yahoo quotes
REM  (the same `npm run refresh-quotes` the cloud runs), commits ONLY data/,
REM  and pushes to main -> Vercel auto-redeploys.
REM
REM  Schedule it with Task Scheduler (see scripts/README-local-refresh.md).
REM  Safe to run anytime / on a timer:
REM    - does NOTHING if the working tree has uncommitted changes (never
REM      touches your in-progress edits),
REM    - does NOTHING if no prices moved (no empty commits),
REM    - conflict-proof against the bot's pushes (rebase -X theirs + retry).
REM  Requires: git + node/npm on PATH, and a git remote you can already push to
REM  (this machine is already authenticated - no token lives in this file).
REM ============================================================================
setlocal EnableExtensions
cd /d "%~dp0.."

set "LOG=%~dp0refresh-local.log"
echo.>> "%LOG%"
echo ==== %DATE% %TIME% ====>> "%LOG%"

REM --- Only act on a clean tree, so a timed run never disturbs active dev work.
git diff --quiet
if errorlevel 1 goto :dirty
git diff --cached --quiet
if errorlevel 1 goto :dirty
goto :run

:dirty
echo SKIP: uncommitted changes in working tree>> "%LOG%"
goto :end

:run
git pull --rebase -X theirs origin main>> "%LOG%" 2>&1
call npm run refresh-quotes>> "%LOG%" 2>&1
git add data>> "%LOG%" 2>&1

REM No staged changes => prices didn't move => nothing to do.
git diff --cached --quiet
if not errorlevel 1 goto :nochange

git commit -m "chore: local backup refresh (%DATE% %TIME%)">> "%LOG%" 2>&1
git push origin main>> "%LOG%" 2>&1
if errorlevel 1 (
  echo push rejected - resync and retry>> "%LOG%"
  git pull --rebase -X theirs origin main>> "%LOG%" 2>&1
  git push origin main>> "%LOG%" 2>&1
)
echo OK: pushed refreshed data>> "%LOG%"
goto :end

:nochange
echo no price changes - nothing to push>> "%LOG%"

:end
endlocal
