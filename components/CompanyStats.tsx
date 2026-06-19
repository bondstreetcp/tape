"use client";
import type { CompanyStats } from "@/lib/companyStats";

const r1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const r2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const price = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
function big(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}`;
}
function shares(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return `${v}`;
}
const trend = (v: number | null) => (v == null ? undefined : v >= 0 ? "#22c55e" : "#ef4444");

const RATING_LABEL: Record<string, string> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong Sell",
  underperform: "Underperform",
  outperform: "Outperform",
};

export default function CompanyStats({ stats }: { stats: CompanyStats | null }) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
        No estimate or statistics data available.
      </div>
    );
  }
  const s = stats;
  const upside =
    s.targetMean != null && s.price ? (s.targetMean / s.price - 1) * 100 : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Analyst ratings */}
      <Section title="Analyst Ratings">
        {s.ratings ? <RatingBar r={s.ratings} /> : <Empty />}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Consensus" value={RATING_LABEL[s.recommendationKey ?? ""] ?? (s.recommendationKey ?? "—")} />
          <Stat label="Mean (1=SB,5=SS)" value={r2(s.recommendationMean)} />
          <Stat label="Analysts" value={s.numAnalysts != null ? `${s.numAnalysts}` : "—"} />
        </div>
      </Section>

      {/* Price target */}
      <Section title="Price Target">
        <TargetBar low={s.targetLow} mean={s.targetMean} high={s.targetHigh} price={s.price} />
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <Stat label="Current" value={price(s.price)} />
          <Stat label="Mean" value={price(s.targetMean)} color={trend(upside)} />
          <Stat label="Upside" value={upside == null ? "—" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`} color={trend(upside)} />
          <Stat label="Range" value={`${price(s.targetLow)}–${price(s.targetHigh)}`} />
        </div>
      </Section>

      {/* Forward estimates */}
      <Section title="Forward Estimates">
        <Grid>
          <Metric label="Forward EPS" value={price(s.forwardEps)} />
          <Metric label="Trailing EPS" value={price(s.trailingEps)} />
          <Metric label="Est. EPS Growth" value={pct(s.earningsGrowth)} color={trend(s.earningsGrowth)} />
          <Metric label="Est. Rev Growth" value={pct(s.revenueGrowth)} color={trend(s.revenueGrowth)} />
        </Grid>
        {s.estimates.length > 0 && (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-[#8b93a7]">
                <th className="py-1 text-left font-medium">Period</th>
                <th className="py-1 text-right font-medium">EPS est.</th>
                <th className="py-1 text-right font-medium"># </th>
                <th className="py-1 text-right font-medium">Rev est.</th>
              </tr>
            </thead>
            <tbody>
              {s.estimates.map((e) => (
                <tr key={e.period} className="border-t border-[#1f2430]">
                  <td className="py-1 text-left text-[#aab2c5]">{periodName(e.period)}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.epsAvg)}</td>
                  <td className="py-1 text-right tabular-nums text-[#8b93a7]">{e.epsAnalysts ?? "—"}</td>
                  <td className="py-1 text-right tabular-nums">{big(e.revAvg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Earnings surprises */}
      <Section title="Earnings Surprises (EPS)">
        {s.surprises.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8b93a7]">
                <th className="py-1 text-left font-medium">Quarter</th>
                <th className="py-1 text-right font-medium">Estimate</th>
                <th className="py-1 text-right font-medium">Actual</th>
                <th className="py-1 text-right font-medium">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {s.surprises.slice(-6).reverse().map((e, i) => (
                <tr key={i} className="border-t border-[#1f2430]">
                  <td className="py-1 text-left text-[#aab2c5]">{e.quarter}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.estimate)}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.actual)}</td>
                  <td className="py-1 text-right tabular-nums" style={{ color: trend(e.surprisePercent) }}>
                    {e.surprisePercent == null ? "—" : `${e.surprisePercent >= 0 ? "+" : ""}${(e.surprisePercent * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Valuation */}
      <Section title="Valuation">
        <Grid>
          <Metric label="Trailing P/E" value={r1(s.trailingPE)} />
          <Metric label="Forward P/E" value={r1(s.forwardPE)} />
          <Metric label="PEG" value={r2(s.pegRatio)} />
          <Metric label="Price / Sales" value={r1(s.priceToSales)} />
          <Metric label="Price / Book" value={r1(s.priceToBook)} />
          <Metric label="EV / Revenue" value={r1(s.evToRevenue)} />
          <Metric label="EV / EBITDA" value={r1(s.evToEbitda)} />
          <Metric label="Beta" value={r2(s.beta)} />
          <Metric label="Market Cap" value={big(s.marketCap)} />
          <Metric label="Enterprise Value" value={big(s.enterpriseValue)} />
        </Grid>
      </Section>

      {/* Profitability */}
      <Section title="Profitability & Returns">
        <Grid>
          <Metric label="Gross Margin" value={pct(s.grossMargins)} />
          <Metric label="Operating Margin" value={pct(s.operatingMargins)} />
          <Metric label="Net Margin" value={pct(s.profitMargins)} />
          <Metric label="Return on Equity" value={pct(s.returnOnEquity)} color={trend(s.returnOnEquity)} />
          <Metric label="Return on Assets" value={pct(s.returnOnAssets)} color={trend(s.returnOnAssets)} />
          <Metric label="Free Cash Flow" value={big(s.freeCashflow)} />
        </Grid>
      </Section>

      {/* Financial health */}
      <Section title="Financial Health">
        <Grid>
          <Metric label="Debt / Equity" value={r1(s.debtToEquity)} />
          <Metric label="Current Ratio" value={r2(s.currentRatio)} />
          <Metric label="Total Cash" value={big(s.totalCash)} />
          <Metric label="Dividend Yield" value={pct(s.dividendYield)} />
          <Metric label="Dividend Rate" value={s.dividendRate == null ? "—" : `$${s.dividendRate.toFixed(2)}`} />
          <Metric label="Payout Ratio" value={pct(s.payoutRatio)} />
        </Grid>
      </Section>

      {/* Ownership & short interest */}
      <Section title="Ownership & Short Interest">
        <Grid>
          <Metric label="% Institutions" value={pct(s.heldPercentInstitutions)} />
          <Metric label="% Insiders" value={pct(s.heldPercentInsiders)} />
          <Metric label="Shares Short" value={shares(s.sharesShort)} />
          <Metric label="Short Ratio (days)" value={r1(s.shortRatio)} />
          <Metric label="Float" value={shares(s.floatShares)} />
          <Metric label="Shares Out" value={shares(s.sharesOutstanding)} />
        </Grid>
      </Section>
    </div>
  );
}

function periodName(p: string): string {
  switch (p) {
    case "0q": return "Current Qtr";
    case "+1q": return "Next Qtr";
    case "0y": return "Current Yr";
    case "+1y": return "Next Yr";
    case "+5y": return "5Y";
    case "-5y": return "Past 5Y";
    default: return p;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[#aab2c5]">{title}</h3>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">{children}</div>;
}
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[#1f2430] py-1.5">
      <span className="text-xs text-[#8b93a7]">{label}</span>
      <span className="text-sm font-medium tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#2a2e39] bg-[#0b0e14] px-2 py-2">
      <div className="text-[10px] text-[#8b93a7]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
function Empty() {
  return <div className="py-2 text-xs text-[#8b93a7]">Not available.</div>;
}

function RatingBar({ r }: { r: import("@/lib/companyStats").RatingDist }) {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell || 1;
  const segs = [
    { n: r.strongBuy, c: "#15803d", label: "Strong Buy" },
    { n: r.buy, c: "#22c55e", label: "Buy" },
    { n: r.hold, c: "#8b93a7", label: "Hold" },
    { n: r.sell, c: "#fb923c", label: "Sell" },
    { n: r.strongSell, c: "#ef4444", label: "Strong Sell" },
  ];
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded">
        {segs.map((s, i) => s.n > 0 && (
          <div key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#8b93a7]">
        {segs.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.c }} />
            {s.label} {s.n}
          </span>
        ))}
      </div>
    </div>
  );
}

function TargetBar({ low, mean, high, price }: { low: number | null; mean: number | null; high: number | null; price: number | null }) {
  if (low == null || high == null || high <= low) return <Empty />;
  const span = high - low;
  const posOf = (v: number | null) => (v == null ? null : Math.min(100, Math.max(0, ((v - low) / span) * 100)));
  const pMean = posOf(mean);
  const pPrice = posOf(price);
  return (
    <div className="pt-2">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-[#ef4444] via-[#6b7280] to-[#22c55e]">
        {pMean != null && (
          <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `calc(${pMean}% - 2px)` }} title="Mean target" />
        )}
        {pPrice != null && (
          <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-[#fbbf24] shadow" style={{ left: `calc(${pPrice}% - 2px)` }} title="Current price" />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[#8b93a7]">
        <span>low ${low.toFixed(0)}</span>
        <span className="text-[#fbbf24]">▮ price</span>
        <span className="text-[#e6e9f0]">▮ target</span>
        <span>high ${high.toFixed(0)}</span>
      </div>
    </div>
  );
}
