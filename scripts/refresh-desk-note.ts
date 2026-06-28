/**
 * Morning Desk Note refresh — fuses the night's artifacts into one GLM-authored
 * tiered brief for the Home dashboard. Deterministic-first: this script picks the
 * top inputs (biggest movers + catalysts, high-impact filings, unusual options,
 * analyst actions); GLM only narrates/organizes/dedupes and stays descriptive.
 *
 * Runs in the nightly FULL rebuild AFTER refresh-data / refresh-catalysts /
 * refresh-overnight-filings / refresh-flow. Writes data/desk-note.json.
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
import type { DeskNote, DeskNoteSection } from "../lib/deskNote";

const DATA = path.join(process.cwd(), "data");
const BASE = "sp500"; // the headline US universe the brief is keyed to

const SYSTEM =
  "You are the markets desk writing a concise OVERNIGHT BRIEF for an equity-research dashboard. You are given the night's PRE-SELECTED data: the biggest stock moves (with any known catalyst), the most material new SEC filings, the largest unusual options trades, and notable analyst rating changes. Write a tiered brief a portfolio manager skims in 60 seconds. " +
  "RULES: organize into 3-5 short sections, most market-moving first; each bullet is ONE development in a single crisp sentence, tagged with the ticker(s) it concerns. DEDUPE across feeds — if a name appears in several (e.g. a big mover that also filed an 8-K and saw unusual calls), write ONE bullet that ties the threads together, not three. Ground every statement ONLY in the supplied data — never invent a number, price, or reason; if the data gives no catalyst for a move, say the move is unexplained. Stay strictly DESCRIPTIVE — what happened and where it shows up — never a forecast, target, or buy/sell/hold call. Omit any category that is empty/quiet. Also write a 1-2 sentence 'tldr' of the night's tone. " +
  NO_ADVICE;

const SCHEMA_HINT =
  'Return ONLY JSON: {"tldr": string, "sections": [{"heading": string, "bullets": [{"text": string, "tickers": string[]}]}]}';

const pct = (v: number | null | undefined) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

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
  const flow = getOptionsFlow(); // sync; OptionsFlow | null
  const analyst = await getAnalystActions(BASE).catch(() => []); // live Yahoo fetch — optional

  // --- Deterministic top-N selection per feed ---
  const stocks = snap?.stocks ?? [];
  const ranked = stocks
    .filter((s) => s.returns["1d"] != null)
    .sort((a, b) => (b.returns["1d"] as number) - (a.returns["1d"] as number));
  const movers = [...ranked.slice(0, 6), ...ranked.slice(-6).reverse()].map((s) => ({
    sym: s.symbol, name: s.name, ret: s.returns["1d"] as number, why: (catalysts as Record<string, { why?: string }>)?.[s.symbol]?.why || "",
  }));

  const filings = (overnight?.items ?? [])
    .filter((f) => f.impact === "high" || f.impact === "medium")
    .slice(0, 20)
    .map((f) => ({ t: f.ticker, form: f.form, impact: f.impact, sent: f.sentiment, head: f.headline }));

  const flows = (flow?.entries ?? [])
    .filter((e) => e.unusual)
    .slice(0, 8)
    .map((e) => ({ t: e.symbol, type: e.type, strike: e.strike, dte: e.dte, prem: e.premium, chg: e.chgPct }));

  const actions = (analyst ?? [])
    .filter((a) => a.action === "up" || a.action === "down")
    .slice(0, 10)
    .map((a) => ({ t: a.symbol, firm: a.firm, dir: a.action, from: a.fromGrade, to: a.toGrade, tgt: a.targetTo }));

  // --- Compact context block ---
  const block = (title: string, lines: string[]) => (lines.length ? `\n=== ${title} ===\n${lines.join("\n")}` : "");
  const user =
    `${SCHEMA_HINT}\n` +
    block("BIGGEST MOVES (1-day, S&P 500)", movers.map((m) => `${m.sym} ${pct(m.ret)} — ${m.name}${m.why ? ` · catalyst: ${m.why}` : " · no catalyst on file"}`)) +
    block("MATERIAL NEW SEC FILINGS", filings.map((f) => `${f.t} ${f.form} [${f.impact}/${f.sent}]: ${f.head}`)) +
    block("UNUSUAL OPTIONS FLOW", flows.map((f) => `${f.t} ${f.type.toUpperCase()} $${f.strike} ${f.dte ?? "?"}dte · ${money(f.prem)} premium${f.chg != null ? ` · stock ${pct(f.chg)}` : ""}`)) +
    block("ANALYST RATING CHANGES", actions.map((a) => `${a.t} ${a.dir === "up" ? "UPGRADE" : "DOWNGRADE"} ${a.from || "?"}→${a.to || "?"} (${a.firm})${a.tgt ? ` · PT ${a.tgt}` : ""}`));

  const counts = { movers: movers.length, filings: filings.length, flow: flows.length, analyst: actions.length };
  if (filings.length + flows.length + actions.length + movers.length === 0) {
    console.log("desk-note: no inputs available — skipping write.");
    return;
  }

  const out = await chatJSON<{ tldr: string; sections: DeskNoteSection[] }>(SYSTEM, user, { maxTokens: 4000 });
  if (!out || !Array.isArray(out.sections)) {
    console.warn("desk-note: LLM returned no usable brief — skipping write.");
    return;
  }

  const sections = out.sections
    .filter((s) => s && s.heading && Array.isArray(s.bullets) && s.bullets.length)
    .map((s) => ({
      heading: String(s.heading),
      bullets: s.bullets
        .filter((b) => b && typeof b.text === "string" && b.text.trim())
        .map((b) => ({ text: b.text.trim(), tickers: Array.isArray(b.tickers) ? b.tickers.filter((x) => typeof x === "string").slice(0, 6) : [] })),
    }))
    .filter((s) => s.bullets.length);

  const note: DeskNote = {
    generatedAt: new Date().toISOString(),
    asOf: overnight?.since ? `since ${new Date(overnight.since).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "overnight",
    tldr: typeof out.tldr === "string" ? out.tldr.trim() : "",
    sections,
    counts,
  };
  await fs.writeFile(path.join(DATA, "desk-note.json"), JSON.stringify(note));
  console.log(`desk-note: wrote ${sections.length} sections (${sections.reduce((n, s) => n + s.bullets.length, 0)} bullets) from ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
