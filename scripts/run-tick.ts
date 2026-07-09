/**
 * run-tick.ts — the NAS-compute orchestrator: one refresh "tick" end-to-end, replicating
 * .github/workflows/refresh-data.yml STEP FOR STEP (same order, same gating, same
 * continue-on-error semantics), so the NAS pipeline and the GitHub fallback can never drift.
 * When you add a step to the workflow, add it to STEPS below (and vice versa).
 *
 *   npx tsx scripts/run-tick.ts <full|quotes|intl|desk|auto> [--dry]
 *
 * auto  = map the current hour to a tick (the NAS's hourly Task Scheduler entry uses this):
 *         UTC 02/04/06/08 quotes · UTC 10 intl · ET 08+17 desk · ET 10/12/14/16 quotes · UTC 23 full
 *         (exits silently on non-tick hours + weekends — an hourly no-op costs nothing).
 * --dry = print the resolved step plan and exit (verify against the workflow after edits).
 *
 * Semantics mirrored from the workflow:
 *  - Hydrate-from-R2 is a HARD GATE: if R2 can't be read we abort before any refresh, so a partial
 *    local tree can never be uploaded over the full one (the 2026-07-03 clobber).
 *  - Every refresh step is continue-on-error; failures are logged and counted.
 *  - FULL's freshness gate failing SKIPS the Vercel deploy (never deploy known-stale data) and
 *    exits non-zero so DSM Task Scheduler emails.
 *  - A lockfile serializes ticks (the FULL run spans several hourly slots); stale locks (>5h) are stolen.
 * Env: the container injects tape.env (all API keys). TAPE_PULL=1 makes the run git-pull main +
 * npm-ci-if-lockfile-changed first (the NAS equivalent of actions/checkout).
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

type Mode = "full" | "quotes" | "intl" | "desk";
type When = "always" | "full" | "quotes-or-desk" | "full-or-intl" | "full-or-desk";

const STEP_TIMEOUT_MIN = 45; // overnight-filings broad scan is ~30m — nothing legitimate exceeds this
const LOCK = path.join(process.cwd(), ".tick.lock");
const LOCK_STALE_H = 5;

// ── The step table: refresh-data.yml, transcribed. ────────────────────────────────────────────────
const STEPS: { name: string; cmd: string; when: When; env?: Record<string, string> }[] = [
  { name: "Refresh quotes (intraday)", cmd: "npm run refresh-quotes", when: "quotes-or-desk" }, // ONLY env set at runtime
  { name: "Refresh US universes (prices, returns, fundamentals)", cmd: "npm run refresh-data", when: "full" },
  { name: "Refine generic sub-industry labels", cmd: "npm run patch-industries", when: "full" },
  { name: "Repair sector ETF returns", cmd: "npm run refresh-sectors", when: "full" },
  { name: "Backfill missing price history", cmd: "npm run refresh-series", when: "full" },
  { name: "Backfill margins — SimFin", cmd: "npm run refresh-margins-simfin", when: "full" },
  { name: "Backfill margins — Alpha Vantage (capped)", cmd: "npm run refresh-margins-av", when: "full", env: { AV_BUDGET: "20" } },
  { name: "Refresh international universes", cmd: "npm run refresh-intl", when: "full-or-intl" },
  { name: "Refresh super-investor 13F holdings", cmd: "npm run refresh-13f", when: "full" },
  { name: "Refresh mover catalysts", cmd: "npm run refresh-catalysts", when: "full" },
  { name: "Refresh closed-end funds", cmd: "npm run refresh-cef", when: "full" },
  { name: "Refresh valuation history (discount to own history)", cmd: "npm run refresh-valuation-history", when: "full" },
  { name: "Refresh pairs (stat-arb)", cmd: "npm run refresh-pairs", when: "full" },
  { name: "Refresh betas (portfolio cockpit)", cmd: "npm run refresh-betas", when: "full" },
  { name: "Refresh realized-vol cone", cmd: "npm run refresh-vol-cone", when: "full" },
  { name: "Refresh index valuation", cmd: "npm run refresh-index-valuation", when: "full" },
  { name: "Refresh estimate revisions", cmd: "npm run refresh-estimates", when: "full" },
  { name: "Refresh holdco NAV", cmd: "npm run refresh-holdco-nav", when: "full" },
  { name: "Refresh insider buys (Form 4)", cmd: "npm run refresh-insiders", when: "full" },
  { name: "Refresh congressional trades", cmd: "npm run refresh-congress", when: "full" },
  { name: "Refresh President's OGE trades", cmd: "npm run refresh-trump", when: "full" },
  { name: "Refresh overnight filings (SuperAnalyst)", cmd: "npm run refresh-overnight-filings", when: "full", env: { SCAN_BROAD: "1" } },
  { name: "Refresh same-store sales (comps)", cmd: "npm run refresh-sss", when: "full" },
  { name: "Refresh intl same-store sales (UK/EU comps)", cmd: "npm run refresh-sss-intl", when: "full" },
  { name: "Refresh guidance (forward outlook)", cmd: "npm run refresh-guidance", when: "full", env: { LIMIT: "150" } },
  { name: "Refresh guidance board", cmd: "npm run refresh-guidance-board", when: "full" },
  { name: "Refresh IV history", cmd: "npm run refresh-iv-history", when: "full" },
  { name: "Refresh Reddit buzz", cmd: "npm run refresh-apewisdom", when: "full" },
  { name: "Refresh put-writing screen", cmd: "npm run refresh-putwrite", when: "full" },
  { name: "Refresh broad vol-universe probe", cmd: "npm run refresh-vol-universe", when: "full" },
  { name: "Refresh vol-dislocation screen", cmd: "npm run refresh-vol-dislocation", when: "full" },
  { name: "Refresh vol-dislocation catalyst tags", cmd: "npm run refresh-vol-tags", when: "full" },
  { name: "Refresh earnings expected-move screen", cmd: "npm run refresh-earnings-move", when: "full" },
  { name: "Refresh earnings-play track record", cmd: "npm run refresh-trade-log", when: "full" },
  { name: "Refresh options flow (S&P 500)", cmd: "npm run refresh-flow", when: "full" },
  { name: "Refresh Trump stock calls", cmd: "npm run refresh-trump-truth", when: "full" },
  { name: "Refresh Fed Watch", cmd: "npm run refresh-fed", when: "full" },
  { name: "Refresh campaigns (activist/short)", cmd: "npm run refresh-campaigns", when: "full" },
  { name: "Refresh biotech catalysts", cmd: "npm run refresh-biotech", when: "full" },
  { name: "Refresh biotech event vol", cmd: "npm run refresh-biotech-vol", when: "full" },
  { name: "Refresh policy & contracts", cmd: "npm run refresh-policy", when: "full" },
  { name: "Refresh catalyst vol", cmd: "npm run refresh-catalyst-vol", when: "full" },
  { name: "Refresh trade desk", cmd: "npm run refresh-trade-ideas", when: "full" },
  { name: "Refresh dispersion", cmd: "npm run refresh-dispersion", when: "full" },
  { name: "Refresh dealer gamma board", cmd: "npm run refresh-gamma-board", when: "full" },
  { name: "Refresh post-earnings drift", cmd: "npm run refresh-pead", when: "full" },
  { name: "Refresh corporate events", cmd: "npm run refresh-corp-events", when: "full" },
  { name: "Refresh IPO & lockup monitor", cmd: "npm run refresh-ipo", when: "full" },
  { name: "Refresh spinoff turnover", cmd: "npm run refresh-spinoffs", when: "full" },
  { name: "Refresh Daily Desk Note", cmd: "npm run refresh-desk-note", when: "full-or-desk" },
  { name: "Refresh Confluence Engine", cmd: "npm run refresh-confluence", when: "full" },
  { name: "Refresh Warning Signs", cmd: "npm run refresh-warnings", when: "full" },
  { name: "Refresh signal track record", cmd: "npm run refresh-signal-log", when: "full" },
  { name: "Refresh valuation-discount verdicts", cmd: "npm run refresh-valuation-explain", when: "full" },
  { name: "Refresh 13F quarter story", cmd: "npm run refresh-13f-story", when: "full" },
  { name: "Refresh Congress summary", cmd: "npm run refresh-congress-summary", when: "full" },
  { name: "Refresh macro (FRED)", cmd: "npm run refresh-macro", when: "full" },
  { name: "Evaluate alerts", cmd: "npm run eval-alerts", when: "always" },
  { name: "Export research lake (Parquet → R2)", cmd: "npm run build-lake && npm run backfill-prices", when: "full" },
];

const runs = (when: When, mode: Mode): boolean =>
  when === "always" ||
  (when === "full" && mode === "full") ||
  (when === "quotes-or-desk" && (mode === "quotes" || mode === "desk")) ||
  (when === "full-or-intl" && (mode === "full" || mode === "intl")) ||
  (when === "full-or-desk" && (mode === "full" || mode === "desk"));

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

/** The hourly schedule (same map as scripts/nas/tape-dispatch.sh): hour → mode, or null off-tick. */
function autoMode(now = new Date()): Mode | null {
  const utcH = now.getUTCHours();
  const utcD = now.getUTCDay(); // 0=Sun
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etH = et.getHours(), etD = et.getDay();
  let mode: Mode | null = null;
  if (utcD >= 1 && utcD <= 5) {
    if ([2, 4, 6, 8].includes(utcH)) mode = "quotes";
    if (utcH === 10) mode = "intl";
    if (utcH === 23) mode = "full";
  }
  if (etD >= 1 && etD <= 5) {
    if ([8, 17].includes(etH)) mode = "desk"; // desk wins the hour (it includes a quote refresh)
    else if ([10, 12, 14, 16].includes(etH)) mode = "quotes";
  }
  return mode;
}

/** Same wall-clock session pick as the workflow's "Pick session universes" step. */
function sessionOnly(): string {
  const h = new Date().getUTCHours();
  if (h < 7) return "kospi,nikkei,topix,hsi"; // Asian session
  if (h < 13) return "cac40,aex,ftse100,dax,smi"; // European morning
  return ""; // US daytime → all universes
}

function step(name: string, cmd: string, extraEnv: Record<string, string> = {}): boolean {
  const t0 = Date.now();
  log(`▶ ${name}`);
  const r = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    timeout: STEP_TIMEOUT_MIN * 60_000,
  });
  const mins = ((Date.now() - t0) / 60_000).toFixed(1);
  const ok = r.status === 0;
  log(`${ok ? "✓" : "✗"} ${name} (${mins}min${ok ? "" : ` — exit ${r.status ?? "timeout/signal"}`})`);
  return ok;
}

async function main() {
  const arg = (process.argv[2] || "").toLowerCase();
  const dry = process.argv.includes("--dry");

  let mode: Mode;
  if (arg === "auto") {
    const m = autoMode();
    if (!m) { console.log("run-tick: not a tick hour — exiting."); return; }
    mode = m;
  } else if (arg === "full" || arg === "quotes" || arg === "intl" || arg === "desk") {
    mode = arg;
  } else {
    console.error("usage: run-tick.ts <full|quotes|intl|desk|auto> [--dry]");
    process.exit(2);
  }

  const plan = STEPS.filter((s) => runs(s.when, mode));
  if (dry) {
    console.log(`run-tick DRY (mode=${mode}) — ${plan.length} refresh steps + hydrate/upload/gate/deploy:`);
    for (const s of plan) console.log(`  ${s.cmd.padEnd(46)} ${s.name}`);
    return;
  }

  // ── Lock (the FULL run spans several hourly slots — later ticks must skip, not stack) ───────────
  if (existsSync(LOCK)) {
    const ageH = (Date.now() - statSync(LOCK).mtimeMs) / 3_600_000;
    if (ageH < LOCK_STALE_H) { log(`another tick is running (lock ${ageH.toFixed(1)}h old) — skipping mode=${mode}.`); return; }
    log(`stealing stale lock (${ageH.toFixed(1)}h old)`);
  }
  writeFileSync(LOCK, `${process.pid} ${mode} ${new Date().toISOString()}`);
  const unlock = () => { try { rmSync(LOCK, { force: true }); } catch { /* gone */ } };
  process.on("exit", unlock);
  process.on("SIGINT", () => { unlock(); process.exit(130); });
  process.on("SIGTERM", () => { unlock(); process.exit(143); });

  try {
    log(`run-tick mode=${mode} (${plan.length} steps planned)`);

    // ── Checkout-equivalent: pull latest main (+ npm ci only when the lockfile changed) ────────────
    if (process.env.TAPE_PULL === "1") {
      const lockBefore = existsSync("package-lock.json") ? readFileSync("package-lock.json", "utf8").length : 0;
      if (!step("Pull latest main", "git pull --ff-only origin main")) log("pull failed — running with the current checkout");
      const lockAfter = existsSync("package-lock.json") ? readFileSync("package-lock.json", "utf8").length : 0;
      if (lockAfter !== lockBefore) step("Install dependencies (lockfile changed)", "npm ci");
    }

    // ── HARD GATE: hydrate the prior tree. Abort on failure — never upload a partial tree over R2. ─
    if (!step("Hydrate data/ from R2 (prior tree)", "npm run data-from-r2")) {
      log("HYDRATE FAILED — aborting the tick to preserve R2 (nothing was refreshed or uploaded).");
      process.exit(1);
    }

    // ── Refresh steps (each continue-on-error, like the workflow) ─────────────────────────────────
    let fails = 0;
    for (const s of plan) {
      const extra = { ...(s.env ?? {}) };
      if (s.cmd === "npm run refresh-quotes") {
        const only = sessionOnly();
        if (only) extra.ONLY = only;
        log(`session pick → ONLY='${only || "(all universes)"}'`);
      }
      if (!step(s.name, s.cmd, extra)) fails++;
    }

    // ── Upload + gate + deploy (workflow tail) ────────────────────────────────────────────────────
    const uploaded = step("Upload site data to R2 (build-time hydration)", "npm run data-to-r2");
    let gateOk = true;
    if (mode === "full") gateOk = step("Data-freshness gate", "npm run check-freshness");

    if (uploaded && gateOk) {
      const hook = process.env.VERCEL_DEPLOY_HOOK;
      if (hook) {
        const r = await fetch(hook, { method: "POST" }).then((x) => x.status).catch(() => 0);
        log(`Vercel deploy hook → HTTP ${r || "failed"}`);
      } else log("VERCEL_DEPLOY_HOOK not set — skipping deploy trigger.");
    } else {
      log("deploy SKIPPED (upload failed or freshness gate red) — never deploy known-stale data.");
    }

    log(`done: ${plan.length - fails}/${plan.length} steps ok${fails ? ` (${fails} failed — continue-on-error)` : ""}`);
    // Exit non-zero when the run is materially broken so DSM Task Scheduler emails:
    if (!uploaded || !gateOk || fails > plan.length / 2) process.exit(1);
  } finally {
    unlock();
  }
}

main().catch((e) => { console.error("run-tick:", String(e?.message || e)); process.exit(1); });
