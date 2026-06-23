/**
 * Build data/catalysts.json — a terse, grounded "why it moved" line for the stocks that show
 * up in the Movers panel. For each mover we feed its OWN recent, DATE-GATED news to Gemini and
 * ask for a single specific-catalyst clause, or NONE when nothing recent explains the move
 * (→ the UI shows nothing rather than slop).
 *
 *   npm run refresh-catalysts
 *
 * Key discipline: a symbol's catalyst is generated for the SHORTEST timeframe it moved in
 * (a 1-day mover gets a "today" catalyst, not its year-to-date story), the news is filtered to
 * a recency window matched to that timeframe (so last quarter's earnings can't explain today's
 * pop), and the cache TTL is per-timeframe so 1-day catalysts refresh ~daily.
 * Needs GEMINI_API_KEY (CI secret, or .env.local for local runs).
 */
import { promises as fs } from "fs";
import path from "path";
import { UNIVERSES } from "../lib/universes";
import { loadSnapshot } from "../lib/data";
import { getNews } from "../lib/news";
import type { CatalystMap } from "../lib/catalysts";

const DATA = path.join(process.cwd(), "data");
const DAY = 24 * 3600 * 1000;
const TFS = ["1d", "1w", "ytd", "1y"] as const;
const TF_LABEL: Record<string, string> = { "1d": "today", "1w": "this week", ytd: "year-to-date", "1y": "over the past year" };
const TF_RANK: Record<string, number> = { "1d": 0, "1w": 1, ytd: 2, "1y": 3 }; // shortest first
const WINDOW_DAYS: Record<string, number> = { "1d": 5, "1w": 16, ytd: 100, "1y": 100 }; // news recency by tf
const TTL_DAYS: Record<string, number> = { "1d": 1.5, "1w": 4, ytd: 7, "1y": 7 }; // cache freshness by tf
const N = 6; // top/bottom per timeframe
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Promotional / litigation / pure-rating headlines are noise for "why it moved".
const JUNK = /shareholder alert|class action|investigation|law\s?firm|rosen law|wolf haldenstein|pomerantz|bragar|kahn swick|schall law|glancy prongay|deadline|lost money|encourages? investors|contact[^.]{0,40}immediately|securities fraud|lawsuit|should contact|3 stocks|here'?s why|motley fool|zacks|price target|reiterates|initiates coverage/i;
// Strip earnings-report boilerplate; if nothing substantive is left it was just "reported its
// Q_ results" — drop it. Keeps "Q1 earnings beat" (→ "beat") while killing "First Quarter 2026 Results".
const BOILER = /\b(the|first|second|third|fourth|q[1-4]|fiscal|full|half|year|quarter(ly)?|results?|earnings|reports?|reported|its|announces?|announced|posts?|posted|operational|highlights?|updates?|provides?|provided|preliminary|unaudited|fy|and|of|for|20\d\d)\b/gi;
const isBareResults = (why: string) => why.replace(BOILER, " ").replace(/[^a-z0-9]+/gi, " ").trim().length === 0;
// Circular "it moved because it moved" non-catalysts (Zacks-style "X underperforms its peers").
const RESTATE = /\b(under|out)perform(s|ed|ing)?\b|compared to (its )?(competitors|peers|sector)|relative to (its )?(peers|sector)|moves? (lower|higher) (monday|tuesday|wednesday|thursday|friday)/i;

const SYSTEM =
  "You are a markets desk writing the one-line reason a stock moved. Output a single terse fragment of at most 12 words naming the SPECIFIC catalyst — e.g. 'Q3 earnings beat, raised FY guidance', 'agreed to be acquired by Synopsys', 'FDA approval for its lead drug', 'guidance cut on soft demand', 'added to the S&P 500'. Base it ONLY on the provided dated headlines — never invent. " +
  "CRUCIAL recency rule: the catalyst must be recent enough to plausibly CAUSE a move over the stated window. For a move 'today', only an event from the last day or two qualifies — ignore older items (last quarter's earnings, a board change from weeks ago, an old partnership) even if important; they do NOT explain today's move. " +
  "No company name or ticker (already shown), no hype adjectives, no 'the company', no trailing period. Ignore promotional, legal, and analyst-rating-only items. If no recent headline clearly explains the move, output exactly: NONE.";

async function geminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  return (env.match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim() || "";
}

async function ask(key: string, today: string, name: string, symbol: string, dir: string, pct: string, tfLabel: string, heads: { title: string; date: string }[]): Promise<string> {
  const list = heads.map((h) => `- ${h.date ? `[${h.date}] ` : ""}${h.title}`).join("\n");
  const prompt = `Today is ${today}.\nCompany: ${name} (${symbol}).\nMove: ${dir} ${pct}% ${tfLabel}.\nRecent news headlines (with dates):\n${list}\n\nWhy did it move ${tfLabel}? Cite only an event recent enough to plausibly cause this move; if none of the headlines explain it, output NONE.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j: any = await res.json();
  let why = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  why = why.replace(/^["'>\s.-]+|["'\s.]+$/g, "");
  if (!why || /^none\b/i.test(why) || why.length > 90 || JUNK.test(why) || isBareResults(why) || RESTATE.test(why)) return "";
  return why;
}

async function main() {
  const key = await geminiKey();
  if (!key) { console.error("No GEMINI_API_KEY (env or .env.local) — cannot generate catalysts."); process.exit(1); }
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  // Collect movers, keeping each symbol's SHORTEST timeframe (most-recent move) as the context.
  const movers = new Map<string, { name: string; dir: string; pct: string; tf: string }>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u.id).catch(() => null);
    if (!snap?.stocks?.length) continue;
    for (const tf of TFS) {
      const ranked = snap.stocks.filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number));
      if (ranked.length < 2) continue;
      for (const s of [...ranked.slice(0, N), ...ranked.slice(-N)]) {
        const cur = movers.get(s.symbol);
        if (cur && TF_RANK[cur.tf] <= TF_RANK[tf]) continue; // already have a shorter/equal window
        const ret = s.returns[tf] as number;
        movers.set(s.symbol, { name: s.name, dir: ret >= 0 ? "up" : "down", pct: Math.abs(ret).toFixed(0), tf });
      }
    }
  }
  console.log(`${movers.size} unique mover symbols across ${UNIVERSES.length} universes`);

  const prev: CatalystMap = await fs.readFile(path.join(DATA, "catalysts.json"), "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
  const out: CatalystMap = {};
  const todo: string[] = [];
  for (const [sym, m] of movers) {
    const p = prev[sym];
    // Reuse only if fresh for THIS timeframe and generated under the same window context.
    if (p && p.tf === m.tf && now - Date.parse(p.ts) < (TTL_DAYS[m.tf] ?? 7) * DAY) out[sym] = p;
    else todo.push(sym);
  }
  console.log(`reusing ${Object.keys(out).length} cached · regenerating ${todo.length}`);

  let done = 0, withWhy = 0;
  const POOL = 5;
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      for (;;) {
        const sym = todo.shift();
        if (!sym) return;
        const m = movers.get(sym)!;
        try {
          const news = await getNews(m.name || sym, 12).catch(() => []);
          const cutoff = now - (WINDOW_DAYS[m.tf] ?? 100) * DAY;
          const heads = news
            .filter((n) => !JUNK.test(n.title) && (!n.time || Date.parse(n.time) >= cutoff)) // date-gate to the tf window
            .slice(0, 8)
            .map((n) => ({ title: n.title, date: n.time ? n.time.slice(0, 10) : "" }));
          const why = heads.length ? await ask(key, today, m.name, sym, m.dir, m.pct, TF_LABEL[m.tf], heads) : "";
          out[sym] = { why, ts: new Date().toISOString(), tf: m.tf };
          if (why) withWhy++;
        } catch (e: any) {
          out[sym] = { why: "", ts: new Date().toISOString(), tf: m.tf };
          console.log(`  ${sym}: ${e.message}`);
        }
        if (++done % 25 === 0) console.log(`  …${done} generated`);
        await sleep(150);
      }
    }),
  );

  await fs.writeFile(path.join(DATA, "catalysts.json"), JSON.stringify(out));
  const total = Object.values(out).filter((c) => c.why).length;
  console.log(`\nWrote ${Object.keys(out).length} catalysts (${total} with a why, ${withWhy} new this run).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
