/**
 * Key Debates refresh — assign already-computed, already-dated evidence to the declared debates in
 * lib/debateRegistry, and accumulate the ledger across runs.
 *
 *   npm run refresh-debates
 *
 * COSTS NOTHING NEW. Every input is a feed the nightly already bakes: the filing index (which carries
 * the 384-d vectors), the overnight-filings digest (which carries the sentiment), campaigns, and the
 * analyst-action history. The only compute here is embedding a handful of anchor paragraphs — one per
 * debate, four of them — and a cosine per candidate. There is no LLM call in this script at all: the
 * judgement lives in the registry commit, the rest is arithmetic. That is the point.
 *
 * ⚠ ONLY DATED SOURCES ENTER THE LEDGER. data/confluence.json and data/warnings.json are a tidy
 * bull/bear pair and are deliberately NOT used here: they are undated snapshots carrying a single
 * board-level asOf, and putting them in a chronological ledger would render state as news — the exact
 * bug that had week-old downgrades on the Daily Desk. They belong in `standing`, on their own clock.
 */
import { promises as fs } from "fs";
import path from "path";
import { decodeVec, cosineSim, type FilingVec } from "../lib/filingIndex";
import { embedMany, EMBED_MODEL } from "../lib/embedLocal";
import { writeFeedGuarded } from "../lib/feedGuard";
import { daysUntil } from "../lib/calendar";
import { getAnalystActionsDetailed } from "../lib/analystActions";
import { DEBATES } from "../lib/debateRegistry";
import { assignEvidence, mergeLedgerAccumulate, summarise, DEFAULT_TAU, type Candidate, type EvidenceEntry, type Standing } from "../lib/debates";
import { readJson } from "../lib/scriptKit";

const DATA = path.join(process.cwd(), "data");
// The universe the analyst pull is keyed to — the same headline US set refresh-desk-note uses.
const BASE = "sp500";
const WINDOW_DAYS = Number(process.env.DEBATE_WINDOW_DAYS || 120); // how far back a candidate may be
const KEEP = Number(process.env.DEBATE_KEEP || 4000);              // ledger rows retained per file


interface OvernightItem {
  ticker: string; accession: string; form: string; filedAt: string; headline: string;
  decisionTakeaway: string; url: string; sentiment: "bullish" | "neutral" | "bearish"; impact: "high" | "medium" | "low";
}
interface Campaign { id?: string; ticker: string; date: string; type: string; campaigner: string; company: string; summary?: string; ask?: string; url: string; }

/** impact → weight. A high-impact disclosure should not count the same as a routine one. */
const IMPACT_W: Record<string, number> = { high: 3, medium: 1.5, low: 0.75 };

async function main() {
  const now = Date.now();
  // Bare YYYY-MM-DD and full ISO instants both appear across these feeds; daysUntil handles the
  // calendar-square case correctly and an ms subtraction does not. Past dates come back negative.
  const ageDays = (iso: string) => { const d = daysUntil((iso || "").slice(0, 10), now); return d == null ? 9999 : -d; };

  const [index, overnight, campaigns] = await Promise.all([
    readJson<{ rows: FilingVec[]; dim: number; model: string }>("filing-index.json"),
    readJson<{ items: OvernightItem[] }>("overnight-filings.json"),
    readJson<{ campaigns: Campaign[] }>("campaigns.json"),
  ]);

  // ── candidates ────────────────────────────────────────────────────────────────────────────────
  // Vectors live in the filing index, sentiment lives in the overnight digest; join on accession.
  // Verified 2026-07-27: the overlap is 100% (392/392), so the join costs no coverage.
  const vecByAcc = new Map<string, Float32Array>();
  for (const r of index?.rows ?? []) {
    if (r?.accession && typeof (r as any).v === "string") {
      try { vecByAcc.set(r.accession, decodeVec((r as any).v, (r as any).s)); } catch { /* skip a corrupt row */ }
    }
  }

  const candidates: Candidate[] = [];
  for (const it of overnight?.items ?? []) {
    // neutral => direction 0 => assignEvidence drops it. 215 of 400 filings are neutral and they are
    // genuinely neutral (M&A, spin-offs, completed mergers) — they are not evidence for either pole.
    const direction = it.sentiment === "bullish" ? 1 : it.sentiment === "bearish" ? -1 : 0;
    candidates.push({
      at: it.filedAt, ticker: it.ticker, direction: direction as -1 | 0 | 1,
      source: `filing ${it.form}`, headline: it.headline, detail: it.decisionTakeaway, url: it.url,
      weight: IMPACT_W[it.impact] ?? 1, key: it.accession, vec: vecByAcc.get(it.accession) ?? null,
    });
  }
  // A published short thesis is unambiguous bear evidence and is properly dated. Activist 13Ds are
  // NOT — an activist stake is bullish for some theses and bearish for others — so they get 0 and are
  // dropped rather than guessed at.
  //
  // These get EMBEDDED rather than passed with vec:null. Relevance is now always required, so a
  // vectorless candidate can never be admitted — leaving campaigns out of the embed pass would
  // silently drop the single best source of bear evidence we have.
  const shorts = (campaigns?.campaigns ?? []).filter((c) => /short/i.test(c.type || "") && c.ticker && c.date);
  const shortVecs = shorts.length ? await embedMany(shorts.map((c) => `${c.company} short thesis: ${(c.summary || c.ask || "").slice(0, 400)}`)) : [];
  shorts.forEach((c, i) => {
    candidates.push({
      at: c.date, ticker: c.ticker, direction: -1,
      source: "short campaign", headline: `${c.campaigner} published a short thesis on ${c.company}`,
      detail: (c.summary || c.ask || "").slice(0, 200), url: c.url, weight: 2, key: `campaign|${c.id || c.url}`, vec: shortVecs[i] ?? null,
    });
  });

  // ANALYST ACTIONS — the intake that actually reaches these rosters.
  //
  // MEASURED 2026-07-27, and it is why this source exists: across the four declared rosters the
  // overnight filing scan produced ~4 candidate rows, because it covers 308 tickers on a given night
  // and a mega-cap files an 8-K only occasionally. The analyst feed touched the same names 37 times.
  //
  // But the DIRECTION cannot come from the rating alone: of 250 rows only 11 are up/down — almost all
  // analyst activity is "maintains". The signal is in the PRICE TARGET. 242 rows carry both a from and
  // a to, and 215 of those moved: 157 raised, 58 cut. A raised target is a bullish revision by the
  // analyst who set it, which is exactly the dated directional evidence a debate ledger wants.
  const { actions: analyst, ok: _aOk, attempted: _aAtt } = await getAnalystActionsDetailed(BASE).catch(() => ({ actions: [] as any[], ok: 0, attempted: 1 }));
  if (_aAtt > 0 && _aOk / _aAtt < 0.8) console.error(`debates: ⚠ analyst scan DEGRADED (${_aOk}/${_aAtt}) — analyst evidence rows are incomplete tonight`);
  const directionOf = (a: { action: string; targetFrom: number | null; targetTo: number | null }) =>
    a.action === "up" ? 1 : a.action === "down" ? -1
    : a.targetFrom && a.targetTo && a.targetTo !== a.targetFrom ? (a.targetTo > a.targetFrom ? 1 : -1) : 0;
  const analystDated = analyst.filter((a: any) => a?.date && a?.symbol && directionOf(a) !== 0);
  const aVecs = analystDated.length
    ? await embedMany(analystDated.map((a: any) =>
        `${a.name || a.symbol}: ${a.firm} ${a.action === "up" ? "upgrade" : a.action === "down" ? "downgrade" : "price target revision"} ` +
        `${a.fromGrade || ""} to ${a.toGrade || ""}, target ${a.targetFrom ?? "?"} to ${a.targetTo ?? "?"}`))
    : [];
  analystDated.forEach((a: any, i: number) => {
    const ratingChange = a.action === "up" || a.action === "down";
    candidates.push({
      at: a.date, ticker: a.symbol, direction: directionOf(a) as -1 | 0 | 1,
      source: ratingChange ? "analyst rating" : "analyst target",
      headline: ratingChange
        ? `${a.firm} ${a.action === "up" ? "upgraded" : "downgraded"} to ${a.toGrade || "?"}`
        : `${a.firm} ${(a.targetTo as number) > (a.targetFrom as number) ? "raised" : "cut"} its price target to ${a.targetTo}`,
      detail: a.targetFrom && a.targetTo ? `target ${a.targetFrom} → ${a.targetTo}` : "",
      // Yahoo gives no per-action URL; link the company's own filings page rather than inventing one.
      url: `https://finance.yahoo.com/quote/${a.symbol}/analysis`,
      // A rating CHANGE outranks a target tweak — it is a rarer, higher-conviction act.
      weight: ratingChange ? 2 : 1,
      key: `analyst|${a.symbol}|${a.date}|${a.firm}|${a.action}|${a.targetTo ?? ""}`,
      vec: aVecs[i] ?? null,
    });
  });

  // ── anchors ───────────────────────────────────────────────────────────────────────────────────
  const anchors = await embedMany(DEBATES.map((d) => d.anchorText));
  if (anchors.length !== DEBATES.length) throw new Error(`embedMany returned ${anchors.length} vectors for ${DEBATES.length} debates`);

  // ── standing (UNDATED snapshot, kept off the ledger's clock) ───────────────────────────────────
  const [confluence, warnings] = await Promise.all([
    readJson<{ asOf: string; names: { symbol: string }[] }>("confluence.json"),
    readJson<{ asOf: string; names: { symbol: string }[] }>("warnings.json"),
  ]);
  const bullSet = new Set((confluence?.names ?? []).map((n) => n.symbol));
  const bearSet = new Set((warnings?.names ?? []).map((n) => n.symbol));

  const prior = await readJson<{ debates: { debate: { id: string }; entries: EvidenceEntry[] }[] }>("debates.json");
  const priorByDebate = new Map((prior?.debates ?? []).map((d) => [d.debate.id, d.entries ?? []]));

  const out = DEBATES.map((debate, i) => {
    const fresh = assignEvidence(debate, anchors[i], candidates, { windowDays: WINDOW_DAYS, ageDays }, cosineSim);
    // Prior rows are re-validated against the CURRENT registry, not just the current score bar: edit a
    // roster and the ledger must forget evidence for a name that is no longer part of the thesis.
    const onRoster = new Set(debate.roster.map((m) => m.ticker.toUpperCase()));
    const priorValid = (priorByDebate.get(debate.id) ?? []).filter((e) => onRoster.has(e.ticker));
    const entries = mergeLedgerAccumulate(priorValid, fresh, KEEP, DEFAULT_TAU);

    // Standing reads the roster through the SAME role sign as the ledger: a roster name flagged by the
    // warnings board is bear evidence at a +1 name and BULL evidence at a -1 name.
    const standing: Standing | null = confluence?.asOf
      ? {
          debateId: debate.id, asOf: confluence.asOf,
          bullNames: debate.roster.filter((m) => (m.role === 1 ? bullSet : bearSet).has(m.ticker)).map((m) => m.ticker),
          bearNames: debate.roster.filter((m) => (m.role === 1 ? bearSet : bullSet).has(m.ticker)).map((m) => m.ticker),
        }
      : null;

    const s = summarise(debate, entries, standing);
    console.log(`  ${debate.id}: +${fresh.length} fresh → ${entries.length} total (bull ${s.counts.bull} / bear ${s.counts.bear}; roster ${s.counts.roster} / phrase ${s.counts.phrase})`);
    return s;
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    model: EMBED_MODEL,
    windowDays: WINDOW_DAYS,
    candidates: candidates.length,
    debates: out,
  };
  const w = await writeFeedGuarded("debates.json", payload);
  console.log(`debates: ${w.written ? "wrote" : "SKIPPED"} ${out.length} debates from ${candidates.length} candidates${w.written ? "" : ` — ${w.reason}`}`);
}

main().catch((e) => { console.error("refresh-debates:", String(e?.message || e)); process.exitCode = 1; });
