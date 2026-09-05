/**
 * Nightly build of data/gov-contracts.json — federal contract-award momentum for the government-
 * exposed public companies in the curated roster (lib/govContracts explains the verified-map choice).
 *
 * Two USAspending.gov calls per name (keyless, public domain): quarterly obligations over the last
 * ~3 years (spending_over_time) → momentum; and the top awarding agencies over the trailing window
 * (spending_by_category) → concentration. ~80 calls/run for ~39 names, politely throttled.
 *
 * Run: npm run refresh-gov-contracts. FULL tier. Degrades per-name: a call that fails leaves that
 * row out this run rather than failing the feed.
 */
import { promises as fsp } from "fs";
import path from "path";
import { deadline } from "../lib/deadline";
import { momentumFrom, type GovContractRow, type GovContractsFile, type QuarterPoint } from "../lib/govContracts";
import { sleep } from "../lib/scriptKit";
import { writeFeedOrExit } from "../lib/feedGuard";

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "gov-contracts.json");
const API = "https://api.usaspending.gov/api/v2";
const AWARD_TYPES = ["A", "B", "C", "D"]; // definitive contracts + IDV/BPA/task orders

// ── The roster: {ticker, USAspending recipient search name}. Every entry verified 2026-08-06 to
// return >$1M of awards; a name is added ONLY after that check (see lib/govContracts). Dropped from
// the candidate set: MAXR (went private 2023), CIVI (oil-co name collision), HWM (~zero). ──────────
const ROSTER: { ticker: string; search: string }[] = [
  { ticker: "LMT", search: "Lockheed Martin" }, { ticker: "UNH", search: "UnitedHealth" },
  { ticker: "BA", search: "Boeing" }, { ticker: "NOC", search: "Northrop Grumman" },
  { ticker: "MCK", search: "McKesson" }, { ticker: "GD", search: "General Dynamics" },
  { ticker: "LDOS", search: "Leidos" }, { ticker: "HII", search: "Huntington Ingalls" },
  { ticker: "HON", search: "Honeywell" }, { ticker: "LHX", search: "L3Harris" },
  { ticker: "BAESY", search: "BAE Systems" }, { ticker: "BAH", search: "Booz Allen Hamilton" },
  { ticker: "FLR", search: "Fluor" }, { ticker: "RTX", search: "RTX Corporation" },
  { ticker: "CACI", search: "CACI International" }, { ticker: "SAIC", search: "Science Applications" },
  { ticker: "ACN", search: "Accenture Federal" }, { ticker: "TXT", search: "Textron" },
  { ticker: "PSN", search: "Parsons Corporation" }, { ticker: "COR", search: "Cencora" },
  { ticker: "PLTR", search: "Palantir" }, { ticker: "IBM", search: "International Business Machines" },
  { ticker: "OSK", search: "Oshkosh Corporation" }, { ticker: "ACM", search: "AECOM" },
  { ticker: "AVAV", search: "AeroVironment" }, { ticker: "CAH", search: "Cardinal Health" },
  { ticker: "TDY", search: "Teledyne" }, { ticker: "TDG", search: "TransDigm" },
  { ticker: "MOG-A", search: "Moog" }, { ticker: "CW", search: "Curtiss-Wright" },
  { ticker: "HEI", search: "HEICO" }, { ticker: "WWD", search: "Woodward" },
  { ticker: "AXON", search: "Axon Enterprise" }, { ticker: "ORCL", search: "Oracle America" },
  { ticker: "MRCY", search: "Mercury Systems" }, { ticker: "GE", search: "GE Aerospace" },
  { ticker: "ROP", search: "Roper Technologies" }, { ticker: "RKLB", search: "Rocket Lab" },
  { ticker: "KTOS", search: "Kratos Defense" },
];

async function post(endpoint: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" },
    body: JSON.stringify(body),
    signal: deadline(25_000),
  });
  if (!res.ok) throw new Error(`usaspending ${endpoint} HTTP ${res.status}`);
  return res.json();
}

async function quarters(search: string): Promise<QuarterPoint[]> {
  const start = new Date(Date.now() - 3.2 * 365 * 86_400_000).toISOString().slice(0, 10);
  const j = await post("search/spending_over_time/", {
    group: "quarter",
    filters: { award_type_codes: AWARD_TYPES, time_period: [{ start_date: start, end_date: new Date().toISOString().slice(0, 10) }], recipient_search_text: [search] },
  });
  return (j.results || [])
    .map((r: any) => ({ fiscal_year: +r.time_period.fiscal_year, quarter: +r.time_period.quarter, amount: +r.aggregated_amount || 0 }))
    .filter((p: QuarterPoint) => Number.isFinite(p.fiscal_year) && Number.isFinite(p.quarter));
}

async function agencies(search: string): Promise<{ name: string; amount: number }[]> {
  const start = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const j = await post("search/spending_by_category/awarding_agency/", {
    filters: { award_type_codes: AWARD_TYPES, time_period: [{ start_date: start, end_date: new Date().toISOString().slice(0, 10) }], recipient_search_text: [search] },
    limit: 3,
  });
  return (j.results || []).map((r: any) => ({ name: String(r.name || "").replace(/^Department of /, "Dept. of "), amount: Math.round(+r.amount || 0) })).filter((a: any) => a.amount > 0);
}

async function main() {
  console.log(`refresh-gov-contracts: ${ROSTER.length} roster names…`);
  const rows: GovContractRow[] = [];
  for (const { ticker, search } of ROSTER) {
    try {
      const qs = await quarters(search);
      await sleep(300);
      if (qs.length < 4) { console.log(`  ${ticker}: ${qs.length} quarters — skipped`); continue; }
      const m = momentumFrom(qs, Date.now());
      const ag = await agencies(search).catch(() => []);
      await sleep(300);
      rows.push({ ticker, name: search, ...m, topAgencies: ag });
    } catch (e: any) {
      console.warn(`  ${ticker}: ${String(e?.message || e).slice(0, 70)} — left out this run`);
    }
  }
  rows.sort((a, b) => b.ttmObligated - a.ttmObligated);
  const out: GovContractsFile = { generatedAt: new Date().toISOString(), rows, rosterSize: ROSTER.length };
  await writeFeedOrExit("gov-contracts.json", out);
  const risers = rows.filter((r) => r.yoyPct != null && r.yoyPct >= 15).length;
  console.log(`gov-contracts: wrote ${rows.length}/${ROSTER.length} rows, ${risers} with YoY obligations up ≥15%.`);
}

main().catch((e) => { console.error("refresh-gov-contracts:", String(e?.message || e)); process.exit(1); });
