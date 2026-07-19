/**
 * Plain-English book summary for the Portfolio Cockpit — the retail TL;DR above the dense cards. Turns the
 * computed stats into a few readable sentences ("your book runs 2× gross, long-biased, tilted to Tech")
 * plus guardrail flags ("one name is 30% of the book"). Deterministic — code composes the read, no LLM
 * (the app's doctrine). Pure + fs-free → unit-tested (tests/bookSummary.test.ts).
 */

import type { PortfolioStats } from "./portfolio";
import type { PortfolioRisk } from "./portfolioRisk";

export interface BookFlag { level: "warn" | "info" | "ok"; text: string }
export interface BookSummary { headline: string[]; flags: BookFlag[] }

const money = (n: number): string => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};
const pc = (frac: number): string => `${Math.round(frac * 100)}%`;

export function summarizeBook(input: {
  stats: PortfolioStats;
  risk: PortfolioRisk | null;
  tilts: { key: string; label: string; tilt: number; coverage: number }[];
  marketDown10Dollar: number | null; // scenarioPnL(stats, −10).dollar
  crashDollar: number | null; // a GFC-style stress $ (negative)
}): BookSummary {
  const { stats, risk, tilts, marketDown10Dollar, crashDollar } = input;
  const { gross, net, aum } = stats;
  const headline: string[] = [];
  if (!gross) return { headline: ["Add positions to see a read on your book."], flags: [] };

  // 1) Positioning — leverage + directionality.
  const dir = net / gross > 0.3 ? "long-biased" : net / gross < -0.3 ? "net short" : "roughly market-neutral";
  if (aum && aum > 0) {
    headline.push(`Your ${money(aum)} book runs ${pc(gross / aum)} gross and ${pc(net / aum)} net — ${dir}, about ${(gross / aum).toFixed(1)}× your capital.`);
  } else {
    headline.push(`Your book is ${money(gross)} gross and ${money(net)} net — ${dir}.`);
  }

  // 2) Concentration + biggest sector bet.
  const effN = stats.concentration.hhi > 0 ? 1 / stats.concentration.hhi : 0;
  const topSec = [...stats.bySector].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0];
  let conc = `The biggest position is ${pc(stats.concentration.top1)} of the book and the top 5 are ${pc(stats.concentration.top5)} — like ${effN ? effN.toFixed(0) : "—"} equal-weight bets.`;
  if (topSec && Math.abs(topSec.weight) >= 0.15) conc += ` Its largest sector bet is ${topSec.sector} at ${pc(topSec.weight)}.`;
  headline.push(conc);

  // 3) Predicted risk (from the holdings' history).
  if (risk) {
    const vol = risk.volAnnPct != null ? `about ${pc(risk.volAnnPct)}/yr` : `about ${money(risk.volAnnDollar)}/yr`;
    headline.push(`Based on its own history it swings ${vol}; a rough day (1-in-20) could lose about ${money(risk.var95Dollar)}.`);
  }

  // 4) Market sensitivity + a crash number, whichever we have. "cost"/"make" by sign so it reads for a
  // long or a short book, with magnitudes (no awkward double-negatives).
  if (stats.beta != null && marketDown10Dollar != null) {
    const crash = crashDollar != null ? `, and a 2008-style crash ${crashDollar <= 0 ? "cost" : "make"} about ${money(Math.abs(crashDollar))}` : "";
    headline.push(`With a ${stats.beta.toFixed(1)} market beta, a −10% market pullback would ${marketDown10Dollar <= 0 ? "cost" : "make"} roughly ${money(Math.abs(marketDown10Dollar))}${crash}.`);
  }

  // ---- Guardrail flags ----
  const flags: BookFlag[] = [];
  if (stats.concentration.top1 >= 0.25) flags.push({ level: "warn", text: `One name is ${pc(stats.concentration.top1)} of your book — a single-stock shock would hurt.` });
  if (topSec && Math.abs(topSec.weight) >= 0.4) flags.push({ level: "warn", text: `${topSec.sector} is ${pc(topSec.weight)} of your book — a big sector bet.` });
  if (stats.beta != null && Math.abs(stats.beta) >= 1.3) flags.push({ level: "warn", text: `β ${stats.beta.toFixed(1)} — you're geared to the market; a downturn bites harder.` });
  if (aum && aum > 0 && net / aum >= 1.5) flags.push({ level: "warn", text: `You're ${pc(net / aum)} net long on your equity — heavily directional.` });
  if (stats.liquidity && stats.liquidity.pctOver5d >= 0.1) flags.push({ level: "warn", text: `${pc(stats.liquidity.pctOver5d)} of the book takes over 5 days to sell — thin names.` });
  const mom = tilts.find((t) => t.key === "momentum");
  if (mom && mom.coverage > 0.3 && Math.abs(mom.tilt) >= 1.5) flags.push({ level: "info", text: `Strong momentum tilt (${mom.tilt >= 0 ? "+" : "−"}${Math.abs(mom.tilt).toFixed(1)}σ) — you ride trends hard, both ways.` });
  if (!flags.length && effN >= 12 && stats.concentration.top1 < 0.1) flags.push({ level: "ok", text: `Well spread — no single name or sector dominates.` });

  return { headline, flags: flags.slice(0, 5) };
}
