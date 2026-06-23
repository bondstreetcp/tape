/**
 * Build data/congress.json — recent congressional stock trades from the U.S. Senate eFD
 * (efdsearch.senate.gov). Public records. Flow: accept the prohibition agreement (stored
 * against the session), page through recent Periodic Transaction Reports, then fetch + parse
 * each e-filed report's transaction table. Polite throttling; House is left for later (PDFs).
 *
 *   npm run refresh-congress
 */
import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { loadSnapshot } from "../lib/data";
import type { CongressTrade, TickerTally, MemberTally, CongressData, TradeType } from "../lib/congress";

const BASE = "https://efdsearch.senate.gov";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const DAY = 864e5;
const WINDOW_DAYS = 300;
const MAX_REPORTS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const jar: Record<string, string> = {};
function setCookies(res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() || []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
}
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const mdy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} 00:00:00`;
const iso = (mdy: string) => { const m = (mdy || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const isTicker = (t: string) => /^[A-Z][A-Z.]{0,6}$/.test(t) && t !== "N/A";

function parseAmount(s: string): [number, number] {
  const nums = (s.match(/[\d,]+/g) || []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n > 0);
  if (/over/i.test(s) && nums.length) return [nums[0], nums[0] * 2];
  if (nums.length >= 2) return [nums[0], nums[1]];
  if (nums.length === 1) return [nums[0], nums[0]];
  return [0, 0];
}
function parseType(s: string): TradeType | null {
  const l = s.toLowerCase();
  if (l.includes("purchase")) return "buy";
  if (l.includes("sale")) return "sell";
  if (l.includes("exchange")) return "exchange";
  return null;
}

// ---- House: annual disclosure ZIP index → e-filed PTR PDFs ----------------------------------
// The House Clerk publishes {YEAR}FD.ZIP (a tab-delimited index of every filing). PTRs are
// FilingType "P"; their transactions live in a PDF. e-filed PTRs have 8-digit DocIDs starting
// with "2" and extract as text; the 7-digit (8…/9…) ones are scans with no text → skipped.
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    try { out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data); } catch { /* skip */ }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// One transaction in the e-filed PTR text: "{asset} ({TICKER}) [{CODE}] {TYPE}{txDate}{notifDate}{amount}".
const HOUSE_TXN = /([A-Za-z0-9 .,&'’\/()\-]{2,70}?)\(([A-Z][A-Z.]{0,6})\)\s*\[([A-Z]{2})\]\s*(P|E|S \(partial\)|S \(full\)|S)\b\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+|\$[\d,]+)/g;

function parseHousePtr(text: string, member: string, filedDate: string): CongressTrade[] {
  const t = (text || "").replace(/\s+/g, " ");
  const out: CongressTrade[] = [];
  let m: RegExpExecArray | null;
  HOUSE_TXN.lastIndex = 0;
  while ((m = HOUSE_TXN.exec(t))) {
    const ticker = m[2].toUpperCase();
    if (!isTicker(ticker) || m[3] === "GS" || m[3] === "OP") continue; // skip treasuries / options
    const type: TradeType = m[4][0] === "P" ? "buy" : m[4][0] === "E" ? "exchange" : "sell";
    const txDate = iso(m[5]);
    const [amountLow, amountHigh] = parseAmount(m[7]);
    if (!txDate || amountLow <= 0) continue;
    // The disclosed asset name extracts noisily from the PDF (owner codes / broker boilerplate
    // bleed in), so keep just the ticker — a clean issuer name is filled from our universe in main().
    const lagDays = filedDate && txDate ? Math.round((Date.parse(filedDate) - Date.parse(txDate)) / DAY) : 0;
    out.push({ member, chamber: "House", ticker, asset: ticker, type, txDate, filedDate, lagDays, amountLow, amountHigh, owner: "" });
  }
  return out;
}

async function fetchHouse(): Promise<CongressTrade[]> {
  const yr = new Date().getFullYear();
  const cutoff = Date.now() - (WINDOW_DAYS + 45) * DAY;
  const cands: { member: string; doc: string; filedDate: string; y: number }[] = [];
  for (const y of [yr, yr - 1]) {
    try {
      const z = await fetch(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${y}FD.ZIP`, { headers: { "User-Agent": UA } });
      if (!z.ok) continue;
      const files = unzip(Buffer.from(await z.arrayBuffer()));
      const idx = (files[`${y}FD.txt`] || Object.values(files).sort((a, b) => b.length - a.length)[0])?.toString("utf8") || "";
      for (const line of idx.split(/\r?\n/).slice(1)) {
        const c = line.split("\t");
        if (c[4] !== "P") continue; // PTR
        const doc = (c[8] || "").trim();
        if (!/^2\d{7}$/.test(doc)) continue; // e-filed only
        const filed = iso(c[7] || "");
        if (!filed || Date.parse(filed) < cutoff) continue;
        cands.push({ member: `${(c[2] || "").trim()} ${(c[1] || "").trim()}`.trim(), doc, filedDate: filed, y });
      }
    } catch (e: any) { console.log(`  House ${y}FD.ZIP: ${e.message}`); }
  }
  cands.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  const top = cands.slice(0, 500);
  console.log(`House: ${top.length} e-filed PTRs in window (of ${cands.length})`);
  const trades = (await pool(top, 4, async (c) => {
    try {
      const r = await fetch(`https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${c.y}/${c.doc}.pdf`, { headers: { "User-Agent": UA } });
      if (!r.ok) return [] as CongressTrade[];
      const data = await pdfParse(Buffer.from(await r.arrayBuffer()));
      return parseHousePtr(data.text || "", c.member, c.filedDate);
    } catch { return [] as CongressTrade[]; }
  })).flat();
  console.log(`House: ${trades.length} stock transactions parsed`);
  return trades;
}

// Clean issuer names keyed by ticker, from our universe snapshots — used to give House trades
// a readable asset name (the PDF-parsed one is unreliable).
async function tickerNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const u of ["russell3000", "sp1500", "nasdaq100"]) {
    const snap = await loadSnapshot(u).catch(() => null);
    for (const s of snap?.stocks || []) if (!map.has(s.symbol)) map.set(s.symbol, s.name);
  }
  return map;
}

async function handshake() {
  let res = await fetch(`${BASE}/search/home/`, { headers: { "User-Agent": UA } });
  setCookies(res);
  const token = (cheerio.load(await res.text())("input[name=csrfmiddlewaretoken]").val() as string) || jar["csrftoken"];
  res = await fetch(`${BASE}/search/home/`, {
    method: "POST", redirect: "manual",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/search/home/`, Cookie: cookie(), "X-CSRFToken": jar["csrftoken"] },
    body: `csrfmiddlewaretoken=${encodeURIComponent(token)}&prohibition_agreement=1`,
  });
  setCookies(res);
  return token;
}

interface ReportRow { member: string; link: string; filedDate: string }

async function searchReports(token: string): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  const startDate = mdy(new Date(Date.now() - WINDOW_DAYS * DAY));
  for (let start = 0; start < 5000; start += 100) {
    const p = new URLSearchParams();
    p.set("draw", "1"); p.set("start", String(start)); p.set("length", "100");
    p.set("report_types", "[11]"); // Periodic Transaction Report
    p.set("submitted_start_date", startDate); p.set("submitted_end_date", "");
    for (const k of ["candidate_state", "senator_state", "office_id", "first_name", "last_name"]) p.set(k, "");
    p.set("csrfmiddlewaretoken", token);
    p.set("order[0][column]", "4"); p.set("order[0][dir]", "desc"); p.set("search[value]", "");
    const res = await fetch(`${BASE}/search/report/data/`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/search/report/`, Cookie: cookie(), "X-CSRFToken": jar["csrftoken"], "X-Requested-With": "XMLHttpRequest" },
      body: p.toString(),
    });
    if (!res.ok) break;
    const j: any = await res.json();
    const rows: any[][] = j.data || [];
    for (const r of rows) {
      const link = String(r[3] || "").match(/href="([^"]+)"/)?.[1] || "";
      if (!/\/ptr\//.test(link)) continue; // e-filed PTRs only (skip scanned paper)
      out.push({ member: `${String(r[0]).trim()} ${String(r[1]).trim()}`.trim(), link, filedDate: iso(String(r[4])) });
    }
    if (start + 100 >= (j.recordsTotal || 0) || out.length >= MAX_REPORTS) break;
    await sleep(250);
  }
  return out.slice(0, MAX_REPORTS);
}

async function parseReport(r: ReportRow): Promise<CongressTrade[]> {
  const res = await fetch(`${BASE}${r.link}`, { headers: { "User-Agent": UA, Cookie: cookie(), Referer: `${BASE}/search/report/` } });
  if (!res.ok) return [];
  const $ = cheerio.load(await res.text());
  const trades: CongressTrade[] = [];
  $("table tbody tr").each((_, tr) => {
    const td = $(tr).find("td").map((_, e) => $(e).text().trim().replace(/\s+/g, " ")).get();
    if (td.length < 8) return;
    const ticker = (td[3] || "").toUpperCase();
    if (!isTicker(ticker)) return; // skip bonds / options / non-tickered assets
    const type = parseType(td[6]);
    if (!type) return;
    const txDate = iso(td[1]);
    if (!txDate) return;
    const [amountLow, amountHigh] = parseAmount(td[7]);
    const lagDays = r.filedDate && txDate ? Math.round((Date.parse(r.filedDate) - Date.parse(txDate)) / DAY) : 0;
    trades.push({ member: r.member, chamber: "Senate", ticker, asset: td[4] || ticker, type, txDate, filedDate: r.filedDate, lagDays, amountLow, amountHigh, owner: td[2] || "" });
  });
  return trades;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const ret = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; ret[k] = await fn(items[k], k); await sleep(250); }
  }));
  return ret;
}

async function main() {
  const token = await handshake();
  const reports = await searchReports(token);
  console.log(`${reports.length} e-filed PTRs in the last ${WINDOW_DAYS}d`);

  const parsed = await pool(reports, 4, (r) => parseReport(r).catch(() => [] as CongressTrade[]));
  const senate = parsed.flat().filter((t) => t.amountLow > 0);
  console.log(`Senate: ${senate.length} stock/ETF transactions`);
  const house = await fetchHouse().catch((e) => { console.log("House failed:", e.message); return [] as CongressTrade[]; });
  if (house.length) { const names = await tickerNames(); for (const t of house) t.asset = names.get(t.ticker) || t.ticker; }
  let trades = [...senate, ...house];
  trades.sort((a, b) => b.txDate.localeCompare(a.txDate));
  console.log(`Total: ${trades.length} (Senate ${senate.length}, House ${house.length})`);

  // aggregates
  const tk = new Map<string, TickerTally & { _members: Set<string>; _not: number }>();
  for (const t of trades) {
    const e = tk.get(t.ticker) || { ticker: t.ticker, asset: t.asset, buys: 0, sells: 0, count: 0, members: 0, notional: 0, _members: new Set<string>(), _not: 0 };
    e.count++; if (t.type === "buy") e.buys++; else if (t.type === "sell") e.sells++;
    e._members.add(t.member); e._not += (t.amountLow + t.amountHigh) / 2;
    tk.set(t.ticker, e);
  }
  const topTickers: TickerTally[] = [...tk.values()].map((e) => ({ ticker: e.ticker, asset: e.asset, buys: e.buys, sells: e.sells, count: e.count, members: e._members.size, notional: Math.round(e._not) })).sort((a, b) => b.count - a.count).slice(0, 40);

  const mb = new Map<string, MemberTally & { _t: Set<string> }>();
  for (const t of trades) {
    const e = mb.get(t.member) || { member: t.member, chamber: t.chamber, trades: 0, buys: 0, sells: 0, tickers: 0, lastTrade: "", _t: new Set<string>() };
    e.trades++; if (t.type === "buy") e.buys++; else if (t.type === "sell") e.sells++;
    e._t.add(t.ticker); if (t.txDate > e.lastTrade) e.lastTrade = t.txDate;
    mb.set(t.member, e);
  }
  const topMembers: MemberTally[] = [...mb.values()].map((e) => ({ member: e.member, chamber: e.chamber, trades: e.trades, buys: e.buys, sells: e.sells, tickers: e._t.size, lastTrade: e.lastTrade })).sort((a, b) => b.trades - a.trades).slice(0, 40);

  // keep the snapshot lean — the most recent ~1500 trades for the table
  trades = trades.slice(0, 1500);
  const out: CongressData = { generatedAt: new Date().toISOString(), since: trades.length ? trades[trades.length - 1].txDate : "", trades, topTickers, topMembers };
  await fs.writeFile(path.join(process.cwd(), "data", "congress.json"), JSON.stringify(out));
  console.log(`Wrote ${trades.length} trades · ${topTickers.length} top tickers · ${topMembers.length} members.`);
  console.log("Most-traded:", topTickers.slice(0, 6).map((t) => `${t.ticker}(${t.count})`).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
