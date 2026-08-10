/**
 * Lobbying × bills × congress-trades join (/lobbying) — pure pieces, exercised by tests.
 *
 * Three code-verified legs, no model judgement anywhere:
 *   • LDA filings (lda.gov, keyed) name a CLIENT and free-text lobbying activity descriptions in
 *     which bill numbers are dense ("the NO FAKES Act (S. 1367)") — extractBills() lifts them with
 *     a regex hardened against "U.S. 123"-style traps.
 *   • Client names resolve to tickers through lib/newsTape's conservative name index (SEC
 *     company_tickers.json; ambiguity is a refusal) after stripping the "X ON BEHALF OF Y"
 *     intermediary wrappers law firms file under.
 *   • Spend is reported as TWO columns, never summed: an in-house registrant reports EXPENSES
 *     (often inclusive of outside firms), a hired firm reports INCOME — adding them double-counts.
 */
import { buildNameIndex, normName, type NameIndex, type Registrant } from "./newsTape";

/* ---------- bill extraction ---------- */

export interface BillId {
  /** Canonical key, e.g. "hr3152" — {type}{number}, used everywhere bills join. */
  id: string;
  /** GovInfo BILLSTATUS type: hr | s | hjres | sjres | hconres | sconres | hres | sres */
  type: string;
  number: number;
  /** Display label, e.g. "H.R. 3152" */
  label: string;
}

const TYPE_BY_KEY: Record<string, string> = {
  HR: "hr", S: "s",
  HJRES: "hjres", SJRES: "sjres",
  HCONRES: "hconres", SCONRES: "sconres",
  HRES: "hres", SRES: "sres",
};

const LABELS: Record<string, string> = {
  hr: "H.R.", s: "S.", hjres: "H.J. Res.", sjres: "S.J. Res.",
  hconres: "H. Con. Res.", sconres: "S. Con. Res.", hres: "H. Res.", sres: "S. Res.",
};

// Longest alternatives first so "H. Con. Res. 14" doesn't half-match as an hres. The lookbehind
// blocks "U.S. 123" (the "S." inside "U.S." would otherwise pass the \b test — a period ends a
// word); "IRS. 123" is already blocked by \b itself (R→S is no boundary).
const BILL_RE =
  /(?<![A-Za-z]\.)\b(H\.?\s*(?:CON\.?\s*RES|J\.?\s*RES|RES|R)\.?|S\.?\s*(?:CON\.?\s*RES|J\.?\s*RES|RES)\.?|S\.)\s*(\d{1,5})\b/gi;

export function extractBills(text: string): BillId[] {
  const seen = new Map<string, BillId>();
  for (const m of (text || "").matchAll(BILL_RE)) {
    const key = m[1].toUpperCase().replace(/[.\s]/g, "");
    const type = TYPE_BY_KEY[key];
    const number = Number(m[2]);
    if (!type || !number) continue;
    const id = `${type}${number}`;
    if (!seen.has(id)) seen.set(id, { id, type, number, label: `${LABELS[type]} ${number}` });
  }
  return [...seen.values()];
}

/* ---------- client-name → ticker resolution ---------- */

/** Law firms file as "COVINGTON & BURLING ON BEHALF OF APPLE INC." / "CORNERSTONE OBO GOOGLE LLC";
 *  the principal is the part AFTER the wrapper. */
export function unwrapClientName(name: string): string {
  const m = (name || "").match(/\b(?:ON\s+BEHALF\s+OF|OBO|O\/B\/O)\b[:\s]*(.+)$/i);
  return (m ? m[1] : name || "").trim();
}

/** Hand-verified aliases for heavy lobbyists whose disclosed names can't meet the SEC-title rules
 *  (Google lobbies as GOOGLE LLC while EDGAR knows only Alphabet). Keys are normName() output. */
const CURATED_ALIASES: Record<string, string> = {
  "google": "GOOGL",
  "google client services": "GOOGL",
  "amazon web services": "AMZN",
  "amazoncom services": "AMZN",
};

/** Non-corporate entity words: a client whose name contains one is a municipality, trade group,
 *  union, school or regulator wearing corporate-sounding tokens — it may only resolve by EXACT
 *  name match, never by leading-core. (Second live audit: the SOUTHWEST AIRLINES PILOTS'
 *  ASSOCIATION landed on LUV, FINRA on a bank, Tidewater Community College on TDW.) */
const ENTITY_VETO =
  /\b(association|assn|alliance|coalition|union|guild|university|universities|college|school|schools|academy|institute|hospital|county|city|town|village|authority|district|cooperative|co-?op|board|society|federation|council|chamber|foundation|committee|ministry|government|tribe|tribal|nation|conference|church|churches|museum|library|port|airport|finra|commonwealth|state of)\b/i;

/** How many DISTINCT SEC company names begin with each first token — the distinctiveness test.
 *  "constellium" leads exactly one name; "southern" leads many (Southern Co / Southern Copper /
 *  Southern First…), so a bare "southern" core can never claim anything. */
export function buildLeadCounts(registrants: Registrant[]): Map<string, number> {
  const namesSeen = new Set<string>();
  const counts = new Map<string, number>();
  for (const r of registrants) {
    const core = normName(r.title);
    if (!core || namesSeen.has(core)) continue;
    namesSeen.add(core);
    const first = core.split(" ")[0];
    counts.set(first, (counts.get(first) || 0) + 1);
  }
  return counts;
}

/**
 * Strict resolution — the news-tape PREFIX pass is deliberately NOT used here, and after TWO live
 * audits the leading-core rule carries three guards. Audit 1 (8/21 fabrications): "CITY OF TERRE
 * HAUTE" → City Holding Co — fixed by requiring the COMPLETE SEC name-core as leading tokens.
 * Audit 2 (at scale): suffix-stripping makes "Southern Co" a bare "southern" that claimed shrimp
 * alliances and universities into the board's top 5. Rules now: (1) curated alias; (2) exact
 * normName match; (3) leading-core match ONLY IF the client has no non-corporate entity word
 * (ENTITY_VETO), AND the core is ≥2 tokens or a ≥6-char token that leads EXACTLY ONE SEC name
 * (leadCounts). Everything else refuses — a missing row is honest, a wrong one is a fabrication.
 */
export function resolveClient(name: string, index: NameIndex, leadCounts?: Map<string, number>): string | null {
  const unwrapped = unwrapClientName(name);
  const core = normName(unwrapped);
  if (!core) return null;
  const alias = CURATED_ALIASES[core];
  if (alias) return alias;
  const exact = index.exact.get(core);
  if (exact) return exact;
  if (ENTITY_VETO.test(unwrapped)) return null;
  const tokens = core.split(" ");
  for (let n = Math.min(4, tokens.length - 1); n >= 2; n--) {
    const lead = tokens.slice(0, n).join(" ");
    const hit = index.exact.get(lead) || CURATED_ALIASES[lead];
    if (hit) return hit;
  }
  const first = tokens[0];
  const hit1 = index.exact.get(first) || CURATED_ALIASES[first];
  if (hit1 && first.length >= 6 && (leadCounts ? (leadCounts.get(first) || 0) === 1 : false)) return hit1;
  return null;
}

export { buildNameIndex };

/* ---------- aggregation types (data/lobbying.json) ---------- */

export interface LobbyBillRef {
  id: string; // "hr3152"
  label: string;
  mentions: number; // filings mentioning it for this ticker
}

export interface LobbyRow {
  ticker: string;
  name: string | null;
  clients: string[]; // distinct disclosed client-name variants that resolved here
  filings: number;
  /** Sum of hired-firm INCOME across filings ($). */
  spendHired: number;
  /** Sum of in-house registrant EXPENSES ($) — often inclusive of outside firms; never add the two. */
  spendInHouse: number;
  bills: LobbyBillRef[];
  /** True distinct-bill count — bills[] is display-capped, so "+N more" must not lie. */
  billCount: number;
  /** Congress-trades join (from data/congress.json tallies; null when the ticker isn't traded). */
  trades: { buys: number; sells: number; members: number; notional: number } | null;
}

export interface ContestedBill {
  id: string;
  label: string;
  title: string | null;
  latestActionDate: string | null; // bare calendar date
  latestAction: string | null;
  policyArea: string | null;
  tickers: string[]; // who lobbies it (resolved only; display-capped)
  /** True distinct-ticker count — tickers[] is capped at 20, so "+N" must not lie. */
  tickerCount: number;
}

export interface LobbyingFile {
  generatedAt: string;
  congress: number;
  /** Posted-date coverage of the accumulated store. */
  postedFrom: string;
  postedTo: string;
  filingsSeen: number;
  filingsResolved: number;
  clientsUnresolved: number;
  /** Store rows the CURRENT resolver refuses — fabrications healed out at aggregate time. */
  healedOut: number;
  /** Amendment/refiling duplicates collapsed at aggregate time (latest filing per pair+period wins). */
  amendmentsCollapsed: number;
  /** generatedAt of the congress.json the trades column was joined from (null = unavailable). */
  tradesAsOf: string | null;
  rows: LobbyRow[];
  bills: ContestedBill[];
}
