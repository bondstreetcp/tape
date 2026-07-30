/**
 * Real-time news tape — the pure core: ticker tagging, noise classification, archive merge.
 *
 * WHY THIS FILE IS MOSTLY ABOUT REFUSING TO TAG
 * --------------------------------------------------------------------------------------------------
 * A market news tape is only useful if you can filter it to your names, so every row wants a ticker.
 * But NO free wire carries one — measured 2026-07-29: PR Newswire and GlobeNewswire both ship
 * headline + timestamp + category and nothing else machine-readable about the issuer. (GlobeNewswire's
 * `dc:identifier` is a press-release serial, not a symbol.) So the ticker has to be inferred, and
 * inference is exactly where a research tool destroys its own credibility.
 *
 * The first matcher I tried was a substring search over company names. On 20 live headlines it tagged
 * three, and TWO WERE WRONG: "Lockheed Martin" came out as FRHC, and "…Best Tasting Room in the Nation
 * in USA Today" came out as TDAY — it matched the word "today". A tape that confidently mis-attributes
 * news to a ticker is worse than one with no tickers at all, because the error is invisible downstream.
 * This is the same failure axis as the move-attribution bug: the individual pieces were all real, the
 * ASSOCIATION was invented.
 *
 * Two properties make the tagging honest, and both are load-bearing:
 *
 *   1. ANCHORED AT THE HEADLINE START. Press releases lead with the issuer's name — that is a
 *      convention of the medium, not a heuristic. Matching only a prefix of the headline turned
 *      16/16 live tags correct and demoted both fabrications above to untagged.
 *   2. AMBIGUITY IS A REFUSAL, NOT A COIN FLIP. If two different registrants claim a name prefix, we
 *      emit null. Share classes are exempted by CIK, because GOOGL/GOOG are not a real ambiguity.
 *
 * An untagged row is a perfectly good row: it still streams, it is still searchable, it just does not
 * claim to be about a company. A mistagged row is a bug we would never see. So the bias is absolute:
 * WHEN IN DOUBT, EMIT NULL. Every tag also records HOW it was made (`tagHow`) so the UI can show its
 * own reasoning, the way /debates renders the gate that admitted each row.
 */

/** How a row's ticker was established. Rendered in the UI — a tag you can't audit is a tag you can't trust. */
export type TagMethod =
  | "edgar-cik"     // the filing's own CIK resolved to a ticker — ground truth, no inference at all
  | "wire-symbol"   // the wire itself printed "(NASDAQ: FIVN)" — an assertion by the publisher, not a guess
  | "name-exact"    // the headline opens with a registrant's full legal name
  | "name-prefix";  // the headline opens with an unambiguous prefix of one registrant's name

export type TapeKind =
  | "filing"  // an SEC filing hit the wire (EDGAR) — perfect attribution, it carries a CIK
  | "press"   // a company press release off a newswire
  | "macro"   // central bank / regulator / exchange notice
  | "promo";  // law-firm solicitations, product puffery — excluded from the default view, never deleted

export interface TapeItem {
  /** Stable identity across runs. NOT the URL where the URL isn't unique — see refresh-debates' dedup bug. */
  id: string;
  /** ISO instant the wire published it. */
  at: string;
  /** Display name of the source ("PR Newswire", "SEC EDGAR"). */
  source: string;
  kind: TapeKind;
  headline: string;
  url: string;
  /** Tagged ticker, or null. Null is a legitimate, common, and CORRECT outcome. */
  symbol: string | null;
  tagHow: TagMethod | null;
  /** Publisher's own taxonomy label where it ships one (GlobeNewswire's dc:subject), else derived. */
  category: string | null;
}

/** One registrant: the authoritative (ticker, legal name, CIK) triple from SEC's company_tickers.json. */
export interface Registrant { ticker: string; title: string; cik: string }

export interface NameIndex {
  /** full normalised legal name → ticker */
  exact: Map<string, string>;
  /** unambiguous 1–4 token name prefix → ticker */
  prefix: Map<string, string>;
  /** every known ticker, so a wire-printed symbol can be validated rather than trusted */
  tickers: Set<string>;
  /** longest prefix (in tokens) present in the index, so the matcher knows how far to look */
  maxPrefixTokens: number;
  /**
   * Longest FULL legal name in tokens. Tracked separately from maxPrefixTokens because they bound
   * different maps: capping the scan at the prefix width meant a 5-token registrant like
   * "United States Lime & Minerals" could never be reached in `exact` at all, and always resolved by
   * the weaker prefix rule. The scan has to run out to whichever map reaches further.
   */
  maxExactTokens: number;
}

/**
 * Corporate-form suffixes stripped before matching. "Fortis Inc." in a headline and "FORTIS INC" in
 * EDGAR must normalise to the same key, and a headline that says "Algoma Steel Group Inc. Reports…"
 * must still match when EDGAR spells it "Algoma Steel Group Ltd".
 */
const SUFFIXES =
  /\b(?:inc|incorporated|corp|corporation|company|co|cos|ltd|limited|llc|llp|lp|plc|nv|bv|sa|se|ag|spa|ab|as|oyj|holdings?|group|the|and|of)\b/g;

/** Normalise a company name or headline fragment to a comparable token string. */
export function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|['']/g, "")
    .replace(/&quot;|["""]/g, " ")
    // Periods are DELETED, not spaced, so dotted corporate forms survive to the suffix pass:
    // "Vale S.A." → "vale sa" → "vale". Spacing them first yields "vale s a", where \bsa\b can
    // never match and the registrant is only ever reachable by the weaker prefix rule.
    .replace(/\./g, "")
    .replace(/[^a-z0-9&\s]+/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Single tokens that are ordinary English AND happen to be registrant names. A headline opening with
 * one of these is far more likely to be a sentence than a company, so a ONE-TOKEN match on them is
 * refused. Multi-token matches are unaffected — "general dynamics" and "american express" are safe,
 * only a bare "general" or "american" is not. Keeping this list tight matters: over-blocking would
 * lose real single-word issuers like ON Semiconductor, so the test is "would this word plausibly open
 * a headline that isn't about that company?"
 */
const AMBIGUOUS_SINGLE_TOKENS = new Set([
  "a", "all", "american", "at", "best", "big", "capital", "central", "core", "energy", "first", "for",
  "general", "global", "great", "growth", "health", "in", "is", "key", "match", "national", "new",
  "next", "no", "now", "on", "one", "open", "power", "pure", "real", "sun", "target", "the", "to",
  "today", "top", "true", "united", "up", "us", "value", "world",
]);

/** Normalise a symbol the way EDGAR does — share classes arrive as both "BRK.B" and "BRK-B". */
export function normTicker(t: string): string {
  // Trim FIRST: folding whitespace to "-" before trimming turns " aapl " into "-AAPL-".
  return (t || "").trim().toUpperCase().replace(/[.\s]+/g, "-");
}

/**
 * Build the name → ticker index from SEC's authoritative registrant list.
 *
 * The prefix map is the recall half of the matcher: EDGAR calls it "Capricor Therapeutics, Inc." while
 * the wire writes "Capricor Investigation Notice…", and "Silicon Motion Technology Corp" appears as
 * "Silicon Motion Announces…". Indexing leading token-runs recovers those.
 *
 * The safety rule is in the collision handling. When two registrants claim the same prefix we normally
 * DELETE it — an unmatchable prefix costs us one untagged row, whereas a wrong winner costs us trust.
 * The one exemption is share classes: multiple tickers under a single CIK are the same issuer, so
 * "alphabet" resolves to the shortest ticker rather than being thrown away.
 */
export function buildNameIndex(registrants: Registrant[], maxPrefixTokens = 4): NameIndex {
  const exact = new Map<string, string>();
  const tickers = new Set<string>();
  // prefix → the CIKs and tickers competing for it, so collisions can be judged rather than guessed
  const claims = new Map<string, { ciks: Set<string>; tickers: string[] }>();
  // Bounded so one absurd registrant name can't make every headline scan pathologically wide.
  const MAX_EXACT_SCAN = 10;
  let maxExactTokens = 1;

  for (const r of registrants) {
    if (!r?.ticker || !r?.title) continue;
    const sym = normTicker(r.ticker);
    const name = normName(r.title);
    tickers.add(sym);
    if (!name) continue;

    // Exact full-name hits are the strongest name evidence; first writer wins (SEC lists the primary
    // class first), and share classes collapse onto it naturally.
    if (!exact.has(name)) exact.set(name, sym);

    const toks = name.split(" ");
    if (toks.length <= MAX_EXACT_SCAN) maxExactTokens = Math.max(maxExactTokens, toks.length);
    for (let n = 1; n <= Math.min(maxPrefixTokens, toks.length); n++) {
      const key = toks.slice(0, n).join(" ");
      // A one-token prefix that is ordinary English never enters the index at all.
      if (n === 1 && AMBIGUOUS_SINGLE_TOKENS.has(key)) continue;
      if (key.length < 4 && n === 1) continue; // "bp", "ge" — too short to anchor a headline safely
      const c = claims.get(key) ?? { ciks: new Set<string>(), tickers: [] };
      c.ciks.add(r.cik || sym);
      c.tickers.push(sym);
      claims.set(key, c);
    }
  }

  const prefix = new Map<string, string>();
  for (const [key, c] of claims) {
    // >1 distinct CIK ⇒ genuinely ambiguous ⇒ refuse. 1 CIK with many tickers ⇒ share classes ⇒ keep.
    if (c.ciks.size !== 1) continue;
    prefix.set(key, c.tickers.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0]);
  }

  return { exact, prefix, tickers, maxPrefixTokens, maxExactTokens };
}

/**
 * THE SINGLE-TOKEN PREDICATE GATE.
 *
 * Audited against the real 10,412-name registrant list: 4,906 one-token prefixes survive the ambiguity
 * filter, and a lot of them are ordinary English — `grab` (GRAB), `news` (NWS), `take` (TTWO), `ball`,
 * `host`, `fair` (FICO), `hunt` (JBHT), `toll`, `ally`, `vale`, `zoom`, `walt` (DIS), `ross` (ROST),
 * `jazz`, `stem`, `root`. A headline opening "Grab a chance to…" or "Take Action on…" would be tagged
 * with a real, plausible, completely wrong ticker.
 *
 * Blocklisting them is the wrong instrument — it would also silence Visa, Nike, Ford and Zoom, who
 * genuinely do open their own press releases with one word. What separates the two cases is the NEXT
 * token: a corporate release says "Zoom announces…", a sentence says "Grab a chance". So a one-token
 * name must be followed by an announcement predicate (or a reporting-period marker, for the
 * "Ford Q2 2026 Results" shape). Multi-token matches skip this gate — "Grab Holdings" is unambiguous
 * on its own.
 *
 * Recall cost is a few untagged rows. Precision benefit is that the tape cannot invent an issuer.
 */
const ANNOUNCE_AFTER =
  /^(?:announce[sd]?|report(?:s|ed)?|declare[sd]?|complete[sd]?|name[sd]?|appoint(?:s|ed)?|elect(?:s|ed)?|price[sd]?|clos(?:es|ed)|launch(?:es|ed)?|award(?:s|ed)?|win[s]?|won|open(?:s|ed)?|acquire[sd]?|agree[sd]?|expand(?:s|ed)?|begin[s]?|began|commence[sd]?|post(?:s|ed)?|deliver(?:s|ed)?|rais(?:es|ed)|cut[s]?|add[s|ed]?|sign[s|ed]?|secure[sd]?|unveil(?:s|ed)?|introduce[sd]?|releas(?:es|ed)|schedul(?:es|ed)|confirm(?:s|ed)?|approve[sd]?|extend(?:s|ed)?|terminat(?:es|ed)|amend(?:s|ed)?|publish(?:es|ed)?|present(?:s|ed)?|join[s]?|select(?:s|ed)?|provid(?:es|ed)|file[sd]?|enter[s|ed]?|receive[sd]?|update[sd]?|issue[sd]?|set[s]?|sets|to|will|is|has|maintains?|initiates?|prices|q[1-4]|first|second|third|fourth|fiscal|full|annual|interim|quarterly|reports|results|earnings|announces)$/i;

/**
 * The "Issuer: headline" masthead convention — one leading word, then a colon or dash. A sentence
 * almost never opens that way, so it corroborates a one-token name as well as a predicate does.
 */
const MASTHEAD_COLON = /^\s*[A-Za-zÀ-ÿ0-9&'’-]+\s*[:—–]/;

/** `(NASDAQ: FIVN)`, `(NYSE American: XYZ)`, `(TSX-V: ABC)` — the exchange-qualified symbol wires print. */
const WIRE_SYMBOL =
  /\((?:\s*(?:nasdaq|nyse|nyse\s*american|nyse\s*arca|amex|otcqb|otcqx|otc|cse|tsx|tsx-?v|lse|asx)(?:\s*capital\s*market)?\s*:\s*)([a-z0-9.\-]{1,6})\s*\)/i;

export interface TagResult { symbol: string; how: TagMethod }

/**
 * Tag a headline with a ticker, or return null.
 *
 * `context` is the item's description/body snippet — searched ONLY for a wire-printed symbol, never for
 * a name. Name matching stays anchored to the start of the headline, because that anchor is the entire
 * reason the matcher is trustworthy; letting names match anywhere in the body reintroduces the
 * substring fabrications this design exists to prevent.
 */
export function tagHeadline(headline: string, idx: NameIndex, context = ""): TagResult | null {
  // 1) The publisher's own assertion beats any inference we could make — but still has to name a
  //    symbol we actually know, or it's a foreign/unlisted ticker we can't resolve.
  const m = WIRE_SYMBOL.exec(`${headline} ${context}`);
  if (m) {
    const sym = normTicker(m[1]);
    if (idx.tickers.has(sym)) return { symbol: sym, how: "wire-symbol" };
  }

  const toks = normName(headline).split(" ").filter(Boolean);
  if (!toks.length) return null;

  // 2+3) Longest anchored match wins, so "United States Lime & Minerals" beats any shorter competing
  //      match. At a given length an exact full-name hit outranks a prefix hit. The scan starts from
  //      whichever map reaches further — see NameIndex.maxExactTokens for why that matters.
  const scan = Math.min(Math.max(idx.maxPrefixTokens, idx.maxExactTokens), toks.length);
  for (let n = scan; n >= 1; n--) {
    const key = toks.slice(0, n).join(" ");
    if (n === 1 && AMBIGUOUS_SINGLE_TOKENS.has(key)) continue;
    // A one-word issuer name needs corroboration that it is a masthead and not a sentence opening:
    // either an announcement predicate (see ANNOUNCE_AFTER) or the "Issuer: headline" convention,
    // which is how the European wires format nearly everything ("Michelin : Déclaration…",
    // "Casino Group: H1 2026 Financial data"). The colon rule matters because those headlines
    // continue in French, so no English predicate list will ever reach them.
    if (n === 1 && !ANNOUNCE_AFTER.test(toks[1] ?? "") && !MASTHEAD_COLON.test(headline)) continue;
    const hitExact = idx.exact.get(key);
    if (hitExact) return { symbol: hitExact, how: "name-exact" };
    // Beyond the prefix width there is nothing in the prefix map, so only `exact` can hit.
    if (n <= idx.maxPrefixTokens) {
      const hitPrefix = idx.prefix.get(key);
      if (hitPrefix) return { symbol: hitPrefix, how: "name-prefix" };
    }
  }
  return null;
}

/**
 * Law-firm solicitations and product puffery. Measured on PR Newswire's full feed: ~85% of items are
 * not public-company market news at all ("PPE Masks and Gowns", "an Architectural Wall Accessory",
 * "Labor Law Attorneys … File a Lawsuit"). They are classified rather than dropped — kept out of the
 * default view but still archived and searchable, because "investor alert" spam does at least mark a
 * name that has attracted litigation.
 *
 * ⚠ THE SUBJECT IS NOT THE SIGNATURE. Caught live 2026-07-30: "ALSTOM S.A: Update on the AMF
 * investigation opened in 2021/22" is an issuer disclosing a securities-regulator probe — about as
 * material as news gets — and a bare /investigation/ rule buried it as spam. Same for a bare
 * /lawsuit/: a company disclosing litigation is news. What marks the spam is the SOLICITATION —
 * "Shareholders Who Lost Money", "Notifies Investors", a named firm touting a deadline — so the
 * patterns match that and let real legal disclosures through.
 */
const PROMO_PATTERNS: RegExp[] = [
  /\b(?:class action|securities fraud|shareholder alert|investor alert|deadline alert)\b/i,
  /\bshareholders? who (?:lost money|purchased)\b/i,
  /\binvestigation notice\b/i,
  /\bnotifies (?:investors|shareholders)\b/i,
  /\b(?:law offices?|law firm|llp|attorneys?) (?:of|at|announces|files?|investigat)/i,
  /\breminds? investors\b/i,
  /\b(?:encourages?|urges?) investors\b/i,
  /\bcontact (?:the firm|us) before\b/i,
  /\baward[- ]winning\b/i,
  /\b(?:unveils|introduces|launches) (?:the |its |new )?(?:all-new|new line)\b/i,
];

/**
 * A law-firm marker plus a litigation verb, in either order and any distance apart. Two loose
 * conditions beat one tight regex here: the real headline is "Labor Law Attorneys, at Blumenthal
 * Nordrehaug Bhowmik De Blouw LLP, File a Lawsuit" — the commas defeat any adjacency pattern, and the
 * firm name between them is arbitrarily long. Requiring BOTH halves is what keeps an issuer's own
 * "Announces Settlement of Patent Lawsuit" out of the promo bucket.
 */
const LAW_FIRM = /\b(?:law offices?|law firm|llp|attorneys?|counsel)\b/i;
const LITIGATION_VERB = /\b(?:file[sd]?|filing|lawsuit|class action|investigat\w*|notif\w+|alert|deadline|represent\w*)\b/i;

export function isPromo(headline: string): boolean {
  const h = headline || "";
  if (PROMO_PATTERNS.some((re) => re.test(h))) return true;
  return LAW_FIRM.test(h) && LITIGATION_VERB.test(h);
}

/**
 * Derive a category when the wire doesn't ship one. GlobeNewswire supplies dc:subject
 * ("Earnings Releases and Operating Results", "Dividend Reports and Estimates"); PR Newswire and
 * EDGAR do not, so these keyword rules stand in. Order matters — first match wins, most
 * market-relevant first.
 */
const CATEGORY_RULES: [RegExp, string][] = [
  // Earnings must be evidenced by a RESULTS word, not merely by a quarter being named. "Announces
  // Third Quarter Dividends" names a quarter but is a dividend declaration, and an unqualified
  // quarter-match stole it from the Dividend rule below.
  [/\bearnings\b|\b(?:quarterly|interim|annual|full[- ]year|fiscal)\s+(?:financial\s+)?results\b|\b(?:q[1-4]|first|second|third|fourth)[- ]quarter\b[^.]{0,40}\bresults\b|\breports?\b[^.]{0,40}\bresults\b/i, "Earnings"],
  [/\bguidance|outlook|raises? (?:its )?(?:full[- ]year|fy)|lowers? (?:its )?(?:full[- ]year|fy)\b/i, "Guidance"],
  [/\bdividend|distribution\b/i, "Dividend"],
  [/\b(?:acquisitions?|acquires?|to acquire|merger|takeover|definitive agreement|tender offer)\b/i, "M&A"],
  [/\b(?:initial public offering|ipo|prices? (?:its )?(?:public )?offering|secondary offering|private placement|at-the-market)\b/i, "Offering"],
  [/\b(?:buyback|repurchase program|share consolidation|reverse split|stock split)\b/i, "Capital return"],
  [/\b(?:fda|phase [123]|clinical|pdufa|topline|trial results)\b/i, "Clinical"],
  [/\b(?:awarded|contract|order for|selected by|wins? \$)\b/i, "Contract"],
  [/\b(?:appoints?|names?|resigns?|steps down|chief executive|cfo|ceo transition)\b/i, "Management"],
  [/\bjoin (?:the )?s&p|index (?:addition|inclusion)|to join\b/i, "Index change"],
];

/**
 * PR Newswire ships its taxonomy as opaque three-letter codes where GlobeNewswire ships prose, so
 * "ATY" would reach the UI as a category nobody can read. Only codes CORROBORATED against live
 * headlines on 2026-07-29 are mapped — DIV on "Declares Quarterly Dividend", CON on "awarded
 * construction contracts", OFR on "Pricing of Initial Public Offering", and so on. Unrecognised codes
 * fall through to the keyword rules rather than being guessed at: inventing a label for RCN or CXP
 * because it looks about right is the same error as inventing a ticker.
 */
const WIRE_CODES: Record<string, string> = {
  ERN: "Earnings", DIV: "Dividend", CON: "Contract", OFR: "Offering",
  AWD: "Award", PDT: "Product", PER: "Management", ATY: "Legal",
};

/** A short all-caps token is a machine code, not a human label. */
const isOpaqueCode = (s: string) => /^[A-Z0-9]{2,4}$/.test(s.trim());

export function categoryOf(headline: string, wireCategory?: string | null): string | null {
  const wire = (wireCategory || "").trim();
  if (wire) {
    if (WIRE_CODES[wire.toUpperCase()]) return WIRE_CODES[wire.toUpperCase()];
    if (!isOpaqueCode(wire)) return wire; // GlobeNewswire-style prose — the publisher's own label wins
  }
  for (const [re, label] of CATEGORY_RULES) if (re.test(headline || "")) return label;
  return null;
}

/**
 * Merge a fresh poll into the archive: newest first, deduped by `id`, capped at `keep`.
 *
 * This is what buys us the thing Godel charges for and no free feed offers — history. The wires expose
 * only their newest ~20 items, so an archive can ONLY be built forward, one poll at a time; a row
 * missed today is unrecoverable. Hence: fresh rows never overwrite an existing id (the first sighting
 * has the earliest, most accurate timestamp we'll ever have), and the cap trims the OLDEST, so a burst
 * of new items can't evict itself.
 */
export function mergeTapeAccumulate(prior: TapeItem[], fresh: TapeItem[], keep = 20_000): TapeItem[] {
  const byId = new Map<string, TapeItem>();
  for (const it of prior) if (it?.id) byId.set(it.id, it);
  for (const it of fresh) {
    if (!it?.id) continue;
    const had = byId.get(it.id);
    // Re-tagging improves over time (the index grows, rules get fixed), so let a fresh row upgrade a
    // null symbol on a known id — but never move its timestamp.
    //
    // ⚠ THE HEADLINES MUST MATCH. Shipped-and-caught 2026-07-30: EDGAR emits one entry per party of a
    // filing, all sharing one accession, so an id collision let the FILER's headline keep the
    // SUBJECT's ticker — a row reading "SoftVest Advisors" tagged PBT. Both halves were right on their
    // own; the pairing was invented. The upstream parse now collapses those entries properly, and this
    // guard makes the failure unreachable even if some future source reuses an id the same way.
    if (had) {
      if (!had.symbol && it.symbol && had.headline === it.headline) {
        byId.set(it.id, { ...had, symbol: it.symbol, tagHow: it.tagHow });
      }
      continue;
    }
    byId.set(it.id, it);
  }
  return [...byId.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1))
    .slice(0, keep);
}

/** Rolling counts for the page header and the freshness monitor. */
export function summariseTape(items: TapeItem[], nowMs: number) {
  const inLastHour = items.filter((i) => nowMs - Date.parse(i.at) <= 3_600_000).length;
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let tagged = 0;
  // `newest` is computed by scan rather than read from items[0]: callers normally pass merged (sorted)
  // output, but silently depending on the caller's ordering is how a summary starts lying.
  let newest: string | null = null;
  for (const i of items) {
    bySource[i.source] = (bySource[i.source] ?? 0) + 1;
    if (i.category) byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    if (i.symbol) tagged++;
    if (i.at && (!newest || i.at > newest)) newest = i.at;
  }
  return {
    total: items.length,
    tagged,
    taggedPct: items.length ? Math.round((tagged / items.length) * 100) : 0,
    inLastHour,
    newest,
    bySource,
    byCategory,
  };
}
