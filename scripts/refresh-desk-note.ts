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
import { getNews, pickHeadlines, CAUSAL_WINDOW_DAYS } from "../lib/news";
import { buildBinaryWeek } from "../lib/binaryWeek";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { DeskNote, DeskNoteSection, DeskNoteWatch, DeskTape, DeskCalendar } from "../lib/deskNote";

const DATA = path.join(process.cwd(), "data");
const BASE = "sp500"; // headline US universe the brief is keyed to
// A note younger than this is fresh enough — makes the scheduler-resilience RETRY crons free (they
// no-op when the primary tick ran) without ever blocking the real morning/evening runs (~8h apart).
const FRESH_MIN = 150;

const readJson = async <T,>(f: string): Promise<T | null> =>
  fs.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

const SYSTEM =
  "You are a senior markets-desk strategist writing the morning brief for a sharp portfolio manager. You are given PRE-SELECTED overnight data WITH CONTEXT (trend, 52-week position, valuation, next-earnings, options skew, implied upside). " +
  "Do NOT just relist the data — for every development write the SECOND LAYER: WHY it matters, the mechanism / read-through, whether it looks like real signal or just noise, and what it sets up or what to watch next. Tie each section together with a one-line thematic 'synthesis' (the so-what for the group). Surface CONNECTIONS the raw feeds don't show on their own — e.g. a stock that is weak AND has heavy near-dated put premium AND just got downgraded is positioning into a catalyst; an unexplained move with no catalyst on file is itself notable. Give the bull AND the bear when it's a genuine debate. " +
  "Ground every claim in the supplied data — never invent a number, a price, or a reason, and never write a placeholder like '$XXB' (use only the figures supplied, or describe qualitatively). Each mover comes with EITHER a stated catalyst, OR recent news headlines, OR a note that none were found: when headlines are present, infer and STATE the most likely driver of the move (an FDA panel win, an earnings beat or guide, an upgrade, a deal, a product/pipeline event). EVERY headline is stamped with its DATE — use it. A one-day move can only be caused by something from the last day or two: a product announcement or partnership from weeks ago did NOT cause today's gap, however much it looks like a story. If the only headlines supplied are stale, or none plausibly explains a move that size, SAY the move is unexplained or the link is uncertain — do not reach for the nearest available headline and build a mechanism around it. A dated deal/takeover item always outranks a product or marketing item on the same name. Reserve the 'Unexplained' tag ONLY for moves where genuinely NO catalyst AND NO news were found, and only then treat the absence as itself information. Each bullet gets a short 'tag' classifying the development: Deal | Catalyst | Positioning | Unexplained | Trend | Analyst | Earnings ahead | Watch. End with 'watchToday' — concrete upcoming catalysts implied by the data (earnings tonight, a deal vote, an FDA date, a deal close). " +
  "DECISION-SUPPORT ONLY: characterize significance, signal-vs-noise, and what would confirm or refute a read — but NEVER issue a buy/sell/hold recommendation, a price target as advice, or position sizing. Dedupe across feeds: combine ONE name's threads (its move + filing + options + upgrade) into its single bullet. FORMAT (CRITICAL): each bullet's 'fact' describes exactly ONE ticker's move/event — at most one ticker's price change per fact, kept to a short scannable line. NEVER list two or more tickers' moves in a single fact, even when they share a theme: a four-name sector move is FOUR separate bullets under one section heading, tied together by that section's 'synthesis' line — not one run-on bullet. (You may reference a related ticker inside the 'read', but the 'fact' stays single-ticker.) COVERAGE: every stock that moved ±8% or more in the data MUST appear somewhere in the brief — fold it into the right section; never silently drop a double-digit move (those are exactly what the reader scans for). " +
  "SECTIONS (FIXED): use EXACTLY these headings, in this order, and omit a section only when it has no bullets — 1) the movers section (heading given in the run context), 2) 'Filings that matter', 3) 'Analyst actions', 4) 'Options desk'. Do NOT invent other section headings; the structure carries the meaning, the synthesis line carries the theme. " +
  NO_ADVICE;

const SCHEMA_HINT =
  'Return ONLY JSON: {"tldr": string (2-3 sentences: the tape + the single most important thing), "sections": [{"heading": string, "synthesis": string (the thematic read), "bullets": [{"fact": string (ONE company/event, a short scannable one-line title), "read": string (the SECOND LAYER — why it matters / read-through / signal-vs-noise / what to watch), "tickers": string[]}]}], "watchToday": [{"text": string, "tickers": string[]}]}';

const pct = (v: number | null | undefined, d = 1) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const sizeLabel = (mc: number) => (mc >= 2e11 ? "mega" : mc >= 1e10 ? "large" : mc >= 2e9 ? "mid" : "small");

async function main() {
  if (!(await llmConfigured())) {
    console.warn("desk-note: OPENROUTER_API_KEY not set — skipping.");
    return;
  }

  // Skip-if-fresh: the RETRY crons (added after GitHub dropped the 12:41 tick on 2026-07-08 and the
  // morning brief never appeared) re-run this script ~90min later — a no-op when the primary ran.
  const prior = await readJson<DeskNote>("desk-note.json");
  if (prior?.generatedAt && Date.now() - Date.parse(prior.generatedAt) < FRESH_MIN * 60_000) {
    console.log(`desk-note: current note is ${Math.round((Date.now() - Date.parse(prior.generatedAt)) / 60_000)}min old (< ${FRESH_MIN}) — fresh enough, skipping.`);
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
  const movers = await Promise.all(
    moverRows.map(async (s) => {
      const why = (catalysts as Record<string, { why?: string }>)?.[s.symbol]?.why || "";
      // No cached catalyst → actively pull recent news so GLM can explain the move instead of
      // shrugging "unexplained". (A 12% move almost always has a reason — go find it.)
      //
      // ⚠ These are 1-DAY movers, so pickHeadlines is mandatory: getNews ranks by SOURCE and reaches
      // back 120 days for press releases, so a raw .slice() hands over four-month-old PR and buries
      // today's wire story. That is how PYPL's $53bn takeover pop got explained as a Venmo/Canva
      // product story on 2026-07-15. Ask for a generous count — it only truncates an already-parsed
      // list, so it's free — and let pickHeadlines do the ranking. DATES STAY IN: the model can only
      // weigh recency if it can see it, and "recent news:" must not be a lie.
      let driver = why ? `catalyst: ${why}` : "";
      if (!why) {
        const news = await getNews(s.name || s.symbol, 30).catch(() => []);
        const heads = pickHeadlines(news, { nowMs: now, windowDays: CAUSAL_WINDOW_DAYS["1d"], limit: 3 });
        driver = heads.length
          ? `recent news: ${heads.map((h) => `${h.date ? `[${h.date}] ` : "[undated] "}${h.title}`).join(" | ")}`
          : "no catalyst or recent news found";
      }
      const val = s.forwardPE != null ? `fwdP/E ${s.forwardPE.toFixed(0)}` : s.trailingPE != null ? `P/E ${s.trailingPE.toFixed(0)}` : "";
      return (
        `${s.symbol} ${pct(s.returns["1d"])} (1w ${pct(s.returns["1w"])}, YTD ${pct(s.returns["ytd"])}) · ${s.sector || "?"} · ${money(s.marketCap)} (${sizeLabel(s.marketCap)}-cap)` +
        `${val ? ` · ${val}` : ""} · ${pct(s.pctFromHigh)} vs 52w-high${earnSoon(s.earningsDate)} · ${driver}`
      );
    }),
  );

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

  // ── CODE-BUILT tape strip + forward calendar (no LLM — always-accurate context) ─────────────────
  const withRet = stocks.filter((s) => s.returns["1d"] != null && s.marketCap > 0);
  const capSum = withRet.reduce((a, s) => a + s.marketCap, 0);
  const macro = await readJson<{ indicators?: { key: string; value: number | null; asOf?: string }[] }>("macro.json");
  const vixInd = macro?.indicators?.find((i) => i.key === "vix");
  const gammaFile = await readJson<{ rows?: any[] }>("gamma-board.json");
  const tape: DeskTape = {
    avg1d: capSum > 0 ? +(withRet.reduce((a, s) => a + s.marketCap * (s.returns["1d"] as number), 0) / capSum).toFixed(2) : null,
    adv: withRet.filter((s) => (s.returns["1d"] as number) > 0).length,
    dec: withRet.filter((s) => (s.returns["1d"] as number) < 0).length,
    big: withRet.filter((s) => Math.abs(s.returns["1d"] as number) >= 4).length,
    vix: vixInd?.value ?? null,
    vixAsOf: vixInd?.asOf ?? null,
    gamma: (gammaFile?.rows ?? [])
      .filter((r) => r.symbol === "SPY" || r.symbol === "QQQ")
      .map((r) => ({ symbol: r.symbol, regime: r.regime, distToFlipPct: r.distToFlipPct ?? null })),
  };

  // Reporters today/tomorrow (calendar-day diff, both sides floored to UTC midnight — the 10f4c822
  // class) + imminent hard binaries via the same join Binary Events This Week uses.
  const em = await readJson<{ rows?: any[] }>("earnings-move.json");
  const dayMs = 86_400_000;
  const nowMid = Math.floor(Date.now() / dayMs) * dayMs;
  const calEarnings = (em?.rows ?? [])
    .map((r) => {
      const t = Date.parse(r.earningsDate);
      if (!Number.isFinite(t)) return null;
      const d = Math.round((Math.floor(t / dayMs) * dayMs - nowMid) / dayMs);
      return d === 0 || d === 1 ? { symbol: r.symbol, name: r.name ?? r.symbol, when: (d === 0 ? "today" : "tomorrow") as "today" | "tomorrow", implied: r.impliedMovePct ?? null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => (a.when === b.when ? (b.implied ?? 0) - (a.implied ?? 0) : a.when === "today" ? -1 : 1))
    .slice(0, 10);
  const [bio, bioVol, cvol, ipo] = await Promise.all([
    readJson<{ items?: any[] }>("biotech-catalysts.json"),
    readJson<{ rows?: any[] }>("biotech-vol.json"),
    readJson<{ rows?: any[] }>("catalyst-vol.json"),
    readJson<{ events?: any[] }>("ipo-monitor.json"),
  ]);
  const binaries = buildBinaryWeek(
    { earnings: em?.rows, biotech: bio?.items, biotechVol: bioVol?.rows, investorDays: cvol?.rows, lockups: ipo?.events },
    Date.now(),
    { horizonDays: 3 },
  )
    .filter((e) => e.hardBinary)
    .slice(0, 6)
    .map((e) => ({ ticker: e.ticker, label: e.label, date: e.date, daysTo: e.daysTo, implied: e.impliedMovePct }));
  const calendar: DeskCalendar = { earnings: calEarnings, binaries };

  // Which run is this? Pre-open frames the brief around the overnight + the day ahead; post-close
  // (including the 22:47 UTC full rebuild) frames it as the session recap + tomorrow's setups.
  const etHour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
  const run: NonNullable<DeskNote["run"]> = etHour < 12 ? "morning" : "evening";
  const moversHeading = run === "morning" ? "Overnight & movers" : "The session";
  const FRAME = (run === "morning"
    ? "RUN CONTEXT: this is the PRE-OPEN MORNING run. Frame the brief as: what happened overnight and yesterday, and what to watch INTO today's session."
    : "RUN CONTEXT: this is the POST-CLOSE EVENING run. Frame the brief as: the session recap — what actually traded and what hit after the bell — and what it sets up for tomorrow ('watchToday' = tomorrow's watch list).")
    + ` The movers section's heading is EXACTLY "${moversHeading}".\n`
    + `TAPE CONTEXT (code-computed, cite freely in the tldr): S&P 500 cap-weighted 1-day ${pct(tape.avg1d)}, breadth ${tape.adv} up / ${tape.dec} down, ${tape.big} names moved ±4%+`
    + `${tape.vix != null ? `, VIX ${tape.vix.toFixed(1)} (close as of ${tape.vixAsOf ?? "recent"})` : ""}`
    + `${tape.gamma.length ? `, dealer gamma ${tape.gamma.map((g) => `${g.symbol} ${g.regime}`).join(" / ")}` : ""}.\n`;

  const block = (title: string, lines: string[]) => (lines.length ? `\n=== ${title} ===\n${lines.join("\n")}` : "");
  const user =
    FRAME +
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

  // The brief is a LARGE structured output (tldr + up to 5 sections × bullets + watch list). GLM-5.2 at
  // reasoningEffort:"high" spends a big share of the token budget on reasoning, and at maxTokens:9000 that
  // starved the JSON — the model burned ~14k output across a retry and still returned no parseable brief,
  // so the skip-write guard froze the note for a day+. Give it real output headroom and dial reasoning to
  // "medium" (this is synthesis/writing, not a hard judgment call) so the JSON reliably completes.
  const out = await chatJSON<{ tldr: string; sections: DeskNoteSection[]; watchToday: DeskNoteWatch[] }>(SYSTEM, user, { maxTokens: 16000, model: PRO_MODEL, reasoningEffort: "medium" });
  if (!out || !Array.isArray(out.sections)) {
    console.warn("desk-note: LLM returned no usable brief — skipping write.");
    return;
  }

  // Whitelist: every ticker the note names must exist in the inputs it was given (snapshot universe
  // ∪ filing tickers) — a hallucinated/truncated symbol otherwise renders as a broken or
  // wrong-company /stock/ link on the home dashboard.
  const knownSyms = new Set<string>(stocks.map((s) => s.symbol));
  for (const f of overnight?.items ?? []) if (f?.ticker) knownSyms.add(String(f.ticker).toUpperCase());
  const cleanTickers = (t: unknown) =>
    (Array.isArray(t) ? t.filter((x) => typeof x === "string").map((x) => x.toUpperCase()).filter((x) => knownSyms.has(x)).slice(0, 6) : []);
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
        })),
    }))
    .filter((s) => s.bullets.length);

  const watchToday = (Array.isArray(out.watchToday) ? out.watchToday : [])
    .filter((w) => w && typeof w.text === "string" && w.text.trim())
    .map((w) => ({ text: w.text.trim(), tickers: cleanTickers(w.tickers) }))
    .slice(0, 8);

  const note: DeskNote = {
    generatedAt: new Date().toISOString(),
    run,
    // Always dated — a bare "overnight" on a note that survives a failed rebuild reads as fresh
    // when it's actually yesterday's (F13 staleness honesty).
    asOf: overnight?.since
      ? `since ${new Date(overnight.since).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
      : `overnight · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
    tldr: typeof out.tldr === "string" ? out.tldr.trim() : "",
    tape,
    calendar,
    sections,
    watchToday,
    counts,
  };
  await fs.writeFile(path.join(DATA, "desk-note.json"), JSON.stringify(note));
  console.log(`desk-note: wrote ${sections.length} sections (${sections.reduce((n, s) => n + s.bullets.length, 0)} bullets) + ${watchToday.length} watch items from ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
