/**
 * Builds data/gamma-board.json — the universe-wide Dealer Gamma Board. Runs the same per-name GEX model as
 * /api/gamma (lib/gammaFetch.loadGamma → lib/gammaExposure.computeGamma) across the most options-liquid US
 * names (top S&P 500 by cap) PLUS the headline index ETFs (SPY/QQQ/IWM/DIA — where dealer gamma matters
 * most). No LLM; live option chains only. Reuses the dispersion vol-probe harness (throttle/mapPool/retry).
 * Nightly FULL. See lib/gammaBoard.ts for the reading of net/gross GEX, the flip, and the OI walls.
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { getOptions } from "../lib/options";
import { loadGamma } from "../lib/gammaFetch";
import { buildGammaRow, type GammaBoardData, type GammaBoardRow } from "../lib/gammaBoard";

const DATA = path.join(process.cwd(), "data");
const TOP = Number(process.env.GAMMA_TOP || 140);
const MAX_EXP = Number(process.env.GAMMA_MAX_EXP || 3);
const WORKERS = 8;

// Headline index ETFs — not in the stock snapshot, but their dealer gamma is the market-wide read.
const INDEX_ETFS: { symbol: string; name: string }[] = [
  { symbol: "SPY", name: "S&P 500 ETF" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF" },
  { symbol: "IWM", name: "Russell 2000 ETF" },
  { symbol: "DIA", name: "Dow 30 ETF" },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i]); } catch { out[i] = null as any; }
      }
    }),
  );
  return out;
}

// Global throttle gate so we never hammer the options endpoint, regardless of worker count.
let gate: Promise<void> = Promise.resolve();
function throttle(gap = 350): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}
async function chainRetry(sym: string, date?: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    await throttle();
    try { const c = await getOptions(sym, date); if (c.puts.length || (!date && c.expirations.length)) return c; } catch { /* retry */ }
    await sleep(500 + i * 400);
  }
  await throttle();
  return getOptions(sym, date);
}

async function main() {
  const snap = await loadSnapshot("sp500");
  if (!snap) { console.error("gamma-board: no sp500 snapshot."); process.exit(1); }

  // Top names by cap (dual-class collapsed so an issuer isn't scanned twice).
  const sorted = [...snap.stocks].filter((s: any) => s.marketCap > 0).sort((a: any, b: any) => b.marketCap - a.marketCap);
  const norm = (nm: string) => (nm || "").toLowerCase().replace(/\b(class\s+[a-k]|cl\.?\s+[a-k]|inc|corp(oration)?|co(mpany)?|ltd|holdings|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  const stocks: { symbol: string; name: string; sector: string }[] = [];
  for (const s of sorted) {
    const k = norm(s.name) || s.symbol;
    if (seen.has(k)) continue;
    seen.add(k);
    stocks.push({ symbol: s.symbol, name: s.name, sector: s.sector || "—" });
    if (stocks.length >= TOP) break;
  }
  const targets = [...INDEX_ETFS.map((e) => ({ ...e, sector: "Index ETF" })), ...stocks];
  console.log(`gamma-board: scanning ${targets.length} names (${INDEX_ETFS.length} ETFs + top ${stocks.length} S&P), ${MAX_EXP} expiries each`);

  const built = await mapPool(targets, WORKERS, async (t): Promise<GammaBoardRow | null> => {
    const g = await loadGamma(t.symbol, chainRetry, MAX_EXP).catch(() => null);
    if (!g) return null;
    return buildGammaRow({
      symbol: t.symbol, name: t.name, sector: t.sector, spot: +g.spot.toFixed(2),
      totalGex: Math.round(g.gex.totalGex), grossGex: Math.round(g.gex.grossGex),
      flip: g.gex.flip != null ? +g.gex.flip.toFixed(2) : null,
      pcRatio: g.gex.pcRatio != null ? +g.gex.pcRatio.toFixed(2) : null,
      callWall: g.gex.callWall, putWall: g.gex.putWall, expiries: g.expiries.length,
    });
  });

  const rows = built.filter((r): r is GammaBoardRow => !!r).sort((a, b) => b.grossGex - a.grossGex);
  if (rows.length < 10) { console.error(`gamma-board: only ${rows.length} names priced — aborting (keep previous file).`); process.exit(1); }

  const out: GammaBoardData = { generatedAt: new Date().toISOString(), universe: "sp500", scanned: targets.length, rows };
  await fs.writeFile(path.join(DATA, "gamma-board.json"), JSON.stringify(out));
  const shortN = rows.filter((r) => r.regime === "short").length;
  // ETF coverage is called out explicitly — a missing headline index (e.g. SPY) is a silent data-quality
  // hit the total row count would hide, so name which of them actually priced.
  const gotEtf = INDEX_ETFS.filter((e) => rows.some((r) => r.symbol === e.symbol)).map((e) => e.symbol);
  const missEtf = INDEX_ETFS.filter((e) => !gotEtf.includes(e.symbol)).map((e) => e.symbol);
  console.log(`gamma-board: wrote ${rows.length} rows (${shortN} short-gamma) · ETFs ${gotEtf.join("/") || "none"}${missEtf.length ? ` · MISSING ${missEtf.join("/")}` : ""} · biggest: ${rows[0]?.symbol} $${(rows[0]?.grossGex / 1e9).toFixed(1)}B/1%`);
}

main().catch((e) => { console.error("gamma-board:", String(e?.message || e)); process.exit(1); });
