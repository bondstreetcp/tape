/**
 * Data-freshness monitor (data-integrity, phase 2).
 *
 * The site's #1 recurring incident is a feed that silently STOPS updating — a broken scraper, a
 * dead API key, a cron step that fails under `continue-on-error` — discovered days later by a human
 * ("Trump mentioned Micron and the feed isn't picking it up"; the 8 LLM steps that ran dead for
 * weeks). We now stamp every data file with `generatedAt`, but nothing WATCHES those stamps.
 *
 * This module is that watcher: an explicit registry of the user-facing feeds with a per-feed max age
 * and, where "empty" is unambiguously broken, a minimum row count. `checkFreshness()` reads each file
 * and classifies it OK / STALE / MISSING / EMPTY / UNREADABLE. Wired into CI as the one step that is
 * allowed to fail the job (every refresh step is `continue-on-error`, by design — so staleness is the
 * only surviving signal), and surfaced live at /api/health/data.
 *
 * Server-only (reads the filesystem). Do NOT import from a client component.
 *
 * Thresholds are calibrated for the post-FULL-run check (weekdays ~22:30 UTC, right after the nightly
 * rebuild): a healthy feed is minutes old, so the windows below only trip on a feed that's been dead
 * across multiple runs — not on GitHub's routine run-lateness or a weekend.
 *   - core (30h): market/derived data rewritten every FULL run — must be current daily.
 *   - event/synthesis (96h): forward-accumulating or skip-write feeds that legitimately keep an old
 *     stamp on a genuinely quiet night; "dead" means no output for ~4 days.
 */
import { promises as fs } from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "data");
const H = 3_600_000;

const STAMP_KEYS = ["generatedAt", "updatedAt", "updated", "asOf", "lastUpdated"] as const;

type Tier = "core" | "event" | "synthesis" | "snapshot";
export type FreshStatus = "ok" | "stale" | "missing" | "empty" | "unreadable";

/** The external service a feed's data comes from. Lets the monitor probe that service and tell
 *  "the upstream is unreachable from this host" (environmental) apart from "the feed logic broke". */
export type FeedOrigin = "sec";

export interface FeedSpec {
  file: string; // relative to data/
  label: string;
  tier: Tier;
  maxAgeHours: number;
  /** dot-path to a countable value (array → length, object → key count). */
  countPath?: string;
  /** FAIL when the count is below this — only set where empty is unambiguously broken. */
  minCount?: number;
  /** override the stamp field(s) to read (default: STAMP_KEYS in order). */
  stampKeys?: readonly string[];
  /** no stamp field in the file → fall back to file mtime (less reliable; git touch resets it). */
  mtimeFallback?: boolean;
  /** upstream this feed fetches from — set only where the feed's health ⟺ that service's reachability
   *  (e.g. data.sec.gov). Drives the reachability probe that disambiguates environmental vs logic. */
  origin?: FeedOrigin;
}

export interface FreshResult {
  file: string;
  label: string;
  tier: Tier;
  status: FreshStatus;
  ageHours: number | null;
  maxAgeHours: number;
  count: number | null;
  minCount: number | null;
  detail: string;
  origin?: FeedOrigin;
}

// ── The registry ────────────────────────────────────────────────────────────────────────────────
// Only USER-FACING feeds. Excluded on purpose: pure caches / reference data (cusip-map, industry-map,
// av-margins, simfin-margins, putwrite-ivhist), telemetry (llm-usage), and the DEAD legacy files
// data/snapshot.json + data/constituents.json (nothing loads them — the live ones are per-universe).
const CORE = 30, EVENT = 96, SYNTH = 96;

const FEEDS: FeedSpec[] = [
  // core — rewritten every FULL run; empty on the count-gated ones = definitely broken
  { file: "estimates.json", label: "Estimate revisions", tier: "core", maxAgeHours: CORE, countPath: "names", minCount: 100 },
  { file: "valuation-history.json", label: "Discount-to-history", tier: "core", maxAgeHours: CORE, countPath: "names", minCount: 500, origin: "sec" },
  { file: "buybacks.json", label: "Buyback & capital return", tier: "core", maxAgeHours: CORE, countPath: "rows", minCount: 300, origin: "sec" },
  { file: "congress.json", label: "Congress trades", tier: "core", maxAgeHours: CORE, countPath: "trades", minCount: 100 },
  { file: "guidance.json", label: "Guidance", tier: "core", maxAgeHours: CORE, countPath: "byTicker", minCount: 20 },
  { file: "catalysts.json", label: "Mover catalysts", tier: "core", maxAgeHours: CORE, countPath: "bySymbol", minCount: 50 },
  { file: "options-flow.json", label: "Options flow", tier: "core", maxAgeHours: CORE },
  { file: "gamma-board.json", label: "Dealer gamma board", tier: "core", maxAgeHours: CORE, countPath: "rows", minCount: 10 },
  { file: "vol-cone.json", label: "Realized-vol cone", tier: "core", maxAgeHours: CORE, countPath: "rows", minCount: 100 },
  { file: "macro.json", label: "Macro (FRED)", tier: "core", maxAgeHours: CORE, stampKeys: ["asOf", "generatedAt"] },
  { file: "cef.json", label: "Closed-end funds", tier: "core", maxAgeHours: CORE },
  { file: "holdco-nav.json", label: "Holdco NAV", tier: "core", maxAgeHours: CORE },
  { file: "superinvestors.json", label: "Super-investor 13F", tier: "core", maxAgeHours: CORE },
  { file: "index-valuation-history.json", label: "Index valuation", tier: "core", maxAgeHours: CORE },
  { file: "apewisdom.json", label: "Reddit buzz", tier: "core", maxAgeHours: CORE },
  { file: "iv-history.json", label: "IV history", tier: "core", maxAgeHours: CORE },
  { file: "earnings-move.json", label: "Earnings expected-move", tier: "core", maxAgeHours: CORE },
  { file: "putwrite.json", label: "Put-writing screen", tier: "core", maxAgeHours: CORE },
  { file: "insiders.json", label: "Insider buys", tier: "core", maxAgeHours: CORE, origin: "sec" },
  { file: "spinoffs.json", label: "Spinoff turnover", tier: "core", maxAgeHours: CORE },
  { file: "trade-log.json", label: "Earnings-play track record", tier: "core", maxAgeHours: CORE },
  { file: "same-store-sales.json", label: "Same-store sales", tier: "core", maxAgeHours: CORE },
  { file: "trade-ideas.json", label: "Trade desk ideas", tier: "core", maxAgeHours: CORE, countPath: "ideas", minCount: 1 },
  { file: "vol-dislocation.json", label: "Vol dislocation", tier: "core", maxAgeHours: CORE, countPath: "rows", minCount: 100 },
  // biotech-vol / pead: age-only — zero forward binaries or an earnings-lull window are legitimate
  { file: "biotech-vol.json", label: "Biotech event vol", tier: "core", maxAgeHours: CORE, countPath: "rows" },
  { file: "pead.json", label: "Post-earnings drift", tier: "core", maxAgeHours: CORE, countPath: "rows" },
  { file: "dispersion.json", label: "Index dispersion", tier: "core", maxAgeHours: CORE },
  { file: "guidance-board.json", label: "Guidance credibility board", tier: "core", maxAgeHours: CORE, countPath: "rows", minCount: 20 },
  { file: "pairs.json", label: "Pairs stat-arb", tier: "core", maxAgeHours: CORE, countPath: "pairs" },
  { file: "betas.json", label: "Portfolio betas", tier: "core", maxAgeHours: CORE, countPath: "betas", minCount: 500 },
  { file: "signal-log.json", label: "Signal track record", tier: "core", maxAgeHours: CORE, countPath: "events", minCount: 1 },
  { file: "signal-backtest.json", label: "Signal backtest", tier: "synthesis", maxAgeHours: SYNTH, countPath: "signals", minCount: 3 },

  // event — forward-accumulating LLM feeds; content can be genuinely sparse, so age-only + a long window
  { file: "campaigns.json", label: "Activism & shorts", tier: "event", maxAgeHours: EVENT },
  { file: "corp-events.json", label: "Corporate events", tier: "event", maxAgeHours: EVENT, origin: "sec" },
  { file: "biotech-catalysts.json", label: "Biotech catalysts", tier: "event", maxAgeHours: EVENT },
  { file: "policy.json", label: "Policy & contracts", tier: "event", maxAgeHours: EVENT },
  { file: "fed-watch.json", label: "Fed Watch", tier: "event", maxAgeHours: EVENT },
  { file: "ipo-monitor.json", label: "IPOs & lockups", tier: "event", maxAgeHours: EVENT },
  { file: "catalyst-vol.json", label: "Catalyst vol", tier: "event", maxAgeHours: EVENT },
  { file: "trump-truth-stocks.json", label: "Trump stock calls", tier: "event", maxAgeHours: EVENT },
  { file: "trump-trades.json", label: "Trump OGE trades", tier: "event", maxAgeHours: EVENT },
  { file: "overnight-filings.json", label: "Overnight filings", tier: "event", maxAgeHours: EVENT, origin: "sec" },

  // synthesis — skip-write when there's nothing notable, so a stale stamp is legitimate for days
  { file: "desk-note.json", label: "Morning desk note", tier: "synthesis", maxAgeHours: SYNTH },
  { file: "valuation-explain.json", label: "Cheap-vs-history verdicts", tier: "synthesis", maxAgeHours: SYNTH },
  { file: "13f-story.json", label: "13F quarter story", tier: "synthesis", maxAgeHours: SYNTH },
  { file: "congress-summary.json", label: "Congress summary", tier: "synthesis", maxAgeHours: SYNTH },
  { file: "confluence.json", label: "Confluence engine", tier: "synthesis", maxAgeHours: SYNTH },
  { file: "warnings.json", label: "Warning signs board", tier: "synthesis", maxAgeHours: SYNTH, countPath: "names" },
];

// Per-universe snapshot row-count floors — a snapshot below its floor is a partial-fetch / degraded
// day (the write-guard should have blocked it, but the monitor is the backstop). Set to ~70% of each
// universe's ACTUAL constituent count, NOT the nominal index size: the intl universes (ftse100,
// nikkei, stoxx600, kospi…) hold curated/mapped SUBSETS (40, 40, 195, 36 names — verified against
// data/constituents/*.json), so a floor at the index's nominal size would false-positive every night.
// Only a catastrophic collapse or an empty file trips. Unlisted → 10.
const SNAPSHOT_FLOORS: Record<string, number> = {
  sp500: 400, nasdaq100: 85, russell1000: 700, russell3000: 1800, sp1500: 1000,
  nikkei: 28, topix: 70, stoxx600: 135, asx200: 70, kospi: 25, hsi: 35,
  ftse100: 28, dax: 25, cac40: 30, aex: 18, smi: 22, tsx: 30, ipc: 20,
};
const SNAPSHOT_FLOOR_DEFAULT = 10;
const SNAPSHOT_MAX_AGE = 36; // at the post-FULL-run check these are minutes old; 36h catches a dead pipeline

function getPath(obj: any, dot: string): unknown {
  return dot.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function countOf(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return null;
}

/** The registry entry for a feed file (e.g. "buybacks.json"), or undefined if unregistered.
 *  Exported so the WRITE guard (lib/feedGuard) enforces the very same countPath/minCount this
 *  monitor reports on — one declaration, no second copy to drift. */
export function feedSpec(file: string): FeedSpec | undefined {
  return FEEDS.find((f) => f.file === file);
}

/** Count a feed payload's rows the way the monitor does (registry countPath → array length /
 *  object key count). Null when the feed declares no countPath (uncountable → age-only). */
export function feedCount(spec: FeedSpec | undefined, data: unknown): number | null {
  if (!spec?.countPath) return null;
  return countOf(getPath(data, spec.countPath));
}
function stampFrom(obj: any, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string") { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
  }
  return null;
}

async function checkFeed(spec: FeedSpec, now: number): Promise<FreshResult> {
  const base: Omit<FreshResult, "status" | "ageHours" | "count" | "detail"> = {
    file: spec.file, label: spec.label, tier: spec.tier, maxAgeHours: spec.maxAgeHours, minCount: spec.minCount ?? null,
    ...(spec.origin ? { origin: spec.origin } : {}),
  };
  const full = path.join(DATA, spec.file);
  let raw: string;
  try {
    raw = await fs.readFile(full, "utf8");
  } catch {
    return { ...base, status: "missing", ageHours: null, count: null, detail: "file does not exist" };
  }
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ...base, status: "unreadable", ageHours: null, count: null, detail: "invalid JSON (possible partial write)" };
  }

  let stampMs = stampFrom(json, spec.stampKeys ?? STAMP_KEYS);
  if (stampMs == null && spec.mtimeFallback) {
    try { stampMs = (await fs.stat(full)).mtimeMs; } catch { /* keep null */ }
  }
  const ageHours = stampMs == null ? null : +((now - stampMs) / H).toFixed(1);
  const count = spec.countPath ? countOf(getPath(json, spec.countPath)) : null;

  if (spec.minCount != null && count != null && count < spec.minCount) {
    return { ...base, status: "empty", ageHours, count, detail: `only ${count} rows (floor ${spec.minCount}) — feed produced ~nothing` };
  }
  if (ageHours == null) {
    return { ...base, status: "unreadable", ageHours, count, detail: "no readable timestamp" };
  }
  if (ageHours > spec.maxAgeHours) {
    return { ...base, status: "stale", ageHours, count, detail: `${ageHours}h old (max ${spec.maxAgeHours}h) — feed likely dead` };
  }
  return { ...base, status: "ok", ageHours, count, detail: `${ageHours}h old${count != null ? `, ${count} rows` : ""}` };
}

async function checkSnapshots(now: number): Promise<FreshResult[]> {
  let dirs: string[];
  try {
    dirs = (await fs.readdir(DATA, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: FreshResult[] = [];
  for (const uni of dirs.sort()) {
    const file = `${uni}/snapshot.json`; // forward slash for a stable cross-platform identity
    const full = path.join(DATA, uni, "snapshot.json");
    let json: any;
    try {
      json = JSON.parse(await fs.readFile(full, "utf8"));
    } catch {
      continue; // not a universe dir (constituents/, series/) — skip silently
    }
    const floor = SNAPSHOT_FLOORS[uni] ?? SNAPSHOT_FLOOR_DEFAULT;
    const count = Array.isArray(json?.stocks) ? json.stocks.length : null;
    const stampMs = stampFrom(json, STAMP_KEYS);
    const ageHours = stampMs == null ? null : +((now - stampMs) / H).toFixed(1);
    const base = { file, label: `Snapshot: ${uni}`, tier: "snapshot" as Tier, maxAgeHours: SNAPSHOT_MAX_AGE, minCount: floor };
    if (count == null) out.push({ ...base, status: "unreadable", ageHours, count, detail: "no stocks[] array" });
    else if (count < floor) out.push({ ...base, status: "empty", ageHours, count, detail: `only ${count} stocks (floor ${floor}) — partial fetch / degraded` });
    else if (ageHours == null) out.push({ ...base, status: "unreadable", ageHours, count, detail: "no readable timestamp" });
    else if (ageHours > SNAPSHOT_MAX_AGE) out.push({ ...base, status: "stale", ageHours, count, detail: `${ageHours}h old (max ${SNAPSHOT_MAX_AGE}h)` });
    else out.push({ ...base, status: "ok", ageHours, count, detail: `${ageHours}h old, ${count} stocks` });
  }
  return out;
}

export const FAILING: readonly FreshStatus[] = ["stale", "missing", "empty", "unreadable"];

/** Result of pinging an upstream (currently only data.sec.gov) FROM THE HOST RUNNING THE CHECK.
 *  ⚠ vantage-specific: a probe from Vercel says nothing about whether the NAS can reach SEC. The
 *  authoritative one is the check-freshness run inside the NAS tick. */
export interface SecProbe {
  reachable: boolean;
  status: number | null;
  ms: number | null;
  detail: string;
}

export interface FreshReport {
  checkedAt: string;
  ok: boolean;
  failing: number;
  results: FreshResult[];
  /** Present only when ≥1 SEC-sourced feed is failing — the reason to bother probing. */
  secProbe?: SecProbe;
  /** One-line verdict correlating the SEC failures with the probe. "" when no SEC feed is failing. */
  secDiagnosis?: string;
}

// A single tiny SEC request proves reachability from this host. AAPL companyfacts is the canonical
// endpoint (what a human would curl); a Range header caps the body so we pay for the round-trip, not
// the 4 MB. ⚠ SEC 403s any request without a descriptive contact in the UA — using the SAME UA the
// feeds send (mirrors lib/edgar's HEADERS) means the probe reflects exactly what they'd experience,
// so a 403 here is a real signal, not a self-inflicted format rejection. `Connection: close` keeps
// undici from pooling a keep-alive socket that would hold the CLI process open after the check.
const SEC_PROBE_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"; // AAPL
const SEC_PROBE_UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const SEC_PROBE_TIMEOUT_MS = 8000;

/** Ping data.sec.gov and report whether THIS host can reach it, with latency. Never throws. */
export async function probeSec(): Promise<SecProbe> {
  const t0 = Date.now();
  try {
    const res = await fetch(SEC_PROBE_URL, {
      headers: { "User-Agent": SEC_PROBE_UA, Range: "bytes=0-99", "Accept-Encoding": "identity", Connection: "close" },
      signal: AbortSignal.timeout(SEC_PROBE_TIMEOUT_MS),
    });
    const ms = Date.now() - t0;
    try { await res.body?.cancel(); } catch { /* don't download the payload */ }
    const reachable = res.status === 200 || res.status === 206; // 206 = the Range was honored
    return {
      reachable, status: res.status, ms,
      detail: reachable
        ? `data.sec.gov responded ${res.status} in ${ms}ms`
        : `data.sec.gov returned ${res.status} in ${ms}ms — likely throttled/blocking this host`,
    };
  } catch (e: any) {
    const ms = Date.now() - t0;
    const why = e?.name === "TimeoutError" ? `timed out (>${SEC_PROBE_TIMEOUT_MS / 1000}s)` : String(e?.message || e).slice(0, 80);
    return { reachable: false, status: null, ms, detail: `data.sec.gov unreachable — ${why}` };
  }
}

/** PURE: the one-line verdict that tells environmental (SEC down) from feed-logic (SEC up, feed still
 *  broken). Empty string when no SEC-sourced feed is failing — nothing to diagnose. */
export function secDiagnosis(results: FreshResult[], probe: SecProbe | null): string {
  const bad = results.filter((r) => r.origin === "sec" && FAILING.includes(r.status));
  if (!bad.length) return "";
  const names = bad.map((r) => r.file.replace(/\.json$/, "")).join(", ");
  if (!probe) return `${bad.length} SEC-sourced feed(s) failing (${names}); SEC reachability not probed.`;
  return probe.reachable
    ? `${bad.length} SEC-sourced feed(s) failing (${names}) BUT ${probe.detail} — SEC is UP from this host, so look at the FEED LOGIC, not the network.`
    : `${bad.length} SEC-sourced feed(s) failing (${names}) AND ${probe.detail} — ENVIRONMENTAL: this host can't reach SEC, not a feed-logic bug.`;
}

/** Read every registered feed + every universe snapshot and classify freshness. `ok` is false when
 *  any result is STALE / MISSING / EMPTY / UNREADABLE.
 *  When ≥1 SEC-sourced feed is failing, ping data.sec.gov to tell "the host can't reach SEC"
 *  (environmental) apart from "the feed logic broke" — set `probe:false` to skip the network call. */
export async function checkFreshness(nowMs?: number, opts?: { probe?: boolean }): Promise<FreshReport> {
  const now = nowMs ?? Date.now();
  const [feeds, snaps] = await Promise.all([
    Promise.all(FEEDS.map((f) => checkFeed(f, now))),
    checkSnapshots(now),
  ]);
  // snapshots first (highest-value backbone), then feeds; failures sort to the top within each.
  const rank = (s: FreshStatus) => (FAILING.includes(s) ? 0 : 1);
  const results = [...snaps, ...feeds].sort((a, b) => rank(a.status) - rank(b.status));
  const failing = results.filter((r) => FAILING.includes(r.status)).length;

  // Probe SEC only when it could explain something — a SEC feed is actually failing. A healthy run
  // never touches the network; a broken one pays one ≤8s round-trip to disambiguate the cause.
  const secFailing = results.some((r) => r.origin === "sec" && FAILING.includes(r.status));
  const secProbe = secFailing && (opts?.probe ?? true) ? await probeSec() : null;

  return {
    checkedAt: new Date(now).toISOString(), ok: failing === 0, failing, results,
    ...(secProbe ? { secProbe } : {}),
    ...(secFailing ? { secDiagnosis: secDiagnosis(results, secProbe) } : {}),
  };
}
