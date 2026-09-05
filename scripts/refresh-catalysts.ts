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
import { getNewsChecked, pickHeadlines, NEWS_JUNK, CAUSAL_WINDOW_DAYS } from "../lib/news";
import { buildMoveEvidence } from "../lib/moveEvidence";
import { detectRecentReport, movePreDatesReport } from "../lib/preannounce";
import type { CatalystMap } from "../lib/catalysts";
import { sleep } from "../lib/scriptKit";
import { writeFeedOrExit } from "../lib/feedGuard";

const DATA = path.join(process.cwd(), "data");
const DAY = 24 * 3600 * 1000;
const TFS = ["1d", "1w", "ytd", "1y"] as const;
const TF_LABEL: Record<string, string> = { "1d": "today", "1w": "this week", ytd: "year-to-date", "1y": "over the past year" };
const TF_RANK: Record<string, number> = { "1d": 0, "1w": 1, ytd: 2, "1y": 3 }; // shortest first
const TTL_DAYS: Record<string, number> = { "1d": 1.5, "1w": 4, ytd: 7, "1y": 7 }; // cache freshness by tf
const N = 6; // top/bottom per timeframe

// Headline junk + the per-timeframe recency windows live in lib/news alongside pickHeadlines, so
// this script and refresh-desk-note pick news the SAME way by construction — the desk note having
// its own naive version is exactly what produced the PYPL Venmo/Canva fabrication.
const JUNK = NEWS_JUNK;
// Strip earnings-report boilerplate; if nothing substantive is left it was just "reported its
// Q_ results" — drop it. Keeps "Q1 earnings beat" (→ "beat") while killing "First Quarter 2026 Results".
const BOILER = /\b(the|first|second|third|fourth|q[1-4]|fiscal|full|half|year|quarter(ly)?|results?|earnings|reports?|reported|its|announces?|announced|posts?|posted|operational|highlights?|updates?|provides?|provided|preliminary|unaudited|fy|and|of|for|20\d\d)\b/gi;
const isBareResults = (why: string) => why.replace(BOILER, " ").replace(/[^a-z0-9]+/gi, " ").trim().length === 0;
// Circular "it moved because it moved" non-catalysts (Zacks-style "X underperforms its peers").
const RESTATE = /\b(under|out)perform(s|ed|ing)?\b|compared to (its )?(competitors|peers|sector)|relative to (its )?(peers|sector)|moves? (lower|higher) (monday|tuesday|wednesday|thursday|friday)/i;

const SYSTEM =
  "You are a markets desk writing the one-line reason a stock moved. Output a single terse fragment of at most 12 words naming the SPECIFIC catalyst — e.g. 'Q3 earnings beat, raised FY guidance', 'agreed to be acquired by Synopsys', 'FDA approval for its lead drug', 'guidance cut on soft demand', 'added to the S&P 500'. Base it ONLY on the provided dated headlines — never invent. " +
  "CRUCIAL recency rule: the catalyst must be recent enough to plausibly CAUSE a move over the stated window. For a move 'today', only an event from the last day or two qualifies — ignore older items (last quarter's earnings, a board change from weeks ago, an old partnership) even if important; they do NOT explain today's move. " +
  "No company name or ticker (already shown), no hype adjectives, no 'the company', no trailing period. Ignore promotional, legal, and analyst-rating-only items. " +
  "MECHANISM FALLBACK: when no recent headline explains the move but a MOVE EVIDENCE line is supplied (sector residual, same-industry peer moves, elevated short volume — all computed from market data), state THAT mechanism as the reason, citing only its numbers — e.g. 'sector-wide semis move (+2.9%)', 'asset-manager group rally, peers +4-7%', 'squeeze-flavored: short volume 61% of tape', 'idiosyncratic de-grossing, sector flat'. Never invent a mechanism the evidence line doesn't show. If headlines and evidence both explain nothing, output exactly: NONE. " +
  "SESSION CLOCK: a company reports either before the open or after the close. When the context flags 'reported AFTER today's close', those results were released after this session ended, so they did NOT cause a 'today' move — never name that earnings report as the catalyst for a today move; use the MOVE EVIDENCE mechanism instead, or NONE.";

async function geminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  return (env.match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim() || "";
}

async function ask(key: string, today: string, name: string, symbol: string, dir: string, pct: string, tfLabel: string, heads: { title: string; date: string }[], evidence?: string, preEarnings?: boolean): Promise<string> {
  const list = heads.length ? heads.map((h) => `- ${h.date ? `[${h.date}] ` : ""}${h.title}`).join("\n") : "(none found in the causal window)";
  // Session-clock caveat: an after-close print landed after this session, so a same-day move pre-dates it.
  const caveat = preEarnings ? `⚠ ${symbol} reported earnings AFTER today's close — the results were released after this session ended, so they did NOT cause today's ${dir} move; do NOT cite the earnings, use the move-evidence mechanism or NONE.\n` : "";
  const prompt = `Today is ${today}.\nCompany: ${name} (${symbol}).\nMove: ${dir} ${pct}% ${tfLabel}.\n${caveat}Recent news headlines (with dates):\n${list}\n${evidence ? `\n${evidence}\n` : ""}\nWhy did it move ${tfLabel}? Cite only an event recent enough to plausibly cause this move; if no headline explains it, fall back to the MOVE EVIDENCE mechanism per your instructions; if neither explains it, output NONE.`;
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
  // ET market day — refresh-catalysts runs in the post-close FULL tick, so this is also the last COMPLETED
  // session, against which an after-close (AMC) print's date is compared to know a today-move pre-dates it.
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Collect movers, keeping each symbol's SHORTEST timeframe (most-recent move) as the context.
  // 1-DAY movers also get a MOVE EVIDENCE line (lib/moveEvidence: sector residual + peer tape +
  // short-vol pressure, all computed from the same snapshot) so a no-headline mover can carry a
  // grounded MECHANISM why ("semis group move") instead of a blank chip — same fix as the desk brief.
  const shortMechRaw: any = await fs.readFile(path.join(DATA, "short-mechanics.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);
  const shortVol = new Map<string, { pct: number; trendPp?: number | null }>(
    (shortMechRaw?.rows ?? [])
      .filter((r: any) => r.symbol && r.latestShortVolPct != null)
      .map((r: any) => [r.symbol, { pct: r.latestShortVolPct, trendPp: r.shortVolTrendPp }]),
  );
  const movers = new Map<string, { name: string; dir: string; pct: string; tf: string; evidence?: string }>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u.id).catch(() => null);
    if (!snap?.stocks?.length) continue;
    const sectorRet1d = new Map<string, number>(
      ((snap as any).sectors ?? []).filter((x: any) => x?.etf && x?.returns?.["1d"] != null).map((x: any) => [x.etf as string, x.returns["1d"] as number]),
    );
    const peerRows = snap.stocks.map((s: any) => ({ symbol: s.symbol, industry: s.industry, sector: s.sector, marketCap: s.marketCap, ret1d: s.returns["1d"] }));
    for (const tf of TFS) {
      const ranked = snap.stocks.filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number));
      if (ranked.length < 2) continue;
      for (const s of [...ranked.slice(0, N), ...ranked.slice(-N)]) {
        const cur = movers.get(s.symbol);
        if (cur && TF_RANK[cur.tf] <= TF_RANK[tf]) continue; // already have a shorter/equal window
        const ret = s.returns[tf] as number;
        const evidence = tf === "1d" && s.returns["1d"] != null
          ? buildMoveEvidence(
              { symbol: s.symbol, sector: s.sector, industry: (s as any).industry, etf: (s as any).etf, ret1d: s.returns["1d"] as number },
              { sectorRet1d, rows: peerRows, shortVol },
            ) || undefined
          : undefined;
        movers.set(s.symbol, { name: s.name, dir: ret >= 0 ? "up" : "down", pct: Math.abs(ret).toFixed(0), tf, evidence });
      }
    }
  }
  console.log(`${movers.size} unique mover symbols across ${UNIVERSES.length} universes`);

  // Accept both file shapes: the current { generatedAt, bySymbol } and the legacy bare symbol map.
  const prevRaw: any = await fs.readFile(path.join(DATA, "catalysts.json"), "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
  const prev: CatalystMap = prevRaw?.bySymbol ?? prevRaw ?? {};
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
          // Generous count — it only truncates an already-parsed list (free), and getNews ranks by
          // SOURCE, so a small count can drop today's wire story before we ever rank by date.
          // CHECKED fetch: a dead network must THROW into the anti-clobber catch below (keep prior /
          // backdate), never masquerade as "no news exists" — the old `.catch(() => [])` wrote a
          // fresh-stamped why:"" over real catalysts for a whole TTL during outages (2026-08-15 sweep).
          const { items: news, fetchFailed } = await getNewsChecked(m.name || sym, 30);
          if (fetchFailed) throw new Error("news fetch unavailable (transport) — keeping the prior catalyst");
          const heads = pickHeadlines(news, { nowMs: now, windowDays: CAUSAL_WINDOW_DAYS[m.tf] ?? 100, limit: 8 });
          // Session-clock guard (1-day movers only): if this name reported AFTER today's close, today's
          // move pre-dates the print — flag it so the model doesn't credit the earnings for a pre-earnings
          // move (the DELL case). Memoized SEC-submissions read; degrades to no-flag on any failure.
          let preEarnings = false;
          if (m.tf === "1d") {
            const rep = await detectRecentReport(sym, now).catch(() => null);
            if (rep) preEarnings = movePreDatesReport(rep.timing, rep.date, today);
          }
          // Evidence-only movers (no headlines, but a computed mechanism) still get asked — the
          // MECHANISM FALLBACK rule lets the model state the group-move/squeeze read, never invent.
          const why = heads.length || m.evidence ? await ask(key, today, m.name, sym, m.dir, m.pct, TF_LABEL[m.tf], heads, m.evidence, preEarnings) : "";
          out[sym] = { why, ts: new Date().toISOString(), tf: m.tf };
          if (why) withWhy++;
        } catch (e: any) {
          // A transient LLM/news error must not overwrite a good "why it moved" with an empty one
          // stamped fresh (that suppressed regeneration for the whole TTL). Keep the prior entry;
          // if there was none, backdate ts so the next run retries instead of honoring the TTL.
          out[sym] = prev[sym]?.why ? prev[sym] : { why: "", ts: new Date(0).toISOString(), tf: m.tf };
          console.log(`  ${sym}: ${e.message}`);
        }
        if (++done % 25 === 0) console.log(`  …${done} generated`);
        await sleep(150);
      }
    }),
  );

  // generatedAt = the file-level staleness stamp (each row also keeps its own ts for the TTL).
  await writeFeedOrExit("catalysts.json", { generatedAt: new Date().toISOString(), bySymbol: out });
  const total = Object.values(out).filter((c) => c.why).length;
  console.log(`\nWrote ${Object.keys(out).length} catalysts (${total} with a why, ${withWhy} new this run).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
