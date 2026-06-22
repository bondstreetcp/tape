/**
 * Second validated backfill source for the Margins chart — SimFin (free tier, ~2019→now,
 * standardized P&L). Complements the Alpha Vantage backfill: SimFin's normalization agrees
 * with EDGAR on some names AV doesn't, and its API isn't rate-limited the way AV's is, so this
 * runs the whole gap list in one pass. Same guard as AV: SimFin's gross margin must match the
 * EDGAR-filed values within 3pp on ≥3 overlapping quarters before we trust it. Trusted series
 * are cached in data/simfin-margins.json; getQuarterlyHistory fills remaining gaps from it
 * (after AV, which reaches deeper).
 *
 *   npx tsx scripts/patch-margins-simfin.ts [SYM ...]
 */
import { promises as fs } from "fs";
import path from "path";
import { getEdgarQuarterly } from "../lib/edgarFinancials";

const CACHE = path.join(process.cwd(), "data", "simfin-margins.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// same gap list as the AV backfill (issuers that report gross profit in some quarters but tag
// cost of revenue inconsistently); financials with no COGS are excluded.
const GAP_NAMES = [
  "ORCL", "T", "VZ", "NOC", "HII", "GD", "SNA", "FDX", "SBUX", "REGN", "TMUS", "SATS", "CHRW", "HAL",
  "GM", "NEM", "EXPE", "AMT", "INTU", "CPRT", "CASY", "HPE", "CTAS", "NI", "SO", "DE", "PCAR", "IQV",
  "MCD", "AJG", "KMI", "WBD", "MSCI", "TXT", "ROL", "NRG", "PEG", "CRL", "BKR", "GPN", "FDS", "SLB",
  "LEN", "DVN", "OTIS", "PNW", "ATO", "PHM", "BALL", "TGT", "EQT", "CCI",
];

interface Q { date: string; rev: number | null; gp: number | null; oi: number | null }
interface Cached { trusted: boolean; n: number; q: [string, number | null, number | null, number | null][] }

const num = (v: any) => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);

async function fetchSimfin(sym: string, key: string): Promise<Q[] | null> {
  const r = await fetch(`https://backend.simfin.com/api/v3/companies/statements/compact?ticker=${encodeURIComponent(sym)}&statements=PL&period=q1,q2,q3,q4`, { headers: { Authorization: key } });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  const st = j?.[0]?.statements?.find((s: any) => s.statement === "PL");
  if (!st?.columns || !st.data) return null;
  const c: string[] = st.columns;
  const iRev = c.indexOf("Revenue"), iGP = c.indexOf("Gross Profit"), iOI = c.indexOf("Operating Income (Loss)"), iDate = c.indexOf("Report Date");
  if (iRev < 0 || iGP < 0 || iDate < 0) return null;
  return (st.data as any[][])
    .filter((row) => row[iDate])
    .map((row) => ({ date: String(row[iDate]), rev: num(row[iRev]), gp: num(row[iGP]), oi: iOI >= 0 ? num(row[iOI]) : null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function validate(sym: string, sf: Q[]): Promise<boolean> {
  const edgar = await getEdgarQuarterly(sym).catch(() => [] as any[]);
  const eGm = new Map<string, number>();
  for (const p of edgar) {
    const rev = typeof p.totalRevenue === "number" ? p.totalRevenue : null;
    const gp = typeof p.grossProfit === "number" ? p.grossProfit : null;
    if (rev && rev > 0 && gp != null) eGm.set(p.date.slice(0, 7), gp / rev);
  }
  let total = 0, ok = 0;
  for (const s of sf) {
    if (s.rev == null || s.rev <= 0 || s.gp == null) continue;
    const e = eGm.get(s.date.slice(0, 7));
    if (e == null) continue;
    total++;
    if (Math.abs(s.gp / s.rev - e) <= 0.03) ok++;
  }
  return total >= 3 && ok / total >= 0.7;
}

async function main() {
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  const key = (env.match(/^SIMFIN_API_KEY=(.*)$/m) || [])[1]?.trim();
  if (!key) { console.error("SIMFIN_API_KEY not in .env.local"); process.exit(1); }

  const cache: Record<string, Cached> = JSON.parse(await fs.readFile(CACHE, "utf8").catch(() => "{}"));
  const wanted = process.argv.slice(2).length ? process.argv.slice(2).map((s) => s.toUpperCase()) : GAP_NAMES;
  const todo = wanted.filter((s) => !cache[s]);
  console.log(`${wanted.length} gap names, ${todo.length} to fetch from SimFin…`);

  let trusted = 0, rejected = 0;
  for (const sym of todo) {
    const sf = await fetchSimfin(sym, key);
    if (!sf || sf.length < 4) { console.log(`  ${sym}: no SimFin data`); cache[sym] = { trusted: false, n: 0, q: [] }; await sleep(600); continue; }
    const isTrusted = await validate(sym, sf);
    cache[sym] = { trusted: isTrusted, n: sf.length, q: isTrusted ? sf.map((x) => [x.date, x.rev, x.gp, x.oi]) : [] };
    if (isTrusted) trusted++; else rejected++;
    console.log(`  ${sym}: ${sf.length}q ${sf[0].date}→${sf[sf.length - 1].date} — ${isTrusted ? "TRUSTED ✓" : "reject"}`);
    await fs.writeFile(CACHE, JSON.stringify(cache));
    await sleep(700);
  }
  console.log(`\nDone: ${trusted} trusted, ${rejected} rejected. ${Object.keys(cache).length}/${wanted.length} cached.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
