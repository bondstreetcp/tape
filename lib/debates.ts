/**
 * Key Debates — a named investment argument rendered as a DATED ledger of evidence, each entry scored
 * for or against the thesis, plus a scorecard grading the thesis against what the roster actually did.
 *
 * ── WHY A DEBATE IS DECLARED, NOT DISCOVERED ────────────────────────────────────────────────────
 * The tempting version clusters the filing index and calls each cluster a "debate". That fails on our
 * data: data/filing-index.json holds ~722 rows spanning SIX DAYS, and clustering a week of filings
 * yields sector noise, not arguments. More fundamentally, a debate is a CLAIM — it has two poles and a
 * falsifiable resolution — and no clustering step produces one. So DEBATES below is a hand-written,
 * diffable const (the lib/peerCohorts.ts precedent) and every downstream step is deterministic code.
 * That is "code verifies, models propose" applied honestly: the judgement is one commit, reviewable in
 * a diff; everything after it is arithmetic.
 *
 * ── WHY POLARITY IS RELATIVE TO THE THESIS ──────────────────────────────────────────────────────
 * MEASURED on data/overnight-filings.json (2026-07-24, 400 filings): sentiment is
 * {neutral 215, bullish 174, bearish 11} — 2.75% bearish. I checked whether that was a miscalibrated
 * classifier and it is NOT: all 11 bearish are unambiguous (a $5.6B impairment, EPS misses, guidance
 * cuts), and the high-impact "neutrals" are overwhelmingly M&A, spin-offs and completed mergers that a
 * careful analyst would also call neutral. It is a genuine BASE-RATE asymmetry — companies file
 * voluntary 8-Ks mostly to announce good things.
 *
 * So a ledger keyed on ABSOLUTE sentiment would be ~97% bull-or-neutral no matter how good the
 * classifier is, and a one-sided "debate" is just a press-release feed. Polarity therefore = the
 * source's own direction × the roster role SIGN: a bullish filing at a name the thesis is short is
 * BEAR evidence. That is what makes a two-sided ledger out of a one-sided corpus, and it is arithmetic
 * rather than judgement.
 *
 * ── WHY THE LEDGER AND THE STANDING ARE SEPARATE ────────────────────────────────────────────────
 * data/confluence.json and data/warnings.json are a tidy bull/bear pair — and they are UNDATED
 * snapshots carrying only a board-level asOf. Folding them into a chronological ledger would present
 * undated state as dated news, which is precisely the bug that put six-day-old downgrades on the Daily
 * Desk (see lib/deskAnalyst). They inform `standing` — where the evidence sits TODAY — and are kept
 * out of `entries`, which admits only genuinely dated sources.
 */

export type Pole = "bull" | "bear";

/** +1 = this name does WELL if the bull pole is right; -1 = it does well if the BEAR pole is right. */
export type RoleSign = 1 | -1;

export interface DebateMember {
  ticker: string;
  role: RoleSign;
  /** Why this name is on the roster at all — rendered, so the roster is self-explaining. */
  why: string;
}

export interface Debate {
  id: string;
  question: string;
  /** The two poles, stated as claims someone could be wrong about. */
  bullPole: string;
  bearPole: string;
  /** Free text embedded once per refresh; evidence must be topically close to THIS to be admitted. */
  anchorText: string;
  /** Literal phrases that admit an item even when its ticker is not on the roster. Lower-cased match. */
  anchorPhrases: string[];
  roster: DebateMember[];
  opened: string; // YYYY-MM-DD calendar square
}

export interface EvidenceEntry {
  debateId: string;
  /** ISO instant — every admitted source carries a real timestamp. */
  at: string;
  ticker: string;
  pole: Pole;
  /** What kind of thing this was: a filing, a short campaign, an analyst action. */
  source: string;
  headline: string;
  detail: string;
  url: string;
  /** Cosine against the debate anchor — printed, so a reader can see the gate that admitted the row. */
  score: number;
  /** How RELEVANCE was met: the embedding cleared the bar ("roster"), or an anchor phrase did. */
  via: "roster" | "phrase";
  weight: number;
}

/** A raw, dated, polarised item from any upstream feed, before debate assignment. */
export interface Candidate {
  at: string;
  ticker: string;
  /** The SOURCE's own direction, before the roster role is applied. 0 = no directional content. */
  direction: -1 | 0 | 1;
  source: string;
  headline: string;
  detail: string;
  url: string;
  weight: number;
  /** 384-d embedding of the item, when the upstream feed has one. */
  vec?: ArrayLike<number> | null;
}

/**
 * Evidence polarity = source direction × roster role.
 *
 * The whole point: a BULLISH development at a name the thesis is SHORT counts FOR the bear pole. Returns
 * null when the item has no directional content (a neutral filing, a maintained rating) — those are not
 * evidence for either side and must not pad the ledger.
 */
export function polarity(direction: -1 | 0 | 1, role: RoleSign): Pole | null {
  const p = direction * role;
  return p > 0 ? "bull" : p < 0 ? "bear" : null;
}

/** Default admission threshold on cosine-vs-anchor. Deliberately a named constant, not a literal. */
export const DEFAULT_TAU = 0.28;

export interface AssignOpts {
  tau?: number;
  /** Age bound in CALENDAR days — pass an age function so callers use the repo's calendar helper. */
  windowDays?: number;
  ageDays?: (iso: string) => number;
  maxPerDebate?: number;
}

/**
 * Admit candidates to a debate on TWO INDEPENDENT GATES, both required:
 *   1. relevance  — cosine(item, anchor) >= tau, OR the item carries a literal anchor phrase
 *   2. attachment — the item's ticker is on the roster, OR it carries a literal anchor phrase
 *
 * One gate alone is not enough in either direction. Ticker-only would admit every routine filing from a
 * roster name (a buyback at NVDA is not evidence about whether AI capex is durable). Cosine-only would
 * admit anything that merely sounds on-topic, at any company, which is how a thesis ledger fills with
 * lookalikes. The phrase list is the deliberate escape hatch for genuinely on-thesis news at a name
 * nobody put on the roster.
 */
export function assignEvidence(
  debate: Debate,
  anchorVec: ArrayLike<number> | null,
  candidates: Candidate[],
  opts: AssignOpts = {},
  cosine: (a: ArrayLike<number>, b: ArrayLike<number>) => number = () => 0,
): EvidenceEntry[] {
  const { tau = DEFAULT_TAU, windowDays, ageDays, maxPerDebate = 200 } = opts;
  const roleOf = new Map(debate.roster.map((m) => [m.ticker.toUpperCase(), m.role]));
  const phrases = debate.anchorPhrases.map((p) => p.toLowerCase()).filter(Boolean);

  const out: EvidenceEntry[] = [];
  for (const c of candidates) {
    if (windowDays != null && ageDays && ageDays(c.at) > windowDays) continue;
    if (c.direction === 0) continue; // no directional content — not evidence for either pole

    const hay = `${c.headline} ${c.detail}`.toLowerCase();
    const phraseHit = phrases.some((p) => hay.includes(p));
    const role = roleOf.get((c.ticker || "").toUpperCase());

    // Gate 2 — ATTACHMENT: the ticker must be ON THE ROSTER. No exceptions, and the earlier "escape
    // hatch" for on-thesis news at an unrostered name is gone.
    //
    // You cannot sign evidence you cannot polarise. Polarity is direction × role, so a name with no
    // declared role has no defined relationship to either pole, and the previous default of +1 was
    // simply inventing one. The real run made the cost visible: the rate-cuts debate filled with small
    // regional banks — FRST, FIBK, MSBI, SHBI — every one marked "bull" purely because it was not on
    // the roster. They scored 0.45-0.57 against the anchor, so this was never a threshold problem: a
    // bank's filings legitimately ARE about interest rates. Being topically about the subject is not
    // the same as bearing on the argument, and only the roster encodes the difference.
    if (role == null) continue;

    // Gate 1 — RELEVANCE: is this filing about the ARGUMENT, or just routine business at a roster
    // name? Cosine over the bar, or an explicit anchor phrase for the case the embedding misses.
    const score = anchorVec && c.vec ? cosine(c.vec, anchorVec) : 0;
    if (!(score >= tau) && !phraseHit) continue;

    const pole = polarity(c.direction, role);
    if (!pole) continue;

    out.push({
      debateId: debate.id,
      at: c.at,
      ticker: (c.ticker || "").toUpperCase(),
      pole,
      source: c.source,
      headline: c.headline,
      detail: c.detail,
      url: c.url,
      score: Number(score.toFixed(3)),
      via: score >= tau ? "roster" : "phrase", // how RELEVANCE was satisfied; attachment is always the roster
      weight: c.weight,
    });
  }

  // Newest first, and stable on ties so a rerun over unchanged inputs produces an identical file.
  out.sort((a, b) => b.at.localeCompare(a.at) || a.ticker.localeCompare(b.ticker) || a.headline.localeCompare(b.headline));
  return out.slice(0, maxPerDebate);
}

/**
 * Accumulate a ledger across runs — dedup on (debate, source, url, ticker), newest wins.
 *
 * ⚠ `minScore` RE-APPLIES TODAY'S ADMISSION BAR TO YESTERDAY'S ROWS, and it is not optional. A ledger
 * that only ever appends makes every past mistake permanent: the candidate window rolls off, so a row
 * admitted by a bug can never be re-derived and re-rejected, it just sits there forever looking like
 * evidence. That is not hypothetical — the first real run of this feature admitted 19 rows to the
 * rate-cuts debate through a phrase gate that skipped the relevance test, and merging alone preserved
 * all 19 after the gate was fixed. Every entry carries the score that admitted it, so raising the bar
 * retroactively purges what would no longer qualify. Self-healing beats a migration script.
 */
export function mergeLedgerAccumulate(prior: EvidenceEntry[], fresh: EvidenceEntry[], keep: number, minScore = 0): EvidenceEntry[] {
  const key = (e: EvidenceEntry) => `${e.debateId}|${e.source}|${e.url}|${e.ticker}`;
  const by = new Map<string, EvidenceEntry>();
  for (const e of prior) if (e?.debateId && (e.score ?? 0) >= minScore) by.set(key(e), e);
  for (const e of fresh) if (e?.debateId) by.set(key(e), e); // fresh wins on a duplicate
  const all = [...by.values()];
  all.sort((a, b) => b.at.localeCompare(a.at) || a.ticker.localeCompare(b.ticker) || a.headline.localeCompare(b.headline));
  return keep > 0 ? all.slice(0, keep) : all;
}

export interface Bucket {
  /** Bucket start, a bare YYYY-MM-DD calendar square. */
  from: string;
  bull: number;
  bear: number;
  /** bull − bear, weighted. Positive = evidence accumulated for the bull pole in this bucket. */
  net: number;
}

/**
 * Weighted bull/bear balance over time. This is the honest half of the feature: a ledger that only
 * accumulates says nothing, so the board also has to show which way the evidence has been running.
 */
export function ledgerBalance(entries: EvidenceEntry[], bucketDays = 7): Bucket[] {
  if (!entries.length) return [];
  const dayOf = (iso: string) => iso.slice(0, 10);
  const days = entries.map((e) => dayOf(e.at)).sort();
  const start = Date.parse(days[0] + "T00:00:00Z");
  const span = bucketDays * 86_400_000;

  const buckets = new Map<string, Bucket>();
  for (const e of entries) {
    const t = Date.parse(dayOf(e.at) + "T00:00:00Z");
    if (Number.isNaN(t)) continue;
    const from = new Date(start + Math.floor((t - start) / span) * span).toISOString().slice(0, 10);
    const b = buckets.get(from) ?? { from, bull: 0, bear: 0, net: 0 };
    if (e.pole === "bull") b.bull += e.weight; else b.bear += e.weight;
    b.net = Number((b.bull - b.bear).toFixed(2));
    buckets.set(from, b);
  }
  return [...buckets.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/** Where the debate stands right now, from UNDATED snapshot feeds — kept out of the dated ledger. */
export interface Standing {
  debateId: string;
  /** Roster names currently flagged bullish by the confluence board, weighted by role. */
  bullNames: string[];
  bearNames: string[];
  /** The snapshot's own asOf — a different clock from the ledger's, so it is rendered separately. */
  asOf: string;
}

export interface DebateOut {
  debate: Debate;
  entries: EvidenceEntry[];
  balance: Bucket[];
  standing: Standing | null;
  counts: { bull: number; bear: number; roster: number; phrase: number };
}

export function summarise(debate: Debate, entries: EvidenceEntry[], standing: Standing | null, bucketDays = 7): DebateOut {
  return {
    debate,
    entries,
    balance: ledgerBalance(entries, bucketDays),
    standing,
    counts: {
      bull: entries.filter((e) => e.pole === "bull").length,
      bear: entries.filter((e) => e.pole === "bear").length,
      roster: entries.filter((e) => e.via === "roster").length,
      phrase: entries.filter((e) => e.via === "phrase").length,
    },
  };
}
