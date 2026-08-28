import { NextRequest, NextResponse } from "next/server";
import { loadSymbolSeries } from "@/lib/data";
import { bucketByDay } from "@/lib/pairs";
import { bsPrice } from "@/lib/blackScholes";

export const dynamic = "force-dynamic";

/**
 * "Does this name wheel well?" — a per-name covered-call backtest off the stored daily price series.
 * We step MONTHLY (~21 trading days) over the last ~3 years and each step sell a ~30-day, ~0.30-delta
 * call: strike ≈ spot·exp(0.52·σ·√T), premium priced with Black-Scholes using trailing 21-day realized
 * vol as the IV proxy (× 1.1 for a rough variance-premium uplift — real IV usually exceeds realized, so
 * this is on the CONSERVATIVE side). The covered-call monthly return is min(spot move, cap) + premium.
 * Returns annualized premium income, how often the shares were called away, and the covered-call return
 * vs simple buy-and-hold. Approximate (no live option history) — a shape read, not a promise.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const series = await loadSymbolSeries(sym).catch(() => null);
  const daily = series?.daily;
  if (!Array.isArray(daily) || daily.length < 300) {
    return NextResponse.json({ error: "not enough price history to backtest" }, { headers: { "Cache-Control": "public, s-maxage=600" } });
  }
  const closes = bucketByDay(daily).filter(([, p]) => p > 0);
  const win = closes.slice(-780); // ~3 years of trading days
  const N = win.length;
  const STEP = 21, T = 21 / 252, R = 0.04;

  let wheel = 1, bh = 1, premSum = 0, assign = 0, months = 0;
  for (let i = 63; i + STEP < N; i += STEP) {
    const spot = win[i][1], end = win[i + STEP][1];
    // trailing 21-day realized vol (annualized)
    let s = 0, s2 = 0, n = 0;
    for (let k = i - 21; k < i; k++) { const lr = Math.log(win[k + 1][1] / win[k][1]); if (Number.isFinite(lr)) { s += lr; s2 += lr * lr; n++; } }
    if (n < 10) continue;
    const mean = s / n, varr = Math.max(s2 / n - mean * mean, 1e-8);
    const rv = Math.sqrt(varr) * Math.sqrt(252);
    const iv = rv * 1.1;
    const strike = spot * Math.exp(0.52 * iv * Math.sqrt(T)); // ≈ 0.30-delta
    const prem = bsPrice("call", spot, strike, T, iv, R);
    const monthRet = end / spot - 1, capRet = strike / spot - 1;
    const ccRet = Math.min(monthRet, capRet) + prem / spot;
    wheel *= 1 + ccRet; bh *= 1 + monthRet; premSum += prem / spot; if (end >= strike) assign++; months++;
  }
  if (months < 6) {
    return NextResponse.json({ error: "not enough history to backtest" }, { headers: { "Cache-Control": "public, s-maxage=600" } });
  }
  const ann = (c: number) => (Math.pow(c, 12 / months) - 1) * 100;
  return NextResponse.json(
    {
      symbol: sym, months,
      startDate: new Date(win[63][0]).toISOString().slice(0, 10),
      endDate: new Date(win[N - 1][0]).toISOString().slice(0, 10),
      premIncomeAnn: (premSum * 12 / months) * 100,
      assignRate: (assign / months) * 100,
      assignCount: assign,
      wheelAnnRet: ann(wheel),
      bhAnnRet: ann(bh),
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
