/**
 * run-tick.ts — the NAS-compute orchestrator: one refresh "tick" end-to-end, replicating
 * .github/workflows/refresh-data.yml STEP FOR STEP (same order, same gating, same
 * continue-on-error semantics), so the NAS pipeline and the GitHub fallback can never drift.
 * When you add a step to the workflow, add it to STEPS below (and vice versa).
 *
 *   npx tsx scripts/run-tick.ts <full|quotes|intl|desk|narration|digest|news|auto> [--dry]
 *
 * auto      = map the current hour to a tick (the NAS's hourly scheduler uses this):
 *             UTC 02/04/06/08 quotes · UTC 10 intl · ET 08+17 desk · ET 10/12/14/16 quotes · UTC 23 full;
 *             + Monday 13:00 UTC fires the weekly digest. Silent no-op off-tick — hourly is free.
 * narration = refresh-narration.yml (the cheap "refresh AI narration" button): just the 7 LLM narration
 *             steps + upload + deploy, for when narration blanks out (an OpenRouter 402). ~$0.70 / 10min.
 * digest    = binary-digest.yml: push the weekly binary-events webhook/email. No R2 upload, no deploy.
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
import { notifyAlert } from "../lib/alertNotify";
import { existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

// Data-pipeline modes (mirror refresh-data.yml) + two ported side-workflows: `narration` =
// refresh-narration.yml (the cheap "refresh AI narration" button — the 7 LLM narration steps, no full
// rebuild), `digest` = binary-digest.yml (the weekly Monday push, webhook/email only, no R2/deploy).
type Mode = "full" | "quotes" | "intl" | "desk" | "narration" | "digest" | "news";
type When = "always" | "full" | "quotes-or-desk" | "full-or-intl" | "full-or-desk";

const STEP_TIMEOUT_MIN = 45; // overnight-filings broad scan is ~30m — nothing legitimate exceeds this
// Every step inherits this: any pipeline that calls getNews tees its headlines into the persistent
// archive (lib/newsArchive). Runner-only — web builds never set it (read-only filesystems).
process.env.NEWS_ARCHIVE = "1";
const LOCK = path.join(process.cwd(), ".tick.lock");
const LOCK_STALE_H = 5;

// ── The step table: refresh-data.yml, transcribed. `narr` marks the 7 steps refresh-narration.yml
// runs (they're a subset of FULL). ────────────────────────────────────────────────────────────────
const STEPS: { name: string; cmd: string; when: When; env?: Record<string, string>; narr?: true }[] = [
  // ⚠ THE NEWS TAPE IS DELIBERATELY NOT A STEP HERE. It is an append-only archive living in its own
  // R2 object on a five-minute clock, and it must have exactly ONE writer. A STEPS entry would give it
  // a second: the tarball hydrate/upload path would carry an hours-old copy and overwrite the newer
  // dedicated object, permanently deleting every row in between — history the wires cannot re-serve.
  // It runs as `run-tick.ts news`, which short-circuits with its own pull → refresh → push trio.
  // First on purpose: pulls new/rotated secrets from R2 into $APP/.alert-env, which the entrypoint
  // sources at the TOP of each tick — so a value written now is in env from the NEXT tick on. This
  // exists because the container's env_file (tape.env) only applies on a DSM container recreate.
  { name: "Sync runner env (R2 secrets)", cmd: "npm run sync-runner-env", when: "always" },
  { name: "Refresh quotes (intraday)", cmd: "npm run refresh-quotes", when: "quotes-or-desk" }, // ONLY env set at runtime
  // Re-measure the pre-print plays' option spreads on the intraday tick — self-gates to US market
  // hours + once/day/play, so it does real work on the first mid-session tick and no-ops otherwise.
  // Lifts the liquidity screen's coverage above the ~1-in-6 the after-hours logger manages.
  { name: "Capture trade spreads (market-hours liquidity)", cmd: "npm run capture-trade-spreads", when: "quotes-or-desk" },
  // Scheduled at all because it wasn't: this only ever ran when a human typed it, so the index
  // membership the whole site reasons about drifted from the real indexes for a MONTH (found
  // 2026-07-30) — and two parser bugs rode along undetected for just as long, because nothing ran the
  // parser. Index membership changes monthly; a manual-only refresh is a guaranteed slow drift.
  //
  // FIRST, before refresh-data, deliberately: build-data reads data/constituents/*.json to decide who
  // is in each universe, so scraping the lists at the top of the tick means tonight's adds/drops land
  // in tonight's snapshots rather than a day late. Safe in this position — nothing later rewrites
  // these files (patch-industries refines the SNAPSHOTS, not the constituent lists), and it runs after
  // the R2 hydrate, which is what supplies data/iwv-holdings.xls for the Russell 3000 leg.
  //
  // ⚠ NON-FATAL, AND MUST STAY THAT WAY. fetch-constituents exits 1 on PARTIAL success — a universe
  // whose source broke keeps its prior file instead of shipping a truncated one, and says so. That is
  // a real signal worth an ✗ in the log, but never a reason to abandon a tick: it is one failed step
  // out of ~70, far below the `fails > plan.length / 2` abort, so a stale index list can't cost us a
  // night of otherwise-good market data. The yml mirrors this with continue-on-error.
  { name: "Refresh index constituent lists", cmd: "npm run fetch-constituents", when: "full" },
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
  { name: "Refresh fundamental forensics (Beneish/Altman/Piotroski/Sloan)", cmd: "npm run refresh-forensics", when: "full" }, // reads the panel written just above — no network
  { name: "Refresh buyback & capital-return board", cmd: "npm run refresh-buybacks", when: "full" },
  { name: "Refresh pairs (stat-arb)", cmd: "npm run refresh-pairs", when: "full" },
  { name: "Refresh betas (portfolio cockpit)", cmd: "npm run refresh-betas", when: "full" },
  { name: "Refresh hedge-menu ETF series (portfolio cockpit)", cmd: "npm run refresh-hedge-etfs", when: "full" },
  { name: "Refresh ADV (portfolio liquidity)", cmd: "npm run refresh-adv", when: "full" },
  { name: "Refresh realized-vol cone", cmd: "npm run refresh-vol-cone", when: "full" },
  { name: "Refresh index valuation", cmd: "npm run refresh-index-valuation", when: "full" },
  { name: "Refresh estimate revisions", cmd: "npm run refresh-estimates", when: "full" },
  { name: "Bake per-stock cache (stats+financials+profile)", cmd: "npm run refresh-company-cache", when: "full" }, // fetch-heavy: belongs on the fast pipe; budgeted here
  { name: "Refresh holdco NAV", cmd: "npm run refresh-holdco-nav", when: "full" },
  { name: "Refresh insider buys (Form 4)", cmd: "npm run refresh-insiders", when: "full" },
  { name: "Refresh short mechanics (FINRA short-vol + SEC FTD)", cmd: "npm run refresh-short-mechanics", when: "full" },
  { name: "Refresh congressional trades", cmd: "npm run refresh-congress", when: "full" },
  { name: "Refresh government contracts (USAspending)", cmd: "npm run refresh-gov-contracts", when: "full" },
  { name: "Refresh President's OGE trades", cmd: "npm run refresh-trump", when: "full" },
  { name: "Refresh overnight filings (SuperAnalyst)", cmd: "npm run refresh-overnight-filings", when: "full", env: { SCAN_BROAD: "1" } },
  { name: "Refresh filing semantic index (local embeddings)", cmd: "npm run refresh-filing-index", when: "full" }, // reads the window just written; no network
  // MUST follow the filing index: it joins overnight-filings (sentiment) to the index (vectors) on
  // accession. No network and no LLM — four anchor embeddings and a cosine per candidate.
  { name: "Refresh key debates (evidence ledger)", cmd: "npm run refresh-debates", when: "full" },
  { name: "Refresh same-store sales (comps)", cmd: "npm run refresh-sss", when: "full" },
  { name: "Refresh intl same-store sales (UK/EU comps)", cmd: "npm run refresh-sss-intl", when: "full" },
  { name: "Refresh guidance (forward outlook)", cmd: "npm run refresh-guidance", when: "full", env: { LIMIT: "150" } },
  { name: "Refresh guidance board", cmd: "npm run refresh-guidance-board", when: "full", narr: true },
  { name: "Refresh IV history", cmd: "npm run refresh-iv-history", when: "full" },
  { name: "Refresh Reddit buzz", cmd: "npm run refresh-apewisdom", when: "full" },
  { name: "Refresh put-writing screen", cmd: "npm run refresh-putwrite", when: "full" },
  { name: "Refresh broad vol-universe probe", cmd: "npm run refresh-vol-universe", when: "full" },
  { name: "Refresh vol-dislocation screen", cmd: "npm run refresh-vol-dislocation", when: "full" },
  { name: "Refresh vol-dislocation catalyst tags", cmd: "npm run refresh-vol-tags", when: "full" },
  // VRP capture ledger — grades /vol-dislocation's rich-vol picks on their OWN axis (IV sold vs realized
  // printed). Reads vol-dislocation.json + vol-cone.json only; runs AFTER both.
  { name: "Refresh VRP capture ledger", cmd: "npm run refresh-vol-premium-ledger", when: "full" },
  { name: "Refresh earnings expected-move screen", cmd: "npm run refresh-earnings-move", when: "full" },
  // corp-events BEFORE the trade-log: the track record's catalyst overlay reads corp-events.json, and
  // running it after meant same-night 8-K disclosures (the freshest, highest-impact ones) were stamped
  // from yesterday's board. No dependency runs the other way. Mirrored in refresh-data.yml.
  { name: "Refresh corporate events", cmd: "npm run refresh-corp-events", when: "full" },
  { name: "Refresh earnings-play track record", cmd: "npm run refresh-trade-log", when: "full" },
  { name: "Refresh preview accuracy record (predicted prints)", cmd: "npm run refresh-preview-log", when: "full" }, // FLASH-tier forecasts + code-graded settles
  // AFTER earnings-move + preview-log, deliberately: it joins both files, so running here means
  // tonight's straddle moves and tonight's desk forecasts land in tonight's odds rows.
  { name: "Refresh earnings odds (Polymarket × consensus drift)", cmd: "npm run refresh-earnings-odds", when: "full" },
  // One trivial query so the Supabase free tier never sees 7 idle days and auto-pauses the research
  // store (the 2026-07-19 outage — the corpus went dark for ~2 weeks). Skips cleanly without the env.
  { name: "Keep the research DB alive (Supabase pause guard)", cmd: "npm run ping-research-db", when: "full" },

  { name: "Refresh options flow (S&P 500)", cmd: "npm run refresh-flow", when: "full" },
  { name: "Refresh Trump stock calls", cmd: "npm run refresh-trump-truth", when: "full" },
  { name: "Refresh Fed Watch", cmd: "npm run refresh-fed", when: "full" },
  { name: "Refresh campaigns (activist/short)", cmd: "npm run refresh-campaigns", when: "full" },
  { name: "Refresh biotech catalysts", cmd: "npm run refresh-biotech", when: "full" },
  { name: "Refresh biotech event vol", cmd: "npm run refresh-biotech-vol", when: "full" },
  { name: "Refresh policy & contracts", cmd: "npm run refresh-policy", when: "full" },
  { name: "Refresh catalyst vol", cmd: "npm run refresh-catalyst-vol", when: "full" },
  { name: "Refresh trade desk", cmd: "npm run refresh-trade-ideas", when: "full", narr: true },
  { name: "Refresh dispersion", cmd: "npm run refresh-dispersion", when: "full" },
  { name: "Refresh dealer gamma board", cmd: "npm run refresh-gamma-board", when: "full" },
  { name: "Refresh post-earnings drift", cmd: "npm run refresh-pead", when: "full" },
  { name: "Refresh IPO & lockup monitor", cmd: "npm run refresh-ipo", when: "full" },
  { name: "Refresh spinoff turnover", cmd: "npm run refresh-spinoffs", when: "full" },
  { name: "Refresh tender offers (odd-lot monitor)", cmd: "npm run refresh-tenders", when: "full" },
  { name: "Refresh merger-arb spreads (DEFM14A)", cmd: "npm run refresh-merger-arb", when: "full" },
  { name: "Refresh SPAC trust arbitrage", cmd: "npm run refresh-spac-arb", when: "full" },
  { name: "Refresh value chains (layer economics)", cmd: "npm run refresh-value-chains", when: "full" },
  { name: "Refresh lobbying (LDA join)", cmd: "npm run refresh-lobbying", when: "full" },
  // Push alerts (My Names P3) — AFTER merger-arb/campaigns/earnings-move so it evaluates the fresh
  // feeds. TAPE_WRITER=nas makes THIS runner the single sender; the GitHub mirror step evaluates
  // and logs but never sends (a standdown fail-open must not double-notify phones).
  { name: "Push alerts (My Names)", cmd: "npm run push-alerts", when: "full", env: { TAPE_WRITER: "nas" } },
  { name: "Refresh Daily Desk Note", cmd: "npm run refresh-desk-note", when: "full-or-desk", narr: true },
  { name: "Refresh Confluence Engine", cmd: "npm run refresh-confluence", when: "full", narr: true },
  { name: "Refresh Warning Signs", cmd: "npm run refresh-warnings", when: "full" },
  { name: "Refresh signal track record", cmd: "npm run refresh-signal-log", when: "full" },
  { name: "Backtest price signals", cmd: "npm run backtest-signals", when: "full" },
  { name: "Signal parameter grid (walk-forward)", cmd: "npm run refresh-signal-grid", when: "full" }, // single-threaded, ~30s on this box; no network
  // Research trickle, not a user-facing feed (deliberately NOT in dataFreshness): ~150 polite
  // fetches/night against EDGAR + DoltHub, accumulating the 2020/2022/2024 earnings-vol replay.
  { name: "Regime replay trickle (earnings-vol backtest)", cmd: "npm run refresh-regime-replay", when: "full" },
  { name: "Refresh valuation-discount verdicts", cmd: "npm run refresh-valuation-explain", when: "full", narr: true },
  { name: "Refresh 13F quarter story", cmd: "npm run refresh-13f-story", when: "full", narr: true },
  { name: "Refresh Congress summary", cmd: "npm run refresh-congress-summary", when: "full", narr: true },
  { name: "Refresh macro (FRED)", cmd: "npm run refresh-macro", when: "full" },
  { name: "Evaluate alerts", cmd: "npm run eval-alerts", when: "always" },
  { name: "Export research lake (Parquet → R2)", cmd: "npm run build-lake && npm run backfill-prices", when: "full" },
];

const runs = (when: When, mode: Mode): boolean =>
  // `news` never reaches the plan — it short-circuits above with its own pull/refresh/push trio, so
  // no STEPS entry may claim it.
  mode !== "news" &&
  (when === "always" ||
  (when === "full" && mode === "full") ||
  (when === "quotes-or-desk" && (mode === "quotes" || mode === "desk")) ||
  (when === "full-or-intl" && (mode === "full" || mode === "intl")) ||
  (when === "full-or-desk" && (mode === "full" || mode === "desk")));

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

/** The weekly binary-events digest (binary-digest.yml): Monday ~08:45 ET. Auto fires it at 13:00 UTC
 * Monday alongside whatever data tick that hour has (they're independent — digest only pushes a webhook). */
function isDigestDue(now = new Date()): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() === 13;
}

// ── Remote ops levers (both ride the entrypoint's per-tick `git pull` — the ONE execution channel
// into the container when docker/DSM access isn't available; R2 is the return channel) ─────────────

/** One-shot forced tick: ops/force-tick.json (committed) = {mode, notBeforeUtc, expiresUtc, key}.
 *  `auto` runs it once inside the window — the done-stamp (data/.tmp, container-local, excluded from
 *  the tar) is written BEFORE the run so a crash can't re-fire it hourly. Built 2026-08-15 to make the
 *  NAS run an instrumented FULL off-schedule while diagnosing the 4-night all-steps-failing outage. */
function forcedMode(): Mode | null {
  try {
    const f = JSON.parse(readFileSync(path.join("ops", "force-tick.json"), "utf8"));
    const m = String(f?.mode ?? "");
    if (!["full", "quotes", "intl", "desk", "narration", "news"].includes(m) || !f?.key) return null;
    const now = Date.now();
    if (f.notBeforeUtc && now < Date.parse(f.notBeforeUtc)) return null;
    if (!f.expiresUtc || now >= Date.parse(f.expiresUtc)) return null; // no expiry = never fires (safety)
    const stamp = path.join("data", ".tmp", `force-tick-done-${String(f.key).replace(/[^\w.-]/g, "_")}`);
    if (existsSync(stamp)) return null;
    try { writeFileSync(stamp, new Date().toISOString()); } catch { return null; } // can't stamp → don't risk a loop
    log(`force-tick: running mode=${m} (key ${f.key})`);
    return m as Mode;
  } catch { return null; } // no file / unreadable → nothing forced
}

/** Idle-hour env probe: on auto invocations that map to NO tick (nights, weekends), spend ~10s probing
 *  the vendors FROM INSIDE THE CONTAINER + host load/mem, and upload site-data/runner-diag.json to R2.
 *  This is how a broken runner gets diagnosed without docker access — the 2026-08-15 outage was invisible
 *  precisely because the container's stdout was the only witness. Best-effort: never throws. */
async function runnerDiag(): Promise<void> {
  try {
    const probe = async (url: string) => {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { headers: { "User-Agent": "tape-runner-diag research jameslyeh@gmail.com" }, signal: AbortSignal.timeout(15_000) });
        try { await r.body?.cancel(); } catch { /* body already gone */ }
        return { status: r.status, ms: Date.now() - t0 };
      } catch (e: any) {
        return { status: 0, ms: Date.now() - t0, err: String(e?.cause?.code ?? e?.name ?? e).slice(0, 60) };
      }
    };
    const [yahoo, sec, efts, openrouter] = await Promise.all([
      probe("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d"),
      probe("https://data.sec.gov/submissions/CIK0000320193.json"),
      probe("https://efts.sec.gov/LATEST/search-index?q=%22diag%22"),
      probe("https://openrouter.ai/api/v1/models"),
    ]);
    // 2026-08-15 finding: yahoo = UND_ERR_CONNECT_TIMEOUT from IN here while the HOST reaches it fine.
    // Family-pinned raw TCP probes discriminate the two candidate causes: broken container IPv6 with
    // AAAA-preferring resolution (fixable in code — force IPv4) vs a FORWARD-chain/iptables block on
    // Yahoo's ranges (needs a DSM-side fix). Dependency-free (node:net), never throws.
    const dnsMod = await import("node:dns/promises");
    const netMod = await import("node:net");
    const yahooDns = await dnsMod.lookup("query1.finance.yahoo.com", { all: true, verbatim: true }).then(
      (a) => a.map((x) => `${x.family}:${x.address}`),
      (e: any) => [`err:${String(e?.code ?? e).slice(0, 40)}`],
    );
    const tcp = (host: string, family: 4 | 6) =>
      new Promise<{ ok: boolean; ms: number; err?: string }>((res) => {
        const t0 = Date.now();
        const s = netMod.connect({ host, port: 443, family, autoSelectFamily: false, timeout: 8000 } as any);
        s.once("connect", () => { s.destroy(); res({ ok: true, ms: Date.now() - t0 }); });
        s.once("timeout", () => { s.destroy(); res({ ok: false, ms: Date.now() - t0, err: "ETIMEDOUT" }); });
        s.once("error", (e: any) => res({ ok: false, ms: Date.now() - t0, err: String(e?.code ?? e).slice(0, 40) }));
      });
    const [yahooV4, yahooV6, secV4] = await Promise.all([
      tcp("query1.finance.yahoo.com", 4),
      tcp("query1.finance.yahoo.com", 6),
      tcp("data.sec.gov", 4), // control: a host the fetch probe already showed working
    ]);
    let sha = "?";
    try { sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* n/a */ }
    const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
    const diag = {
      generatedAt: new Date().toISOString(),
      host: (await import("node:os")).hostname(), // provenance — a PC-side test run must not read as the NAS
      sha, node: process.version,
      loadavg: read("/proc/loadavg").trim(),
      memAvailableKb: Number(/MemAvailable:\s+(\d+)/.exec(read("/proc/meminfo"))?.[1] ?? 0),
      alertWebhookSet: !!process.env.ALERT_WEBHOOK_URL,
      openrouterKeySet: !!process.env.OPENROUTER_API_KEY,
      autoSelectFamily: (netMod as any).getDefaultAutoSelectFamily?.() ?? "n/a",
      probes: { yahoo, sec, efts, openrouter },
      yahooDns,
      tcpFamily: { yahooV4, yahooV6, secV4 },
    };
    const { putObject } = await import("../lib/r2");
    await putObject("site-data/runner-diag.json", Buffer.from(JSON.stringify(diag, null, 1)), "application/json");
    log(`runner-diag uploaded (yahoo ${yahoo.status}/${yahoo.ms}ms · sec ${sec.status}/${sec.ms}ms · load ${diag.loadavg.split(" ")[0]})`);
  } catch (e) {
    log(`runner-diag failed (non-fatal): ${String(e).slice(0, 120)}`);
  }
}

/** Same wall-clock session pick as the workflow's "Pick session universes" step. */
function sessionOnly(): string {
  const h = new Date().getUTCHours();
  if (h < 7) return "kospi,nikkei,topix,hsi"; // Asian session
  if (h < 13) return "cac40,aex,ftse100,dax,smi"; // European morning
  return ""; // US daytime → all universes
}

/** Per-step outcomes of THIS tick — written to data/tick-report.json before the upload, so the report
 *  rides the tar into R2 and a broken runner is diagnosable REMOTELY (2026-08-15: the NAS failed every
 *  refresh step for 4 nights while stamping a fresh heartbeat, and the only evidence was inside docker
 *  logs nobody could reach; the tar itself is the one channel that provably still works). */
const stepReport: { name: string; cmd: string; ok: boolean; exit: number | string | null; mins: number; stderrTail?: string }[] = [];

function step(name: string, cmd: string, extraEnv: Record<string, string> = {}): boolean {
  const t0 = Date.now();
  log(`▶ ${name}`);
  // stderr is CAPTURED (then re-emitted below, so docker logs keep it) — a failed step's tail goes in
  // the tick report. stdout stays inherited: live streaming, and stdout tails rarely carry the error.
  const r = spawnSync(cmd, {
    shell: true,
    stdio: ["inherit", "inherit", "pipe"],
    env: { ...process.env, ...extraEnv },
    timeout: STEP_TIMEOUT_MIN * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stderr = r.stderr ? String(r.stderr) : "";
  if (stderr) process.stderr.write(stderr); // preserve the old docker-logs behavior
  const mins = +(((Date.now() - t0) / 60_000).toFixed(1));
  const ok = r.status === 0;
  const exit = r.status ?? (r.signal ? `signal:${r.signal}` : r.error ? `spawn:${String((r.error as any)?.code ?? r.error).slice(0, 60)}` : "timeout");
  stepReport.push({ name, cmd, ok, exit, mins, ...(ok ? {} : { stderrTail: stderr.slice(-800) }) });
  log(`${ok ? "✓" : "✗"} ${name} (${mins}min${ok ? "" : ` — exit ${exit}`})`);
  return ok;
}

// ── Checkout-age alarm ──
// The runner ran a 3-week-stale checkout without anyone noticing (2026-08-09) — the entrypoint now
// pulls per tick, and THIS is the alarm if that ever silently stops working again (a stuck pull, a
// diverged branch, a detached volume). Cheap: one ls-remote per tick; alerts at most once a day via
// a state file. Best-effort end to end — a git/network hiccup must never block the tick.
function checkCheckoutAge(): void {
  try {
    const localSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const remote = execSync("git ls-remote origin main", { encoding: "utf8", timeout: 15_000 }).split(/\s/)[0]?.trim();
    if (!remote || remote === localSha) return;
    const behind = Number(execSync(`git rev-list --count HEAD..${remote}`, { encoding: "utf8" }).trim());
    if (!Number.isFinite(behind) || behind < 20) return; // a tick-to-push race is normal; 20+ commits behind is a dead updater
    const stamp = path.join("data", ".tmp", "checkout-age-alerted.json");
    const today = new Date().toISOString().slice(0, 10);
    try { if (JSON.parse(readFileSync(stamp, "utf8")).date === today) return; } catch { /* not alerted today */ }
    const msg = `Runner checkout is ${behind} commits behind origin/main (${localSha.slice(0, 7)}) — the per-tick git pull is not landing. Restart tape-runner or check the volume.`;
    console.error(`run-tick: ⚠ ${msg}`);
    void notifyAlert(msg, "Tape runner code stale");
    writeFileSync(stamp, JSON.stringify({ date: today, behind }));
  } catch { /* best-effort — never block the tick */ }
}

async function main() {
  const arg = (process.argv[2] || "").toLowerCase();
  const dry = process.argv.includes("--dry");
  checkCheckoutAge();

  const fromAuto = arg === "auto";
  let mode: Mode;
  let autoDigest = false; // auto also fires the weekly digest on Monday
  if (fromAuto) {
    const m = autoMode() ?? forcedMode(); // the schedule wins the hour; a force-tick fills an idle one
    autoDigest = isDigestDue();
    if (!m && !autoDigest) {
      console.log("run-tick: not a tick hour — running the idle diag, then exiting.");
      await runnerDiag(); // ~10s; uploads site-data/runner-diag.json so the container is observable
      return;
    }
    mode = m ?? "digest"; // Monday 13:00 with no data tick → digest-only
    if (!m && autoDigest) autoDigest = false; // already the primary mode; don't double-run
  } else if (arg === "full" || arg === "quotes" || arg === "intl" || arg === "desk" || arg === "narration" || arg === "digest" || arg === "news") {
    mode = arg;
  } else {
    console.error("usage: run-tick.ts <full|quotes|intl|desk|narration|digest|news|auto> [--dry]");
    process.exit(2);
  }

  const plan = mode === "digest" ? [] : mode === "narration" ? STEPS.filter((s) => s.narr) : STEPS.filter((s) => runs(s.when, mode));
  if (dry) {
    if (mode === "digest") { console.log("run-tick DRY (mode=digest): hydrate → push-binary-digest (webhook/email; no R2 upload / deploy)."); return; }
    // `news` never touches the STEPS plan, so printing the plan length would describe the wrong run.
    if (mode === "news") { console.log("run-tick DRY (mode=news): news-tape-pull → refresh-news-tape → news-tape-push (one R2 object; NO tree hydrate, NO tree upload, NO deploy)."); return; }
    console.log(`run-tick DRY (mode=${mode}) — ${plan.length} refresh steps + hydrate/upload${mode === "full" ? "/gate" : ""}/deploy${autoDigest ? " + weekly digest" : ""}:`);
    for (const s of plan) console.log(`  ${s.cmd.padEnd(46)} ${s.name}`);
    return;
  }

  // ── news: runs entirely OUTSIDE the main tick's lock and checkout ──────────────────────────────
  // Two reasons it cannot share them, both of which would have broken the tape in production:
  //   1. THE LOCK. A FULL run holds it for hours. A five-minute tick that skips whenever the lock is
  //      held would go dark for the whole nightly rebuild — exactly the window where the wires are
  //      busiest, and rows missed are rows no wire will re-serve. It touches a different R2 object and
  //      never reads or writes the data tree, so it genuinely cannot race the main tick; it only has
  //      to serialize against ITSELF, hence its own lockfile.
  //   2. THE CHECKOUT. `git pull` in a shared working tree, concurrent with a FULL run's pull/npm ci,
  //      races on git's own index.lock. The news tick has no need for fresh code every five minutes —
  //      the hourly tick already pulls.
  if (mode === "news") {
    const NEWS_LOCK = path.join(process.cwd(), ".tick-news.lock");
    const NEWS_STALE_MIN = 15; // a 2-second job stuck this long is hung, not slow
    if (existsSync(NEWS_LOCK)) {
      const ageMin = (Date.now() - statSync(NEWS_LOCK).mtimeMs) / 60_000;
      if (ageMin < NEWS_STALE_MIN) { log(`another news tick is running (lock ${ageMin.toFixed(1)}m old) — skipping.`); return; }
      log(`stealing stale news lock (${ageMin.toFixed(1)}m old)`);
    }
    writeFileSync(NEWS_LOCK, `${process.pid} news ${new Date().toISOString()}`);
    const unlockNews = () => { try { rmSync(NEWS_LOCK, { force: true }); } catch { /* gone */ } };
    process.on("exit", unlockNews);
    process.on("SIGINT", () => { unlockNews(); process.exit(130); });
    process.on("SIGTERM", () => { unlockNews(); process.exit(143); });
    try {
      step("Pull news archive from R2", "npm run news-tape-pull");     // non-fatal by design
      const refreshed = step("Refresh market news tape", "npm run refresh-news-tape");
      // Push even when the refresh reported failure: writeFeedGuarded degrades to stale rather than
      // empty, so the pushed object is never worse than what R2 already holds.
      const pushed = step("Push news archive to R2", "npm run news-tape-push");
      log(`news tick: refresh ${refreshed ? "ok" : "FAILED"}, push ${pushed ? "ok" : "FAILED"}.`);
      if (!pushed) process.exit(1);
      return;
    } finally { unlockNews(); }
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

    // ── digest: read the hydrated feeds, push the webhook/email, done. No R2 upload, no deploy. ────
    if (mode === "digest") {
      const ok = step("Push weekly binary-events digest", "npm run push-binary-digest");
      log(`digest ${ok ? "sent" : "FAILED"} (no R2 upload / deploy).`);
      if (!ok) process.exit(1);
      return; // finally { unlock() }
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

    // ── Tick report: land THIS run's per-step outcomes inside the tar (remote diagnosability) ──────
    // Written before the upload so it ships with the tree it describes. Plain write, no guard — it is
    // diagnostic metadata, not a feed. Includes the checkout sha: a wedged git tree is the first thing
    // to rule out when every step fails but the upload works (the 2026-08-15 incident's exact shape).
    try {
      let sha = "?";
      try { sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a repo? */ }
      const readProc = (f: string) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } };
      writeFileSync(path.join("data", "tick-report.json"), JSON.stringify({
        generatedAt: new Date().toISOString(), mode, sha, node: process.version,
        loadavgEnd: readProc("/proc/loadavg"), // was the box starved while the steps ran? (Eufy contention)
        memAvailableKb: Number(/MemAvailable:\s+(\d+)/.exec(readProc("/proc/meminfo"))?.[1] ?? 0),
        fails, total: plan.length, steps: stepReport,
      }, null, 1));
    } catch (e) { log(`tick-report write failed (non-fatal): ${String(e).slice(0, 120)}`); }

    // A majority-failed tick is a BROKEN RUNNER, not a quiet market — say so out loud (ntfy), because
    // the upload below will still succeed and stamp fresh, and without this push the outage is silent.
    if (plan.length > 0 && fails > plan.length / 2) {
      void notifyAlert(
        `run-tick mode=${mode}: ${fails}/${plan.length} steps FAILED — the runner is broken (data will read stale). First failure: ${stepReport.find((s) => !s.ok)?.name ?? "?"} (exit ${stepReport.find((s) => !s.ok)?.exit}). See data/tick-report.json in the R2 tar.`,
        "Tape runner broken",
      );
    }

    // ── Upload + gate + deploy (workflow tail) ────────────────────────────────────────────────────
    // FULL propagates into data-to-r2's env so its FULL-only writes fire on the NAS pipeline too — the
    // per-stock cache object (company.tar.gz) and the freshness heartbeat. In GitHub Actions `env.FULL`
    // is set job-wide; run-tick only has `mode` locally, so pass it explicitly (else the NAS strips
    // data/company from the tarball but never re-ships company.tar.gz, and never writes the heartbeat).
    // TAPE_WRITER stamps the R2 manifest so refresh-data.yml's primary-check can see the NAS is alive
    // and stand its scheduled runs down (the dual-writer clobber fix — see data-to-r2.ts).
    const uploaded = step("Upload site data to R2 (build-time hydration)", "npm run data-to-r2", {
      TAPE_WRITER: "nas",
      // The heartbeat must carry the run's HEALTH, not just its existence — a full that failed every
      // step still uploads (stale-tree re-ship is deliberate), and before these two fields the alert
      // pipeline read that as "all good" for 4 straight nights (2026-08-15).
      TICK_FAILS: String(fails),
      TICK_TOTAL: String(plan.length),
      ...(mode === "full" ? { FULL: "true" } : {}),
    });
    let gateOk = true;
    // The gate runs on FULL ONLY, and intraday ticks deploy ungated BY DESIGN — do not "fix" this by
    // gating them. Observed 2026-08-05 (news tape dead 5 days, gate red): the 23:00 FULL skipped its
    // deploy, then the 02:00 quotes tick deployed anyway — and that was the RIGHT outcome. The upload
    // above has already advanced R2, so a skipped deploy protects nobody from the stale feed (the site
    // hydrates it either way); gating quotes ticks would only mean a dead news tape freezes QUOTE
    // updates all day — strictly staler for the user. The gate's real teeth are (1) this FULL-tick
    // skip, which keeps the just-rebuilt tree off the site for a few hours while (2) check-freshness
    // pushes the red verdict to ALERT_WEBHOOK_URL so a human fixes the feed the same night.
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

    // Weekly binary-events digest, alongside a Monday data tick (independent — webhook only).
    if (autoDigest) step("Push weekly binary-events digest", "npm run push-binary-digest");

    log(`done: ${plan.length - fails}/${plan.length} steps ok${fails ? ` (${fails} failed — continue-on-error)` : ""}`);
    // Exit non-zero when the run is materially broken so DSM Task Scheduler emails:
    if (!uploaded || !gateOk || fails > plan.length / 2) process.exit(1);
  } finally {
    unlock();
  }
}

main().catch((e) => { console.error("run-tick:", String(e?.message || e)); process.exit(1); });
