/**
 * Per-stock company cache — the nightly build. For every US name it bakes getCompanyStats (Yahoo) +
 * getFinancials (Yahoo + SEC EDGAR) + getCompanyProfile (Yahoo) into data/company/<SYM>.json, so a
 * stock page reads ONE small local file instead of making three live fetches at request time. This is
 * the fetch-heavy opposite of the compute-over-owned-data jobs: it belongs on the FAST pipe (GitHub
 * Actions) → R2, and the slow NAS origin just reads what R2 ships. On the NAS it still runs, but the
 * budget bounds it and the carry-forward means yesterday's files stand for anything it can't reach.
 *
 * Incremental: a name is re-fetched only when its cache is missing or older than STALE_DAYS, so
 * steady-state only the aged cohort costs anything. A wall-clock budget caps the run; unreached names
 * keep their prior file (degrade to STALE, never EMPTY). The index data/company-cache.json (count of
 * cached files) is the freshness handle — the per-symbol files are the data and are written first, so
 * a blocked index write never loses this run's fetches.
 */
import { promises as fs } from "fs";
import path from "path";
import { fetchCompanyBundle, readCompanyCache, companyCacheDir, companyCacheFile } from "../lib/companyCache";
import { archiveWriter, readCompanyManifest, shouldStandDown, type CompanyManifest } from "../lib/companyArchive";
import { notifyAlert } from "../lib/alertNotify";
import { pool } from "../lib/edgar";
import { writeFeedGuarded } from "../lib/feedGuard";
import { UNIVERSES } from "../lib/universes";
import type { Snapshot } from "../lib/types";

const DATA = path.join(process.cwd(), "data");
const STALE_DAYS = Number(process.env.COMPANY_CACHE_STALE_DAYS || 2);
const BUDGET_MIN = Number(process.env.COMPANY_CACHE_BUDGET_MIN || 30);
const CONCURRENCY = Number(process.env.COMPANY_CACHE_CONCURRENCY || 6);
const MAX_PER_RUN = Number(process.env.COMPANY_CACHE_MAX || 100000); // safety cap on fetches/run

const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;

// Early-warning when the good-IP bake pipe (the "pc" writer) goes dark. Once its R2 stamp is stale
// past this, THIS box's fallback bake can't refresh the cache (its egress gets degraded Yahoo
// payloads), so the per-stock cache silently drifts STALE — that's how it went ~10 days unnoticed in
// 2026-08. Page once/day so a dark box is caught in hours. Stamp lives in lake/.tmp (gitignored, not
// in the data tarball). Best-effort: never throws, never blocks the bake.
const PC_DARK_WARN_H = Number(process.env.COMPANY_CACHE_PC_DARK_WARN_H || 48);
const DARK_STAMP = path.join("lake", ".tmp", "company-cache-dark-alert.json");
async function warnIfPrimaryPipeDark(manifest: CompanyManifest | null, self: string): Promise<void> {
  try {
    if (!manifest?.bakedAt || !manifest.writer || manifest.writer === self) return; // no foreign stamp to judge
    const ageH = (Date.now() - Date.parse(manifest.bakedAt)) / 3_600_000;
    if (!Number.isFinite(ageH) || ageH <= PC_DARK_WARN_H) return;
    const today = new Date().toISOString().slice(0, 10);
    try { if (JSON.parse(await fs.readFile(DARK_STAMP, "utf8")).date === today) return; } catch { /* not alerted today */ }
    await notifyAlert(
      `company-cache: the good-IP bake pipe (writer "${manifest.writer}") has been DARK ${ageH.toFixed(0)}h (>${PC_DARK_WARN_H}h). ` +
        `"${self}" is baking as fallback, but its egress gets degraded Yahoo payloads — the per-stock cache will drift STALE ` +
        `until the "${manifest.writer}" box runs scripts/pc/bake-company.cmd again.`,
      "Tape company-cache pipe dark",
    );
    try { await fs.mkdir(path.dirname(DARK_STAMP), { recursive: true }); await fs.writeFile(DARK_STAMP, JSON.stringify({ date: today, ageH: Math.round(ageH) })); } catch { /* stamp best-effort */ }
  } catch { /* a warning must never break the bake */ }
}

async function main() {
  // ── Standdown: the good-IP pipe owns this feed ──
  // Yahoo serves this NAS's (and GH's datacenter) egress IPs degraded quoteSummary payloads — the
  // 2026-08 null-stats incident baked stats:null for 75% of the tree from here. The Windows box
  // (writer "pc") bakes nightly and stamps R2; while that stamp is fresh, other writers skip. Fail-
  // open: no stamp / stale stamp / any read error → this box bakes as the fallback, and the
  // carry-forward + null-stats-is-due guards below bound the damage to STALE, never null.
  const self = archiveWriter();
  const manifest = await readCompanyManifest();
  const sd = shouldStandDown(manifest, self, Date.now());
  console.log(`company-cache: ${sd.reason}`);
  await warnIfPrimaryPipeDark(manifest, self); // early-warning if the good-IP bake box went dark
  if (sd.skip) return;

  await fs.mkdir(companyCacheDir(), { recursive: true });

  // EVERY universe the stock route serves — US AND international. A name that isn't baked live-fetches
  // Yahoo on every render on the NAS, so the cache must cover the whole set the route admits, not just
  // the US union. (Foreign tickers have Yahoo stats/profile/fundamentals; their SEC arm just no-ops.)
  const symbols = new Set<string>();
  for (const u of UNIVERSES) {
    try {
      const snap = JSON.parse(await fs.readFile(path.join(DATA, u.id, "snapshot.json"), "utf8")) as Snapshot;
      for (const s of snap.stocks ?? []) if (s.symbol) symbols.add(s.symbol);
    } catch { /* missing universe on this box — skip */ }
  }
  if (!symbols.size) { console.error("company-cache: no readable snapshots — keeping the prior cache (degrade to STALE)."); process.exit(1); }

  // Off-index coverage: index membership LAGS a listing by months, so a recent IPO is invisible to
  // every universe snapshot and its stock page has no bake to read (Midera/MFP, listed 2026-06-26,
  // had a dead Earnings tab six weeks later). Add the IPO monitor's tickers + an explicit
  // COMPANY_CACHE_EXTRA=SYM,SYM escape hatch for names every feed missed. Junk tickers cost one
  // failed fetch and write nothing (the hasData guard).
  try {
    const ipo = JSON.parse(await fs.readFile(path.join(DATA, "ipo-monitor.json"), "utf8")) as { events?: { kind?: string; ticker?: string }[] };
    for (const e of ipo.events ?? []) if (e.kind === "ipo" && e.ticker && /^[A-Z0-9.\-]{1,6}$/.test(e.ticker)) symbols.add(e.ticker);
  } catch { /* monitor absent on this box — universes only */ }
  for (const s of (process.env.COMPANY_CACHE_EXTRA ?? "").split(",")) {
    const t = s.trim().toUpperCase();
    if (t && /^[A-Z0-9.\-]{1,6}$/.test(t)) symbols.add(t);
  }

  // Due = missing OR older than STALE_DAYS, sorted OLDEST-FIRST (never-cached = ∞ age) so a
  // budget-bound run drains the whole universe over successive nights instead of re-baking the same
  // front cohort forever (fair round-robin, no tail starvation).
  const all = [...symbols];
  const dueAged: { sym: string; age: number }[] = [];
  let fresh = 0;
  for (const sym of all) {
    const c = await readCompanyCache(sym);
    // A file with NULL stats is a partial-failure bake, not coverage — its fresh fetchedAt must not
    // exempt it for STALE_DAYS (EAT baked stats-null and would have sat estimates-less through its
    // print). Count it due regardless of age. Genuinely dataless names never write a file at all
    // (the hasData guard), so this cohort is only the vendor-blip names and shrinks to zero via the
    // carry-forward below once a name has EVER had stats.
    if (c && ageDays(c.fetchedAt) < STALE_DAYS && c.stats) fresh++;
    else dueAged.push({ sym, age: c && c.stats ? ageDays(c.fetchedAt) : Infinity });
  }
  dueAged.sort((a, b) => b.age - a.age);
  const targets = dueAged.slice(0, MAX_PER_RUN).map((x) => x.sym);
  console.log(`company-cache: ${all.length} names (${UNIVERSES.length} universes) · ${fresh} still fresh (<${STALE_DAYS}d) · ${targets.length} due this run, oldest-first (budget ${BUDGET_MIN}m, conc ${CONCURRENCY})`);

  const deadline = Date.now() + BUDGET_MIN * 60_000;
  let built = 0, failed = 0, deferred = 0, carried = 0;
  await pool(targets, CONCURRENCY, async (sym) => {
    if (Date.now() > deadline) { deferred++; return; }
    try {
      const bundle = await fetchCompanyBundle(sym);
      // Field-level stale-not-empty: a PARTIALLY failed fetch must not null a field the prior bake
      // had. The all-empty guard below only catches total outages — EAT 2026-08 baked with
      // financials present but Yahoo stats/profile nulled in that moment, and since cachedStats
      // deliberately never re-fetches when the file exists, the Earnings tab showed "No estimate or
      // statistics data available" until the next bake. Carry each missing field from the prior file.
      const prior = await readCompanyCache(sym);
      if (prior) {
        if (!bundle.stats && prior.stats) { bundle.stats = prior.stats; carried++; }
        if (!bundle.profile && prior.profile) { bundle.profile = prior.profile; carried++; }
        if (!bundle.financials.annual.length && !bundle.financials.quarterly.length && ((prior.financials?.annual?.length ?? 0) || (prior.financials?.quarterly?.length ?? 0))) { bundle.financials = prior.financials; carried++; }
      }
      // Never persist an EMPTY bundle. If every source came back null (transient vendor outage, or a
      // genuinely dataless ticker) we write nothing: an existing name keeps its prior good file, and a
      // never-cached name stays uncached so the page live-falls-back and recovers on its own. Degrade
      // to STALE per name, never cache emptiness.
      const hasData = bundle.stats || bundle.profile || bundle.financials.annual.length || bundle.financials.quarterly.length;
      if (!hasData) { failed++; return; }
      // Atomic write (tmp + rename) so a run killed mid-write never leaves a truncated <SYM>.json that
      // readdir would count as coverage but readCompanyCache can't parse.
      const f = companyCacheFile(sym);
      const tmp = f + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(bundle));
      await fs.rename(tmp, f);
      built++;
    } catch (e) {
      failed++;
      console.warn(`company-cache: ${sym} — ${String((e as any)?.message || e).slice(0, 100)}`);
    }
  });

  // Cumulative count of cached files on disk (not just this run) — the honest coverage number.
  const cachedCount = (await fs.readdir(companyCacheDir()).catch(() => [])).filter((f) => f.endsWith(".json")).length;
  console.log(`company-cache: built ${built}, failed ${failed}${carried ? `, ${carried} fields carried from prior bakes (partial vendor failures)` : ""}${deferred ? `, ${deferred} deferred (budget spent)` : ""} · ${cachedCount} names cached total`);

  const index = { generatedAt: new Date().toISOString(), count: cachedCount, universe: "US union", staleDays: STALE_DAYS, builtThisRun: built };
  const w = await writeFeedGuarded("company-cache.json", index);
  if (!w.written) {
    console.error(`company-cache: index WRITE BLOCKED — ${w.reason} (the per-symbol files were still written; only the freshness index is held).`);
    process.exit(1);
  }
  console.log(`company-cache: wrote index [${w.reason}]`);
}

main().catch((e) => { console.error("company-cache:", String(e?.message || e)); process.exit(1); });
