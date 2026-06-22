/**
 * Build data/catalysts.json — a terse, grounded "why it moved" line for the stocks that show
 * up in the Movers panel. For the union of top/bottom movers across the common timeframes, we
 * feed each name's OWN recent news to Gemini and ask for a single specific-catalyst clause, or
 * NONE when the headlines don't explain the move (→ the UI shows nothing rather than slop).
 *
 *   npm run refresh-catalysts
 *
 * A 7-day per-symbol TTL means most nights only the freshly-rotated movers get regenerated.
 * Needs GEMINI_API_KEY (CI secret, or .env.local for local runs).
 */
import { promises as fs } from "fs";
import path from "path";
import { UNIVERSES } from "../lib/universes";
import { loadSnapshot } from "../lib/data";
import { getNews } from "../lib/news";
import type { CatalystMap } from "../lib/catalysts";

const DATA = path.join(process.cwd(), "data");
const TFS = ["1d", "1w", "ytd", "1y"] as const;
const TF_LABEL: Record<string, string> = { "1d": "today", "1w": "this week", ytd: "year-to-date", "1y": "over the past year" };
const N = 6; // top/bottom per timeframe
const TTL = 7 * 24 * 3600 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Promotional / litigation / pure-rating headlines are noise for "why it moved".
const JUNK = /shareholder alert|class action|investigation|law\s?firm|rosen law|wolf haldenstein|pomerantz|bragar|kahn swick|schall law|glancy prongay|deadline|lost money|encourages? investors|contact[^.]{0,40}immediately|securities fraud|lawsuit|should contact|3 stocks|here'?s why|motley fool|zacks|price target|reiterates|initiates coverage/i;
// Strip the earnings-report boilerplate words; if nothing substantive is left, the line was
// just "reported its Q_ results" with no actual outcome — drop it. Keeps terse-but-real ones
// like "Q1 earnings beat" (→ "beat") while killing "First Quarter 2026 Results" (→ "").
const BOILER = /\b(the|first|second|third|fourth|q[1-4]|fiscal|full|half|year|quarter(ly)?|results?|earnings|reports?|reported|its|announces?|announced|posts?|posted|operational|highlights?|updates?|provides?|provided|preliminary|unaudited|fy|and|of|for|20\d\d)\b/gi;
const isBareResults = (why: string) => why.replace(BOILER, " ").replace(/[^a-z0-9]+/gi, " ").trim().length === 0;

const SYSTEM =
  "You are a markets desk writing the one-line reason a stock moved. Output a single terse fragment of at most 12 words naming the SPECIFIC catalyst — e.g. 'Q3 earnings beat, raised FY guidance', 'agreed to be acquired by Synopsys', 'FDA approval for its lead drug', 'guidance cut on soft demand', 'added to the S&P 500', 'spun off from Western Digital'. Base it ONLY on the provided headlines — never invent or guess. Do NOT include the company name or ticker (already shown), no hype adjectives, no 'the company', no trailing period. Ignore promotional, legal, and analyst-rating-only items. If the headlines do not clearly explain the move, output exactly: NONE.";

async function geminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  return (env.match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim() || "";
}

async function ask(key: string, name: string, symbol: string, dir: string, pct: string, tfLabel: string, heads: string[]): Promise<string> {
  const prompt = `Company: ${name} (${symbol}).\nMove: ${dir} ${pct}% ${tfLabel}.\nRecent news headlines:\n${heads.map((h) => `- ${h}`).join("\n")}\n\nWhy did it move?`;
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
  if (!why || /^none\b/i.test(why) || why.length > 90 || JUNK.test(why) || isBareResults(why)) return "";
  return why;
}

async function main() {
  const key = await geminiKey();
  if (!key) { console.error("No GEMINI_API_KEY (env or .env.local) — cannot generate catalysts."); process.exit(1); }

  // collect the union of movers across universes + the common timeframes
  const movers = new Map<string, { name: string; dir: string; pct: string; tfLabel: string; absRet: number }>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u.id).catch(() => null);
    if (!snap?.stocks?.length) continue;
    for (const tf of TFS) {
      const ranked = snap.stocks.filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number));
      if (ranked.length < 2) continue;
      for (const s of [...ranked.slice(0, N), ...ranked.slice(-N)]) {
        const ret = s.returns[tf] as number;
        const abs = Math.abs(ret);
        const cur = movers.get(s.symbol);
        // keep each symbol's single most-extreme move as the context to explain
        if (!cur || abs > cur.absRet) movers.set(s.symbol, { name: s.name, dir: ret >= 0 ? "up" : "down", pct: abs.toFixed(0), tfLabel: TF_LABEL[tf], absRet: abs });
      }
    }
  }
  console.log(`${movers.size} unique mover symbols across ${UNIVERSES.length} universes`);

  const prev: CatalystMap = await fs.readFile(path.join(DATA, "catalysts.json"), "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
  const now = Date.now();
  const out: CatalystMap = {};
  const todo: string[] = [];
  for (const sym of movers.keys()) {
    const p = prev[sym];
    if (p && now - Date.parse(p.ts) < TTL) out[sym] = p; // fresh enough — reuse (incl. empty)
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
          const news = await getNews(m.name || sym, 10).catch(() => []);
          const heads = news.map((n) => n.title).filter((t) => !JUNK.test(t)).slice(0, 8);
          const why = heads.length ? await ask(key, m.name, sym, m.dir, m.pct, m.tfLabel, heads) : "";
          out[sym] = { why, ts: new Date().toISOString() };
          if (why) withWhy++;
        } catch (e: any) {
          out[sym] = { why: "", ts: new Date().toISOString() };
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
