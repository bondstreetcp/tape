/**
 * Build data/superinvestors.json — the curated roster's latest Form 13F-HR holdings, with
 * quarter-over-quarter deltas and a cross-investor "most owned" tally. Also maintains
 * data/cusip-map.json, an accreting CUSIP→ticker cache (filled from OpenFIGI, which is free
 * and needs no key; set OPENFIGI_API_KEY to raise the rate limit).
 *
 *   npm run refresh-13f
 *
 * 13F data only changes once a quarter (filed ~45 days after quarter-end), so most nightly
 * runs are no-ops past the first of each quarter; the CUSIP cache means we only ever map a
 * given security once.
 */
import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { INVESTORS, type Holding, type InvestorPortfolio, type MostOwned, type SuperInvestorsData } from "../lib/superinvestors";

const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };
const DATA = path.join(process.cwd(), "data");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const numf = (s: string) => { const n = parseFloat(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

async function getJson(u: string): Promise<any> { const r = await fetch(u, { headers: HEADERS }); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.json(); }
async function getText(u: string): Promise<string> { const r = await fetch(u, { headers: HEADERS }); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.text(); }

interface RawHolding { name: string; cusip: string; cls: string; value: number; shares: number }
interface Filing13F { acc: string; filedAt: string; period: string }

// ---- EDGAR: list a filer's 13F-HR filings, newest period first --------------------------
async function list13F(cik: string): Promise<{ name: string; filings: Filing13F[] }> {
  const padded = cik.padStart(10, "0");
  const s = await getJson(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const r = s.filings?.recent || {};
  const byPeriod = new Map<string, Filing13F>();
  for (let i = 0; i < (r.form?.length || 0); i++) {
    if (r.form[i] !== "13F-HR" && r.form[i] !== "13F-HR/A") continue;
    const period = r.reportDate?.[i] || "";
    if (!period) continue;
    const f: Filing13F = { acc: r.accessionNumber[i], filedAt: r.filingDate[i], period };
    const prev = byPeriod.get(period);
    // keep the latest-filed for each period (an amendment supersedes the original)
    if (!prev || f.filedAt > prev.filedAt) byPeriod.set(period, f);
  }
  const filings = [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period));
  return { name: s.name as string, filings };
}

// ---- EDGAR: fetch + parse a filing's information table into aggregated holdings ----------
async function parseHoldings(cik: string, acc: string): Promise<RawHolding[]> {
  const accNo = acc.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}`;
  const idx = await getJson(`${base}/index.json`);
  const xmls: any[] = (idx?.directory?.item || []).filter((f: any) => /\.xml$/i.test(f.name) && !/primary_doc/i.test(f.name));
  let info = "";
  for (const f of xmls) {
    const t = await getText(`${base}/${f.name}`);
    if (/informationTable|<\s*[\w:]*infoTable/i.test(t)) { info = t; break; }
  }
  if (!info) return [];
  // Strip namespace prefixes (<ns1:infoTable> → <infoTable>) so selectors match any filer.
  info = info.replace(/<(\/?)(?:[A-Za-z][\w-]*:)?(\w+)/g, "<$1$2");
  const $ = cheerio.load(info, { xmlMode: true });
  const agg = new Map<string, RawHolding>();
  $("infoTable").each((_, el) => {
    const $e = $(el);
    const putCall = $e.find("putCall").first().text().trim();
    if (putCall) return; // skip option positions — keep the actual share book
    const cusip = $e.find("cusip").first().text().trim().toUpperCase();
    if (!cusip) return;
    const value = numf($e.find("value").first().text());
    const shares = numf($e.find("shrsOrPrnAmt sshPrnamt").first().text());
    const cur = agg.get(cusip);
    if (cur) { cur.value += value; cur.shares += shares; }
    else agg.set(cusip, { cusip, name: $e.find("nameOfIssuer").first().text().trim(), cls: $e.find("titleOfClass").first().text().trim(), value, shares });
  });
  // Pre-2023 13Fs report value in $thousands; 2023+ in whole dollars. Detect from the
  // typical value/shares (≈ share price): if it's implausibly small, scale by 1000.
  const ratios = [...agg.values()].filter((h) => h.shares > 0).map((h) => h.value / h.shares).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)] || 0;
  const unit = med > 0 && med < 2 ? 1000 : 1;
  if (unit !== 1) for (const h of agg.values()) h.value *= unit;
  return [...agg.values()];
}

// ---- CUSIP → ticker via OpenFIGI, cached in data/cusip-map.json --------------------------
type CusipMap = Record<string, string>; // "" = looked up, no US ticker
async function loadCusipMap(): Promise<CusipMap> {
  return fs.readFile(path.join(DATA, "cusip-map.json"), "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
}
async function mapCusips(cusips: string[], cache: CusipMap): Promise<void> {
  const todo = [...new Set(cusips)].filter((c) => !(c in cache));
  if (!todo.length) return;
  const key = process.env.OPENFIGI_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["X-OPENFIGI-APIKEY"] = key;
  const batch = key ? 100 : 10; // OpenFIGI: 100 jobs/req with a key, 10 without
  const gap = key ? 300 : 3200; // stay under ~250/min keyed, ~25/min keyless
  console.log(`  mapping ${todo.length} new CUSIPs via OpenFIGI (${key ? "keyed" : "keyless"})…`);
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    let tries = 0;
    for (;;) {
      const res = await fetch("https://api.openfigi.com/v3/mapping", { method: "POST", headers, body: JSON.stringify(chunk.map((c) => ({ idType: "ID_CUSIP", idValue: c }))) });
      if (res.status === 429 && tries++ < 4) { await sleep(20000); continue; }
      if (!res.ok) { console.log(`    OpenFIGI HTTP ${res.status} on batch ${i / batch}; marking unresolved`); chunk.forEach((c) => (cache[c] = cache[c] ?? "")); break; }
      const j: any = await res.json();
      j.forEach((row: any, k: number) => {
        const data: any[] = row?.data || [];
        const pick = data.find((x) => x?.ticker && x?.exchCode === "US") || data.find((x) => x?.ticker && x?.securityType2 === "Common Stock") || data.find((x) => x?.ticker);
        cache[chunk[k]] = pick?.ticker ? String(pick.ticker).replace(/\/.*$/, "").trim() : "";
      });
      break;
    }
    if (i + batch < todo.length) await sleep(gap);
  }
}

// ---- assemble one investor's portfolio ---------------------------------------------------
const STALE_MS = 300 * 24 * 3600 * 1000; // ~10 months — drop managers who stopped filing

function buildPortfolio(inv: (typeof INVESTORS)[number], cur: RawHolding[], curF: Filing13F, prior: RawHolding[] | null, priorF: Filing13F | null, cmap: CusipMap): InvestorPortfolio {
  const priorBy = new Map((prior || []).map((h) => [h.cusip, h]));
  const total = cur.reduce((s, h) => s + h.value, 0) || 1;
  const tk = (c: string) => cmap[c] || null;
  const holdings: Holding[] = cur.map((h) => {
    const p = priorBy.get(h.cusip);
    let change: Holding["change"] = "hold";
    let deltaShares: number | null = null, deltaPct: number | null = null;
    if (!p) change = "new";
    else { deltaShares = h.shares - p.shares; deltaPct = p.shares ? deltaShares / p.shares : null; change = deltaPct != null && deltaPct > 0.05 ? "add" : deltaPct != null && deltaPct < -0.05 ? "trim" : "hold"; }
    return { ticker: tk(h.cusip), name: h.name, cusip: h.cusip, cls: h.cls, value: h.value, shares: h.shares, pct: (h.value / total) * 100, change, deltaShares, deltaPct };
  }).sort((a, b) => b.value - a.value);

  const curCusips = new Set(cur.map((h) => h.cusip));
  const soldOut = (prior || []).filter((h) => !curCusips.has(h.cusip)).sort((a, b) => b.value - a.value).map((h) => ({ ticker: tk(h.cusip), name: h.name, cusip: h.cusip }));
  const newBuys = holdings.filter((h) => h.change === "new").slice(0, 10).map((h) => ({ ticker: h.ticker, name: h.name, value: h.value, pct: h.pct }));
  const topAdds = holdings.filter((h) => h.change === "add" && h.deltaPct != null).sort((a, b) => (b.deltaPct! - a.deltaPct!)).slice(0, 6).map((h) => ({ ticker: h.ticker, name: h.name, deltaPct: h.deltaPct! }));
  const topTrims = holdings.filter((h) => h.change === "trim" && h.deltaPct != null).sort((a, b) => (a.deltaPct! - b.deltaPct!)).slice(0, 6).map((h) => ({ ticker: h.ticker, name: h.name, deltaPct: h.deltaPct! }));

  return { ...inv, asOf: curF.period, filedAt: curF.filedAt, priorAsOf: priorF?.period ?? null, totalValue: total, count: holdings.length, holdings, newBuys, soldOut, topAdds, topTrims };
}

async function main() {
  const cmap = await loadCusipMap();
  const portfolios: InvestorPortfolio[] = [];
  const rawCurrent: { inv: (typeof INVESTORS)[number]; cur: RawHolding[]; f: Filing13F; prior: RawHolding[] | null; pf: Filing13F | null }[] = [];
  const now = Date.now();

  for (const inv of INVESTORS) {
    try {
      const { name, filings } = await list13F(inv.cik);
      if (!filings.length) { console.log(`✗ ${inv.name}: no 13F-HR (EDGAR="${name}")`); continue; }
      const latest = filings[0];
      if (now - Date.parse(latest.period) > STALE_MS) { console.log(`✗ ${inv.name}: stale (latest period ${latest.period}) — skipping`); continue; }
      const cur = await parseHoldings(inv.cik, latest.acc);
      if (!cur.length) { console.log(`✗ ${inv.name}: empty info table`); continue; }
      const priorF = filings[1] || null;
      const prior = priorF ? await parseHoldings(inv.cik, priorF.acc).catch(() => null) : null;
      rawCurrent.push({ inv, cur, f: latest, prior, pf: priorF });
      console.log(`✓ ${inv.name}: ${cur.length} holdings (${latest.period})${prior ? ` vs ${priorF!.period}` : ""}`);
    } catch (e: any) { console.log(`✗ ${inv.name}: ${e.message}`); }
  }

  // map every CUSIP we touched (current + prior) once, then build
  const allCusips = rawCurrent.flatMap((r) => [...r.cur, ...(r.prior || [])].map((h) => h.cusip));
  await mapCusips(allCusips, cmap);
  for (const r of rawCurrent) portfolios.push(buildPortfolio(r.inv, r.cur, r.f, r.prior, r.pf, cmap));

  // cross-investor "most owned"
  const owned = new Map<string, MostOwned>();
  for (const p of portfolios) {
    for (const h of p.holdings) {
      const e = owned.get(h.cusip) || { ticker: h.ticker, name: h.name, cusip: h.cusip, holders: [], holderCount: 0, totalValue: 0 };
      e.holders.push(p.slug); e.holderCount++; e.totalValue += h.value; if (!e.ticker && h.ticker) e.ticker = h.ticker;
      owned.set(h.cusip, e);
    }
  }
  const mostOwned = [...owned.values()].sort((a, b) => b.holderCount - a.holderCount || b.totalValue - a.totalValue).slice(0, 40);

  const out: SuperInvestorsData = { generatedAt: new Date().toISOString(), investors: portfolios, mostOwned };
  await fs.writeFile(path.join(DATA, "superinvestors.json"), JSON.stringify(out));
  await fs.writeFile(path.join(DATA, "cusip-map.json"), JSON.stringify(cmap));
  const resolved = Object.values(cmap).filter(Boolean).length;
  console.log(`\nWrote ${portfolios.length} investors · ${mostOwned.length} most-owned · CUSIP cache ${resolved}/${Object.keys(cmap).length} resolved`);
}
main().catch((e) => { console.error(e); process.exit(1); });
