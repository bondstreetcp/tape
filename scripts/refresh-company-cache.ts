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

async function main() {
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

  // Due = missing OR older than STALE_DAYS, sorted OLDEST-FIRST (never-cached = ∞ age) so a
  // budget-bound run drains the whole universe over successive nights instead of re-baking the same
  // front cohort forever (fair round-robin, no tail starvation).
  const all = [...symbols];
  const dueAged: { sym: string; age: number }[] = [];
  let fresh = 0;
  for (const sym of all) {
    const c = await readCompanyCache(sym);
    if (c && ageDays(c.fetchedAt) < STALE_DAYS) fresh++;
    else dueAged.push({ sym, age: c ? ageDays(c.fetchedAt) : Infinity });
  }
  dueAged.sort((a, b) => b.age - a.age);
  const targets = dueAged.slice(0, MAX_PER_RUN).map((x) => x.sym);
  console.log(`company-cache: ${all.length} names (${UNIVERSES.length} universes) · ${fresh} still fresh (<${STALE_DAYS}d) · ${targets.length} due this run, oldest-first (budget ${BUDGET_MIN}m, conc ${CONCURRENCY})`);

  const deadline = Date.now() + BUDGET_MIN * 60_000;
  let built = 0, failed = 0, deferred = 0;
  await pool(targets, CONCURRENCY, async (sym) => {
    if (Date.now() > deadline) { deferred++; return; }
    try {
      const bundle = await fetchCompanyBundle(sym);
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
  console.log(`company-cache: built ${built}, failed ${failed}${deferred ? `, ${deferred} deferred (budget spent)` : ""} · ${cachedCount} names cached total`);

  const index = { generatedAt: new Date().toISOString(), count: cachedCount, universe: "US union", staleDays: STALE_DAYS, builtThisRun: built };
  const w = await writeFeedGuarded("company-cache.json", index);
  if (!w.written) {
    console.error(`company-cache: index WRITE BLOCKED — ${w.reason} (the per-symbol files were still written; only the freshness index is held).`);
    process.exit(1);
  }
  console.log(`company-cache: wrote index [${w.reason}]`);
}

main().catch((e) => { console.error("company-cache:", String(e?.message || e)); process.exit(1); });
