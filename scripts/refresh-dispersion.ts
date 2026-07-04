/**
 * Builds data/dispersion.json — index implied vol (VIX) vs the cap-weighted average of the top S&P 500
 * names' single-name IV. CRITICAL: we fetch the top ~100 names BY MARKET CAP (which INCLUDES the mega-caps
 * that dominate the index weighting) — NOT the quality/put-writing screen, which excludes high-P/E names
 * and would badly skew the average. VIX from macro.json. Reuses the vol-probe harness (throttle/mapPool/
 * chainRetry) + ivFromPut/ivFromCall. Run in the nightly FULL job.
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { getOptions } from "../lib/options";
import { ivFromPut, ivFromCall } from "../lib/putwrite";
import { computeDispersion, type DispersionData } from "../lib/dispersion";

const DATA = path.join(process.cwd(), "data");
const TOP = Number(process.env.DISP_TOP || 100);
const R = 0.043;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mapPool<T, R2>(items: T[], n: number, fn: (x: T) => Promise<R2>): Promise<R2[]> {
  const out: R2[] = new Array(items.length);
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
const midOf = (o: any): number | null => (o.bid && o.ask ? (o.bid + o.ask) / 2 : o.last);

// ~1-month ATM implied vol (mean of ATM put & call solved from the mid).
async function atmIV(sym: string): Promise<number | null> {
  const base = await chainRetry(sym);
  const spot = base?.underlying;
  if (!spot || !base.expirations?.length) return null;
  const now = Date.now();
  const exps = base.expirations
    .map((d: string) => ({ d, dte: Math.round((Date.parse(d + "T00:00:00Z") - now) / 86_400_000) }))
    .filter((e: { dte: number }) => e.dte >= 1);
  if (!exps.length) return null;
  const band = exps.filter((e: { dte: number }) => e.dte >= 18 && e.dte <= 45);
  const pick = (band.length ? band : exps).sort((a: any, b: any) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
  const chain = pick.d === base.selected ? base : await chainRetry(sym, pick.d);
  const T = pick.dte / 365;
  const puts = chain.puts.map((p: any) => ({ ...p, m: midOf(p) })).filter((p: any) => p.m > 0);
  const calls = chain.calls.map((c: any) => ({ ...c, m: midOf(c) })).filter((c: any) => c.m > 0);
  const nearest = (arr: any[], k: number) => arr.reduce((a: any, b: any) => (Math.abs(b.strike - k) < Math.abs(a.strike - k) ? b : a));
  const p = puts.length ? nearest(puts, spot) : null;
  const c = calls.length ? nearest(calls, spot) : null;
  const ivP = p ? ivFromPut(spot, p.strike, T, R, p.m) : null;
  const ivC = c ? ivFromCall(spot, c.strike, T, R, c.m) : null;
  const ivs = [ivP, ivC].filter((v): v is number => v != null && v > 0.03 && v < 3);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

async function main() {
  const snap = await loadSnapshot("sp500");
  if (!snap) { console.error("dispersion: no sp500 snapshot."); process.exit(1); }
  const sorted = [...snap.stocks].filter((s: any) => s.marketCap > 0).sort((a: any, b: any) => b.marketCap - a.marketCap);
  // Collapse dual-class issuers (GOOG/GOOGL, BRK.A/BRK.B, FOX/FOXA…) so each issuer is counted ONCE at its
  // true weight — else its IV is double-weighted in the cap-weighted average. Keep the higher-cap class.
  const norm = (nm: string) => (nm || "").toLowerCase().replace(/\b(class\s+[a-c]|cl\s+[a-c]|inc|corp(oration)?|co(mpany)?|ltd|holdings|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  const top: any[] = [];
  for (const s of sorted) {
    const k = norm(s.name) || s.symbol;
    if (seen.has(k)) continue;
    seen.add(k);
    top.push(s);
    if (top.length >= TOP) break;
  }
  const mac = JSON.parse(await fs.readFile(path.join(DATA, "macro.json"), "utf8"));
  const vix = (mac.indicators || []).find((i: any) => i.key === "vix")?.value;
  if (!(vix > 0)) { console.error("dispersion: no VIX in macro.json."); process.exit(1); }
  console.log(`dispersion: solving ATM IV for the top ${top.length} S&P names by cap; VIX ${vix}`);

  const built = await mapPool(top, 8, async (s: any) => {
    const iv = await atmIV(s.symbol).catch(() => null);
    if (iv == null) return null;
    return { symbol: s.symbol, name: s.name, sector: s.sector || "—", atmIV: +iv.toFixed(3), marketCap: s.marketCap };
  });
  const rows = built.filter((r): r is NonNullable<typeof r> => !!r);
  const disp = computeDispersion(rows, vix);
  if (!disp) { console.error(`dispersion: only ${rows.length} names solved — not enough.`); process.exit(1); }

  const out: DispersionData = { ...disp, generatedAt: new Date().toISOString(), vix, coverage: rows.length };
  await fs.writeFile(path.join(DATA, "dispersion.json"), JSON.stringify(out));
  console.log(`dispersion: index ${(disp.indexIV * 100).toFixed(1)}% vs cap-wtd single-name ${(disp.singleNameIV * 100).toFixed(1)}% (n=${disp.n}) · implied corr ${disp.impliedCorr != null ? (disp.impliedCorr * 100).toFixed(0) + "%" : "—"}`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
