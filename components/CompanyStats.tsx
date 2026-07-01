"use client";
import type { CompanyStats } from "@/lib/companyStats";
import { fmtMoney, currencyPrefix } from "@/lib/format";

const r1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const r2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
// Big amounts (cap, EV, revenue) in the universe currency — for UK these are pounds
// (£) even though per-share prices are pence; currencyPrefix() handles that.
function bigCur(v: number | null, cur: string): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  const sym = currencyPrefix(cur);
  if (a >= 1e12) return `${s}${sym}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${sym}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${sym}${(a / 1e6).toFixed(1)}M`;
  return `${s}${sym}${a.toFixed(0)}`;
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

export default function CompanyStats({ stats, currency = "USD", show = "all" }: { stats: CompanyStats | null; currency?: string; show?: "earnings" | "valuation" | "all" }) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
        No estimate or statistics data available.
      </div>
    );
  }
  const s = stats;
  const price = (v: number | null) => fmtMoney(v, currency);
  const big = (v: number | null) => bigCur(v, currency);
  const upside =
    s.targetMean != null && s.price ? (s.targetMean / s.price - 1) * 100 : null;
  // Yahoo sometimes returns recommendationKey "none" / a null mean even when the buy/hold/sell counts
  // exist — derive the consensus from the counts so the card isn't blank.
  const ratingsMean = (() => {
    if (s.recommendationMean != null) return s.recommendationMean;
    const r = s.ratings;
    if (!r) return null;
    const tot = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
    return tot ? (r.strongBuy + r.buy * 2 + r.hold * 3 + r.sell * 4 + r.strongSell * 5) / tot : null;
  })();
  const consensusLabel = (() => {
    const k = s.recommendationKey;
    if (k && k !== "none" && RATING_LABEL[k]) return RATING_LABEL[k];
    if (ratingsMean == null) return "—";
    return ratingsMean <= 1.5 ? "Strong Buy" : ratingsMean <= 2.5 ? "Buy" : ratingsMean <= 3.5 ? "Hold" : ratingsMean <= 4.5 ? "Sell" : "Strong Sell";
  })();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {show !== "valuation" && (
        <>
      {/* Analyst ratings */}
      <Section title="Analyst Ratings">
        {s.ratings ? <RatingBar r={s.ratings} /> : <Empty />}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Consensus" value={consensusLabel} />
          <Stat label="Mean (1=SB,5=SS)" value={r2(ratingsMean)} />
          <Stat label="Analysts" value={s.numAnalysts != null ? `${s.numAnalysts}` : "—"} />
        </div>
      </Section>

      {/* Price target */}
      <Section title="Price Target">
        <TargetBar low={s.targetLow} mean={s.targetMean} high={s.targetHigh} price={s.price} currency={currency} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
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
              <tr className="text-[var(--text-3)]">
                <th className="py-1 text-left font-medium">Period</th>
                <th className="py-1 text-right font-medium">EPS est.</th>
                <th className="py-1 text-right font-medium" title="Analyst low–high range; % = dispersion (disagreement) relative to the mean — high = a wide bull/bear gap">Low–High (disp.)</th>
                <th className="py-1 text-right font-medium"># </th>
                <th className="py-1 text-right font-medium">Rev est.</th>
              </tr>
            </thead>
            <tbody>
              {s.estimates.map((e) => (
                <tr key={e.period} className="border-t border-[var(--divider)]">
                  <td className="py-1 text-left text-[var(--text-2)]">{periodName(e.period)}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.epsAvg)}</td>
                  <td className="py-1 text-right tabular-nums text-[var(--text-3)]">
                    {e.epsLow != null && e.epsHigh != null ? (
                      <>
                        {price(e.epsLow)}–{price(e.epsHigh)}
                        {e.epsAvg ? (
                          (() => { const disp = ((e.epsHigh - e.epsLow) / Math.abs(e.epsAvg)) * 100; return <span style={{ color: disp >= 25 ? "#f59e0b" : "var(--text-4)" }}> ({disp.toFixed(0)}%)</span>; })()
                        ) : null}
                      </>
                    ) : "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--text-3)]">{e.epsAnalysts ?? "—"}</td>
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
          <>
          <BeatSummary surprises={s.surprises} />
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-3)]">
                <th className="py-1 text-left font-medium">Quarter</th>
                <th className="py-1 text-right font-medium">Estimate</th>
                <th className="py-1 text-right font-medium">Actual</th>
                <th className="py-1 text-right font-medium">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {s.surprises.slice(-6).reverse().map((e, i) => (
                <tr key={i} className="border-t border-[var(--divider)]">
                  <td className="py-1 text-left text-[var(--text-2)]">{e.quarter}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.estimate)}</td>
                  <td className="py-1 text-right tabular-nums">{price(e.actual)}</td>
                  <td className="py-1 text-right tabular-nums" style={{ color: trend(e.surprisePercent) }}>
                    {e.surprisePercent == null ? "—" : `${e.surprisePercent >= 0 ? "+" : ""}${(e.surprisePercent * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </Section>

      {/* Estimate revisions */}
      <EstimateRevisions estimates={s.estimates} currency={currency} />

      {/* Recent analyst actions */}
      {s.ratingChanges.length > 0 && (
        <Section title="Recent Analyst Actions" wide>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="text-[var(--text-3)]">
                  <th className="py-1 text-left font-medium">Date</th>
                  <th className="py-1 text-left font-medium">Firm</th>
                  <th className="py-1 text-left font-medium">Action</th>
                  <th className="py-1 text-right font-medium">Price Target</th>
                </tr>
              </thead>
              <tbody>
                {s.ratingChanges.map((c, i) => {
                  const m = actionMeta(c.action);
                  return (
                    <tr key={i} className="border-t border-[var(--divider)]">
                      <td className="py-1 pr-3 text-left text-[var(--text-3)]">{c.date}</td>
                      <td className="py-1 pr-3 text-left text-[var(--text-2)]">{c.firm}</td>
                      <td className="py-1 pr-3 text-left">
                        <span style={{ color: m.color }}>{m.label}</span>
                        {c.toGrade && (
                          <span className="text-[var(--text-3)]">
                            {" · "}
                            {c.fromGrade && c.fromGrade !== c.toGrade ? `${c.fromGrade} → ` : ""}
                            {c.toGrade}
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {c.targetTo != null ? fmtMoney(c.targetTo, currency, 0) : "—"}
                        {c.targetFrom != null && c.targetTo != null && c.targetFrom !== c.targetTo && (
                          <span className="text-[10px] text-[var(--text-3)]"> (was {fmtMoney(c.targetFrom, currency, 0)})</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
        </>
      )}
      {show !== "earnings" && (
        <>
      {/* Key-metrics headline — the at-a-glance read */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-2">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Key metrics</div>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Big value={r1(s.forwardPE)} label="Forward P/E" />
          <Big value={r1(s.evToEbitda)} label="EV / EBITDA" />
          <Big value={pct(s.profitMargins)} label="Net margin" color={trend(s.profitMargins)} />
          <Big value={pct(s.returnOnEquity)} label="Return on equity" color={trend(s.returnOnEquity)} />
          <Big value={pct(s.dividendYield)} label="Dividend yield" />
          <Big value={big(s.freeCashflow)} label="Free cash flow" />
          {s.beta != null && <Big value={r2(s.beta)} label="Beta" />}
        </div>
      </div>

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
          <Metric label="Dividend Rate" value={s.dividendRate == null ? "—" : fmtMoney(s.dividendRate, currency)} />
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
        </>
      )}
    </div>
  );
}

function deltaPct(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) < 0.0005) return "flat";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function BeatSummary({ surprises }: { surprises: import("@/lib/companyStats").SurpriseRow[] }) {
  const recent = surprises.slice(-8).filter((e) => e.surprisePercent != null);
  if (!recent.length) return null;
  const beats = recent.filter((e) => (e.surprisePercent ?? 0) > 0).length;
  const avg = recent.reduce((a, e) => a + (e.surprisePercent ?? 0), 0) / recent.length;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="text-[var(--text-2)]">
        Beat in <span className="font-semibold text-[var(--text)]">{beats} of {recent.length}</span> recent quarters
      </span>
      <span className="text-[var(--text-3)]">
        avg surprise{" "}
        <span className="font-semibold tabular-nums" style={{ color: trend(avg) }}>
          {avg >= 0 ? "+" : ""}{(avg * 100).toFixed(1)}%
        </span>
      </span>
    </div>
  );
}

function EstimateRevisions({ estimates, currency = "USD" }: { estimates: import("@/lib/companyStats").EstimatePeriod[]; currency?: string }) {
  const fwd = estimates.filter((e) => ["0q", "+1q", "0y", "+1y"].includes(e.period) && e.epsCurrent != null);
  if (!fwd.length) return null;
  const cy = fwd.find((e) => e.period === "0y") || fwd[0];
  const chg90 = cy.epsCurrent != null && cy.eps90dAgo ? cy.epsCurrent / cy.eps90dAgo - 1 : null;
  const netUp = (cy.epsUp30d ?? 0) - (cy.epsDown30d ?? 0);
  const rising = (chg90 != null && chg90 > 0.002) || netUp > 0;
  const falling = (chg90 != null && chg90 < -0.002) || netUp < 0;
  const signal =
    rising && !falling
      ? { t: "Estimates trending higher ↑", c: "#22c55e" }
      : falling && !rising
        ? { t: "Estimates trending lower ↓", c: "#ef4444" }
        : { t: "Estimates steady", c: "var(--text-3)" };
  return (
    <Section title="Estimate Revisions (consensus EPS)" wide>
      <div className="mb-2 text-xs">
        <span className="font-semibold" style={{ color: signal.c }}>{signal.t}</span>
        <span className="text-[var(--text-3)]"> · where consensus sits now vs. 30–90 days ago, and how many analysts moved each way</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-xs">
          <thead>
            <tr className="text-[var(--text-3)]">
              <th className="py-1 text-left font-medium">Period</th>
              <th className="py-1 text-right font-medium">EPS now</th>
              <th className="py-1 text-right font-medium">vs 30d</th>
              <th className="py-1 text-right font-medium">vs 90d</th>
              <th className="py-1 text-right font-medium">Revisions (30d)</th>
            </tr>
          </thead>
          <tbody>
            {fwd.map((e) => {
              const d30 = e.epsCurrent != null && e.eps30dAgo ? e.epsCurrent / e.eps30dAgo - 1 : null;
              const d90 = e.epsCurrent != null && e.eps90dAgo ? e.epsCurrent / e.eps90dAgo - 1 : null;
              return (
                <tr key={e.period} className="border-t border-[var(--divider)]">
                  <td className="py-1 text-left text-[var(--text-2)]">{periodName(e.period)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtMoney(e.epsCurrent, currency)}</td>
                  <td className="py-1 text-right tabular-nums" style={{ color: trend(d30) }}>{deltaPct(d30)}</td>
                  <td className="py-1 text-right tabular-nums" style={{ color: trend(d90) }}>{deltaPct(d90)}</td>
                  <td className="py-1 text-right tabular-nums">
                    <span className="text-[#22c55e]">↑{e.epsUp30d ?? 0}</span>{" "}
                    <span className="text-[#ef4444]">↓{e.epsDown30d ?? 0}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
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

function Section({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={"rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" + (wide ? " lg:col-span-2" : "")}>
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-2)]">{title}</h3>
      {children}
    </div>
  );
}

function actionMeta(action: string) {
  switch (action) {
    case "up": return { label: "Upgrade", color: "#22c55e" };
    case "down": return { label: "Downgrade", color: "#ef4444" };
    case "init": return { label: "Initiate", color: "#60a5fa" };
    case "reit": return { label: "Reiterate", color: "var(--text-3)" };
    case "main": return { label: "Maintain", color: "var(--text-3)" };
    default: return { label: action || "Update", color: "var(--text-3)" };
  }
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">{children}</div>;
}
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--divider)] py-2">
      <span className="text-[13px] text-[var(--text-3)]">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
// A large lead metric for the valuation headline strip.
function Big({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-bold leading-none tabular-nums" style={color ? { color } : undefined}>{value}</div>
      <div className="mt-1 text-[12px] text-[var(--text-4)]">{label}</div>
    </div>
  );
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2">
      <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
function Empty() {
  return <div className="py-2 text-xs text-[var(--text-3)]">Not available.</div>;
}

function RatingBar({ r }: { r: import("@/lib/companyStats").RatingDist }) {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell || 1;
  const segs = [
    { n: r.strongBuy, c: "#15803d", label: "Strong Buy" },
    { n: r.buy, c: "#22c55e", label: "Buy" },
    { n: r.hold, c: "var(--text-3)", label: "Hold" },
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
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-3)]">
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

function TargetBar({ low, mean, high, price, currency = "USD" }: { low: number | null; mean: number | null; high: number | null; price: number | null; currency?: string }) {
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
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-3)]">
        <span>low {fmtMoney(low, currency, 0)}</span>
        <span className="text-[#fbbf24]">▮ price</span>
        <span className="text-[var(--text)]">▮ target</span>
        <span>high {fmtMoney(high, currency, 0)}</span>
      </div>
    </div>
  );
}
