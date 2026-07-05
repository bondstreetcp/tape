/**
 * Merger-Arbitrage monitor — a board of pending US acquisitions with the live arb spread. Sources deals
 * from EDGAR merger proxies (DEFM14A/PREM14A — the target files these when a deal heads to a vote), then
 * an LLM (cheap Flash tier) reads each filing and extracts the CONSIDERATION (cash $/sh and/or a fixed
 * exchange ratio), the acquirer, and the expected close. The cash price is number-grounded in the filing
 * (never invented). Target/acquirer prices come from the snapshots (live-quote fallback for off-index
 * names); lib/mergerArb.ts (unit-tested) computes the spread + annualized return. Writes data/merger-arb.json.
 *
 * Doctrine: the LLM proposes the deal terms, the code computes the spread. Needs OPENROUTER_API_KEY.
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { eftsSearch, fetchFilingBodyText, edgarDocUrl, type EftsHit } from "../lib/edgarSearch";
import { chatJSON, FLASH_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { numberGroundedIn, cleanTicker, isoDateOnly } from "../lib/llmValidate";
import { arbMetrics, rankArb, type Deal, type ArbRow, type MergerArbData, type DealStructure } from "../lib/mergerArb";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const CAP = Number(process.env.ARB_CAP || 45);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function priceMap(): Promise<Map<string, { price: number; name: string }>> {
  const m = new Map<string, { price: number; name: string }>();
  for (const u of ["russell3000", "sp1500", "sp500", "nasdaq100"]) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      for (const s of j.stocks ?? []) if (s.symbol && !m.has(s.symbol) && s.price > 0) m.set(s.symbol, { price: s.price, name: s.name });
    } catch { /* skip */ }
  }
  return m;
}

async function liveQuote(sym: string): Promise<number | null> {
  try {
    // validateResult:false — yahoo-finance2's strict schema rejects some valid quotes (e.g. BRK.A) + spams logs.
    const q: any = await yf.quote(sym, {}, { validateResult: false } as any);
    const p = q?.regularMarketPrice ?? q?.[0]?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch { return null; }
}

const SYSTEM =
  "You read an SEC MERGER filing (a merger proxy or 8-K) and extract the ACQUISITION terms as JSON — the deal where the filing's company (or a named target) is being ACQUIRED. " +
  "isDefinitiveDeal: true ONLY if a DEFINITIVE agreement to acquire the target at stated per-share consideration exists (NOT a mere 'exploring strategic alternatives', a rumor, a terminated deal, or a mutual merger-of-equals with no per-share price). " +
  "structure: 'cash' (all cash $/sh), 'stock' (a fixed exchange ratio of acquirer shares per target share), or 'mixed' (both). " +
  "cashPerShare: the CASH $ per target share, from the filing text ONLY (e.g. '$17.00 per share in cash' → 17.00); null if none or all-stock. " +
  "exchangeRatio: acquirer shares received per ONE target share (e.g. '0.400 shares of Acquirer per share' → 0.4); null if all-cash. " +
  "acquirerTicker: the ACQUIRER's stock ticker if it's public and stated (needed to value a stock deal); null otherwise. " +
  "expectedClose: the expected closing as a best-estimate calendar date YYYY-MM-DD (end of the stated quarter/half if only a period is given, e.g. 'second half of 2026' → 2026-12-31); null if not stated. " +
  "cvr: true if a contingent value right / earnout is part of the consideration. " +
  "NEVER invent, compute, or infer a number — copy only figures explicitly written as the merger consideration. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: {"isDefinitiveDeal": boolean, "targetTicker": string|null, "targetName": string, "acquirer": string, "acquirerTicker": string|null, "structure": "cash"|"stock"|"mixed", "cashPerShare": number|null, "exchangeRatio": number|null, "cvr": boolean, "expectedClose": string|null, "confidence": "high"|"medium"|"low"}';

async function extract(text: string, hintTicker: string | null): Promise<any | null> {
  const clip = text.slice(0, 40000);
  return chatJSON<any>(SYSTEM, `${SCHEMA}\n\nFiling text (the tickered filer is likely the target: ${hintTicker || "?"}):\n${clip}`, {
    model: FLASH_MODEL,
    maxTokens: 1500,
    reasoningEffort: "low",
  });
}

async function main() {
  if (!(await llmConfigured())) {
    console.log("merger-arb: no LLM (OPENROUTER_API_KEY) — keeping the previous file.");
    return;
  }
  const now = new Date();
  const start = new Date(now.getTime() - 210 * 86_400_000).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);

  // Pending merger proxies — the target files these when a deal goes to a shareholder vote.
  const hits: EftsHit[] = [];
  for (const forms of ["DEFM14A", "PREM14A"]) {
    hits.push(...(await eftsSearch({ forms, startdt: start, enddt: end })));
    await sleep(400);
  }
  const seen = new Set<string>();
  const cands: EftsHit[] = [];
  for (const h of hits) {
    const t = cleanTicker(h.ticker);
    if (t && !seen.has(t)) { seen.add(t); cands.push(h); }
  }
  console.log(`merger-arb: ${cands.length} unique DEFM14A/PREM14A candidates`);

  const prices = await priceMap();
  const deals: ArbRow[] = [];
  let dropped = 0;
  for (const h of cands.slice(0, CAP)) {
    const text = await fetchFilingBodyText(h);
    if (text.length < 500) continue;
    const e = await extract(text, h.ticker);
    if (!e || !e.isDefinitiveDeal) continue;
    const targetTicker = cleanTicker(e.targetTicker) || cleanTicker(h.ticker);
    if (!targetTicker) continue;

    // Ground the cash price in the filing — a computed/hallucinated figure is nulled.
    let cashPerShare = typeof e.cashPerShare === "number" && e.cashPerShare > 0 ? e.cashPerShare : null;
    if (cashPerShare != null && !numberGroundedIn(cashPerShare, text)) { cashPerShare = null; dropped++; }
    const exchangeRatio = typeof e.exchangeRatio === "number" && e.exchangeRatio > 0 ? e.exchangeRatio : null;
    const structure: DealStructure = ["cash", "stock", "mixed"].includes(e.structure) ? e.structure : cashPerShare != null && exchangeRatio != null ? "mixed" : exchangeRatio != null ? "stock" : "cash";
    const acquirerTicker = cleanTicker(e.acquirerTicker) || null;

    const deal: Deal = {
      targetTicker,
      targetName: (typeof e.targetName === "string" && e.targetName.trim()) || prices.get(targetTicker)?.name || targetTicker,
      acquirer: (typeof e.acquirer === "string" && e.acquirer.trim().slice(0, 60)) || "—",
      acquirerTicker,
      structure,
      cashPerShare,
      exchangeRatio,
      cvr: !!e.cvr,
      expectedClose: isoDateOnly(e.expectedClose),
      announced: h.date || null,
      url: edgarDocUrl(h.ciks[0] || "", h.accession, h.doc),
    };

    const tp = prices.get(targetTicker)?.price ?? (await liveQuote(targetTicker));
    const ap = acquirerTicker ? (prices.get(acquirerTicker)?.price ?? (await liveQuote(acquirerTicker))) : null;
    deals.push(arbMetrics(deal, tp, ap, now.getTime()));
  }

  // Plausibility guard: real arb spreads live within a wide but finite band; |spread|>60% is a
  // misextraction (a garbled exchange ratio balloons the deal value — the number-grounding guard only
  // protects the CASH leg). Drop those rather than show a bogus 140% "arb". Null-spread deals are kept
  // (informational — the deal exists, price/terms just aren't fully known).
  const clean = deals.filter((d) => d.grossSpreadPct == null || Math.abs(d.grossSpreadPct) <= 60);
  const ranked = rankArb(clean);
  const out: MergerArbData = { generatedAt: now.toISOString(), scanned: cands.length, deals: ranked };
  await fs.writeFile(path.join(DATA, "merger-arb.json"), JSON.stringify(out));
  console.log(`merger-arb: wrote ${ranked.length} deals (${dropped} ungrounded cash prices dropped) → data/merger-arb.json`);
  for (const d of ranked.slice(0, 12)) {
    console.log(`  ${d.targetTicker.padEnd(6)} ← ${d.acquirer.slice(0, 24).padEnd(24)} ${d.structure.padEnd(5)} spread ${d.grossSpreadPct != null ? d.grossSpreadPct.toFixed(2) + "%" : "—"} · ann ${d.annualizedPct != null ? d.annualizedPct.toFixed(0) + "%" : "—"} · close ${d.expectedClose ?? "?"}`);
  }
}

main().catch((e) => { console.error("merger-arb:", String(e?.message || e)); process.exit(1); });
