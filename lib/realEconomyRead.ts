/**
 * SERVER-ONLY builder for the "Real economy" AI desk read — baked by scripts/refresh-real-economy.ts
 * (monthly cadence → no per-view LLM cost), stored on the feed, rendered instantly by the client panel.
 * Imports ./llm, so it must NEVER be pulled into the client bundle (the panel imports only the TYPE
 * from ./realEconomy). Decision-support, not advice.
 */
import { chatJSON, NO_ADVICE } from "./llm";
import type { RealEconomyData, RealEconomyRead } from "./realEconomy";

const sp = (v: number | null): string => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/** Build the desk read from the feed's own numbers. null if the LLM is unreachable or returns junk. */
export async function buildRealEconomyRead(data: RealEconomyData): Promise<RealEconomyRead | null> {
  const byGroup = (g: string) => data.series.filter((s) => s.group === g);
  const line = (s: (typeof data.series)[number]) => {
    const c = (v: number | null) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${s.changeUnit === "pts" ? "pts" : "%"}`);
    return `${s.label}: ${s.latest ?? "?"} ${s.unit} — YoY ${c(s.yoyPct)}, MoM ${c(s.momPct)} (as of ${s.latestDate ?? "?"})`;
  };
  const section = (g: string) => { const rows = byGroup(g); return rows.length ? `${g}:\n${rows.map((s) => `  ${line(s)}`).join("\n")}` : ""; };
  const tsaLine = data.tsa
    ? `Air travel (TSA checkpoint throughput): 7-day avg ${Math.round(data.tsa.avg7 ?? 0).toLocaleString()} pax/day, ${sp(data.tsa.chg30dPct)} vs ~1 month ago (YTD table — no true YoY).`
    : "";
  const sheet = [section("Activity"), section("Recession watch"), section("Manufacturing"), section("Services"), section("Freight"), section("Consumer"), section("Prices"), section("Money & Credit"), section("Labor"), section("Housing"), section("Travel"), tsaLine].filter(Boolean).join("\n\n");

  const SYSTEM =
    "You are a macro/cross-asset analyst reading FREE real-economy alt-data — broad activity (Chicago Fed CFNAI, the Weekly Economic Index, financial conditions), manufacturing (regional-Fed PMI surveys, industrial production, capacity utilization, core capex orders), freight (rail carloads/intermodal, a truck-freight index, and the Cass freight index — shipments = volume, expenditures = spend, so expenditures rising while shipments fall = firmer rates; plus inventories-to-sales), consumer demand (retail sales, durable-goods orders, vehicle sales), the labor market (weekly jobless claims — LOWER = healthier), air-travel demand, and housing (starts, permits, construction, new-home sales, the 30-yr mortgage rate — LOWER rate = more supportive) — for a trading desk. " +
    "From ONLY the figures provided, synthesize what the real economy is telling us right now: is manufacturing expanding or contracting (the regional-Fed diffusion indices read >0 = expansion; weigh their POINT moves), is the goods economy (freight) accelerating or cooling, is the consumer still spending, is travel demand holding, is housing firming or softening — and name the CROSS-CURRENTS (e.g. PMIs turning up while freight is still soft, or permits up while starts fall). Then give the read-through to sectors/industries (industrials/manufacturers, rails, truckers, retailers, homebuilders, building products, airlines, lodging). " +
    "The inflection matters more than the level; weigh YoY over one-month noise. Ground EVERY claim in the numbers/series provided — never invent a figure or a series not listed. Remember the truck line is the BTS Freight TSI (a proxy for the proprietary ATA Truck Tonnage Index) and hotel is a lodging-CPI PRICE proxy, NOT RevPAR — don't overstate either. Be concrete and terse. " +
    NO_ADVICE;
  const SCHEMA =
    'Return ONLY JSON: {"tldr":string (ONE sentence — the single biggest real-economy takeaway),' +
    '"regime":"expanding"|"cooling"|"mixed"|"contracting" (the overall read across freight+travel+housing),' +
    '"points":string[] (2-4 short plain-English bullets: the standout moves, the key cross-current, and what housing/freight/travel each say — no bullet symbols),' +
    '"readThrough":string[] (1-3 short sector/industry read-throughs, e.g. "rails: carloads +X% supports UNP/CSX volumes"),' +
    '"caveat":string (ONE sentence — these are lead indicators / proxies, not the hard prints)}';

  const out = await chatJSON<{ tldr?: string; regime?: string; points?: unknown; readThrough?: unknown; caveat?: string }>(
    SYSTEM,
    `Real-economy data (most recent values):\n${sheet}\n\n${SCHEMA}`,
    { maxTokens: 800, reasoningEffort: "low" },
  );
  if (!out || !out.tldr || !Array.isArray(out.points)) return null;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim().slice(0, 260)).slice(0, n) : []);
  const points = strs(out.points, 4);
  if (!points.length) return null;
  const regime = ["expanding", "cooling", "mixed", "contracting"].includes(String(out.regime)) ? (out.regime as RealEconomyRead["regime"]) : "mixed";
  return {
    tldr: String(out.tldr).slice(0, 320),
    regime,
    points,
    readThrough: strs(out.readThrough, 3),
    caveat: out.caveat ? String(out.caveat).slice(0, 240) : undefined,
    generatedAt: new Date().toISOString(),
  };
}
