/**
 * Nightly build of data/lobbying.json — the legislation↔lobbying↔congress join (/lobbying).
 *
 * Pipeline: pull LDA filings (lda.gov, Authorization: Token LDA_API_KEY, 120 req/min) —
 * incrementally by filing_dt_posted_after, or the whole filing year with SEED=1 (run once from
 * the PC; the store then travels via R2). Resolve each CLIENT to a ticker via the strict resolver
 * (lib/lobbying — two live audits taught it to refuse municipalities, unions and generic
 * suffix-stripped cores); extract bill numbers with the tested regex; accumulate in
 * data/lobbying-store.json. AGGREGATION RE-RESOLVES every stored client with the current resolver,
 * so resolver improvements retroactively heal old fabrications (the debates self-heal lesson), and
 * collapses amendments/refilings to the latest filing per (registrant, client, period) — both
 * disclosure bases stay separate columns, never summed. Bill status is keyless GovInfo BILLSTATUS
 * (7-day cache; only a true 404 is cached as missing — transient outages retry, and a decimated
 * fetch keeps the prior bills table). A missing key or LDA outage SKIPS the write and exits 1:
 * the prior file survives and freshness ages honestly (STALE, never silently green).
 *
 * Run: npm run refresh-lobbying. FULL tier; countPath rows, minCount 50.
 */
import { promises as fsp } from "fs";
import path from "path";
import {
  extractBills, resolveClient, buildNameIndex, buildLeadCounts,
  type LobbyRow, type ContestedBill, type LobbyingFile,
} from "../lib/lobbying";
import type { Registrant, NameIndex } from "../lib/newsTape";
import { writeFeedGuarded } from "../lib/feedGuard";
import { getObject, r2Configured } from "../lib/r2";
import { sleep } from "../lib/scriptKit";

const DATA = path.join(process.cwd(), "data");
const STORE = path.join(DATA, "lobbying-store.json");
const OUT = path.join(DATA, "lobbying.json");
const TICKERS_CACHE = path.join(DATA, ".tmp", "company-tickers.json");
const BILLS_CACHE = path.join(DATA, ".tmp", "billstatus-cache.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const YEAR = Number(process.env.LOBBY_YEAR) || 2026;
/** Congress for this filing year: 119th = 2025-26, 120th = 2027-28, … */
const CONGRESS = 119 + Math.floor((YEAR - 2025) / 2);
const PAGE_SIZE = 25; // LDA hard max
const PACE_MS = 550; // 120 req/min quota → ~109/min at this pace
// Nightly budget must clear a QUARTERLY DEADLINE DAY: Apr-20-2026 alone was ~640 pages, and an
// exhausted budget used to livelock the cursor forever (dedupe pages yielded no new maxPosted).
// 1200 pages ≈ 11 min — well inside the 45-min step budget.
const MAX_PAGES = Number(process.env.LOBBY_MAX_PAGES) || (process.env.SEED ? 4000 : 1200);
const BILL_TTL_MS = 7 * 24 * 3600e3;
const TOP_BILLS = 150;


interface StoreRow {
  uuid: string;
  posted: string; // YYYY-MM-DD
  period: string;
  ticker: string;
  client: string;
  registrant: string;
  income: number;
  expenses: number;
  bills: string[];
}

interface Store {
  year: number;
  cursor: string; // latest dt_posted seen (YYYY-MM-DD); pulls restart one day earlier (uuid dedupe)
  rows: StoreRow[];
  unresolved: number;
  seen: number;
}

async function fetchJSON(url: string, headers: Record<string, string>): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers }).catch(() => null);
    if (res?.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 30;
      console.log(`  429 — waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res?.ok) { await sleep(1500); continue; }
    return res.json().catch(() => null);
  }
  return null;
}

async function loadResolver(): Promise<{ index: NameIndex; leads: Map<string, number> }> {
  let cached: { fetchedAt: number; data: any } | null = null;
  try { cached = JSON.parse(await fsp.readFile(TICKERS_CACHE, "utf8")); } catch { /* cold */ }
  if (!cached || Date.now() - cached.fetchedAt > BILL_TTL_MS) {
    const data = await fetchJSON("https://www.sec.gov/files/company_tickers.json", { "User-Agent": UA });
    if (data) {
      cached = { fetchedAt: Date.now(), data };
      await fsp.mkdir(path.dirname(TICKERS_CACHE), { recursive: true });
      await fsp.writeFile(TICKERS_CACHE, JSON.stringify(cached));
    }
  }
  if (!cached) throw new Error("SEC company_tickers.json unavailable and no cache");
  const regs: Registrant[] = Object.values(cached.data).map((r: any) => ({
    cik: String(r.cik_str), ticker: r.ticker, title: r.title,
  }));
  return { index: buildNameIndex(regs), leads: buildLeadCounts(regs) };
}

/** Pull filings into the store. Returns false when NOTHING could be pulled (missing key / hard
 *  outage) so the caller can refuse to stamp a fresh file over a dead night. */
async function pullFilings(store: Store, index: NameIndex, leads: Map<string, number>): Promise<boolean> {
  const key = process.env.LDA_API_KEY;
  // Fail-soft on a missing key: the LDA filings list is publicly readable, so pull ANONYMOUSLY rather
  // than going dark. Anonymous is rate-limited harder (fetchJSON already backs off on 429) and the
  // cursor checkpoints every page, so a large catch-up just spans a couple of runs. A genuinely dead
  // pull still returns false below (sawAnyPage stays false) → the prior file is kept, never faked.
  if (!key) console.warn("lobbying: LDA_API_KEY not set — pulling ANONYMOUSLY (lower rate limit; set the key to restore full-rate pulls)");
  const headers: Record<string, string> = key
    ? { Authorization: `Token ${key}`, "User-Agent": UA }
    : { "User-Agent": UA };
  const have = new Set(store.rows.map((r) => r.uuid));
  // One-day overlap: the API doesn't document whether dt_posted_after is > or >= — re-pulling the
  // cursor day costs pages the uuid set absorbs. (UTC date math on a bare date is TZ-stable.)
  const dayBefore = (d: string) => new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10);
  const after = process.env.SEED ? "" : dayBefore(store.cursor);
  let page = 1;
  let newRows = 0;
  let sawAnyPage = false;
  let maxPosted = store.cursor;
  for (; page <= MAX_PAGES; page++) {
    const url =
      `https://lda.gov/api/v1/filings/?filing_year=${YEAR}&page_size=${PAGE_SIZE}&page=${page}&ordering=dt_posted` +
      (after ? `&filing_dt_posted_after=${after}` : "");
    const data = await fetchJSON(url, headers);
    if (!data?.results) break;
    sawAnyPage = true;
    for (const f of data.results) {
      store.seen++;
      const uuid = f.filing_uuid;
      const posted = String(f.dt_posted || "").slice(0, 10);
      // Cursor advances on EVERY filing seen, new or duplicate — a dedupe-only page must still
      // move the cursor or a deadline-day dump wedges the incremental pull permanently.
      if (posted > maxPosted) maxPosted = posted;
      if (!uuid || have.has(uuid)) continue;
      const clientName = f.client?.name || "";
      const ticker = resolveClient(clientName, index, leads);
      if (!ticker) { store.unresolved++; continue; }
      const billIds = new Set<string>();
      for (const act of f.lobbying_activities || []) {
        for (const b of extractBills(act?.description || "")) billIds.add(b.id);
      }
      store.rows.push({
        uuid,
        posted,
        period: f.filing_period || "",
        ticker,
        client: clientName,
        registrant: f.registrant?.name || "",
        income: Number(f.income) || 0,
        expenses: Number(f.expenses) || 0,
        bills: [...billIds],
      });
      have.add(uuid);
      newRows++;
    }
    if (!data.next) { page++; break; }
    if (page === MAX_PAGES) console.warn(`lobbying: page budget ${MAX_PAGES} exhausted with more pages pending — will resume next run`);
    await sleep(PACE_MS);
    if (page % 100 === 0) {
      // Checkpoint: a long crawl must survive being killed — cursor moves with the walk.
      if (maxPosted > store.cursor) store.cursor = maxPosted;
      await fsp.writeFile(STORE, JSON.stringify(store));
      console.log(`  page ${page} · ${newRows} resolved rows · checkpointed @ ${store.cursor}`);
    }
  }
  if (maxPosted > store.cursor) store.cursor = maxPosted;
  console.log(`lobbying: pulled ${page - 1} pages · +${newRows} resolved rows (store ${store.rows.length}) · cursor ${store.cursor}`);
  return sawAnyPage;
}

/** GovInfo BILLSTATUS — keyless, 7-day cached. Only a true 404 caches as missing; transient
 *  failures return null WITHOUT caching so one outage can't blank the table for a week. */
async function billStatus(id: string, type: string, num: number, cache: Record<string, any>): Promise<any | null> {
  const hit = cache[id];
  if (hit && Date.now() - hit.fetchedAt < BILL_TTL_MS) return hit.missing ? null : hit;
  const url = `https://www.govinfo.gov/bulkdata/BILLSTATUS/${CONGRESS}/${type}/BILLSTATUS-${CONGRESS}${type}${num}.xml`;
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
  if (res?.status === 404) { cache[id] = { fetchedAt: Date.now(), missing: true }; return null; }
  if (!res?.ok) return null; // transient — retry next run, no cache entry
  const xml = await res.text();
  const pick = (re: RegExp) => (xml.match(re)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null;
  // The canonical title is the <title> immediately BEFORE <titles>; the first <title> in document
  // order is an arbitrary alternate. [^<] keeps captures inside one element.
  const entry = {
    fetchedAt: Date.now(),
    title:
      pick(/<title>([^<]*)<\/title>\s*<titles>/) ||
      pick(/<titleType>Display Title<\/titleType>[^]*?<title>([^<]*)<\/title>/) ||
      pick(/<title>([^<]*)<\/title>/),
    latestActionDate: pick(/<latestAction>[^]*?<actionDate>([^<]*)<\/actionDate>/),
    latestAction: pick(/<latestAction>[^]*?<text>([^]*?)<\/text>/),
    policyArea: pick(/<policyArea>\s*<name>([^<]*)<\/name>/),
  };
  cache[id] = entry;
  return entry;
}

async function main() {
  const { index, leads } = await loadResolver();

  let store: Store | null = null;
  try { store = JSON.parse(await fsp.readFile(STORE, "utf8")); } catch { /* fall through */ }
  if (store && store.year !== YEAR) {
    console.log(`lobbying: store year ${store.year} ≠ ${YEAR} — starting the new filing year fresh`);
    store = null;
  }
  if (!store) {
    // One-time bootstrap: the year was seeded from the PC and uploaded to its own R2 object; after
    // the first nightly the store rides the normal data.tar.gz channel. If R2 IS configured but
    // the object can't be read, ABORT — restarting from an empty January cursor would slow-crawl
    // for weeks and shrink the board (the accumulator must never silently reset).
    const boot = r2Configured() ? await getObject("site-data/lobbying-store.json").catch(() => null) : null;
    if (boot) {
      store = JSON.parse(boot.toString("utf8")) as Store;
      console.log(`lobbying: bootstrapped store from R2 (${store.rows.length} rows, cursor ${store.cursor})`);
      if (store.year !== YEAR) store = null;
    }
    if (!store) {
      if (r2Configured()) { console.error("lobbying: no local store and no R2 bootstrap — refusing an empty restart"); process.exit(1); }
      store = { year: YEAR, cursor: `${YEAR}-01-01`, rows: [], unresolved: 0, seen: 0 };
    }
  }
  const priorRows = store.rows.length;

  const pulled = await pullFilings(store, index, leads);
  if (!pulled) {
    // A dead pull must NOT stamp a fresh file — the prior lobbying.json survives and freshness
    // ages honestly instead of reading green over a dead feed.
    console.error("lobbying: pull FAILED (missing key or LDA unreachable) — keeping the prior file; exiting 1");
    process.exit(1);
  }
  if (store.rows.length >= priorRows) await fsp.writeFile(STORE, JSON.stringify(store)); // accumulator invariant

  // ── Aggregate: RE-RESOLVE with the current resolver (self-heal) + collapse amendments ──
  let healedOut = 0;
  const live = store.rows.filter((r) => {
    const t = resolveClient(r.client, index, leads);
    if (t !== r.ticker) { healedOut++; return false; } // refused or re-mapped under current rules
    return true;
  });
  // Latest filing per (registrant, client, period) wins — an amendment replaces its original
  // rather than double-counting the quarter's spend and bill mentions.
  const byPair = new Map<string, StoreRow>();
  for (const r of live) {
    const k = `${r.registrant}|${r.client}|${r.period}`;
    const prev = byPair.get(k);
    if (!prev || r.posted > prev.posted || (r.posted === prev.posted && r.uuid > prev.uuid)) byPair.set(k, r);
  }
  const effective = [...byPair.values()];
  const amendmentsCollapsed = live.length - effective.length;

  const byTicker = new Map<string, StoreRow[]>();
  for (const r of effective) {
    const list = byTicker.get(r.ticker) || [];
    list.push(r);
    byTicker.set(r.ticker, list);
  }

  const congress = await fsp.readFile(path.join(DATA, "congress.json"), "utf8").then(JSON.parse).catch(() => null);
  const tradesBy = new Map<string, { buys: number; sells: number; members: Set<string>; notional: number }>();
  for (const t of congress?.trades || []) {
    const agg = tradesBy.get(t.ticker) || { buys: 0, sells: 0, members: new Set<string>(), notional: 0 };
    if (t.type === "buy") agg.buys++;
    else if (t.type === "sell") agg.sells++;
    agg.members.add(t.member);
    agg.notional += ((t.amountLow || 0) + (t.amountHigh || 0)) / 2;
    tradesBy.set(t.ticker, agg);
  }

  const names = new Map<string, string>();
  for (const u of ["russell3000", "sp1500", "nasdaq100"]) {
    try {
      const snap = JSON.parse(await fsp.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      for (const s of snap?.stocks || []) if (s?.symbol && s?.name && !names.has(s.symbol)) names.set(s.symbol, s.name);
    } catch { /* names only */ }
  }

  const rows: LobbyRow[] = [...byTicker.entries()].map(([ticker, list]) => {
    const billCounts = new Map<string, number>();
    for (const r of list) for (const b of r.bills) billCounts.set(b, (billCounts.get(b) || 0) + 1);
    const t = tradesBy.get(ticker);
    return {
      ticker,
      name: names.get(ticker) ?? null,
      clients: [...new Set(list.map((r) => r.client))].slice(0, 8),
      filings: list.length,
      spendHired: list.reduce((a, r) => a + r.income, 0),
      spendInHouse: list.reduce((a, r) => a + r.expenses, 0),
      bills: [...billCounts.entries()]
        .map(([id, mentions]) => ({ id, label: labelOf(id), mentions }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 12),
      billCount: billCounts.size,
      trades: t ? { buys: t.buys, sells: t.sells, members: t.members.size, notional: Math.round(t.notional) } : null,
    };
  }).sort((a, b) => Math.max(b.spendInHouse, b.spendHired) - Math.max(a.spendInHouse, a.spendHired));

  // ── Contested bills, ranked by distinct tickers; a decimated fetch keeps the prior table ──
  const billTickers = new Map<string, Set<string>>();
  for (const r of effective) for (const b of r.bills) {
    const set = billTickers.get(b) || new Set<string>();
    set.add(r.ticker);
    billTickers.set(b, set);
  }
  let cache: Record<string, any> = {};
  try { cache = JSON.parse(await fsp.readFile(BILLS_CACHE, "utf8")); } catch { /* cold */ }
  const top = [...billTickers.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, TOP_BILLS);
  let bills: ContestedBill[] = [];
  for (const [id, tickers] of top) {
    const m = id.match(/^([a-z]+)(\d+)$/);
    if (!m) continue;
    const st = await billStatus(id, m[1], Number(m[2]), cache);
    await sleep(120);
    if (!st?.title) continue; // 404 = mis-cited or prior-congress number — refuse, don't guess
    bills.push({
      id,
      label: labelOf(id),
      title: st.title,
      latestActionDate: st.latestActionDate,
      latestAction: st.latestAction,
      policyArea: st.policyArea,
      tickers: [...tickers].sort().slice(0, 20),
      tickerCount: tickers.size,
    });
  }
  const prior = await fsp.readFile(OUT, "utf8").then((s) => JSON.parse(s) as LobbyingFile).catch(() => null);
  if (bills.length < 30 && (prior?.bills?.length || 0) >= 30) {
    console.warn(`lobbying: bill fetch decimated (${bills.length}) — keeping the prior ${prior!.bills.length}-bill table`);
    bills = prior!.bills;
  }
  await fsp.mkdir(path.dirname(BILLS_CACHE), { recursive: true });
  await fsp.writeFile(BILLS_CACHE, JSON.stringify(cache));

  const payload: LobbyingFile = {
    generatedAt: new Date().toISOString(),
    congress: CONGRESS,
    postedFrom: effective.reduce((a, r) => (r.posted < a ? r.posted : a), store.cursor),
    postedTo: store.cursor,
    filingsSeen: store.seen,
    filingsResolved: effective.length,
    clientsUnresolved: store.unresolved,
    healedOut,
    amendmentsCollapsed,
    tradesAsOf: congress?.generatedAt ?? null,
    rows,
    bills,
  };
  const w = await writeFeedGuarded("lobbying.json", payload);
  if (!w.written) { console.error(`lobbying: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  console.log(
    `lobbying: ${rows.length} tickers · ${bills.length} contested bills · ${effective.length} effective filings ` +
    `(${healedOut} healed out, ${amendmentsCollapsed} amendments collapsed) [${w.reason}]`,
  );
}

function labelOf(id: string): string {
  const m = id.match(/^([a-z]+)(\d+)$/);
  if (!m) return id;
  const L: Record<string, string> = { hr: "H.R.", s: "S.", hjres: "H.J. Res.", sjres: "S.J. Res.", hconres: "H. Con. Res.", sconres: "S. Con. Res.", hres: "H. Res.", sres: "S. Res." };
  return `${L[m[1]] || m[1]} ${m[2]}`;
}

main().catch((e) => { console.error("refresh-lobbying failed:", e); process.exit(1); });
