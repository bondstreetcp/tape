/**
 * refresh-cot — CFTC Commitments of Traders positioning, free from the CFTC public API (Socrata, no
 * key). For ~19 key futures (equity indices, rates, FX, energy, metals, ags, BTC) we pull ~5yr of the
 * weekly Legacy report and compute large-speculator NET positioning (non-commercial long − short), its
 * percentile vs its own 5-year range (the crowding signal), week-over-week change, and % of open
 * interest. Writes data/cot.json; the /cot board renders it. Weekly cadence (published Fri, as-of Tue).
 *
 *   npx tsx scripts/refresh-cot.ts
 */
import { writeFeedGuarded } from "../lib/feedGuard";
import type { CotRow, CotData, CotGroup } from "../lib/cot";

const API = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

type Mkt = { key: string; label: string; group: CotGroup; name: string };
const MARKETS: Mkt[] = [
  { key: "sp500", label: "S&P 500", group: "Equities", name: "S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE" },
  { key: "nasdaq", label: "Nasdaq 100", group: "Equities", name: "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE" },
  { key: "russell", label: "Russell 2000", group: "Equities", name: "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE" },
  { key: "vix", label: "VIX", group: "Equities", name: "VIX FUTURES - CBOE FUTURES EXCHANGE" },
  { key: "ust2y", label: "UST 2-year", group: "Rates", name: "UST 2Y NOTE - CHICAGO BOARD OF TRADE" },
  { key: "ust10y", label: "UST 10-year", group: "Rates", name: "UST 10Y NOTE - CHICAGO BOARD OF TRADE" },
  { key: "ustbond", label: "UST Bond", group: "Rates", name: "UST BOND - CHICAGO BOARD OF TRADE" },
  { key: "eur", label: "Euro FX", group: "FX", name: "EURO FX - CHICAGO MERCANTILE EXCHANGE" },
  { key: "jpy", label: "Japanese Yen", group: "FX", name: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE" },
  { key: "gbp", label: "British Pound", group: "FX", name: "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE" },
  { key: "wti", label: "WTI Crude", group: "Energy", name: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE" },
  { key: "natgas", label: "Natural Gas", group: "Energy", name: "NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE" },
  { key: "gold", label: "Gold", group: "Metals", name: "GOLD - COMMODITY EXCHANGE INC." },
  { key: "silver", label: "Silver", group: "Metals", name: "SILVER - COMMODITY EXCHANGE INC." },
  { key: "copper", label: "Copper", group: "Metals", name: "COPPER- #1 - COMMODITY EXCHANGE INC." },
  { key: "corn", label: "Corn", group: "Ags", name: "CORN - CHICAGO BOARD OF TRADE" },
  { key: "soybeans", label: "Soybeans", group: "Ags", name: "SOYBEANS - CHICAGO BOARD OF TRADE" },
  { key: "wheat", label: "Wheat (SRW)", group: "Ags", name: "WHEAT-SRW - CHICAGO BOARD OF TRADE" },
  { key: "bitcoin", label: "Bitcoin", group: "Crypto", name: "BITCOIN - CHICAGO MERCANTILE EXCHANGE" },
];

const num = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };

type Obs = { date: string; specNet: number; commNet: number; oi: number };

async function fetchMarket(name: string): Promise<Obs[]> {
  const where = encodeURIComponent(`market_and_exchange_names='${name.replace(/'/g, "''")}'`);
  const url = `${API}?$where=${where}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=270` +
    `&$select=report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,comm_positions_long_all,comm_positions_short_all`;
  const res = await fetch(url, { headers: { "User-Agent": "stock-chart-screener (research)" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as any[])
    .map((r) => ({
      date: String(r.report_date_as_yyyy_mm_dd).slice(0, 10),
      specNet: num(r.noncomm_positions_long_all) - num(r.noncomm_positions_short_all),
      commNet: num(r.comm_positions_long_all) - num(r.comm_positions_short_all),
      oi: num(r.open_interest_all),
    }))
    .filter((x) => x.date && Number.isFinite(x.specNet));
}

function build(m: Mkt, hist: Obs[]): CotRow | null {
  if (hist.length < 20) return null; // hist is newest→oldest
  const latest = hist[0], prev = hist[1] ?? latest;
  const nets = hist.map((h) => h.specNet);
  const percentile = (nets.filter((n) => n <= latest.specNet).length / nets.length) * 100; // rank in own history
  return {
    key: m.key, label: m.label, group: m.group,
    specNet: latest.specNet, specNetPrev: prev.specNet, wowChange: latest.specNet - prev.specNet,
    pctOI: latest.oi > 0 ? (latest.specNet / latest.oi) * 100 : null,
    percentile, commNet: latest.commNet, openInterest: latest.oi,
    history: [...hist].reverse().map((h) => [h.date, h.specNet] as [string, number]).slice(-260),
  };
}

async function main() {
  const rows: CotRow[] = [];
  let reportDate = "";
  for (const m of MARKETS) {
    try {
      const row = build(m, await fetchMarket(m.name));
      if (row) {
        rows.push(row);
        const d = row.history.at(-1)![0];
        if (d > reportDate) reportDate = d;
        console.log(`  ${m.key.padEnd(9)} net ${String(row.specNet).padStart(8)} (${row.percentile.toFixed(0).padStart(3)}%ile) wow ${row.wowChange >= 0 ? "+" : ""}${row.wowChange} @ ${d}`);
      } else console.warn(`  ${m.key}: insufficient/no data — check the market name`);
    } catch (e: any) { console.warn(`  ${m.key}: fetch failed (${String(e?.message || e).slice(0, 50)})`); }
  }
  const data: CotData = { asOf: new Date().toISOString(), reportDate, rows };
  const w = await writeFeedGuarded("cot.json", data);
  console.log(`refresh-cot: ${w.reason}`);
  if (!w.written) { console.error("refresh-cot: kept prior file (too thin) — retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-cot:", String((e as Error)?.message || e)); process.exitCode = 1; });
