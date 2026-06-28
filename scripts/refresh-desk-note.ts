/**
 * Morning Desk Note refresh — fuses the night's artifacts into one GLM-authored
 * TWO-LAYER tiered brief for the Home dashboard / Morning Desk tab.
 *
 * Deterministic-first: this script picks the top inputs AND hands GLM real context
 * (trend, 52-week position, valuation, next-earnings, options skew, implied upside)
 * so it can write the second layer — why a development matters, signal vs noise,
 * what it sets up — not just relist data points. GLM analyzes/organizes/dedupes and
 * stays descriptive (no buy/sell/hold). Runs in the nightly FULL rebuild AFTER
 * refresh-data / refresh-catalysts / refresh-overnight-filings / refresh-flow.
 *   npm run refresh-desk-note
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadCatalysts } from "../lib/catalysts";
import { loadOvernightFilings } from "../lib/overnightFilings";
import { getOptionsFlow } from "../lib/optionsFlow";
import { getAnalystActions } from "../lib/analystActions";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import type { DeskNote, DeskNoteSection, DeskNoteWatch } from "../lib/deskNote";

const DATA = path.join(process.cwd(), "data");
const BASE = "sp500"; // headline US universe the brief is keyed to

const SYSTEM =
  "You are a senior markets-desk strategist writing the morning brief for a sharp portfolio manager. You are given PRE-SELECTED overnight data WITH CONTEXT (trend, 52-week position, valuation, next-earnings, options skew, implied upside). " +
  "Do NOT just relist the data — for every development write the SECOND LAYER: WHY it matters, the mechanism / read-through, whether it looks like real signal or just noise, and what it sets up or what to watch next. Tie each section together with a one-line thematic 'synthesis' (the so-what for the group). Surface CONNECTIONS the raw feeds don't show on their own — e.g. a stock that is weak AND has heavy near-dated put premium AND just got downgraded is positioning into a catalyst; an unexplained move with no catalyst on file is itself notable. Give the bull AND the bear when it's a genuine debate. " +
  "Ground every claim in the supplied data — never invent a number, a price, or a reason, and never write a placeholder like '$XXB' (use only the figures supplied, or describe qualitatively); if a move has no catalyst on file, say so and treat the absence as information. Each bullet gets a short 'tag' classifying the development: Deal | Catalyst | Positioning | Unexplained | Trend | Analyst | Earnings ahead | Watch. End with 'watchToday' — concrete upcoming catalysts implied by the data (earnings tonight, a deal vote, an FDA date, a deal close). " +
  "DECISION-SUPPORT ONLY: characterize significance, signal-vs-noise, and what would confirm or refute a read — but NEVER issue a buy/sell/hold recommendation, a price target as advice, or position sizing. Dedupe across feeds: one name = one bullet that ties its threads together. " +
  NO_ADVICE;

const SCHEMA_HINT =
  'Return ONLY JSON: {"tldr": string (2-3 sentences: the tape + the single most important thing), "sections": [{"heading": string, "synthesis": string (the thematic read), "bullets": [{"fact": string (what happened, concise), "read": string (the SECOND LAYER — why it matters / read-through / signal-vs-noise / what to watch), "tickers": string[], "tag": string}]}], "watchToday": [{"text": string, "tickers": string[]}]}';

const pct = (v: number | null | undefined, d = 1) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const sizeLabel = (mc: number) => (mc >= 2e11 ? "mega" : mc >= 1e10 ? "large" : mc >= 2e9 ? "mid" : "small");

async function main() {
  if (!(await llmConfigured())) {
    console.warn("desk-note: OPENROUTER_API_KEY not set — skipping.");
    return;
  }

  const [snap, catalysts, overnight] = await Promise.all([
    loadSnapshot(BASE).catch(() => null),
    loadCatalysts().catch(() => ({} as Record<string, { why?: string }>)),
    loadOvernightFilings().catch(() => null),
  ]);
  const flow = getOptionsFlow();
  const analyst = await getAnalystActions(BASE).catch(() => []);

  const now = Date.now();
  const earnSoon = (iso?: string | null) => {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const days = Math.round((ms - now) / 86_400_000);
    return days >= -1 && days <= 12 ? ` · reports ${new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
  };

  // --- Movers with trend / valuation / 52w / earnings context ---
  const stocks = snap?.stocks ?? [];
  const priceOf = new Map(stocks.map((s) => [s.symbol, s.price]));
  const ranked = stocks.filter((s) => s.returns["1d"] != null).sort((a, b) => (b.returns["1d"] as number) - (a.returns["1d"] as number));
  const moverRows = [...ranked.slice(0, 6), ...ranked.slice(-6).reverse()];
  const movers = moverRows.map((s) => {
    const why = (catalysts as Record<string, { why?: string }>)?.[s.symbol]?.why || "";
    const val = s.forwardPE != null ? `fwdP/E ${s.forwardPE.toFixed(0)}` : s.trailingPE != null ? `P/E ${s.trailingPE.toFixed(0)}` : "";
    return (
      `${s.symbol} ${pct(s.returns["1d"])} (1w ${pct(s.returns["1w"])}, YTD ${pct(s.returns["ytd"])}) · ${s.sector || "?"} · ${money(s.marketCap)} (${sizeLabel(s.marketCap)}-cap)` +
      `${val ? ` · ${val}` : ""} · ${pct(s.pctFromHigh)} vs 52w-high${earnSoon(s.earningsDate)} · ${why ? `catalyst: ${why}` : "NO catalyst on file"}`
    );
  });

  // --- Material filings with substance (whatChanged + takeaway), not just headlines ---
  const filings = (overnight?.items ?? [])
    .filter((f) => f.impact === "high" || f.impact === "medium")
    .slice(0, 22)
    .map((f) => {
      const wc = (f.whatChanged || []).slice(0, 2).join("; ");
      return `${f.ticker} ${f.form} [${f.impact}/${f.sentiment}]: ${f.headline}${wc ? ` | ${wc}` : ""}${f.decisionTakeaway ? ` | takeaway: ${f.decisionTakeaway}` : ""}`;
    });

  // --- Options flow aggregated per name → call/put skew + total premium ---
  const byName = new Map<string, { call: number; put: number; chg: number | null; top: string }>();
  for (const e of (flow?.entries ?? []).filter((x) => x.unusual)) {
    const a = byName.get(e.symbol) || { call: 0, put: 0, chg: e.chgPct, top: "" };
    if (e.type === "call") a.call += e.premium; else a.put += e.premium;
    if (!a.top) a.top = `${e.type} $${e.strike} ${e.dte ?? "?"}dte`;
    byName.set(e.symbol, a);
  }
  const flows = [...byName.entries()]
    .map(([sym, a]) => ({ sym, ...a, total: a.call + a.put }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((a) => {
      const skew = a.call > a.put * 2 ? "CALL-heavy" : a.put > a.call * 2 ? "PUT-heavy" : "two-way";
      return `${a.sym} ${skew}: ${money(a.total)} total (${money(a.call)} calls / ${money(a.put)} puts), biggest ${a.top}${a.chg != null ? ` · stock ${pct(a.chg)}` : ""}`;
    });

  // --- Analyst up/downgrades with implied upside vs current price ---
  const actions = (analyst ?? [])
    .filter((a) => a.action === "up" || a.action === "down")
    .slice(0, 12)
    .map((a) => {
      const px = priceOf.get(a.symbol);
      const up = a.targetTo && px ? ` · PT ${a.targetTo} (${pct((a.targetTo / px - 1) * 100, 0)} vs px)` : a.targetTo ? ` · PT ${a.targetTo}` : "";
      return `${a.symbol} ${a.action === "up" ? "UPGRADE" : "DOWNGRADE"} ${a.fromGrade || "?"}→${a.toGrade || "?"} (${a.firm})${up}`;
    });

  const block = (title: string, lines: string[]) => (lines.length ? `\n=== ${title} ===\n${lines.join("\n")}` : "");
  const user =
    `${SCHEMA_HINT}\n` +
    block("BIGGEST MOVES (1-day, S&P 500; with 1w/YTD trend, sector, size, valuation, 52w-position, next-earnings, catalyst)", movers) +
    block("MATERIAL NEW SEC FILINGS (with what-changed + the model's takeaway)", filings) +
    block("UNUSUAL OPTIONS FLOW (aggregated per name → call/put skew)", flows) +
    block("ANALYST RATING CHANGES (with implied upside vs current price)", actions);

  const counts = { movers: movers.length, filings: filings.length, flow: flows.length, analyst: actions.length };
  if (movers.length + filings.length + flows.length + actions.length === 0) {
    console.log("desk-note: no inputs available — skipping write.");
    return;
  }

  const out = await chatJSON<{ tldr: string; sections: DeskNoteSection[]; watchToday: DeskNoteWatch[] }>(SYSTEM, user, { maxTokens: 7000 });
  if (!out || !Array.isArray(out.sections)) {
    console.warn("desk-note: LLM returned no usable brief — skipping write.");
    return;
  }

  const cleanTickers = (t: unknown) => (Array.isArray(t) ? t.filter((x) => typeof x === "string").slice(0, 6) : []);
  const sections = out.sections
    .filter((s) => s && s.heading && Array.isArray(s.bullets) && s.bullets.length)
    .map((s) => ({
      heading: String(s.heading),
      synthesis: typeof s.synthesis === "string" ? s.synthesis.trim() : "",
      bullets: s.bullets
        .filter((b) => b && typeof b.fact === "string" && b.fact.trim())
        .map((b) => ({
          fact: b.fact.trim(),
          read: typeof b.read === "string" ? b.read.trim() : "",
          tickers: cleanTickers(b.tickers),
          tag: typeof b.tag === "string" ? b.tag.trim().slice(0, 16) : "",
        })),
    }))
    .filter((s) => s.bullets.length);

  const watchToday = (Array.isArray(out.watchToday) ? out.watchToday : [])
    .filter((w) => w && typeof w.text === "string" && w.text.trim())
    .map((w) => ({ text: w.text.trim(), tickers: cleanTickers(w.tickers) }))
    .slice(0, 8);

  const note: DeskNote = {
    generatedAt: new Date().toISOString(),
    asOf: overnight?.since ? `since ${new Date(overnight.since).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "overnight",
    tldr: typeof out.tldr === "string" ? out.tldr.trim() : "",
    sections,
    watchToday,
    counts,
  };
  await fs.writeFile(path.join(DATA, "desk-note.json"), JSON.stringify(note));
  console.log(`desk-note: wrote ${sections.length} sections (${sections.reduce((n, s) => n + s.bullets.length, 0)} bullets) + ${watchToday.length} watch items from ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
