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
import { loadCatalysts, type CatalystMap } from "../lib/catalysts";
import { daysUntil } from "../lib/calendar";
import { selectDeskActions, actionVerb } from "../lib/deskAnalyst";
import { fmtDate } from "../lib/format";
import { loadOvernightFilings } from "../lib/overnightFilings";
import { getOptionsFlow } from "../lib/optionsFlow";
import { getAnalystActionsDetailed } from "../lib/analystActions";
import { getNewsChecked, pickHeadlines, CAUSAL_WINDOW_DAYS } from "../lib/news";
import { buildMoveEvidence, cryptoExplains, type SocialBuzz } from "../lib/moveEvidence";
import { getCryptoTape } from "../lib/market";
import { latestScannerFor, type StaplesScannerData } from "../lib/staplesScanner";
import { fetchLiveMarketHeadlines } from "../lib/marketHeadlinesFetch";
import { askConfigured, gatherContext, askGemini } from "../lib/ask";
import type { ApeWisdomData } from "../lib/apewisdom";
import { detectRecentReport, movePreDatesReport } from "../lib/preannounce";
import { buildBinaryWeek } from "../lib/binaryWeek";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { DeskNote, DeskNoteSection, DeskNoteWatch, DeskTape, DeskCalendar, DeskSource } from "../lib/deskNote";

const DATA = path.join(process.cwd(), "data");
const BASE = "sp500"; // headline US universe the brief is keyed to
// A note younger than this is fresh enough — makes the scheduler-resilience RETRY crons free (they
// no-op when the primary tick ran) without ever blocking the real morning/evening runs (~8h apart).
const FRESH_MIN = 150;
// The grounded "why did it move" ask defaults to flash — it's search-grounded (Google Search does the
// fact-finding) and ~20x cheaper on input than a Pro model, and its output is a 1-2 sentence reason, not
// heavy reasoning. Bump via DESK_GROUNDED_MODEL (e.g. gemini-3.1-pro-preview) if the answers thin out.
const GROUNDED_MODEL = process.env.DESK_GROUNDED_MODEL || "gemini-2.5-flash";
// A 1-day move at least this big ALWAYS gets the grounded "why" — the day's headline movers must never be
// hand-waved as a sector move or left on a stale/generic cached catalyst (the MRNA vaccine-day miss).
// Bounded by DESK_GROUNDED_MAX, and grounding is free to ~5k searches/mo. Override with DESK_GROUNDED_BIG.
const GROUNDED_BIG_MOVE_PCT = Number(process.env.DESK_GROUNDED_BIG) || 8;

const readJson = async <T,>(f: string): Promise<T | null> =>
  fs.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

const SYSTEM =
  "You are a senior markets-desk strategist writing the morning brief for a sharp portfolio manager. You are given PRE-SELECTED overnight data WITH CONTEXT (trend, 52-week position, valuation, next-earnings, options skew, implied upside). " +
  "Do NOT just relist the data — for every development write the SECOND LAYER: WHY it matters, the mechanism / read-through, whether it looks like real signal or just noise, and what it sets up or what to watch next. Tie each section together with a one-line thematic 'synthesis' (the so-what for the group). Surface CONNECTIONS the raw feeds don't show on their own — e.g. a stock that is weak AND has heavy near-dated put premium AND just got downgraded is positioning into a catalyst; an unexplained move with no catalyst on file is itself notable. Give the bull AND the bear when it's a genuine debate. " +
  "Ground every claim in the supplied data — never invent a number, a price, or a reason, and never write a placeholder like '$XXB' (use only the figures supplied, or describe qualitatively). Each mover comes with EITHER a stated catalyst, OR a `grounded (web search):` explanation — a live web-search-sourced reason for the move WITH dated citations, from the SAME engine as the stock pages' 'why is it moving' feature; treat it as a reliable, fact-checked driver, lead the bullet with it, and NEVER override it with 'no catalyst' — OR recent news headlines, OR a note that none were found: when headlines are present, infer and STATE the most likely driver of the move (an FDA panel win, an earnings beat or guide, an upgrade, a deal, a product/pipeline event). EVERY headline is stamped with its DATE — use it. A one-day move can only be caused by something from the last day or two: a product announcement or partnership from weeks ago did NOT cause today's gap, however much it looks like a story. If the only headlines supplied are stale, or none plausibly explains a move that size, SAY the move is unexplained or the link is uncertain — do not reach for the nearest available headline and build a mechanism around it. A dated deal/takeover item always outranks a product or marketing item on the same name. ATTRIBUTION RULE — EARNINGS OUTRANK EVERYTHING, BUT MIND THE SESSION CLOCK: when a mover is marked 'REPORTED EARNINGS …' (a results 8-K is on record), that print is normally the driver — lead with the report (use headlines for the beat/miss/guide color), and treat any analyst upgrade/downgrade dated at or after the print as REACTION to it, never the cause. CRITICAL — a company reports either BEFORE the open (BMO) or AFTER the close (AMC), and the marker says which; the % move you are given is the REGULAR-SESSION (close-to-close) move. An AFTER-CLOSE (AMC) print released TODAY comes out AFTER that session closed, so today's move PRE-DATES the earnings and is NOT the reaction to them (the reaction is after-hours and the NEXT session). When the line flags this ('PRINT HIT AFTER TODAY'S CLOSE … PRE-DATES the earnings'), NEVER frame today's regular-session move as a 'sell-the-news', 'the market refused to reward the beat', or any reaction to the print — a large drop INTO an after-close print is pre-earnings de-risking/positioning, not a verdict on the results; attribute today's move to the tape/sector/positioning via MOVE EVIDENCE, and report the print SEPARATELY as a forward event (what it sets up after-hours / next session — surface it in watchToday). This applies wherever the name appears, movers AND 'Filings that matter'. A BEFORE-OPEN (BMO) print released today DID drive today's session — attribute normally. The session AFTER a print is the earnings reaction; a move 2-7 days after a marked report with no fresh catalyst is a CONTINUED post-earnings move — say so and tag it Earnings, never 'no specific catalyst'. MECHANISM RULE — NEVER headline a mover 'no specific catalyst' or 'no catalyst found': every mover carries MOVE EVIDENCE computed from the data (its sector's own 1-day move and the RESIDUAL the sector does not explain; the largest and hottest same-industry peers' moves; elevated short volume when present; and SOCIAL attention — a Reddit mention surge — when the crowd is loud enough to register). When no fresh headline exists, USE IT to state the best-evidenced mechanism as the fact line and the read: a small residual = a sector/theme move (name the sector's move, and when one peer clearly led with news, name the leader — 'sector sympathy: semis ripped, SNDK +18% led'); CRYPTO BETA — a crypto-linked name (COIN, HOOD, MSTR, or a bitcoin miner) carries a 'crypto tape:' evidence line: when BTC/ETH moved and the name moved the SAME way, the crypto move IS the driver — say 'crypto beta: BTC +x% today' and cite the figure, NEVER 'no catalyst', and NEVER pin a whole-complex crypto move on a single-name story (a crypto-linked name moving AGAINST a flat/opposite crypto tape is the name-specific case — then look for its own news); a large residual with elevated short volume on an up-move = squeeze-flavored positioning; a large residual with no news = idiosyncratic positioning/de-grossing — say which and cite the numbers supplied. When a 'social:' line is present, read it as RETAIL ATTENTION — a Reddit mention surge corroborates that the crowd is crowding the move (squeeze-flavored on an up-move, especially alongside elevated short volume) — cite it as corroboration, NEVER as the cause of the move (buzz reacts to moves as often as it drives them), and NEVER let 'retail is loud' stand in for a real catalyst. NEVER invent a mechanism the evidence doesn't support — the evidence numbers are the ONLY figures you may cite for it (the social figures included: cite only what is supplied). Reserve the 'Unexplained' tag ONLY for moves where genuinely NO catalyst AND NO news were found AND no recent report is marked AND the move evidence itself is flat/absent — and only then treat the absence as itself information. Each bullet gets a short 'tag' classifying the development: Deal | Earnings | Catalyst | Positioning | Unexplained | Trend | Analyst | Earnings ahead | Watch. End with 'watchToday' — concrete upcoming catalysts implied by the data (earnings tonight, a deal vote, an FDA date, a deal close). " +
  "ANALYST CLUSTERS — when SEVERAL firms reaffirm/maintain/upgrade the SAME name on one day and that name's analyst line shows it just fell hard (a big negative 1w return, and/or 'reported earnings Nd ago'), read it as the sell-side DEFENDING a post-earnings selloff — consensus circling the wagons around the drop — NOT a 'roadshow' or 'analyst day' (never assert a company event the data does not state); the so-what is whether price follows the reaffirmed targets or this is peak sentiment. STAPLES SCANNER — when a staples name reporting today/tomorrow carries a 'Nielsen scanner' line, that is the ~2-week-lagged US point-of-sale demand & share trend into its print: lead its watchToday note with whether scanner sales are ACCELERATING or DECELERATING vs the 12-week and any share gains/losses — a decelerating scanner with share loss into a print is a soft-quarter setup, accelerating + share gains the opposite. Cite only the scanner figures supplied. DECISION-SUPPORT ONLY: characterize significance, signal-vs-noise, and what would confirm or refute a read — but NEVER issue a buy/sell/hold recommendation, a price target as advice, or position sizing. Dedupe across feeds: combine ONE name's threads (its move + filing + options + upgrade) into its single bullet. FORMAT (CRITICAL): each bullet's 'fact' describes exactly ONE ticker's move/event — at most one ticker's price change per fact, kept to a short scannable line. NEVER list two or more tickers' moves in a single fact, even when they share a theme: a four-name sector move is FOUR separate bullets under one section heading, tied together by that section's 'synthesis' line — not one run-on bullet. (You may reference a related ticker inside the 'read', but the 'fact' stays single-ticker.) COVERAGE: every stock that moved ±8% or more in the data MUST appear somewhere in the brief — fold it into the right section; never silently drop a double-digit move (those are exactly what the reader scans for). " +
  "SECTIONS (FIXED): use EXACTLY these headings, in this order, and omit a section only when it has no bullets — 1) the movers section (heading given in the run context), 2) 'Filings that matter', 3) 'Analyst actions', 4) 'Options desk'. Do NOT invent other section headings; the structure carries the meaning, the synthesis line carries the theme. " +
  NO_ADVICE;

const SCHEMA_HINT =
  'Return ONLY JSON: {"tldr": string (2-3 sentences: the tape + the single most important thing), "sections": [{"heading": string, "synthesis": string (the thematic read), "bullets": [{"fact": string (ONE company/event, a short scannable one-line title), "read": string (the SECOND LAYER — why it matters / read-through / signal-vs-noise / what to watch), "tickers": string[]}]}], "watchToday": [{"text": string, "tickers": string[]}]}';

const pct = (v: number | null | undefined, d = 1) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const sizeLabel = (mc: number) => (mc >= 2e11 ? "mega" : mc >= 1e10 ? "large" : mc >= 2e9 ? "mid" : "small");

/** Bounded-concurrency map — used for the desk-note's grounded per-mover "why did it move" pull (see the
 *  no-catalyst block). Same shape as every other refresh script's local pool; kept local by convention. */
async function mapPool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
    }),
  );
  return out;
}

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
    loadCatalysts().catch(() => ({} as CatalystMap)),
    loadOvernightFilings().catch(() => null),
  ]);
  const flow = getOptionsFlow();
  // Coverage-aware (2026-08-15 sweep): a 429 storm thins the ~140-name scan to a handful of survivors
  // and still returns a well-formed array — indistinguishable from a quiet week. Below the same 80%
  // threshold the API route uses, the brief must not present the thin list as "the day's actions".
  const { actions: analyst, ok: aOk, attempted: aAtt } = await getAnalystActionsDetailed(BASE).catch(() => ({ actions: [], ok: 0, attempted: 1 }));
  const analystDegraded = aAtt > 0 && aOk / aAtt < 0.8;
  if (analystDegraded) console.error(`desk-note: ⚠ analyst scan DEGRADED (${aOk}/${aAtt} fetches ok) — the section will say so instead of reading as a quiet day`);

  // ── MOVE EVIDENCE context (lib/moveEvidence): sector residual + peer tape + short-vol pressure,
  // all computed from feeds already on disk. This is what lets the model state a MECHANISM for a
  // no-headline mover ("sector sympathy", "squeeze-flavored") instead of shrugging "no catalyst" —
  // without ever guessing: every number it may cite is arithmetic, not inference.
  const sectorRet1d = new Map<string, number>(
    (snap?.sectors ?? []).filter((x: any) => x?.etf && x?.returns?.["1d"] != null).map((x: any) => [x.etf as string, x.returns["1d"] as number]),
  );
  const shortMech = await readJson<{ rows?: { symbol: string; latestShortVolPct?: number | null; shortVolTrendPp?: number | null }[] }>("short-mechanics.json");
  const shortVol = new Map(
    (shortMech?.rows ?? [])
      .filter((r) => r.symbol && r.latestShortVolPct != null)
      .map((r) => [r.symbol, { pct: r.latestShortVolPct as number, trendPp: r.shortVolTrendPp }]),
  );
  const peerRows = (snap?.stocks ?? []).map((s) => ({
    symbol: s.symbol, industry: (s as any).industry, sector: s.sector, marketCap: s.marketCap, ret1d: s.returns["1d"],
  }));
  // Crypto tape (BTC/ETH 1d) — the missing factor for crypto-linked movers (COIN/HOOD/MSTR/miners),
  // whose move tracks bitcoin, not their GICS sector. Fetched live; degrades to nulls, never throws.
  const crypto = await getCryptoTape().catch(() => ({ btc1d: null, eth1d: null, sol1d: null, asOf: "" }));
  if (crypto.btc1d != null) console.log(`desk-note: crypto tape BTC ${pct(crypto.btc1d)}${crypto.eth1d != null ? `, ETH ${pct(crypto.eth1d)}` : ""}`);

  const now = Date.now();
  // Which run is this? (computed up front — the movers' earnings attribution needs it below, and the
  // FRAME uses it later.) Pre-open MORNING vs post-close EVENING both frames the brief AND fixes the last
  // COMPLETED regular session, so an after-close print can be judged against the session the shown 1-day
  // (close-to-close) move actually covers.
  const etHour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }));
  const run: NonNullable<DeskNote["run"]> = etHour < 12 ? "morning" : "evening";
  const todayET = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD in ET (matches EDGAR filingDate)
  const prevWeekday = (day: string): string => {
    const d = new Date(day + "T12:00:00Z");
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  };
  // Last COMPLETED session as of this run: today in the evening (post-close) run, the prior weekday pre-open.
  // (Weekday approx — a holiday at worst degrades one edge day to the old behavior, never a false caveat.)
  const lastSessionDay = run === "evening" ? todayET : prevWeekday(todayET);

  // Calendar-day countdown, not an elapsed-ms round — otherwise the window flips with the clock (the
  // daysUntil class). fmtDate handles the instant-vs-bare-date distinction for the label.
  const earnSoon = (iso?: string | null) => {
    const days = iso ? daysUntil(iso, now) : null;
    return days != null && days >= -1 && days <= 12 ? ` · reports ${fmtDate(iso!, { year: false })}` : "";
  };

  // --- Movers with trend / valuation / 52w / earnings context ---
  const stocks = snap?.stocks ?? [];
  const priceOf = new Map(stocks.map((s) => [s.symbol, s.price]));
  const ranked = stocks.filter((s) => s.returns["1d"] != null).sort((a, b) => (b.returns["1d"] as number) - (a.returns["1d"] as number));
  const moverRows = [...ranked.slice(0, 6), ...ranked.slice(-6).reverse()];
  // A cached catalyst may only explain THIS 1-day move if it was generated FOR a short-timeframe move
  // and RECENTLY. refresh-catalysts stores each symbol's shortest-timeframe catalyst, so a name that's
  // a 1-day mover here but was only a YTD mover there carries a YTD *story* ("up on the AI narrative")
  // — applying that to today's gap is the same recency error as the PYPL fabrication, one layer up.
  // When it fails the gate we fall through to the (now recency-correct) news path rather than trust it.
  const CATALYST_MAX_AGE_MS = 3 * 86_400_000;
  const freshDayCatalyst = (sym: string): string => {
    const c = catalysts?.[sym];
    if (!c?.why) return "";
    if (c.tf && c.tf !== "1d" && c.tf !== "1w") return ""; // a longer-horizon story, not today's driver
    if (c.ts && now - Date.parse(c.ts) > CATALYST_MAX_AGE_MS) return ""; // last week's pop, not today's
    return c.why;
  };

  // ── SOCIAL context (lib/moveEvidence): Reddit ATTENTION from the ApeWisdom snapshot already on disk.
  // Numbers only (mention surge, rank climb) — like the rest of MOVE EVIDENCE, the model may cite the
  // figures but never the raw posts. It lets a headline-less mover read "no news, but Reddit mentions
  // +420% (climbed 38) — retail is crowding it". (StockTwits sentiment was evaluated and dropped: it
  // skews so bullish that "% bullish" is platform baseline, not signal — a name DOWN 5% still showed
  // ~100% bullish. The named CAUSE now comes from the grounded ask below.)
  const ape = await readJson<ApeWisdomData>("apewisdom.json");
  const social = new Map<string, SocialBuzz>();
  for (const s of moverRows) {
    const a = ape?.byTicker?.[s.symbol.toUpperCase()];
    if (a) social.set(s.symbol, { redditMentions: a.mentions, redditMentionChangePct: a.mentionChangePct, redditRank: a.rank, redditRankChange: a.rankChange });
  }

  // Build each mover's descriptive line + attribution as STRUCTURED rows (not final strings), so the
  // no-catalyst ones can get a grounded "why did it move" pass (below) before the lines are assembled.
  const moverData = await Promise.all(
    moverRows.map(async (s) => {
      // ── Move attribution, CODE-FIRST: did this name just REPORT? ──
      // The 8-K Item 2.02 filing date is the ground truth "it reported Nd ago" fact, checked BEFORE
      // any headline inference. Without it the model attributes the print's move to whatever headline
      // survives ranking — ABNB +17% was credited to a Wedbush upgrade the morning it REPORTED, and
      // RMD's Friday print read as "no specific catalyst" on Monday (2026-08 report). Headlines still
      // ride along for the beat/miss color; the filing fact anchors WHAT the driver is.
      const ret1d = s.returns["1d"] as number;
      const rep = await detectRecentReport(s.symbol, now).catch(() => null);
      const why = freshDayCatalyst(s.symbol);
      // No usable cached catalyst → actively pull recent news so GLM can explain the move instead of
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
        // CHECKED fetch: "the news check DIED" and "no news exists" are different facts, and the brief
        // must never publish the second when the first happened (2026-08-15 sweep — during the outage
        // every mover read "no catalyst found" because the fetch was down, a false absence claim).
        const { items: news, fetchFailed } = await getNewsChecked(s.name || s.symbol, 30).catch(() => ({ items: [], fetchFailed: true }));
        const heads = pickHeadlines(news, { nowMs: now, windowDays: CAUSAL_WINDOW_DAYS["1d"], limit: 3 });
        driver = heads.length
          ? `recent news: ${heads.map((h) => `${h.date ? `[${h.date}] ` : "[undated] "}${h.title}`).join(" | ")}`
          : fetchFailed
            ? "news check UNAVAILABLE this run (fetch failed — absence of headlines is NOT evidence of no news); attribute via MOVE EVIDENCE only and say the news check didn't run"
            : "no name-specific news in the causal window — attribute via MOVE EVIDENCE";
      }
      if (rep) {
        const when = rep.daysAgo === 0 ? "TODAY" : rep.daysAgo === 1 ? "YESTERDAY" : `${rep.date} (${rep.daysAgo}d ago)`;
        const tlabel = rep.timing === "premarket" ? " before the open (BMO)" : rep.timing === "afterhours" ? " after the close (AMC)" : rep.timing === "intraday" ? " intraday" : "";
        // SESSION-CLOCK caveat: an AFTER-CLOSE print is released after its day's session closes, so if that
        // day IS the last completed session (the one the shown 1-day close-to-close move covers), the move
        // PRE-DATES the print — it is NOT the earnings reaction (that's after-hours + the next session).
        // Holds for BOTH runs: the evening run's session is today; the pre-open morning run's is yesterday,
        // whose after-close print the pre-open tape hasn't reacted to yet. The DELL 2026-09-01 case: blowout
        // print AFTER the close, yet the -6.8% regular-session drop was the risk-off tape + pre-earnings
        // de-risking, not a 'sell-the-news'.
        const preEarnings = movePreDatesReport(rep.timing, rep.date, lastSessionDay);
        driver =
          `REPORTED EARNINGS ${when}${tlabel} — 8-K results filing on record` +
          (preEarnings
            ? ` ⚠ PRINT LANDED AFTER THAT SESSION'S CLOSE: the shown ${pct(ret1d)} close-to-close move PRE-DATES the earnings and is NOT the reaction to them — attribute this move to the tape/sector/positioning (MOVE EVIDENCE below; a big drop INTO an after-close print is pre-earnings de-risking, not a verdict on results), and treat the print as a SEPARATE after-hours / next-session event`
            : "") +
          (driver ? ` · ${driver}` : "");
      }
      const evidence = buildMoveEvidence(
        { symbol: s.symbol, sector: s.sector, industry: (s as any).industry, etf: (s as any).etf, ret1d },
        { sectorRet1d, rows: peerRows, shortVol, social, crypto },
      );
      // Does this mover need the grounded web-search "why"? Fire it for a big IDIOSYNCRATIC move (the
      // sector does NOT explain it) with no CONFIRMED catalyst (no fresh 8-K report, no fresh cached
      // catalyst). ⚠ Do NOT gate on "Yahoo returned zero headlines" — that was the AVGO miss
      // (2026-08-16): AVGO fell 5.9% on an actively-exploited VMware CVE + a BofA debt downgrade that
      // Yahoo's feed never carried, so a stale/irrelevant headline slipped through, the gate saw "has
      // headlines" and skipped the ask, and the brief shrugged "no fresh catalyst" while the grounded
      // model (run by hand) found BOTH drivers. The web search finds what the feed misses. Sector-
      // sympathy moves (small residual) skip it — MOVE EVIDENCE already explains those — so cost stays bounded.
      const secRet = (s as any).etf != null ? sectorRet1d.get((s as any).etf) : undefined;
      const residual = secRet != null ? ret1d - secRet : ret1d;
      const sectorExplains = secRet != null && Math.sign(secRet) === Math.sign(ret1d) && Math.abs(residual) < Math.abs(ret1d) * 0.5;
      // A crypto-linked name moving WITH a material crypto tape is crypto beta, not idiosyncratic — the
      // MOVE EVIDENCE crypto line already explains it, so don't burn a grounded search (the sector analogue).
      // BUT the day's BIGGEST movers (≥ GROUNDED_BIG_MOVE_PCT) always get the grounded catalyst check even
      // when the sector "explains" the move or a (possibly stale/generic) cached catalyst exists — that is
      // how MRNA's vaccine-day move read as a healthcare-sector wiggle. Only a confirmed earnings print (rep)
      // or a crypto-beta move — which already carry real drivers — suppress it. Smaller moves keep the cheap
      // gate: ground only the idiosyncratic, no-cached-catalyst ones. The grounded answer, when it lands,
      // supersedes the cached catalyst (and on failure we fall back to it — degrade, don't error).
      const bigMove = Math.abs(ret1d) >= GROUNDED_BIG_MOVE_PCT;
      const needsGrounding = !rep && !cryptoExplains(s.symbol, crypto.btc1d, ret1d) && (bigMove || (!why && !sectorExplains));
      const val = s.forwardPE != null ? `fwdP/E ${s.forwardPE.toFixed(0)}` : s.trailingPE != null ? `P/E ${s.trailingPE.toFixed(0)}` : "";
      const prefix =
        `${s.symbol} ${pct(ret1d)} (1w ${pct(s.returns["1w"])}, YTD ${pct(s.returns["ytd"])}) · ${s.sector || "?"} · ${money(s.marketCap)} (${sizeLabel(s.marketCap)}-cap)` +
        `${val ? ` · ${val}` : ""} · ${pct(s.pctFromHigh)} vs 52w-high${earnSoon(s.earningsDate)}`;
      return { symbol: s.symbol, name: s.name || s.symbol, ret1d, prefix, driver, evidence, needsGrounding };
    }),
  );

  // ── GROUNDED "why did it move" — extend the stock-page ExplainMove engine (lib/ask: Gemini + Google
  // Search grounding, with dated source citations) to the desk brief. Targets big IDIOSYNCRATIC movers
  // with no confirmed catalyst (see needsGrounding above) — the names that would otherwise shrug "no
  // fresh catalyst" despite a real, findable driver (the AVGO case) — biggest move first, capped by
  // DESK_GROUNDED_MAX so a wild tape can't run up the bill. Grounding is free to 5k searches/mo.
  // Degrade-don't-error: any failure just leaves the base MOVE EVIDENCE attribution, never a fabrication.
  const moveSources: { ticker: string; sources: DeskSource[] }[] = [];
  if (askConfigured()) {
    const GROUNDED_MAX = Number(process.env.DESK_GROUNDED_MAX) || 10;
    const need = moverData
      .filter((m) => m.needsGrounding)
      .sort((a, b) => Math.abs(b.ret1d) - Math.abs(a.ret1d))
      .slice(0, GROUNDED_MAX);
    if (need.length) {
      console.log(`desk-note: grounded why-move ask for ${need.length} idiosyncratic mover(s) with no confirmed catalyst: ${need.map((m) => m.symbol).join(", ")}`);
      await mapPool(need, 3, async (m) => {
        const q =
          `In 1-2 sentences, what specifically drove ${m.name} (${m.symbol})'s ${pct(m.ret1d)} share-price move in its latest trading session? ` +
          `Name the dated catalyst — earnings or guidance, an analyst rating/price-target change, product/regulatory/legal news, or M&A — ` +
          `or say plainly if it was mostly a sector/market move. Cite the date of the development; if nothing specific is findable, say so rather than guessing.`;
        try {
          const res = await askGemini(q, await gatherContext(m.symbol, m.name), [], { model: GROUNDED_MODEL });
          if (res?.answer) {
            m.driver = `grounded (web search): ${res.answer.replace(/\s+/g, " ").trim()}`;
            if (res.sources.length) moveSources.push({ ticker: m.symbol, sources: res.sources.slice(0, 4) });
          }
        } catch (e: any) {
          console.warn(`desk-note: grounded ask failed for ${m.symbol} (${String(e?.message || e).slice(0, 80)}) — keeping MOVE EVIDENCE attribution`);
        }
      });
    }
  } else {
    console.log("desk-note: GEMINI_API_KEY not set — skipping grounded why-move ask (movers fall back to MOVE EVIDENCE).");
  }

  const movers = moverData.map((m) => `${m.prefix} · ${m.driver}${m.evidence ? ` · ${m.evidence}` : ""}`);

  // --- Material filings with substance (whatChanged + takeaway), not just headlines ---
  const filings = (overnight?.items ?? [])
    .filter((f) => f.impact === "high" || f.impact === "medium")
    .slice(0, 22)
    .map((f) => {
      const wc = (f.whatChanged || []).slice(0, 2).join("; ");
      // Release timing so the model applies the session-clock rule here too (an after-close results 8-K
      // means the day's regular-session move pre-dates it — not a verdict on the print).
      const t = f.reportTiming === "afterhours" ? " · released AFTER the close (AMC)" : f.reportTiming === "premarket" ? " · released BEFORE the open (BMO)" : "";
      return `${f.ticker} ${f.form}${t} [${f.impact}/${f.sentiment}]: ${f.headline}${wc ? ` | ${wc}` : ""}${f.decisionTakeaway ? ` | takeaway: ${f.decisionTakeaway}` : ""}`;
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

  // --- Analyst actions, bounded by RECENCY rather than by count ---
  //
  // ⚠ THE BUG THIS REPLACES (found live 2026-07-27): this filtered to `up || down` and then took
  // `.slice(0, 12)`. Genuine up/downgrades are RARE — the overwhelming majority of analyst activity is
  // maintains, reiterations and initiations — so the slice had to reach back DAYS to find 12 of them.
  // Measured on sp500 that day: 07-27 had 17 actions and ZERO up/down, and the cumulative up/down count
  // only reached 11 by 07-21. The desk therefore published SIX-DAY-OLD downgrades under a "Daily Desk"
  // heading, while discarding all 17 of the day's real analyst notes.
  //
  // A count-bounded slice over a filtered list is never "the N most recent" — it is "however far back
  // I had to go". Same trap as the move-attribution incident. Bound the WINDOW; let the count float.
  const ANALYST_WINDOW_DAYS = 4; // 4, not 1: Monday's desk must still see Friday's tape across a weekend
  // daysUntil, not an ms subtraction: `a.date` is a bare YYYY-MM-DD calendar square, and elapsed-ms
  // rounding makes the window flip with the clock. Past dates come back negative.
  const ageDays = (iso: string) => { const d = daysUntil(iso, now); return d == null ? 9999 : -d; };
  const picked = selectDeskActions(analyst ?? [], ageDays, { windowDays: ANALYST_WINDOW_DAYS, max: 12 });
  // ── Analyst-line CONTEXT: a rating note means little without the stock's recent tape. A CLUSTER of
  // same-day reaffirmations on a name that just fell hard on earnings is sell-side DEFENSE — but the
  // model can only read that if the line carries the drop. Attach each name's 1d/1w return, and for the
  // few names that actually moved hard, a BOUNDED "reported earnings Nd ago" check (the WMT miss: six
  // Buy reaffirmations read as a 'roadshow' because the −9% earnings drop was invisible to the model).
  const stockBySym = new Map(stocks.map((s) => [s.symbol, s] as const));
  const bigMove = (sym: string) => {
    const st = stockBySym.get(sym); const r1w = st?.returns?.["1w"]; const r1d = st?.returns?.["1d"];
    return (r1w != null && Math.abs(r1w) >= 5) || (r1d != null && Math.abs(r1d) >= 5);
  };
  const reportChkSyms = [...new Set(picked.map((a) => a.symbol))].filter(bigMove); // usually 0–2 names
  const repBySym = new Map<string, Awaited<ReturnType<typeof detectRecentReport>>>();
  await mapPool(reportChkSyms, 3, async (sym) => { repBySym.set(sym, await detectRecentReport(sym, now).catch(() => null)); });
  const actions = picked.map((a) => {
      const px = priceOf.get(a.symbol);
      const up = a.targetTo && px ? ` · PT ${a.targetTo} (${pct((a.targetTo / px - 1) * 100, 0)} vs px)` : a.targetTo ? ` · PT ${a.targetTo}` : "";
      const st = stockBySym.get(a.symbol);
      const rep = repBySym.get(a.symbol);
      const r1d = st?.returns?.["1d"], r1w = st?.returns?.["1w"];
      let sctx = "";
      if (bigMove(a.symbol) || rep) {
        const seg = [
          r1d != null ? `${pct(r1d)} 1d` : "",
          r1w != null ? `${pct(r1w)} 1w` : "",
          rep ? `reported earnings ${rep.daysAgo === 0 ? "today" : `${rep.daysAgo}d ago`}` : "",
        ].filter(Boolean).join(", ");
        sctx = seg ? ` · stock ${seg}` : "";
      }
      // The date is IN the string on purpose: without it the model has no way to know an item is two
      // sessions old and will happily narrate it as today's news — which is how this shipped wrong.
      return `${a.date} ${a.symbol} ${actionVerb(a)} (${a.firm})${up}${sctx}`;
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

  // ── STAPLES SCANNER — the NielsenIQ US demand read for staples names reporting today/tomorrow (a
  // ~2-week-lagged leading indicator of the print). Attach each reporter's latest scanner trend so the
  // brief can lead its watch note with whether scanner sales are accelerating/decelerating + share moves.
  const scannerData = await readJson<StaplesScannerData>("staples-scanner.json");
  const scannerLines = calEarnings
    .map((e) => {
      const r = latestScannerFor(scannerData, e.symbol);
      if (!r) return null;
      const g = r.row.dollar.l4w ?? r.row.dollar.l2w;
      const inf = r.row.inflection === "accelerating" ? "ACCELERATING" : r.row.inflection === "decelerating" ? "DECELERATING" : "stable";
      const seg = [
        `US $ ${g == null ? "?" : `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`} ${inf}${r.row.dollar.l12w != null ? ` (vs ${r.row.dollar.l12w >= 0 ? "+" : ""}${r.row.dollar.l12w.toFixed(1)}% 12wk)` : ""}`,
        r.row.volume != null ? `vol ${r.row.volume >= 0 ? "+" : ""}${r.row.volume.toFixed(1)}%` : "",
        r.row.shareDeltaBps != null ? `share ${r.row.shareDeltaBps >= 0 ? "+" : ""}${r.row.shareDeltaBps}bp` : "",
      ].filter(Boolean).join(", ");
      return `${e.symbol} (${e.name}) reports ${e.when} — Nielsen scanner [${r.row.category}]: ${seg}${r.row.note ? ` — ${r.row.note}` : ""} (thru ${r.periodEnd})`;
    })
    .filter((x): x is string => !!x);

  // Walter Bloomberg's curated market flashes crossing the tape — market-wide CONTEXT for the brief
  // (Fed/macro/trade/geopolitics + company flashes). Free, from his public Telegram; degrade to none.
  const wire = await fetchLiveMarketHeadlines(30).catch(() => []);
  const wireLines = wire.filter((h) => h.curated).slice(0, 15).map((h) => `${h.title}${h.ticker ? ` [$${h.ticker}]` : ""}`);

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

  // Pre-open frames the brief around the overnight + the day ahead; post-close (including the 22:47 UTC
  // full rebuild) frames it as the session recap + tomorrow's setups. (`run` computed up top.)
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
    block("BIGGEST MOVES (1-day, S&P 500; with 1w/YTD trend, sector, size, valuation, 52w-position, next-earnings, catalyst / grounded web-search reason / news, MOVE EVIDENCE: sector residual + peer tape + short-vol + Reddit buzz)", movers) +
    block("MATERIAL NEW SEC FILINGS (with what-changed + the model's takeaway)", filings) +
    block("UNUSUAL OPTIONS FLOW (aggregated per name → call/put skew)", flows) +
    // Each line is prefixed with its OWN date. The model must use it — an item from two sessions ago
    // is not today's news, and saying so ("Friday's downgrade…") is the honest framing.
    block(
      `ANALYST ACTIONS from the last ${ANALYST_WINDOW_DAYS} days — each line starts with the date it happened; say WHEN if it is not today (with implied upside vs current price)${analystDegraded ? ` — ⚠ THE SCAN WAS DEGRADED THIS RUN (${aOk}/${aAtt} fetches succeeded): the list below is INCOMPLETE, not a quiet day — if you mention analyst activity at all, say the scan was partial; never state or imply there were few/no analyst actions today` : ""}`,
      actions,
    ) +
    block(
      "STAPLES SCANNER — NielsenIQ US demand & share for staples names reporting today/tomorrow (a ~2-week-lagged leading read on the print; lead the watch note for these names with whether scanner sales are accelerating or decelerating vs the 12-week and any share gains/losses). A leading DESK READ line, when present, is the AI's whole-scanner takeaway — use it for thematic staples context, but keep each name's watch note grounded in ITS OWN scanner figures",
      scannerLines.length && scannerData?.summary?.headline
        ? [`DESK READ (whole scanner, thru ${scannerData.summary.periodEnd || "?"}): ${scannerData.summary.headline}`, ...scannerLines]
        : scannerLines,
    ) +
    block(
      "WIRE — Walter Bloomberg's curated market flashes crossing the tape right now (Fed/macro/trade/geopolitics + company flashes). Use for MARKET-WIDE context and to make sure a big cross-asset or macro theme is reflected in the brief; treat a flash as a lead ONLY if the day's data corroborates it — never fabricate a single-stock bullet from a wire line alone",
      wireLines,
    );

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
  // Rescue ladder (2026-08-09: a post-failover regen hit glm's empty-shell-on-packed-context trap
  // and the skip-write guard froze a two-day-old note): PRO once → PRO retry → the shootout's tie
  // partner (gemini-3.1-pro — PRO-tier quality, different provider, so a glm-side shell/outage
  // doesn't decide whether the desk gets a brief). Skip-write stays the last resort.
  type DeskOut = { tldr: string; sections: DeskNoteSection[]; watchToday: DeskNoteWatch[] };
  const usable = (o: DeskOut | null): o is DeskOut => !!o && Array.isArray(o.sections) && o.sections.length > 0;
  const attempt = (model: string) =>
    chatJSON<DeskOut>(SYSTEM, user, { maxTokens: 16000, model, reasoningEffort: "medium" }).catch(() => null);
  let out = await attempt(PRO_MODEL);
  if (!usable(out)) {
    console.warn("desk-note: PRO returned no usable brief — retrying, then the alternate pro model.");
    out = await attempt(PRO_MODEL);
  }
  if (!usable(out)) out = await attempt("google/gemini-3.1-pro-preview");
  if (!usable(out)) {
    console.warn("desk-note: no usable brief from any rung — skipping write.");
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
    // Grounded per-ticker citations for the movers explained via web search — rendered as chips under
    // the matching bullets (the stock-page ExplainMove UX). Empty when the grounded ask found nothing.
    moveSources,
    counts,
  };
  await fs.writeFile(path.join(DATA, "desk-note.json"), JSON.stringify(note));
  console.log(`desk-note: wrote ${sections.length} sections (${sections.reduce((n, s) => n + s.bullets.length, 0)} bullets) + ${watchToday.length} watch items from ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
