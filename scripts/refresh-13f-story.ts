/**
 * QoQ 13F Story — GLM writes the quarter's rotation narrative from the CONSENSUS moves across the
 * super-investor roster (who initiated/added/sold/trimmed what, by how many managers). Shown as a
 * banner on the Super-Investors page. Runs in the nightly FULL rebuild AFTER refresh-13f.
 *   npm run refresh-13f-story
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSuperInvestors } from "../lib/superinvestors";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { ThirteenFStory, StoryTheme } from "../lib/thirteenFStory";

const DATA = path.join(process.cwd(), "data");

async function main() {
  if (!(await llmConfigured())) {
    console.warn("13f-story: OPENROUTER_API_KEY not set — skipping.");
    return;
  }
  const si = await loadSuperInvestors().catch(() => null);
  if (!si || !si.investors.length) {
    console.warn("13f-story: no super-investor data — skipping.");
    return;
  }

  // Consensus tallies: ticker → distinct managers taking each action.
  const acc = {
    initiated: new Map<string, Set<string>>(),
    added: new Map<string, Set<string>>(),
    soldOut: new Map<string, Set<string>>(),
    trimmed: new Map<string, Set<string>>(),
  };
  const names = new Map<string, string>();
  const bump = (m: Map<string, Set<string>>, ticker: string | null, name: string, mgr: string) => {
    if (!ticker) return;
    names.set(ticker, name);
    (m.get(ticker) || m.set(ticker, new Set()).get(ticker)!).add(mgr);
  };
  for (const inv of si.investors) {
    for (const b of inv.newBuys || []) bump(acc.initiated, b.ticker, b.name, inv.manager);
    for (const a of inv.topAdds || []) bump(acc.added, a.ticker, a.name, inv.manager);
    for (const s of inv.soldOut || []) bump(acc.soldOut, s.ticker, s.name, inv.manager);
    for (const t of inv.topTrims || []) bump(acc.trimmed, t.ticker, t.name, inv.manager);
  }
  const top = (m: Map<string, Set<string>>, n = 12) =>
    [...m.entries()]
      .map(([ticker, set]) => ({ ticker, name: names.get(ticker) || ticker, mgrs: set.size }))
      .filter((x) => x.mgrs >= 1)
      .sort((a, b) => b.mgrs - a.mgrs)
      .slice(0, n);

  // Buys = initiations + adds combined (by manager breadth); sells = sold-out + trims.
  const buyMap = new Map<string, Set<string>>();
  for (const [t, s] of acc.initiated) buyMap.set(t, new Set(s));
  for (const [t, s] of acc.added) { const e = buyMap.get(t) || buyMap.set(t, new Set()).get(t)!; s.forEach((x) => e.add(x)); }
  const sellMap = new Map<string, Set<string>>();
  for (const [t, s] of acc.soldOut) sellMap.set(t, new Set(s));
  for (const [t, s] of acc.trimmed) { const e = sellMap.get(t) || sellMap.set(t, new Set()).get(t)!; s.forEach((x) => e.add(x)); }

  const fmt = (rows: { ticker: string; name: string; mgrs: number }[]) => rows.map((r) => `${r.ticker} (${r.name}) — ${r.mgrs} manager${r.mgrs > 1 ? "s" : ""}`).join("\n");
  const newBuys = top(acc.initiated);
  const buys = top(buyMap);
  const sells = top(sellMap);
  const mostOwned = (si.mostOwned || []).filter((m) => m.ticker).slice(0, 10).map((m) => `${m.ticker} — held by ${m.holderCount}`).join("\n");
  const asOf = mostCommonAsOf(si.investors.map((i) => i.asOf));

  const SYSTEM =
    "You are a 13F analyst summarizing what a roster of famous value, activist, and growth investors COLLECTIVELY did last quarter. From the consensus moves (how many distinct managers initiated/added vs sold/trimmed each name), write the quarter's ROTATION STORY: the 2-4 themes — what the group leaned INTO and what it leaned OUT of, by sector/style, and the read on what it suggests about how this cohort is positioned. Ground every claim in the supplied tallies and tickers — never invent a move or a number. Each theme: a short heading, a 1-2 sentence read, and the relevant tickers. Also a one-paragraph 'tldr' headline of the quarter. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"tldr": string, "themes": [{"heading": string, "detail": string, "tickers": string[]}]}';
  const user =
    `${SCHEMA}\n\n=== MOST-INITIATED (brand-new positions, by manager breadth) ===\n${fmt(newBuys)}\n` +
    `\n=== MOST-BOUGHT (initiations + adds) ===\n${fmt(buys)}\n` +
    `\n=== MOST-SOLD (sold-out + trims) ===\n${fmt(sells)}\n` +
    `\n=== MOST-OWNED ACROSS THE ROSTER ===\n${mostOwned}`;

  const out = await chatJSON<{ tldr: string; themes: StoryTheme[] }>(SYSTEM, user, { maxTokens: 3500, model: PRO_MODEL });
  if (!out || !out.tldr) {
    console.warn("13f-story: LLM returned no usable story — skipping write.");
    return;
  }
  const themes = (Array.isArray(out.themes) ? out.themes : [])
    .filter((t) => t && t.heading && t.detail)
    .map((t) => ({ heading: String(t.heading).trim(), detail: String(t.detail).trim(), tickers: (Array.isArray(t.tickers) ? t.tickers : []).filter((x) => typeof x === "string").slice(0, 8) }))
    .slice(0, 4);

  const story: ThirteenFStory = { generatedAt: new Date().toISOString(), asOf, tldr: String(out.tldr).trim(), themes };
  await fs.writeFile(path.join(DATA, "13f-story.json"), JSON.stringify(story));
  console.log(`13f-story: wrote tldr + ${themes.length} themes (quarter ${asOf || "?"})`);
}

function mostCommonAsOf(dates: string[]): string | null {
  const c = new Map<string, number>();
  for (const d of dates) if (d) c.set(d, (c.get(d) || 0) + 1);
  let best: string | null = null, n = 0;
  for (const [d, k] of c) if (k > n) { n = k; best = d; }
  return best;
}

main().catch((e) => { console.error(e); process.exit(1); });
