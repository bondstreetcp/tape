/**
 * Named preset stock screens (value/quality factor strategies), shared by the
 * Screener UI and the backtester so a screen and its backtest hold exactly the
 * same names. Each returns the passing symbols in the screen's natural rank order
 * (best first). All run off the snapshot's per-stock `fund` metrics + valuation.
 */
import type { StockRow } from "./types";

export type ScreenKey = "magic" | "erp5" | "qualval" | "netnet" | "piotroski" | "shyield" | "moat" | "rule40" | "mna" | "quality" | "peercheap" | "margininflect";
export interface ScreenOpts { topN?: number; pioMin?: number }

export const SCREEN_LABEL: Record<ScreenKey, string> = {
  magic: "Magic Formula (Greenblatt)",
  erp5: "ERP5 (4-Factor Value)",
  qualval: "Quality + Value Composite",
  netnet: "Net-Net / NCAV (Graham)",
  piotroski: "Piotroski F-Score",
  shyield: "Shareholder Yield (Faber)",
  moat: "Buffett–Munger Moat",
  rule40: "Rule of 40 (Growth + Profit)",
  mna: "M&A Target (Takeout)",
  quality: "Quality Percentile",
  peercheap: "Cheap vs Sector Peers",
  margininflect: "Margin Inflection + Re-accel",
};

/** Short labels for the toggle chips (shared by the Screener + Backtester). */
export const SCREEN_SHORT: Record<ScreenKey, string> = {
  magic: "Magic Formula",
  erp5: "ERP5",
  qualval: "Quality+Value",
  netnet: "Net-Net",
  piotroski: "Piotroski",
  shyield: "Sh. Yield",
  moat: "Moat",
  rule40: "Rule of 40",
  mna: "M&A Target",
  quality: "Quality",
  peercheap: "Cheap vs Peers",
  margininflect: "Margin Turn",
};

/** Display order for the screen chips and tooltips. */
export const SCREEN_ORDER: ScreenKey[] = ["magic", "erp5", "qualval", "netnet", "piotroski", "shyield", "moat", "rule40", "mna", "quality", "peercheap", "margininflect"];

/** Detailed, plain-English descriptions for the strategy tooltip + the beta-tester guide. */
export const SCREEN_INFO: Record<ScreenKey, { name: string; what: string; how: string; read: string }> = {
  magic: {
    name: "Magic Formula (Greenblatt)",
    what: "Joel Greenblatt's “Little Book That Beats the Market” strategy — buy good businesses at cheap prices.",
    how: "Ranks every company two ways — by earnings yield (how cheap) and by return on capital (how good) — sums the two ranks, and takes the best names. We proxy earnings yield with 1/(P/E) and return-on-capital with ROE; financials & utilities are excluded (the capital math doesn't fit) along with sub-$500M caps.",
    read: "Lower combined rank = better; the list is shown best-first. Use the Top-N selector to widen/narrow it.",
  },
  erp5: {
    name: "ERP5 (4-Factor Value)",
    what: "An extension of Greenblatt's Magic Formula (popularised by Evan Bleker) — it widens the net from two factors to four, leaning deeper value.",
    how: "Ranks every company four ways — earnings yield (1/(P/E)), return on capital (ROIC, falling back to ROE), price-to-book (cheap), and free-cash-flow yield (FCF ÷ market cap) — sums the four ranks, and takes the best names. Financials & utilities are excluded and sub-$500M caps dropped, same as the Magic Formula.",
    read: "Lower combined rank = better; shown best-first. Folding price-to-book and cash-flow yield into the Magic Formula's earnings-yield + return-on-capital tilts the list toward asset-cheap, cash-generative names. Use Top-N to widen/narrow.",
  },
  qualval: {
    name: "Quality + Value Composite",
    what: "A single blended rank that scores every company on cheapness and business quality at once — “wonderful companies at fair prices” in one number.",
    how: "Sums six factor ranks — three value (earnings yield, free-cash-flow yield, low price-to-book) and three quality (ROIC, operating margin, low net debt/EBITDA), value and quality weighted equally — and takes the best names. Ex financials/utilities, ≥$500M.",
    read: "Lower combined rank = better; best-first. Unlike stacking two screens (a hard AND), this is a soft blend — a name can rank near the top overall without topping any single screen, so it surfaces the best all-round profiles rather than the rare names that ace every filter.",
  },
  netnet: {
    name: "Net-Net / NCAV (Graham)",
    what: "Ben Graham's deepest value screen — buying a dollar of working capital for less than a dollar, with the business thrown in free.",
    how: "NCAV (net current asset value) = current assets − ALL liabilities, ignoring every fixed asset (plants, goodwill, brands). A “net-net” trades below its NCAV, so you're paying less than a conservative liquidation value.",
    read: "The Mkt / NCAV column: below 1.0 = under liquidation value; below 0.67× = Graham's strict net-net (green). Extremely rare in large caps (usually zero in the S&P 500) — switch to Broad 1500 or Russell 3000 to find them.",
  },
  piotroski: {
    name: "Piotroski F-Score (0–9)",
    what: "Joseph Piotroski's 9-point checklist of fundamental strength — it separates financially improving companies from deteriorating ones.",
    how: "One point each for: positive return on assets, positive operating cash flow, rising ROA, cash flow greater than net income (earnings quality), falling leverage, rising current ratio, no new share issuance, rising gross margin, and rising asset turnover.",
    read: "7–9 = strengthening (green), 0–3 = weakening (red). Set the minimum with the F-Score selector. Classic use: pair a high F-Score with cheap valuation to avoid value traps.",
  },
  shyield: {
    name: "Shareholder Yield (Faber)",
    what: "Meb Faber's total cash-return measure — every way a company hands cash back to owners, not just the dividend.",
    how: "Dividend yield + net buyback yield (how much the share count shrank) + net debt-paydown yield. The buyback & debt pieces are clamped to ±20% so a one-off spinoff or big deleveraging doesn't distort the ranking.",
    read: "Higher = more cash returned per dollar of market value; shown top-N first. A high yield from buybacks + debt paydown (not just dividends) is the signal Faber found most powerful.",
  },
  moat: {
    name: "Buffett–Munger Moat (Quality)",
    what: "The wonderful-business filter — a durable competitive advantage that lets a company compound at high returns for years, the kind Buffett & Munger pay up for.",
    how: "Keeps only names with a high return on invested capital (ROIC ≥ 15%), consistently fat operating margins (≥ 20%), and little debt (net debt ≤ 1.5× EBITDA, or net cash); the survivors are ranked by ROIC + operating margin. Financials are excluded — the capital/margin math doesn't translate.",
    read: "A deliberately short, high-conviction list — the thresholds are strict, so many universes return only a handful. It says nothing about price: pair a moat name with valuation work so you don't overpay for quality.",
  },
  rule40: {
    name: "Rule of 40 (Growth + Profitability)",
    what: "The SaaS/compounder rule of thumb — a healthy growth company's revenue growth rate plus its profit margin should clear 40%.",
    how: "Adds trailing revenue growth % to free-cash-flow margin % and keeps names where the sum is ≥ 40, ranked by the combined score (best first). A fast grower can run a thin margin and a mature compounder can grow slowly if the margin is fat — either way the total should reach 40. Ex financials (FCF margin doesn't apply to banks), ≥ $500M.",
    read: "Higher combined score = a better growth-vs-profitability trade-off. Born as a private-software benchmark; applied across the market it surfaces both efficient growers and high-margin steady compounders. Pair with valuation — a great Rule-of-40 score can still be richly priced.",
  },
  mna: {
    name: "M&A Target (Takeout Candidate)",
    what: "A heuristic for acquisition attractiveness — the profile of a clean, cash-generative business an acquirer could buy and finance, not a prediction that a bid is imminent.",
    how: "Filters for a digestible size ($300M–$25B), low leverage (net debt ≤ 2× EBITDA, or net cash — room for a buyer to lever it up), real cash generation (positive FCF margin) and margins (operating margin ≥ 8%), and an undemanding multiple (P/E ≤ 25, so there's headroom for a takeout premium). Survivors are ranked by a four-factor score — cheapness, FCF margin, ROIC, and low leverage. Ex financials.",
    read: "Lower combined rank = a cleaner, cheaper, more financeable target; shown best-first. It flags who looks acquirable on the numbers — not who's actually in play. Cross-check ownership, insider stakes and sector consolidation before reading anything into it.",
  },
  quality: {
    name: "Quality Percentile",
    what: "A single business-quality rank — how good the company is at turning capital into profit and cash, regardless of price.",
    how: "Sums six quality-factor ranks across the universe — return on invested capital, return on equity, gross margin, operating margin, free-cash-flow yield, and low net-debt/EBITDA — and takes the best names. Ex financials (the capital math doesn't translate), ≥$500M.",
    read: "Lower combined rank = higher quality; shown best-first. Quality says nothing about valuation — it's the universal first cut and a clean sort key to overlay on a value screen (cheap AND high-quality avoids value traps).",
  },
  peercheap: {
    name: "Cheap vs Sector Peers",
    what: "Cross-sectional relative value — names trading cheap versus their OWN sector's peers right now (not versus their own history).",
    how: "Within each sector, z-scores every name's P/E, forward P/E and price-to-book against the sector median, then ranks by the average z-score (more negative = cheaper than peers). Needs a real peer set (≥5 names per sector) and at least two valid multiples per name. Ex financials, ≥$500M.",
    read: "Most negative composite z = cheapest relative to its peers; shown cheapest-first. The complement to the Discount-to-History screen — that one is mean-reversion on a name's own multiples, this is cheapness across the cross-section. Pair with quality so you're buying a cheap good business, not a cheap broken one.",
  },
  margininflect: {
    name: "Margin Inflection + Re-acceleration",
    what: "The P&L turn that tends to precede consensus upgrades — operating margins expanding while revenue growth is re-accelerating.",
    how: "Keeps names where operating margin rose year-over-year AND the latest revenue growth is above the 3-year revenue CAGR (i.e. growth is speeding up, not slowing), ranked by the combined magnitude of the margin expansion and the acceleration. Ex financials, ≥$500M.",
    read: "Higher combined score = a stronger fundamental inflection. Catching the turn before the Street fully models it is where the re-rating lives; complements estimate-revision momentum (the fundamental turn vs. the Street's reaction to it). Pair with valuation — an inflecting name can already be richly priced.",
  },
};

/** Rank rows best-first by `val` (higher = better) → symbol → 0-based rank. */
function rankMap(rows: StockRow[], val: (s: StockRow) => number): Map<string, number> {
  const m = new Map<string, number>();
  [...rows].sort((a, b) => val(b) - val(a)).forEach((s, i) => m.set(s.symbol, i));
  return m;
}

export function screenSymbols(key: ScreenKey, stocks: StockRow[], opts: ScreenOpts = {}): string[] {
  const topN = opts.topN ?? 30;
  const pioMin = opts.pioMin ?? 7;

  if (key === "netnet") {
    // Graham deep value: market cap below net current asset value (rare outside small caps).
    return stocks
      .filter((s) => { const n = s.fund?.ncav; return n != null && n > 0 && s.marketCap < n; })
      .sort((a, b) => a.marketCap / a.fund!.ncav! - b.marketCap / b.fund!.ncav!) // deepest discount first
      .map((s) => s.symbol);
  }

  if (key === "piotroski") {
    return stocks
      .filter((s) => (s.fund?.fScore ?? -1) >= pioMin)
      .sort((a, b) => (b.fund!.fScore ?? 0) - (a.fund!.fScore ?? 0))
      .map((s) => s.symbol);
  }

  if (key === "shyield") {
    return stocks
      .filter((s) => s.fund?.shareholderYield != null)
      .sort((a, b) => b.fund!.shareholderYield! - a.fund!.shareholderYield!)
      .slice(0, topN)
      .map((s) => s.symbol);
  }

  if (key === "erp5") {
    // ERP5 (Bleker): a 4-factor value rank — earnings yield + return on capital + price-to-book
    // + free-cash-flow yield. Same exclusions as the Magic Formula (ex financials/utilities, ≥$500M);
    // needs all four inputs present so every name is comparable on every factor.
    const valid = stocks.filter(
      (s) =>
        (s.trailingPE ?? 0) > 0 &&
        (s.priceToBook ?? 0) > 0 &&
        (s.fund?.roic != null || s.fund?.roe != null) &&
        s.fund?.fcfYield != null &&
        s.etf !== "XLF" && s.etf !== "XLU" && (s.marketCap || 0) >= 5e8,
    );
    if (valid.length < 20) return [];
    const rEY = rankMap(valid, (s) => 1 / s.trailingPE!); // high earnings yield = better
    const rROC = rankMap(valid, (s) => s.fund!.roic ?? s.fund!.roe!); // high return on capital = better
    const rPB = rankMap(valid, (s) => -s.priceToBook!); // low price-to-book = better (negate)
    const rCF = rankMap(valid, (s) => s.fund!.fcfYield!); // high cash-flow yield = better
    return valid
      .map((s) => ({ sym: s.symbol, score: rEY.get(s.symbol)! + rROC.get(s.symbol)! + rPB.get(s.symbol)! + rCF.get(s.symbol)! }))
      .sort((a, b) => a.score - b.score)
      .slice(0, topN)
      .map((x) => x.sym);
  }

  if (key === "qualval") {
    // Quality + Value composite: blend three value factors (earnings yield, FCF yield, cheap P/B)
    // with three quality factors (ROIC, operating margin, low leverage), value and quality weighted
    // equally. A soft rank over the whole universe — ex financials/utilities, ≥$500M, all inputs present.
    const valid = stocks.filter(
      (s) =>
        (s.trailingPE ?? 0) > 0 &&
        (s.priceToBook ?? 0) > 0 &&
        s.fund?.fcfYield != null &&
        s.fund?.roic != null &&
        s.fund?.opMargin != null &&
        s.etf !== "XLF" && s.etf !== "XLU" && (s.marketCap || 0) >= 5e8,
    );
    if (valid.length < 20) return [];
    const rEY = rankMap(valid, (s) => 1 / s.trailingPE!);
    const rFCF = rankMap(valid, (s) => s.fund!.fcfYield!);
    const rPB = rankMap(valid, (s) => -s.priceToBook!);
    const rROIC = rankMap(valid, (s) => s.fund!.roic!);
    const rOM = rankMap(valid, (s) => s.fund!.opMargin!);
    const rLev = rankMap(valid, (s) => -(s.fund!.netDebtEbitda ?? 0)); // less leverage = better
    return valid
      .map((s) => {
        const value = rEY.get(s.symbol)! + rFCF.get(s.symbol)! + rPB.get(s.symbol)!;
        const quality = rROIC.get(s.symbol)! + rOM.get(s.symbol)! + rLev.get(s.symbol)!;
        return { sym: s.symbol, score: value + quality };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, topN)
      .map((x) => x.sym);
  }

  if (key === "moat") {
    // Buffett–Munger moat: durable high returns on capital, fat operating margins, little debt.
    // A quality FILTER (not a rank-sum) — survivors ranked by ROIC + operating margin, best first.
    // Net debt missing (≈ no debt / net cash) is allowed through the leverage gate.
    return stocks
      .filter(
        (s) =>
          (s.fund?.roic ?? -Infinity) >= 0.15 &&
          (s.fund?.opMargin ?? -Infinity) >= 0.2 &&
          (s.fund?.netDebtEbitda == null || s.fund.netDebtEbitda <= 1.5) &&
          s.etf !== "XLF" && (s.marketCap || 0) >= 5e8,
      )
      .sort((a, b) => b.fund!.roic! + b.fund!.opMargin! - (a.fund!.roic! + a.fund!.opMargin!))
      .slice(0, topN)
      .map((s) => s.symbol);
  }

  if (key === "rule40") {
    // Rule of 40: revenue growth % + FCF margin % ≥ 40%. A growth-vs-profitability health check —
    // fast growers can run thin margins, mature names lean on margin; the sum should clear 40. Needs
    // both inputs; ranked by the combined score, best first. Ex financials (FCF margin ≈ meaningless
    // for banks), ≥ $500M market cap + ≥ $100M revenue (so hyper-growth off a tiny base doesn't skew it).
    return stocks
      .filter(
        (s) =>
          s.fund?.revGrowth != null &&
          s.fund?.fcfMargin != null &&
          s.fund.revGrowth + s.fund.fcfMargin >= 0.4 &&
          (s.fund.revenue == null || s.fund.revenue >= 100e6) && // revenue floor — don't let hyper-growth off a tiny base skew the list
          s.etf !== "XLF" && (s.marketCap || 0) >= 5e8,
      )
      .sort((a, b) => b.fund!.revGrowth! + b.fund!.fcfMargin! - (a.fund!.revGrowth! + a.fund!.fcfMargin!))
      .slice(0, topN)
      .map((s) => s.symbol);
  }

  if (key === "mna") {
    // M&A / takeout target (heuristic): a clean, cash-generative mid-cap at an undemanding multiple —
    // the profile an acquirer can buy and finance. FILTER for digestible size ($300M–$25B), low
    // leverage (net debt ≤ 2× EBITDA or net cash — room to lever up), positive FCF margin + operating
    // margin ≥ 8%, and 0 < P/E ≤ 25. Survivors RANKED by a 4-factor takeout score (cheap + cash-
    // generative + high ROIC + low leverage). Ex financials. A screen for attractiveness, not a bid.
    const valid = stocks.filter(
      (s) =>
        (s.marketCap || 0) >= 3e8 && (s.marketCap || 0) <= 2.5e10 &&
        (s.trailingPE ?? 0) > 0 && s.trailingPE! <= 25 &&
        (s.fund?.fcfMargin ?? -1) > 0 &&
        (s.fund?.opMargin ?? -1) >= 0.08 &&
        (s.fund?.netDebtEbitda == null || s.fund.netDebtEbitda <= 2) &&
        s.etf !== "XLF",
    );
    if (valid.length < 10) return [];
    const rCheap = rankMap(valid, (s) => 1 / s.trailingPE!); // low P/E = cheap = better
    const rFCF = rankMap(valid, (s) => s.fund!.fcfMargin!);
    const rROIC = rankMap(valid, (s) => s.fund!.roic ?? s.fund!.roe ?? 0);
    const rLev = rankMap(valid, (s) => -(s.fund!.netDebtEbitda ?? 0)); // less debt = better
    return valid
      .map((s) => ({ sym: s.symbol, score: rCheap.get(s.symbol)! + rFCF.get(s.symbol)! + rROIC.get(s.symbol)! + rLev.get(s.symbol)! }))
      .sort((a, b) => a.score - b.score)
      .slice(0, topN)
      .map((x) => x.sym);
  }

  if (key === "quality") {
    // Composite quality: sum six quality-factor ranks (ROIC, ROE, gross & operating margin, FCF yield,
    // low leverage), best first. A pure quality rank — says nothing about price. Ex financials, ≥$500M.
    const valid = stocks.filter(
      (s) => s.fund?.roic != null && s.fund?.grossMargin != null && s.fund?.opMargin != null && s.fund?.fcfYield != null && s.etf !== "XLF" && (s.marketCap || 0) >= 5e8,
    );
    if (valid.length < 20) return [];
    const rROIC = rankMap(valid, (s) => s.fund!.roic!);
    const rROE = rankMap(valid, (s) => s.fund!.roe ?? -Infinity);
    const rGM = rankMap(valid, (s) => s.fund!.grossMargin!);
    const rOM = rankMap(valid, (s) => s.fund!.opMargin!);
    const rFCF = rankMap(valid, (s) => s.fund!.fcfYield!);
    const rLev = rankMap(valid, (s) => -(s.fund!.netDebtEbitda ?? 0)); // less leverage = better
    return valid
      .map((s) => ({ sym: s.symbol, score: rROIC.get(s.symbol)! + rROE.get(s.symbol)! + rGM.get(s.symbol)! + rOM.get(s.symbol)! + rFCF.get(s.symbol)! + rLev.get(s.symbol)! }))
      .sort((a, b) => a.score - b.score)
      .slice(0, topN)
      .map((x) => x.sym);
  }

  if (key === "peercheap") {
    // Cross-sectional relative value: z-score P/E, forward P/E and P/B against the SECTOR median,
    // rank by the average z (more negative = cheaper than peers). Needs a real peer set per sector.
    const valid = stocks.filter((s) => s.sector && (s.trailingPE ?? 0) > 0 && (s.priceToBook ?? 0) > 0 && s.etf !== "XLF" && (s.marketCap || 0) >= 5e8);
    if (valid.length < 20) return [];
    const bySector = new Map<string, StockRow[]>();
    for (const s of valid) { const l = bySector.get(s.sector); if (l) l.push(s); else bySector.set(s.sector, [s]); }
    const median = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const std = (xs: number[], mu: number) => Math.sqrt(xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / xs.length) || 1;
    const metrics: ((s: StockRow) => number | null | undefined)[] = [(s) => s.trailingPE, (s) => s.forwardPE, (s) => s.priceToBook];
    const sectorStats = new Map<string, ({ med: number; sd: number } | null)[]>();
    for (const [sec, list] of bySector) {
      if (list.length < 5) continue; // need a real peer set
      sectorStats.set(sec, metrics.map((m) => { const vals = list.map(m).filter((v): v is number => v != null && v > 0); if (vals.length < 5) return null; const md = median(vals); return { med: md, sd: std(vals, md) }; }));
    }
    return valid
      .map((s) => {
        const stats = sectorStats.get(s.sector);
        if (!stats) return null;
        const zs: number[] = [];
        metrics.forEach((m, i) => { const st = stats[i]; const v = m(s); if (st && v != null && v > 0) zs.push((v - st.med) / st.sd); });
        return zs.length >= 2 ? { sym: s.symbol, z: zs.reduce((a, b) => a + b, 0) / zs.length } : null;
      })
      .filter((x): x is { sym: string; z: number } => x != null)
      .sort((a, b) => a.z - b.z) // cheapest vs peers first
      .slice(0, topN)
      .map((x) => x.sym);
  }

  if (key === "margininflect") {
    // Margin inflection: operating margin up YoY AND revenue growth re-accelerating (latest YoY >
    // 3yr CAGR). Ranked by the combined magnitude of expansion + acceleration. Ex financials, ≥$500M.
    return stocks
      .filter(
        (s) =>
          (s.fund?.opMarginChg ?? -1) > 0 &&
          s.fund?.revGrowth != null && s.fund?.revCagr3y != null &&
          s.fund.revGrowth > s.fund.revCagr3y && s.fund.revGrowth > 0 &&
          s.etf !== "XLF" && (s.marketCap || 0) >= 5e8,
      )
      .sort((a, b) => b.fund!.opMarginChg! + (b.fund!.revGrowth! - b.fund!.revCagr3y!) - (a.fund!.opMarginChg! + (a.fund!.revGrowth! - a.fund!.revCagr3y!)))
      .slice(0, topN)
      .map((s) => s.symbol);
  }

  // Magic Formula (Greenblatt): earnings-yield rank + return-on-capital rank, summed,
  // best N. Proxy earnings yield with 1/(P/E), return-on-capital with ROE; ex financials
  // & utilities, ≥$500M cap.
  const valid = stocks.filter(
    (s) => (s.trailingPE ?? 0) > 0 && s.fund?.roe != null && s.etf !== "XLF" && s.etf !== "XLU" && (s.marketCap || 0) >= 5e8,
  );
  if (valid.length < 20) return [];
  const ey = new Map<string, number>();
  [...valid].sort((a, b) => 1 / b.trailingPE! - 1 / a.trailingPE!).forEach((s, i) => ey.set(s.symbol, i));
  const roc = new Map<string, number>();
  [...valid].sort((a, b) => b.fund!.roe! - a.fund!.roe!).forEach((s, i) => roc.set(s.symbol, i));
  return valid
    .map((s) => ({ sym: s.symbol, score: ey.get(s.symbol)! + roc.get(s.symbol)! }))
    .sort((a, b) => a.score - b.score)
    .slice(0, topN)
    .map((x) => x.sym);
}

/**
 * Stack several screens with a hard AND: a name must pass EVERY selected screen.
 * The survivors are ranked by the sum of their positions across the screens, so a
 * name that ranks high in all of them floats to the top. With one screen this is
 * exactly screenSymbols; with none, empty. Each screen is evaluated over the full
 * universe (not pre-sliced to Top-N) so the intersection is honest, then the final
 * list is capped at opts.topN.
 */
export function combinedScreenSymbols(keys: ScreenKey[], stocks: StockRow[], opts: ScreenOpts = {}): string[] {
  if (keys.length === 0) return [];
  if (keys.length === 1) return screenSymbols(keys[0], stocks, opts);
  const full: ScreenOpts = { ...opts, topN: 1e9 }; // every passing name, fully ranked
  const lists = keys.map((k) => screenSymbols(k, stocks, full));
  if (lists.some((l) => l.length === 0)) return []; // a screen with no names ⇒ empty intersection
  const pos = lists.map((l) => new Map(l.map((s, i) => [s, i] as const)));
  const inAll = lists[0].filter((s) => pos.every((m) => m.has(s)));
  return inAll
    .map((s) => ({ s, score: pos.reduce((acc, m) => acc + (m.get(s) ?? 0), 0) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, opts.topN ?? 30)
    .map((x) => x.s);
}
