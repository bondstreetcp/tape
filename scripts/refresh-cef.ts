/**
 * Build data/cef.json from CEF Connect's public daily-pricing feed — the full closed-end-fund
 * universe in one call (price, NAV, premium/discount, the discount z-score vs the fund's own
 * history, distribution rate, leverage, expense, bond analytics). Public data, no login; we
 * send a real UA and hit it once. Undocumented endpoint, so it's wrapped defensively.
 *
 *   npm run refresh-cef
 */
import { promises as fs } from "fs";
import path from "path";
import { cefGroup, type Cef, type CefData } from "../lib/cef";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cleanCat = (c: string) => String(c || "").replace(/^Morningstar US CEF\s*/i, "").trim() || "Other";

async function main() {
  const res = await fetch("https://www.cefconnect.com/api/v3/DailyPricing", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CEF Connect DailyPricing -> HTTP ${res.status}`);
  const raw: any[] = await res.json();
  if (!Array.isArray(raw) || !raw.length) throw new Error("DailyPricing returned no rows");

  const funds: Cef[] = [];
  let latest = "";
  for (const r of raw) {
    const ticker = String(r.Ticker || "").trim().toUpperCase();
    const price = num(r.Price);
    const nav = num(r.NAV);
    if (!ticker || price == null || nav == null) continue; // need the basics for a discount
    const category = cleanCat(r.CategoryName);
    const strategy = r.Strategy ? String(r.Strategy) : null;
    const navDate = r.NAVPublished ? String(r.NAVPublished).slice(0, 10) : null;
    if (navDate && navDate > latest) latest = navDate;
    funds.push({
      ticker,
      name: String(r.Name || ticker),
      sponsor: String(r.SponsorName || ""),
      category,
      group: cefGroup(category, strategy),
      strategy,
      price,
      nav,
      discount: num(r.Discount) ?? (nav ? (price / nav - 1) * 100 : 0),
      z1y: num(r.ZScore1Yr),
      z6m: num(r.ZScore6M),
      disc52w: num(r.Discount52WkAvg),
      distRate: num(r.DistributionRatePrice),
      distFreq: r.DistributionFrequency ? String(r.DistributionFrequency) : null,
      leverage: num(r.LeverageRatioPercentage),
      expense: num(r.ExpenseRatio),
      mktCapM: num(r.MarketCapUSDm),
      avgCoupon: num(r.AverageCoupon),
      avgMaturity: num(r.AverageWeightedMaturity),
      effDuration: num(r.EffDurationLevAdj) ?? num(r.AvgWtdDurationLevAdj),
      ret3yNav: num(r.Yr3RetOnNav),
      retYtdPrice: num(r.YTDRetOnPrice),
      navTicker: r.NavTicker ? String(r.NavTicker) : null,
      navDate,
    });
  }
  funds.sort((a, b) => a.discount - b.discount); // most-discounted first

  const out: CefData = { generatedAt: new Date().toISOString(), asOf: latest || null, funds };
  await fs.writeFile(path.join(process.cwd(), "data", "cef.json"), JSON.stringify(out));

  const byGroup: Record<string, number> = {};
  for (const f of funds) byGroup[f.group] = (byGroup[f.group] || 0) + 1;
  console.log(`Wrote ${funds.length} CEFs (NAV as of ${latest}). Groups:`, byGroup);
  console.log("Deepest discounts:", funds.slice(0, 6).map((f) => `${f.ticker} ${f.discount.toFixed(1)}%`).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
