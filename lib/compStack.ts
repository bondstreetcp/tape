/**
 * Two-year comp-STACK analyzer — what a retailer's / restaurant's comparable-sales GUIDE implies for the
 * two-year stack over the REST of its fiscal year. The desk question after every retail print ("what does
 * the FIVE guide imply for the stack?"), computed in code from the disclosed comp series (lib/sameStoreSales)
 * plus the comp outlook read from the latest release (SssTicker.guide, sanitized by lib/compGuide).
 *
 *   stack       = this quarter's comp + the comp it LAPS a year earlier (additive — the sell-side shorthand and
 *                 the Comps Board column; compBogey keeps the multiplicative form for its single-quarter bogey)
 *   guided qtr  → its stack range straight from the guide
 *   un-guided   → back-solved from the FY comp guide: FY ≈ Σ wᵢ·compᵢ over the four fiscal quarters, with the
 *                 actual year-to-date quarters and the guided quarter known, so the remainder's blended comp falls
 *                 out. Weights = the PRIOR year's quarterly revenue (the proxy for comp-store dollars); equal
 *                 weights when no revenue history is supplied — flagged in `notes`, and worth ±~1pt.
 *   hold-stack  → the comps that would merely HOLD the just-reported stack flat through year-end, and the FY comp
 *                 that path adds up to vs the guide — i.e. how much the guide leaves on the table if momentum holds.
 *
 * CLIENT-SAFE: pure math, no fs/llm/network. Used by the /comp-stacks board and the Earnings-prep card.
 */
import type { SssData, SssPeriod, SssTicker } from "./sameStoreSales";

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;
const QTR = YEAR / 4;

export type Qn = 1 | 2 | 3 | 4;
export interface FiscalTag { q: Qn; fy: number | null } // fy normalized to 4 digits (FY26 → 2026)

const WORD_Q: Record<string, Qn> = { first: 1, second: 2, third: 3, fourth: 4 };

/** The 4-digit fiscal year in an issuer label ("FY26", "FY 2026", "fiscal 2027", "3Q26", "Q2 '25"); null if none. */
export function fiscalYearOf(label?: string | null): number | null {
  if (!label) return null;
  const s = String(label);
  const y =
    s.match(/\b(?:FY|F)\s?'?(\d{4}|\d{2})\b/i) ||
    s.match(/\b(?:fiscal|fy)(?:\s*year)?\s*'?(\d{4}|\d{2})\b/i) ||
    s.match(/\b[1-4]Q\s?'?(\d{4}|\d{2})\b/i) ||
    s.match(/'(\d{2})\b/) ||
    s.match(/\b(20\d{2})\b/);
  if (!y) return null;
  const n = Number(y[1]);
  return y[1].length === 2 ? 2000 + n : n;
}

/** Parse an issuer fiscal label ("Q3 FY26", "3Q26", "Q2 '25", "third quarter fiscal 2026", "Q1 2027") into its
 *  quarter number + fiscal year. null when no quarter number can be read (the year is optional). */
export function parseFiscalLabel(label?: string | null): FiscalTag | null {
  if (!label) return null;
  const s = String(label).trim();
  let q: Qn | null = null;
  const m = s.match(/\bQ\s?([1-4])\b/i) || s.match(/\b([1-4])Q(?=\d|\b)/i);
  if (m) q = Number(m[1]) as Qn;
  else {
    const w = s.match(/\b(first|second|third|fourth)[- ]?(?:fiscal[- ])?quarter/i);
    if (w) q = WORD_Q[w[1].toLowerCase()];
  }
  if (!q) return null;
  return { q, fy: fiscalYearOf(s) };
}

export interface StackPoint {
  label: string;
  q: Qn | null; // fiscal quarter number (null on a history point whose label has none)
  fpEnd: string | null; // the actual period end (reported) or the EXPECTED end (remaining), ISO
  kind: "actual" | "guided" | "implied";
  comp: number | null; // the actual comp, or the guided / implied MIDPOINT
  compLow: number | null; // the range on guided / implied points (null on actuals)
  compHigh: number | null;
  lap: number | null; // the comp this quarter laps (the same fiscal quarter a year earlier)
  stack: number | null; // comp + lap (midpoint for ranges)
  stackLow: number | null;
  stackHigh: number | null;
  weight: number | null; // this quarter's share of the fiscal year (prior-year revenue weight, or 0.25)
}

export interface CompStackAnalysis {
  latest: StackPoint; // the just-reported quarter
  history: StackPoint[]; // reported quarters, oldest → newest (≤ 8), `latest` last
  fiscal: { fy: number | null; latestQ: Qn; solvingNextFy: boolean; remainingQs: Qn[] };
  remaining: StackPoint[]; // the rest of the fiscal year being solved, in order (guided and/or implied)
  fyGuide: { label: string; low: number; high: number; mid: number; priorLow: number | null; priorHigh: number | null } | null;
  nextQGuide: { label: string; low: number; high: number } | null;
  ytdComp: number | null; // blended (weighted) actual comp for the year so far
  ytdCompStated: number | null; // the YTD comp the release itself states, if any (cross-check)
  implied: { quarters: string[]; low: number; mid: number; high: number } | null; // the FY guide's blended comp for the UN-guided remainder
  piecesFy: { low: number; mid: number; high: number } | null; // when nothing is left to solve: the FY comp the actual + guided pieces add up to
  holdStack: { stack: number; comps: { label: string; comp: number }[]; fyComp: number | null; vsGuideMid: number | null } | null;
  stackShift: number | null; // mean(remaining stack − latest stack), pts: negative = the guide embeds deceleration
  read: { tag: "decel" | "flat" | "accel"; text: string } | null;
  revenueCheck: { quarters: string[]; revLowM: number; revHighM: number; lyRevM: number; growthLow: number; growthHigh: number } | null;
  weightSource: "revenue" | "equal";
  guideStatus: "fresh" | "stale" | "none";
  notes: string[];
}

export interface AnalyzeOpts {
  /** Quarterly total revenue in $M (any order) — for the fiscal-quarter weights + the revenue cross-check. */
  revenueByDate?: { date: string; rev: number | null }[];
  /** ± pts of stack shift that still reads as "holds the stack flat" (default 2.5). */
  flatBand?: number;
}

/** Signed 1-dp percent with a real minus sign: +12.3 / −3.1 (the read text + the boards share it). */
export const sgn = (v: number, d = 1): string => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(d)}`;

function periodNear(ps: SssPeriod[], target: number, tolDays: number): SssPeriod | null {
  let best: SssPeriod | null = null, bd = Infinity;
  for (const p of ps) {
    const d = Math.abs(Date.parse(p.fpEnd) - target);
    if (d <= tolDays * DAY && d < bd) { best = p; bd = d; }
  }
  return best;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function analyzeCompStack(tk: SssTicker, opts: AnalyzeOpts = {}): CompStackAnalysis | null {
  const ps = (tk.periods || [])
    .filter((p) => p.comp != null && Number.isFinite(Date.parse(p.fpEnd)))
    .sort((a, b) => Date.parse(b.fpEnd) - Date.parse(a.fpEnd));
  if (ps.length < 2) return null;
  const latestP = ps[0];
  const notes: string[] = [];

  // The comp outlook is only trusted when it was read from the SAME release as the latest comp — a guide from
  // the prior print would pair last quarter's outlook with this quarter's actuals and mis-solve the remainder.
  const guideStatus: CompStackAnalysis["guideStatus"] = !tk.guide ? "none" : !tk.lastAccession || tk.guide.accession === tk.lastAccession ? "fresh" : "stale";
  const guide = guideStatus === "fresh" ? tk.guide! : null;
  if (guideStatus === "stale") notes.push("Comp outlook not yet re-read from the latest release — the guide-implied read is pending the next refresh.");

  // Which fiscal quarter was just reported: the issuer's own label, else back out of the guide's next-quarter label.
  let tag = parseFiscalLabel(latestP.fiscalLabel);
  if (!tag) {
    const nq = parseFiscalLabel(tk.guide?.nextQ?.label);
    if (nq) tag = { q: (nq.q === 1 ? 4 : nq.q - 1) as Qn, fy: nq.fy == null ? null : nq.q === 1 ? nq.fy - 1 : nq.fy };
  }
  if (!tag) return null;
  const qn = tag.q;
  const solvingNextFy = qn === 4; // a year-end print guides the NEXT fiscal year — solve that one
  const fy = tag.fy == null ? null : solvingNextFy ? tag.fy + 1 : tag.fy;
  const fyTag = fy == null ? "" : ` FY${String(fy).slice(-2)}`;
  const qLabel = (k: Qn) => `Q${k}${fyTag}`;
  const t0 = Date.parse(latestP.fpEnd);
  // Expected period-end of fiscal slot k (1-4) of the year being solved, on a 91.3-day grid off the latest print.
  const endOf = (k: number) => (solvingNextFy ? t0 + k * QTR : t0 - (qn - k) * QTR);
  const actualQs = (solvingNextFy ? [] : [1, 2, 3, 4].slice(0, qn)) as Qn[];
  const remainingQs = (solvingNextFy ? [1, 2, 3, 4] : [1, 2, 3, 4].slice(qn)) as Qn[];

  // Per fiscal slot: the reported period (if this year's), the comp it laps, and the prior-year revenue weight.
  const revs = (opts.revenueByDate || [])
    .filter((r) => r.rev != null && r.rev > 0 && Number.isFinite(Date.parse(r.date)))
    .map((r) => ({ d: Date.parse(r.date), rev: r.rev as number }));
  const revNear = (target: number, tolDays = 45): number | null => {
    let best: number | null = null, bd = Infinity;
    for (const r of revs) {
      const d = Math.abs(r.d - target);
      if (d <= tolDays * DAY && d < bd) { best = r.rev; bd = d; }
    }
    return best;
  };
  const slots = ([1, 2, 3, 4] as Qn[]).map((k) => {
    const act = actualQs.includes(k) ? (k === qn ? latestP : periodNear(ps, endOf(k), 40)) : null;
    const end = act ? Date.parse(act.fpEnd) : endOf(k);
    const lapP = periodNear(ps, end - YEAR, 45);
    const lyRev = revNear(lapP ? Date.parse(lapP.fpEnd) : end - YEAR);
    return { k, end, act, lap: lapP?.comp ?? null, lyRev, rev: act ? revNear(end) : null };
  });
  const allRev = slots.every((s) => s.lyRev != null);
  const weightSource: CompStackAnalysis["weightSource"] = allRev ? "revenue" : "equal";
  const totRev = allRev ? slots.reduce((a, s) => a + (s.lyRev as number), 0) : 0;
  const weightOf = (k: Qn) => (allRev ? (slots[k - 1].lyRev as number) / totRev : 0.25);
  if (!allRev) notes.push("Quarter weights are equal (no prior-year quarterly revenue on file) — the implied comps are approximate.");
  const ytdComplete = slots.filter((s) => actualQs.includes(s.k)).every((s) => s.act != null);
  if (!ytdComplete) notes.push("A year-to-date quarter's comp is missing from the series — the FY back-solve needs every reported quarter.");

  // History: every reported quarter with the comp it lapped, oldest → newest.
  const history: StackPoint[] = ps.slice(0, 8).map((p) => {
    const lap = periodNear(ps, Date.parse(p.fpEnd) - YEAR, 45)?.comp ?? null;
    return {
      label: p.fiscalLabel || p.fpEnd, q: parseFiscalLabel(p.fiscalLabel)?.q ?? null, fpEnd: p.fpEnd, kind: "actual" as const,
      comp: p.comp as number, compLow: null, compHigh: null, lap, stack: lap == null ? null : (p.comp as number) + lap, stackLow: null, stackHigh: null,
      weight: null,
    };
  }).reverse();
  const latest = history[history.length - 1];
  const S = latest.stack; // the stack to hold

  // The guided upcoming quarter (its slot from the label; else the first remaining quarter).
  const nq = guide?.nextQ && guide.nextQ.compLow != null && guide.nextQ.compHigh != null ? guide.nextQ : null;
  let guidedQ: Qn | null = null;
  if (nq && remainingQs.length) {
    const t = parseFiscalLabel(nq.label);
    guidedQ = t && remainingQs.includes(t.q) ? t.q : remainingQs[0];
  }
  const nextQGuide = nq ? { label: nq.label, low: nq.compLow as number, high: nq.compHigh as number } : null;

  // The FY guide — must cover the year being solved (label-convention drift of one year is tolerated: the
  // accession gate already excludes a genuinely stale guide).
  const fg = guide?.fy && guide.fy.compLow != null && guide.fy.compHigh != null ? guide.fy : null;
  let fyGuide: CompStackAnalysis["fyGuide"] = null;
  if (fg) {
    const gy = fiscalYearOf(fg.label);
    if (gy != null && fy != null && Math.abs(gy - fy) > 1) notes.push(`The release's ${fg.label} comp guide covers a different year than the one being solved (FY${String(fy).slice(-2)}) — not used.`);
    else fyGuide = { label: fg.label, low: fg.compLow as number, high: fg.compHigh as number, mid: ((fg.compLow as number) + (fg.compHigh as number)) / 2, priorLow: fg.priorCompLow ?? null, priorHigh: fg.priorCompHigh ?? null };
  }

  // The rest of the year: guided slot from the guide, the others to be solved.
  const remaining: StackPoint[] = remainingQs.map((k) => {
    const s = slots[k - 1];
    const base: StackPoint = { label: qLabel(k), q: k, fpEnd: iso(s.end), kind: "implied", comp: null, compLow: null, compHigh: null, lap: s.lap, stack: null, stackLow: null, stackHigh: null, weight: weightOf(k) };
    if (k === guidedQ && nq) {
      const lo = nq.compLow as number, hi = nq.compHigh as number, mid = (lo + hi) / 2;
      const label = parseFiscalLabel(nq.label)?.q === k && nq.label ? nq.label : base.label;
      return { ...base, label, kind: "guided", comp: mid, compLow: lo, compHigh: hi, stack: s.lap == null ? null : mid + s.lap, stackLow: s.lap == null ? null : lo + s.lap, stackHigh: s.lap == null ? null : hi + s.lap };
    }
    return base;
  });

  // Year-to-date blend (weighted actual comps of this year's reported quarters).
  const actualSlots = slots.filter((s) => actualQs.includes(s.k));
  const wActual = actualSlots.reduce((a, s) => a + weightOf(s.k), 0);
  const ytdComp = ytdComplete && actualSlots.length ? actualSlots.reduce((a, s) => a + weightOf(s.k) * (s.act!.comp as number), 0) / wActual : null;

  // Back-solve the un-guided remainder from the FY guide (low↔low, high↔high pairings = guide-consistent scenarios).
  let implied: CompStackAnalysis["implied"] = null;
  let piecesFy: CompStackAnalysis["piecesFy"] = null;
  if (fyGuide && ytdComplete) {
    const guided = remaining.find((r) => r.kind === "guided");
    const known = (x: "low" | "mid" | "high") =>
      actualSlots.reduce((a, s) => a + weightOf(s.k) * (s.act!.comp as number), 0) +
      (guided ? (guided.weight as number) * (x === "low" ? (guided.compLow as number) : x === "high" ? (guided.compHigh as number) : (guided.comp as number)) : 0);
    const unknown = remaining.filter((r) => r.kind !== "guided");
    const Wu = unknown.reduce((a, r) => a + (r.weight as number), 0);
    if (Wu > 1e-9) {
      const low = (fyGuide.low - known("low")) / Wu, mid = (fyGuide.mid - known("mid")) / Wu, high = (fyGuide.high - known("high")) / Wu;
      implied = { quarters: unknown.map((r) => r.label), low, mid, high };
      for (const r of unknown) {
        r.comp = mid; r.compLow = low; r.compHigh = high;
        if (r.lap != null) { r.stack = mid + r.lap; r.stackLow = low + r.lap; r.stackHigh = high + r.lap; }
      }
    } else {
      piecesFy = { low: known("low"), mid: known("mid"), high: known("high") };
    }
  }

  // Hold-the-stack: the comp each remaining quarter needs to keep the just-reported stack, and the FY it adds to.
  let holdStack: CompStackAnalysis["holdStack"] = null;
  if (S != null && remaining.length) {
    const comps = remaining.filter((r) => r.lap != null).map((r) => ({ label: r.label, comp: S - (r.lap as number) }));
    const full = comps.length === remaining.length && ytdComplete;
    const fyComp = full
      ? actualSlots.reduce((a, s) => a + weightOf(s.k) * (s.act!.comp as number), 0) + remaining.reduce((a, r) => a + (r.weight as number) * (S - (r.lap as number)), 0)
      : null;
    holdStack = { stack: S, comps, fyComp, vsGuideMid: fyComp != null && fyGuide ? fyComp - fyGuide.mid : null };
  }

  // The read: where the guide takes the stack vs where it is now.
  const stackShift = S == null ? null : mean(remaining.filter((r) => r.stack != null).map((r) => (r.stack as number) - S));
  let read: CompStackAnalysis["read"] = null;
  if (stackShift != null && S != null) {
    const band = opts.flatBand ?? 2.5;
    const path = remaining.filter((r) => r.stack != null).map((r) => `${sgn(r.stack as number)} (${r.label}, ${r.kind})`).join(", ");
    const hold = holdStack && holdStack.fyComp != null && fyGuide
      ? ` Holding the stack flat would take ${holdStack.comps.map((c) => `${c.label} ${sgn(c.comp)}`).join(" / ")} and add up to FY comps ${sgn(holdStack.fyComp)} vs the ${sgn(fyGuide.low, 0)} to ${sgn(fyGuide.high, 0)}% guide.`
      : "";
    if (stackShift <= -band) read = { tag: "decel", text: `The guide implies the 2-yr stack fading from ${sgn(S)} to ${path} — about ${Math.abs(stackShift).toFixed(1)} pts of deceleration into year-end.${hold}` };
    else if (stackShift >= band) read = { tag: "accel", text: `The guide assumes the 2-yr stack BUILDING from ${sgn(S)} to ${path} — about ${stackShift.toFixed(1)} pts of acceleration.${hold}` };
    else read = { tag: "flat", text: `The guide holds the 2-yr stack roughly flat: ${sgn(S)} now → ${path}.${hold}` };
  }

  // Revenue cross-check: the FY $ guide less YTD actual less the guided quarter = what the un-guided quarters must do vs last year.
  let revenueCheck: CompStackAnalysis["revenueCheck"] = null;
  const fr = guide?.fy;
  if (fr && fr.revLowM != null && fr.revHighM != null && allRev && ytdComplete && actualSlots.every((s) => s.rev != null)) {
    const guided = remaining.find((r) => r.kind === "guided");
    const gRev = guided ? (nq && nq.revLowM != null && nq.revHighM != null ? { lo: nq.revLowM, hi: nq.revHighM } : null) : { lo: 0, hi: 0 };
    const unknown = remaining.filter((r) => r.kind !== "guided");
    if (gRev && unknown.length) {
      const ytdRev = actualSlots.reduce((a, s) => a + (s.rev as number), 0);
      const lyRevM = unknown.reduce((a, r) => a + (slots[(r.q as Qn) - 1].lyRev as number), 0);
      const revLowM = fr.revLowM - ytdRev - gRev.lo, revHighM = fr.revHighM - ytdRev - gRev.hi;
      if (lyRevM > 0 && revLowM > 0) revenueCheck = { quarters: unknown.map((r) => r.label), revLowM, revHighM, lyRevM, growthLow: (revLowM / lyRevM - 1) * 100, growthHigh: (revHighM / lyRevM - 1) * 100 };
    }
  }

  return {
    latest, history,
    fiscal: { fy, latestQ: qn, solvingNextFy, remainingQs },
    remaining, fyGuide, nextQGuide,
    ytdComp, ytdCompStated: guide?.ytdComp ?? null,
    implied, piecesFy, holdStack, stackShift, read, revenueCheck, weightSource, guideStatus, notes,
  };
}

// ── The /comp-stacks board ───────────────────────────────────────────────────────────────────────
export interface CompStackRow {
  ticker: string;
  name: string;
  industry: string;
  region: string;
  metricLabel: string;
  sourceUrl: string; // the latest comp's filing
  guideUrl: string | null; // the release the outlook was read from
  analysis: CompStackAnalysis;
}

/** Every name with a stackable comp series (a reported quarter AND the quarter it laps), analyzed. Names with a
 *  fresh guide sort first — most embedded deceleration first (the sandbag candidates) — then the rest by the
 *  latest stack. `revenueOf` supplies quarterly revenue ($M) for the weights; omit for equal weights. */
export function buildCompStackRows(
  data: SssData,
  nameOf: (t: string) => string | undefined,
  revenueOf?: (t: string) => AnalyzeOpts["revenueByDate"] | undefined,
): CompStackRow[] {
  const rows: CompStackRow[] = [];
  for (const [ticker, tk] of Object.entries(data.byTicker)) {
    const a = analyzeCompStack(tk, { revenueByDate: revenueOf?.(ticker) });
    if (!a || a.latest.stack == null) continue;
    const latestP = tk.periods.find((p) => p.comp != null);
    rows.push({
      ticker, name: nameOf(ticker) || ticker, industry: tk.industry || "", region: tk.region || "US",
      metricLabel: tk.metricLabel, sourceUrl: latestP?.source.url || "", guideUrl: a.guideStatus === "fresh" ? tk.guide?.url ?? null : null,
      analysis: a,
    });
  }
  const guided = (r: CompStackRow) => (r.analysis.stackShift != null ? 0 : 1);
  return rows.sort((a, b) =>
    guided(a) - guided(b) ||
    (a.analysis.stackShift ?? 0) - (b.analysis.stackShift ?? 0) ||
    (b.analysis.latest.stack ?? -99) - (a.analysis.latest.stack ?? -99),
  );
}
