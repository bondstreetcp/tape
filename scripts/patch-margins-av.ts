/**
 * Backfill deep gross profit / cost of revenue from Alpha Vantage for names where SEC XBRL
 * doesn't cleanly tag a cost-of-revenue total (so the Margins chart gaps even though revenue
 * and operating income are present). AV serves ~20yr of NORMALIZED quarterly income statements.
 *
 * We don't trust AV blindly: for each name we VALIDATE its gross margin against EDGAR on the
 * quarters they share — if they disagree, the name is marked untrusted and never used. The
 * validated series is cached in data/av-margins.json, which getQuarterlyHistory merges in to
 * fill its remaining gaps.
 *
 * Free AV tier is ~25 requests/day (≥1s apart), so this is RESUMABLE: each run processes up to
 * AV_BUDGET new names, spaced out, skipping anything already cached. Re-run until the list is done.
 *
 *   npx tsx scripts/patch-margins-av.ts [SYM ...]      # default: built-in gap list
 *   AV_BUDGET=10 npx tsx scripts/patch-margins-av.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { getEdgarQuarterly } from "../lib/edgarFinancials";

const CACHE = path.join(process.cwd(), "data", "av-margins.json");
const BUDGET = parseInt(process.env.AV_BUDGET || "24", 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Material gross-margin-gap names from the S&P 500 / Russell audits (issuers that DO report
// gross profit in some quarters but whose cost-of-revenue tagging is inconsistent). Financials
// with no COGS at all are excluded — AV can't give them a meaningful gross margin either.
const GAP_NAMES = [
  "ORCL", "T", "VZ", "NOC", "HII", "GD", "SNA", "FDX", "SBUX", "REGN", "TMUS", "SATS", "CHRW", "HAL",
  "GM", "NEM", "EXPE", "AMT", "INTU", "CPRT", "CASY", "HPE", "CTAS", "NI", "SO", "DE", "PCAR", "IQV",
  "MCD", "AJG", "KMI", "WBD", "MSCI", "TXT", "ROL", "NRG", "PEG", "CRL", "BKR", "GPN", "FDS", "SLB",
  "LEN", "DVN", "OTIS", "PNW", "ATO", "PHM", "BALL", "TGT", "EQT", "CCI",
];

interface AvQ { date: string; rev: number | null; gp: number | null; oi: number | null }
interface Cached { trusted: boolean; n: number; q: [string, number | null, number | null, number | null][] }

function loadKey(env: string): string {
  for (const l of env.split("\n")) { const m = l.match(/^ALPHAVANTAGE_API_KEY=(.*)$/); if (m) return m[1].trim(); }
  return "";
}

async function fetchAv(sym: string, key: string): Promise<AvQ[] | "throttled" | null> {
  const r = await fetch(`https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${encodeURIComponent(sym)}&apikey=${key}`);
  const j: any = await r.json().catch(() => ({}));
  if (j.Note || j.Information) return "throttled";
  if (!Array.isArray(j.quarterlyReports)) return null;
  const num = (v: any) => (v == null || v === "None" || v === "" ? null : Number.isFinite(+v) ? +v : null);
  return j.quarterlyReports
    .map((x: any) => ({ date: String(x.fiscalDateEnding), rev: num(x.totalRevenue), gp: num(x.grossProfit), oi: num(x.operatingIncome) }))
    .filter((x: AvQ) => x.date)
    .sort((a: AvQ, b: AvQ) => a.date.localeCompare(b.date));
}

// trust AV for a name only if its gross margin matches EDGAR's on the quarters they share
async function validate(sym: string, av: AvQ[]): Promise<boolean> {
  const edgar = await getEdgarQuarterly(sym).catch(() => [] as any[]);
  const eGm = new Map<string, number>();
  for (const p of edgar) {
    const rev = typeof p.totalRevenue === "number" ? p.totalRevenue : null;
    const gp = typeof p.grossProfit === "number" ? p.grossProfit : null;
    if (rev && rev > 0 && gp != null) eGm.set(p.date.slice(0, 7), gp / rev);
  }
  let total = 0, ok = 0;
  for (const a of av) {
    if (a.rev == null || a.rev <= 0 || a.gp == null) continue;
    const e = eGm.get(a.date.slice(0, 7));
    if (e == null) continue;
    total++;
    if (Math.abs(a.gp / a.rev - e) <= 0.03) ok++; // within 3 percentage points
  }
  return total >= 3 && ok / total >= 0.7;
}

async function main() {
  const key = loadKey(await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => ""));
  if (!key) { console.error("ALPHAVANTAGE_API_KEY not in .env.local"); process.exit(1); }

  const cache: Record<string, Cached> = JSON.parse(await fs.readFile(CACHE, "utf8").catch(() => "{}"));
  const wanted = process.argv.slice(2).length ? process.argv.slice(2).map((s) => s.toUpperCase()) : GAP_NAMES;
  const todo = wanted.filter((s) => !cache[s]);
  console.log(`${wanted.length} gap names, ${Object.keys(cache).length} cached, ${todo.length} remaining. Budget ${BUDGET} this run.`);

  let used = 0, trusted = 0, rejected = 0;
  for (const sym of todo) {
    if (used >= BUDGET) { console.log(`  budget reached — re-run to continue (${todo.length - used} left).`); break; }
    used++;
    const av = await fetchAv(sym, key);
    if (av === "throttled") { console.log(`  ${sym}: throttled — stopping (daily cap). Re-run tomorrow.`); break; }
    if (!av || av.length < 4) { console.log(`  ${sym}: no AV data`); cache[sym] = { trusted: false, n: 0, q: [] }; await sleep(1500); continue; }
    const isTrusted = await validate(sym, av);
    // Only ship the data we actually use (trusted); for rejected names keep just the flag so we
    // don't re-spend an API call on them.
    cache[sym] = { trusted: isTrusted, n: av.length, q: isTrusted ? av.map((x) => [x.date, x.rev, x.gp, x.oi]) : [] };
    if (isTrusted) trusted++; else rejected++;
    console.log(`  ${sym}: ${av.length}q ${av[0].date}→${av[av.length - 1].date} — ${isTrusted ? "TRUSTED ✓" : "rejected (disagrees with EDGAR)"}`);
    await fs.writeFile(CACHE, JSON.stringify(cache)); // write as we go (resumable)
    await sleep(1500); // ≥1 req/sec
  }
  console.log(`\nDone this run: ${used} fetched, ${trusted} trusted, ${rejected} rejected. ${Object.keys(cache).length}/${wanted.length} cached total.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
