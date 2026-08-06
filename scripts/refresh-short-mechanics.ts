/**
 * Nightly build of data/short-mechanics.json — daily short-VOLUME % (FINRA) + fails-to-deliver (SEC)
 * for our universe. Both are free official files; see lib/shortMechanics for the honest framing.
 *
 *  • FINRA CNMSshvol daily files (~15 trading days) → volume-weighted short-volume % + latest + trend.
 *  • SEC semi-monthly FTD zips (latest + prior) → fails shares/$ + change. Parsed via `unzip -p`;
 *    if unzip is unavailable the FTD columns degrade to null and the short-volume board still ships.
 *
 * Scoped to the russell3000 universe so the output is our names, not all 12k tape symbols.
 * Run: npm run refresh-short-mechanics. FULL tier.
 */
import { promises as fsp } from "fs";
import { execFileSync } from "node:child_process";
import path from "path";
import os from "os";
import { deadline } from "../lib/deadline";
import { parseFinraLine, parseFtdLine, rollShortVol, type FinraShortRow, type ShortMechFile, type ShortMechRow } from "../lib/shortMechanics";

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "short-mechanics.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const WINDOW_DAYS = 15;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: deadline(30_000) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

/** Latest WINDOW_DAYS FINRA daily short-volume files (walk back over weekends/holidays). */
async function finraWindow(): Promise<{ byDate: Map<string, FinraShortRow[]>; latestDate: string | null }> {
  const byDate = new Map<string, FinraShortRow[]>();
  let latestDate: string | null = null;
  const now = Date.now();
  for (let back = 0; back < 30 && byDate.size < WINDOW_DAYS; back++) {
    const d = new Date(now - back * 86_400_000);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue; // skip weekends before spending a request
    const stamp = yyyymmdd(d);
    const txt = await getText(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${stamp}.txt`);
    await sleep(120);
    if (!txt) continue;
    const rows: FinraShortRow[] = [];
    for (const line of txt.split(/\r?\n/)) { const r = parseFinraLine(line); if (r) rows.push(r); }
    if (rows.length) { byDate.set(stamp, rows); if (!latestDate) latestDate = stamp; }
  }
  return { byDate, latestDate };
}

/** The latest available semi-monthly FTD file (and the prior), parsed via unzip. Best-effort. */
async function ftdFiles(): Promise<{ latest: Map<string, { fails: number; usd: number }> | null; prior: Map<string, { fails: number; usd: number }> | null; asOf: string | null }> {
  // Candidate stamps: this month + last 3, halves b then a (b = 2nd half, newer).
  const now = new Date();
  const cands: string[] = [];
  for (let m = 0; m < 4; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    cands.push(`${ym}b`, `${ym}a`);
  }
  const parsed: { stamp: string; map: Map<string, { fails: number; usd: number }> }[] = [];
  for (const stamp of cands) {
    if (parsed.length >= 2) break;
    try {
      const res = await fetch(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${stamp}.zip`, { headers: { "User-Agent": UA }, signal: deadline(35_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue;
      const tmp = path.join(os.tmpdir(), `ftd-${stamp}.zip`);
      await fsp.writeFile(tmp, buf);
      const text = execFileSync("unzip", ["-p", tmp], { maxBuffer: 200 * 1024 * 1024 }).toString();
      await fsp.rm(tmp, { force: true });
      const map = new Map<string, { fails: number; usd: number }>();
      for (const line of text.split(/\r?\n/)) {
        const r = parseFtdLine(line);
        if (!r) continue;
        const cur = map.get(r.symbol) ?? { fails: 0, usd: 0 };
        cur.fails += r.fails;
        cur.usd += r.fails * r.priceUsd;
        map.set(r.symbol, cur);
      }
      if (map.size) parsed.push({ stamp, map });
      await sleep(150);
    } catch { /* unzip missing or fetch failed — degrade */ }
  }
  return { latest: parsed[0]?.map ?? null, prior: parsed[1]?.map ?? null, asOf: parsed[0]?.stamp ?? null };
}

async function main() {
  const snap = JSON.parse(await fsp.readFile(path.join(DATA, "russell3000", "snapshot.json"), "utf8"));
  const nameBy = new Map<string, string>((snap.stocks as any[]).map((s) => [s.symbol, s.name]));
  const universe = new Set(nameBy.keys());
  // FINRA files spell class shares with a dot (BRK.A); our universe uses a dash. Map both ways.
  const finraKey = (sym: string) => sym.replace("-", ".");

  console.log("refresh-short-mechanics: fetching FINRA short-volume window…");
  const { byDate, latestDate } = await finraWindow();
  console.log(`  ${byDate.size} trading days (latest ${latestDate ?? "none"})`);
  console.log("refresh-short-mechanics: fetching SEC fails-to-deliver…");
  const ftd = await ftdFiles();
  console.log(`  FTD ${ftd.latest ? `${ftd.latest.size} symbols (${ftd.asOf})` : "unavailable"}`);

  // Index each day by symbol ONCE (2,500 names × 15 days would be O(n²) with a linear find).
  const dates = [...byDate.keys()].sort(); // ascending
  const dayIndex = new Map(dates.map((d) => [d, new Map(byDate.get(d)!.map((r) => [r.symbol, r]))]));
  const latestBySym = latestDate ? dayIndex.get(latestDate)! : new Map<string, FinraShortRow>();

  const rows: ShortMechRow[] = [];
  for (const symbol of universe) {
    const fk = finraKey(symbol);
    const daily: FinraShortRow[] = [];
    for (const d of dates) { const r = dayIndex.get(d)!.get(fk); if (r) daily.push(r); }
    const sv = rollShortVol(daily, latestBySym.get(fk) ?? null);
    const fl = ftd.latest?.get(fk) ?? null;
    const fp = ftd.prior?.get(fk) ?? null;
    if (sv.daysObserved === 0 && !fl) continue; // nothing for this name
    rows.push({
      symbol, name: nameBy.get(symbol) || symbol,
      ...sv,
      ftdShares: fl ? Math.round(fl.fails) : null,
      ftdUsd: fl ? Math.round(fl.usd) : null,
      ftdChangePct: fl && fp && fp.usd > 0 ? +(((fl.usd - fp.usd) / fp.usd) * 100).toFixed(0) : null,
    });
  }
  // Default view is heaviest recent shorting first.
  rows.sort((a, b) => (b.latestShortVolPct ?? -1) - (a.latestShortVolPct ?? -1));

  const out: ShortMechFile = {
    generatedAt: new Date().toISOString(),
    shortVolAsOf: latestDate ? `${latestDate.slice(0, 4)}-${latestDate.slice(4, 6)}-${latestDate.slice(6)}` : null,
    ftdAsOf: ftd.asOf,
    windowDays: WINDOW_DAYS,
    rows,
  };
  await fsp.writeFile(FILE, JSON.stringify(out));
  console.log(`short-mechanics: wrote ${rows.length} names (${rows.filter((r) => r.ftdShares != null).length} with FTD data).`);
}

main().catch((e) => { console.error("refresh-short-mechanics:", String(e?.message || e)); process.exit(1); });
