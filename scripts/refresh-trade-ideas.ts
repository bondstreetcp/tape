/**
 * Trade Desk — assembles the top CODE-DETECTED options mispricings from the nightly feeds (earnings-move,
 * vol-dislocation, catalyst-vol), deterministically scores + diversifies them, then asks ONE LLM call to
 * SELECT the best few and write a thesis / risk / conviction / trap flag for each. The ticker, structure,
 * and stat (the mispricing) are FIXED BY CODE — the LLM only narrates + selects, never invents a number.
 * Writes data/trade-ideas.json. Nightly (FULL), after the source feeds. Needs OPENROUTER_API_KEY; if the
 * LLM is unavailable it still writes the code-scored shortlist (no narrative), so the page never breaks.
 */
import { promises as fs } from "fs";
import path from "path";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { cleanTicker } from "../lib/llmValidate";
import type { VolDisData } from "../lib/volDislocation";
import { sideLabel, type TradeIdea, type TradeDeskData, type Conviction } from "../lib/tradeIdeas";

const DATA = path.join(process.cwd(), "data");
const PICK = Number(process.env.TRADE_PICKS || 8);
const POOL = 24; // candidate pool (was 16) — more survivors reach the LLM narrator

const readJSON = async (f: string): Promise<any> => {
  const r = await fs.readFile(path.join(DATA, f), "utf8").catch(() => null);
  if (!r) return null;
  try { return JSON.parse(r); } catch { return null; }
};
const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 1) => (x == null ? "—" : x.toFixed(d));

function assemble(em: any, vd: (VolDisData & any) | null, cv: any): TradeIdea[] {
  const out: TradeIdea[] = [];

  // 1) Earnings-move — the implied straddle vs the name's OWN typical post-earnings move.
  for (const r of em?.rows || []) {
    if (!(r.histN >= 3) || !(r.straddle > 0) || r.richness == null) continue;
    const rich = r.richness >= 1.25, cheap = r.richness <= 0.8;
    if (!rich && !cheap) continue;
    // Cap the rich edge (mirrors the vol-dislocation branch): richness runs to 3-5× for low-vol names whose
    // typical move is tiny (banks/staples) — a far thinner dollar/vega edge than the raw ratio implies.
    const edge = rich ? Math.min(r.richness - 1, 1.0) : 1 - r.richness;
    // ...and weight by the premium actually at stake, so a 4%-vs-1.2% ratio artifact doesn't outrank a
    // bigger-move name with real premium (an 8%+ implied move is worth ~full weight).
    const moveFactor = Math.min((r.impliedMovePct ?? 0) / 8, 1.25);
    out.push({
      symbol: r.symbol, name: r.name, sector: r.sector || "—", price: r.price ?? null,
      source: "earnings-move",
      structure: rich ? "Sell the ATM straddle into the print" : "Buy the ATM straddle into the print",
      side: rich ? "sell-vol" : "buy-vol",
      stat: `Implied ±${num(r.impliedMovePct)}% vs ~${num(r.histAvgMovePct)}% typical move (n=${r.histN}); ATM IV ${pct(r.impliedIV)}`,
      event: r.daysToEarnings != null ? `Earnings ~in ${r.daysToEarnings}d (${(r.earningsDate || "").slice(0, 10)})` : null,
      daysToEvent: r.daysToEarnings ?? null, expiry: r.expiry ?? null,
      score: edge * (Math.min(r.histN, 8) / 8) * (r.daysToEarnings != null && r.daysToEarnings <= 14 ? 1.25 : 1) * moveFactor,
    });
  }

  // 2) Vol Dislocation — the variance premium (ATM IV ÷ realized), non-earnings + liquid only.
  for (const r of vd?.rows || []) {
    if (r.earningsDriven || r.illiquid || r.ivPremium == null) continue;
    const rich = r.ivPremium >= 1.6, cheap = r.ivPremium <= 0.9;
    if (!rich && !cheap) continue;
    // Cap the rich edge: an IV/RV above ~2.5× is usually a data/distress artifact (stale option, real
    // solvency scare), not a "cleaner" trade — don't let 5-6× outliers crowd out moderate dislocations.
    const edge = rich ? Math.min(r.ivPremium - 1.15, 1.35) : 1.15 - r.ivPremium;
    out.push({
      symbol: r.symbol, name: r.name, sector: r.sector || "—", price: r.price ?? null,
      source: "vol-dislocation",
      structure: rich ? "Sell premium (rich vol vs realized)" : "Buy vol (cheap vs realized)",
      side: rich ? "sell-vol" : "buy-vol",
      stat: `IV/RV ${num(r.ivPremium, 2)}× — ATM IV ${pct(r.atmIV)} vs realized ${pct(r.rvol)}${r.skew != null ? `; skew ${(r.skew * 100).toFixed(0)}` : ""}${r.catalyst ? ` · ⚡ ${r.catalyst.text}` : ""}`,
      event: r.catalyst ? `Possible catalyst: ${r.catalyst.text}` : null,
      daysToEvent: r.daysToEarnings ?? null, expiry: null,
      // down-weight rich vol that already has a headline catalyst (likely a trap, not a free premium)
      score: edge * (r.catalyst ? 0.7 : 1) * (r.broad ? 0.85 : 1),
    });
  }

  // 3) Catalyst-Vol — cheap options into a SCHEDULED event (investor day, capital-markets day…).
  for (const r of cv?.rows || []) {
    if (r.ratio == null || r.ratio >= 0.85) continue;
    out.push({
      symbol: r.ticker, name: r.company, sector: "—", price: r.price ?? null,
      source: "catalyst-vol",
      structure: `Buy options into the ${r.eventType}`,
      side: "buy-event",
      stat: `Implied ±${num(r.impliedMovePct)}% vs ~${num(r.baselineMovePct)}% baseline (ratio ${num(r.ratio, 2)}); ${r.daysToEvent}d to the event`,
      event: `${r.eventType} ${r.eventDate}`,
      daysToEvent: r.daysToEvent ?? null, expiry: r.expiry ?? null,
      score: (1 - r.ratio) * (r.daysToEvent != null && r.daysToEvent <= 60 ? 1.2 : 1),
    });
  }
  return out;
}

// Dedupe by symbol (strongest signal wins), rank, then diversify by source so it's not all one kind.
function topPool(cands: TradeIdea[], n = POOL): TradeIdea[] {
  const best = new Map<string, TradeIdea>();
  for (const c of cands) {
    const cur = best.get(c.symbol);
    if (!cur || c.score > cur.score) best.set(c.symbol, c);
  }
  const all = [...best.values()].sort((a, b) => b.score - a.score);
  const caps: Record<string, number> = { "earnings-move": 8, "vol-dislocation": 6, "catalyst-vol": 6 };
  const seen: Record<string, number> = {};
  const pool: TradeIdea[] = [];
  for (const c of all) {
    if ((seen[c.source] || 0) >= (caps[c.source] ?? 6)) continue;
    seen[c.source] = (seen[c.source] || 0) + 1;
    pool.push(c);
    if (pool.length >= n) break;
  }
  return pool;
}

const clamp = (s: any, n: number): string => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, n) : "");
const normConv = (c: any): Conviction => (c === "high" ? "high" : c === "low" ? "low" : "medium");
const convRank: Record<Conviction, number> = { high: 0, medium: 1, low: 2 };

async function narrate(pool: TradeIdea[]): Promise<TradeIdea[]> {
  if (!pool.length) return [];
  const SYSTEM = `You are an options strategist writing a weekly desk note of the most actionable trades. Each candidate below was DETECTED and PRICED BY CODE — its ticker, structure, and stat (the mispricing) are FIXED and correct; do NOT change them or invent new numbers.

Your job: SELECT the ${PICK} most compelling, actionable-this-week ideas, and for each write:
- thesis: 2-3 sentences on why it's attractive, grounded ONLY in that candidate's stat + event. No new numbers, no price targets.
- risk: ONE sentence — the main thing that kills the trade (the move happens, IV stays bid, thin liquidity, the catalyst slips).
- trap: true if the edge is likely just pricing a KNOWN pending event (e.g. rich vol because a real catalyst is coming) rather than a free mispricing — be honest.
- conviction: "high" | "medium" | "low".

RULES:
- Pick the BEST ${PICK} (or fewer if few are compelling). Prefer a MIX of buy-vol / sell-vol / event, not all one kind.
- Ground every thesis in THAT candidate's stat/event. NEVER invent a deal, date, earnings figure, or price.
- Tight and concrete. No hype.
${NO_ADVICE}
Return JSON: { "picks": [ { "symbol": "TICKER", "thesis": "...", "risk": "...", "trap": false, "conviction": "medium" } ] }`;
  const user = pool
    .map((p) => `${p.symbol} (${p.name}) · ${sideLabel(p.side)} · ${p.structure}\n  stat: ${p.stat}${p.event ? `\n  event: ${p.event}` : ""}`)
    .join("\n\n");
  const out = await chatJSON<{ picks?: { symbol?: string; thesis?: string; risk?: string; trap?: boolean; conviction?: string }[] }>(SYSTEM, user, {
    model: PRO_MODEL,
    maxTokens: 6000,
    reasoningEffort: "medium",
  });
  const picks = Array.isArray(out?.picks) ? out!.picks! : [];
  if (!picks.length) return [];
  const bySym = new Map<string, (typeof picks)[number]>();
  for (const p of picks) { const s = cleanTicker(p.symbol); if (s) bySym.set(s, p); }
  const allowed = new Set(pool.map((p) => p.symbol));
  const ideas: TradeIdea[] = [];
  for (const p of pool) {
    const pk = allowed.has(p.symbol) ? bySym.get(p.symbol) : undefined;
    if (!pk || !clamp(pk.thesis, 500)) continue; // only names the LLM actually selected + narrated
    ideas.push({ ...p, thesis: clamp(pk.thesis, 500), risk: clamp(pk.risk, 240), trap: !!pk.trap, conviction: normConv(pk.conviction) });
  }
  ideas.sort((a, b) => convRank[a.conviction ?? "medium"] - convRank[b.conviction ?? "medium"] || b.score - a.score);
  return ideas;
}

async function main() {
  const [em, vd, cv] = await Promise.all([readJSON("earnings-move.json"), readJSON("vol-dislocation.json"), readJSON("catalyst-vol.json")]);
  const cands = assemble(em, vd, cv);
  const pool = topPool(cands);
  console.log(`trade-ideas: assembled ${cands.length} candidates → pool of ${pool.length} (em/vd/cv).`);
  if (!pool.length) {
    console.log("trade-ideas: no candidates this week.");
    return;
  }

  let ideas: TradeIdea[] = [];
  if (await llmConfigured()) {
    ideas = await narrate(pool);
    console.log(`trade-ideas: LLM narrated ${ideas.length} ideas.`);
  } else {
    console.log("trade-ideas: no LLM (OPENROUTER_API_KEY) — writing the code-scored shortlist without narrative.");
  }
  // Fallback so the page never empties: the top code-scored ideas, sans narrative.
  if (!ideas.length) ideas = pool.slice(0, PICK);

  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7)); // Monday of this week (UTC)
  const data: TradeDeskData = {
    generatedAt: now.toISOString(),
    weekOf: monday.toISOString().slice(0, 10),
    model: ideas.some((i) => i.thesis) ? PRO_MODEL : undefined,
    pool: pool.length,
    ideas,
  };
  await fs.writeFile(path.join(DATA, "trade-ideas.json"), JSON.stringify(data));
  const withThesis = ideas.filter((i) => i.thesis).length;
  console.log(`trade-ideas: wrote ${ideas.length} ideas (${withThesis} narrated) · week of ${data.weekOf}.`);
  for (const i of ideas) console.log(`  ${i.symbol.padEnd(6)} ${sideLabel(i.side).padEnd(9)} ${i.conviction ?? "—"}  ${i.structure}`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
