/**
 * Vol-tags — the LLM "why" on the rich-vol names in data/vol-dislocation.json. Code already flags
 * EARNINGS-driven rich vol (expected, not a dislocation); this asks an LLM — grounded ONLY in recent
 * headlines — whether the OTHER top rich names have a real pending catalyst (M&A, FDA, litigation,
 * restructuring, activist) that would make the rich vol a trap, or no obvious one (a possible genuine
 * dislocation). Honest division of labor: CODE detects the rich vol, the LLM only contextualizes it.
 * Writes the tags back into the file. Runs AFTER refresh-vol-dislocation in the nightly FULL job.
 * Needs OPENROUTER_API_KEY / an LLM; skips cleanly if unset.
 */
import { promises as fs } from "fs";
import path from "path";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { getNews } from "../lib/news";
import { cleanTicker } from "../lib/llmValidate";
import type { VolDisData } from "../lib/volDislocation";

const TOP = Number(process.env.LIMIT || 24); // budget cap: only the top rich non-earnings names get an LLM read

async function main() {
  if (!(await llmConfigured())) {
    console.error("vol-tags: no LLM configured (OPENROUTER_API_KEY) — skipping.");
    return;
  }
  const p = path.join(process.cwd(), "data", "vol-dislocation.json");
  const raw = await fs.readFile(p, "utf8").catch(() => null);
  if (!raw) {
    console.error("vol-tags: no data/vol-dislocation.json — run `npm run refresh-vol-dislocation` first.");
    process.exit(1);
  }
  const data = JSON.parse(raw) as VolDisData & { taggedAt?: string };
  // Rich vol that ISN'T already explained by an upcoming print — those are the ones worth a "why".
  const targets = data.rows.filter((r) => r.ivPremium >= 1.4 && !r.earningsDriven).slice(0, TOP);
  if (!targets.length) {
    console.log("vol-tags: no rich non-earnings names to tag.");
    return;
  }
  const ctx = await Promise.all(
    targets.map(async (r) => {
      const news = await getNews(r.symbol, 8).catch(() => []);
      const heads = news.slice(0, 8).map((n) => `- ${n.time ? n.time.slice(0, 10) + " " : ""}${n.title}`).join("\n");
      return { symbol: r.symbol, name: r.name, ivPremium: r.ivPremium, heads };
    }),
  );
  const withNews = ctx.filter((c) => c.heads);
  if (!withNews.length) {
    console.log("vol-tags: no headlines found for the rich names.");
    return;
  }

  const SYSTEM = `You are a volatility analyst. Each stock below has RICH option implied vol vs its realized vol (a high variance premium), with its RECENT HEADLINES. For each, decide whether that rich vol is explained by a REAL, PENDING catalyst — a merger/acquisition or strategic review, an FDA/PDUFA decision, a major lawsuit or regulatory ruling, a restructuring / bankruptcy risk, an activist campaign, a spin-off — or whether there is NO obvious catalyst in the news (a possible dislocation, or just a small/illiquid name).
RULES:
- Cite ONLY a catalyst that clearly appears in THAT name's headlines. If the headlines show no clear catalyst, use kind:"none" and catalyst:"".
- NEVER invent a deal, date, or fact. Ground every catalyst in a headline.
- catalyst is ONE short phrase, at most 8 words — e.g. "pending buyout", "FDA decision due", "Chapter 11 restructuring", "proxy fight".
- confidence 0-1: high only when a headline plainly names a pending catalyst.
${NO_ADVICE}
Return JSON: { "tags": [ { "symbol": "TICKER", "kind": "event" | "none" | "unclear", "catalyst": "short phrase", "confidence": 0.0 } ] }`;
  const user = withNews.map((c) => `${c.symbol} (${c.name}) — IV/RV ${c.ivPremium.toFixed(1)}x\n${c.heads}`).join("\n\n");
  const out = await chatJSON<{ tags?: { symbol?: string; kind?: string; catalyst?: string; confidence?: number }[] }>(SYSTEM, user, { model: PRO_MODEL, maxTokens: 4000, reasoningEffort: "low" });
  const tags = Array.isArray(out?.tags) ? out!.tags! : [];
  const bySym = new Map<string, (typeof tags)[number]>();
  for (const t of tags) {
    const s = cleanTicker(t.symbol);
    if (s) bySym.set(s, t);
  }
  const allowed = new Set(targets.map((r) => r.symbol)); // only trust tags for names we actually asked about
  let tagged = 0;
  for (const r of data.rows) {
    const t = allowed.has(r.symbol) ? bySym.get(r.symbol) : undefined;
    if (t && t.kind && t.kind !== "none" && typeof t.catalyst === "string" && t.catalyst.trim()) {
      r.catalyst = { text: t.catalyst.trim().slice(0, 80), kind: t.kind === "event" ? "event" : "unclear", confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)) };
      tagged++;
    } else {
      delete r.catalyst; // clear any stale tag from a prior run
    }
  }
  data.taggedAt = new Date().toISOString();
  await fs.writeFile(p, JSON.stringify(data));
  console.log(`vol-tags: tagged ${tagged}/${withNews.length} rich non-earnings names with a grounded catalyst.`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
