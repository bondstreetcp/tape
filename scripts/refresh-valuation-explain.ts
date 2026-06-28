/**
 * Cheap-vs-history, EXPLAINED — GLM labels each of the deepest valuation discounts as a GENUINE
 * discount vs a likely VALUE TRAP, grounded in the cheapest-but-telling signals (forward-vs-
 * trailing P/E = the market's earnings-direction view, the price trend, the depth of the
 * discount). Overlaid on the Discount-to-History screen. Runs in the nightly FULL rebuild AFTER
 * refresh-valuation-history + refresh-data.
 *   npm run refresh-valuation-explain
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadValuationHistory, type MultipleStat, type MultipleKey } from "../lib/valuationHistory";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { ValuationExplainMap, Verdict } from "../lib/valuationExplain";

const DATA = path.join(process.cwd(), "data");
const UNIVERSE = "russell3000";
const TOP = 40; // deepest discounts to label

const MULT_LABEL: Record<string, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);
const pct = (v: number | null | undefined, d = 0) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

async function main() {
  if (!(await llmConfigured())) {
    console.warn("valuation-explain: OPENROUTER_API_KEY not set — skipping.");
    return;
  }
  const [vh, snap] = await Promise.all([loadValuationHistory().catch(() => null), loadSnapshot(UNIVERSE).catch(() => null)]);
  if (!vh || !Object.keys(vh.names).length) {
    console.warn("valuation-explain: no valuation-history data — skipping.");
    return;
  }
  const ctx = new Map((snap?.stocks || []).map((s) => [s.symbol, s] as const));

  // Pick the deepest discounts with real context (in the snapshot, decent cap, genuine discount).
  const cand = Object.entries(vh.names)
    .map(([sym, n]) => {
      const mk = n.eligible?.[0];
      const st = mk ? n.multiples?.[mk] : undefined;
      return st && mk ? { sym, mk, st } : null;
    })
    .filter((x): x is { sym: string; mk: MultipleKey; st: MultipleStat } => x !== null)
    .filter((x) => x.st.z <= -1 && x.st.discountPct <= -15 && ctx.has(x.sym) && (ctx.get(x.sym)!.marketCap ?? 0) >= 1e9)
    .sort((a, b) => a.st.z - b.st.z)
    .slice(0, TOP);

  if (!cand.length) {
    console.log("valuation-explain: no qualifying discounts — skipping write.");
    return;
  }

  const lines = cand.map(({ sym, mk, st }) => {
    const c = ctx.get(sym)!;
    const earnDir =
      c.forwardPE != null && c.trailingPE != null
        ? c.forwardPE < c.trailingPE * 0.95
          ? "earnings expected to GROW (fwd P/E below trailing)"
          : c.forwardPE > c.trailingPE * 1.05
            ? "earnings expected to FALL (fwd P/E above trailing)"
            : "earnings roughly flat"
        : "earnings direction unclear";
    return (
      `${sym} (${c.name}) · ${c.sector || "?"} · ${money(c.marketCap)} · ${MULT_LABEL[mk] || mk} ${st.current.toFixed(1)} vs 10yr median ${st.median.toFixed(1)} (z ${st.z.toFixed(1)}, ${pct(st.discountPct)}) · ` +
      `price 3m ${pct(c.returns?.["3m"])}, 1y ${pct(c.returns?.["1y"])}, ${pct(c.pctFromHigh)} vs 52w-high · ${earnDir}${c.dividendYield ? ` · div ${(c.dividendYield).toFixed(1)}%` : ""}`
    );
  });

  const SYSTEM =
    "You are a value-investing analyst. Each name trades at a steep discount to its OWN 10-year valuation. For EACH, judge whether the cheapness is a GENUINE discount (the business is stable or improving and is simply out of favor — mean-reversion candidate) or a likely VALUE TRAP (the market is correctly pricing structural deterioration and the multiple may stay low or fall further), or MIXED (genuinely cheap but with real risks). " +
    "Lean on the supplied signals: forward-vs-trailing P/E is the market's earnings-direction view (rising earnings supports 'genuine'; falling earnings supports 'trap'); a price still making new lows / down hard over 1y suggests the market sees deterioration; a one-off recent dip with steady earnings suggests 'genuine'. Give ONE concise sentence of reasoning grounded in those signals — never invent fundamentals you weren't given. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"verdicts":[{"symbol": string, "verdict": "genuine"|"trap"|"mixed", "reason": string}]}';
  const user = `${SCHEMA}\n\nDEEP DISCOUNTS (each with discount depth + price trend + earnings direction):\n${lines.join("\n")}`;

  const out = await chatJSON<{ verdicts: { symbol: string; verdict: string; reason: string }[] }>(SYSTEM, user, { maxTokens: 5000, model: PRO_MODEL });
  const valid = new Set<Verdict>(["genuine", "trap", "mixed"]);
  const map: ValuationExplainMap = {};
  for (const v of out?.verdicts || []) {
    const sym = String(v?.symbol || "").toUpperCase();
    const verdict = String(v?.verdict || "").toLowerCase() as Verdict;
    if (sym && valid.has(verdict) && v?.reason) map[sym] = { verdict, reason: String(v.reason).trim().slice(0, 240) };
  }
  if (!Object.keys(map).length) {
    console.warn("valuation-explain: LLM returned no usable verdicts — skipping write.");
    return;
  }
  await fs.writeFile(path.join(DATA, "valuation-explain.json"), JSON.stringify({ generatedAt: new Date().toISOString(), verdicts: map }));
  const tally = Object.values(map).reduce((a, v) => ((a[v.verdict] = (a[v.verdict] || 0) + 1), a), {} as Record<string, number>);
  console.log(`valuation-explain: wrote ${Object.keys(map).length} verdicts · ${JSON.stringify(tally)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
