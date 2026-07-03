/**
 * Congress-trading SUMMARY — Gemini reads the members' disclosed trades and pulls out what's
 * notable/actionable (cluster buys, outsized trades, sector bets, notable-member conviction) vs.
 * the routine noise, so the Congress page leads with signal instead of a raw table. Runs in the
 * nightly FULL rebuild AFTER refresh-congress.
 *   npm run refresh-congress-summary
 */
import { promises as fs } from "fs";
import path from "path";
import { loadCongress } from "../lib/congress";
import { loadSnapshot } from "../lib/data";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import { whitelistTickers } from "../lib/llmValidate";
import type { CongressSummary, CongressHighlight } from "../lib/congressSummary";

const DATA = path.join(process.cwd(), "data");
const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`);

async function main() {
  if (!(await llmConfigured())) {
    console.warn("congress-summary: OPENROUTER_API_KEY not set — skipping.");
    return;
  }
  const [cong, snap] = await Promise.all([loadCongress().catch(() => null), loadSnapshot("russell3000").catch(() => null)]);
  if (!cong || !cong.trades.length) {
    console.warn("congress-summary: no congress data — skipping.");
    return;
  }
  const sectorBy = new Map((snap?.stocks || []).map((s) => [s.symbol, s.sector] as const));
  const now = Date.now();
  const recent = cong.trades.filter((t) => now - Date.parse(t.txDate) <= 75 * 86_400_000);
  // Every ticker the summary may name must exist in the disclosed trades themselves.
  const tradedSyms = new Set(cong.trades.map((t) => String(t.ticker || "").toUpperCase()).filter(Boolean));

  // Cluster buys — names several members bought (net buyers), by member breadth then notional.
  const clusters = cong.topTickers
    .filter((t) => t.buys > t.sells && t.members >= 2)
    .slice(0, 16)
    .map((t) => `${t.ticker} (${t.asset})${sectorBy.get(t.ticker) ? ` · ${sectorBy.get(t.ticker)}` : ""}: ${t.buys} buys / ${t.sells} sells across ${t.members} members · ~${money(t.notional)} notional`);

  // Outsized individual trades (large bracket) in the recent window.
  const large = [...recent]
    .filter((t) => t.amountHigh >= 250_000)
    .sort((a, b) => b.amountHigh - a.amountHigh)
    .slice(0, 18)
    .map((t) => `${t.member} (${t.chamber}) ${t.type.toUpperCase()} ${t.ticker} · ${money(t.amountLow)}–${money(t.amountHigh)} · tx ${t.txDate}${t.owner && t.owner !== "Self" ? ` · ${t.owner}` : ""}`);

  // Most active members in the window (buy-leaning).
  const memCount = new Map<string, { chamber: string; buys: number; sells: number; names: Set<string> }>();
  for (const t of recent) {
    const e = memCount.get(t.member) || { chamber: t.chamber, buys: 0, sells: 0, names: new Set<string>() };
    if (t.type === "buy") e.buys++; else if (t.type === "sell") e.sells++;
    e.names.add(t.ticker);
    memCount.set(t.member, e);
  }
  const activeMembers = [...memCount.entries()]
    .sort((a, b) => b[1].buys + b[1].sells - (a[1].buys + a[1].sells))
    .slice(0, 10)
    .map(([m, e]) => `${m} (${e.chamber}): ${e.buys} buys / ${e.sells} sells across ${e.names.size} names (75d)`);

  if (!clusters.length && !large.length) {
    console.log("congress-summary: nothing notable in the window — skipping write.");
    return;
  }

  const SYSTEM =
    "You are an analyst who follows congressional (STOCK Act) trading for signal. From the disclosed trades below, surface what is NOTABLE or potentially ACTIONABLE and SEPARATE it from the routine noise. Signal looks like: several different members buying the SAME name (cluster conviction); an unusually large single trade; a member concentrating into one sector or name; buying into a known catalyst. Noise looks like: broad index/bond ETFs, tiny housekeeping trades, spouse-directed diversification, routine liquidity sells. " +
    "Write a 'tldr' (the one-paragraph read on what the cohort has been doing) and 4-7 'highlights', each with a short headline, a 1-2 sentence read of WHY it's notable, a tag (Cluster buy | Large trade | Notable member | Sector bet | Sells | Watch), and the tickers. Ground every claim in the supplied data — never invent a trade, a name, or a dollar figure. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"tldr": string, "highlights": [{"headline": string, "detail": string, "tag": string, "tickers": string[]}]}';
  const block = (title: string, lines: string[]) => (lines.length ? `\n=== ${title} ===\n${lines.join("\n")}` : "");
  const user =
    `${SCHEMA}\n` +
    block("CLUSTER BUYS (names multiple members bought, net)", clusters) +
    block("OUTSIZED RECENT TRADES (≥$250k bracket, last 75d)", large) +
    block("MOST ACTIVE MEMBERS (last 75d)", activeMembers);

  const out = await chatJSON<{ tldr: string; highlights: CongressHighlight[] }>(SYSTEM, user, { maxTokens: 6000, model: PRO_MODEL, reasoningEffort: "high" });
  if (!out || !out.tldr) {
    console.warn("congress-summary: LLM returned no usable summary — skipping write.");
    return;
  }
  const highlights = (Array.isArray(out.highlights) ? out.highlights : [])
    .filter((h) => h && h.headline && h.detail)
    .map((h) => ({
      headline: String(h.headline).trim(),
      detail: String(h.detail).trim(),
      tag: typeof h.tag === "string" ? h.tag.trim().slice(0, 16) : "Watch",
      // whitelist: only tickers present in the disclosed trades fed to the prompt — a hallucinated
      // symbol would render as a wrong-company /stock/ link (shared validator, lib/llmValidate)
      tickers: whitelistTickers(h.tickers, tradedSyms).slice(0, 8),
    }))
    .slice(0, 7);

  const summary: CongressSummary = { generatedAt: new Date().toISOString(), since: cong.since || null, tldr: String(out.tldr).trim(), highlights };
  await fs.writeFile(path.join(DATA, "congress-summary.json"), JSON.stringify(summary));
  console.log(`congress-summary: wrote tldr + ${highlights.length} highlights`);
}

main().catch((e) => { console.error(e); process.exit(1); });
