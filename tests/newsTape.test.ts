import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normName, normTicker, buildNameIndex, tagHeadline, isPromo, categoryOf,
  mergeTapeAccumulate, summariseTape, type Registrant, type TapeItem,
} from "../lib/newsTape";

// Regression suite for the tagging matcher. Cases 1 and 2 are the two FABRICATIONS a naive substring
// matcher produced on live PR Newswire headlines on 2026-07-29 — they are the reason this module
// anchors at the headline start, and they must never come back. The rest pin the refusal behaviour,
// because for a news tape "no ticker" is a correct answer and "the wrong ticker" is an invisible bug.

/** A miniature registrant table shaped like SEC's company_tickers.json. */
const REG: Registrant[] = [
  { ticker: "LMT",  title: "Lockheed Martin Corp",                cik: "0000936468" },
  { ticker: "FRHC", title: "Freedom Holding Corp",                cik: "0000924805" },
  { ticker: "TDAY", title: "Todays Bancorp Inc",                  cik: "0001111111" },
  { ticker: "WVVI", title: "Willamette Valley Vineyards Inc",     cik: "0000838875" },
  { ticker: "GPK",  title: "Graphic Packaging Holding Company",   cik: "0001408075" },
  { ticker: "FIVN", title: "Five9, Inc.",                         cik: "0001288847" },
  { ticker: "SIMO", title: "Silicon Motion Technology Corp",      cik: "0001334325" },
  { ticker: "CAPR", title: "Capricor Therapeutics, Inc.",         cik: "0001133869" },
  { ticker: "USLM", title: "United States Lime & Minerals Inc",   cik: "0000082020" },
  { ticker: "GOOGL", title: "Alphabet Inc.",                      cik: "0001652044" },
  { ticker: "GOOG",  title: "Alphabet Inc.",                      cik: "0001652044" },
  // A deliberate prefix collision across two DIFFERENT issuers — must poison the shared prefix.
  { ticker: "APLD", title: "Applied Digital Corp",                cik: "0001144879" },
  { ticker: "AMAT", title: "Applied Materials Inc",               cik: "0000006951" },
  { ticker: "ON",   title: "ON Semiconductor Corp",               cik: "0001097864" },
];
const IDX = buildNameIndex(REG);

test("normName strips corporate suffixes and punctuation to a comparable key", () => {
  assert.equal(normName("Five9, Inc."), "five9");
  assert.equal(normName("Graphic Packaging Holding Company"), "graphic packaging");
  assert.equal(normName("United States Lime & Minerals Inc"), "united states lime & minerals");
  assert.equal(normName("Fortis Inc."), "fortis");
  // Dotted corporate forms must reach the suffix pass intact, or "Vale S.A." normalises to "vale s a".
  assert.equal(normName("Vale S.A."), "vale");
  assert.equal(normName("Motiva S.A."), "motiva");
});

test("normTicker folds share-class separators", () => {
  assert.equal(normTicker("brk.b"), "BRK-B");
  assert.equal(normTicker(" aapl "), "AAPL");
});

// ── the two live fabrications ─────────────────────────────────────────────────────────────────────
test("FABRICATION 1: a company named mid-headline is NOT tagged (Lockheed → FRHC)", () => {
  // The subject of the sentence is the Department of War, not the issuer. A substring matcher tagged
  // this FRHC. Untagged is the correct outcome — we are not in the business of parsing sentences.
  const got = tagHeadline("Department of War Awards Lockheed Martin $58.62B for Multiyear PAC-3 MSE Production", IDX);
  assert.equal(got, null);
});

test("FABRICATION 2: an incidental word is not a ticker (…USA Today → TDAY)", () => {
  const got = tagHeadline("Willamette Valley Vineyards Wins #1 Best Tasting Room in the Nation in USA Today", IDX);
  // It must tag the ACTUAL issuer that opens the headline, never the trailing publication name.
  // "Willamette Valley Vineyards Inc" normalises to exactly the three leading tokens, so this is an
  // exact full-name hit, not a prefix one.
  assert.deepEqual(got, { symbol: "WVVI", how: "name-exact" });
});

// ── the anchored happy paths ──────────────────────────────────────────────────────────────────────
test("exact full legal name at the head of the headline", () => {
  assert.deepEqual(tagHeadline("Graphic Packaging Holding Company Declares Quarterly Dividend", IDX),
    { symbol: "GPK", how: "name-exact" });
});

test("name PREFIX recovers issuers whose legal name is longer than the wire's usage", () => {
  // EDGAR: "Silicon Motion Technology Corp" / "Capricor Therapeutics, Inc." — the wire drops the tail.
  assert.deepEqual(tagHeadline("Silicon Motion Announces Results for the Quarterly Period", IDX),
    { symbol: "SIMO", how: "name-prefix" });
  assert.deepEqual(tagHeadline("Capricor Reports Second Quarter 2026 Results", IDX),
    { symbol: "CAPR", how: "name-prefix" });
});

test("longest anchored prefix wins over a shorter competing match", () => {
  assert.deepEqual(tagHeadline("United States Lime & Minerals Reports Second Quarter 2026 Results", IDX),
    { symbol: "USLM", how: "name-exact" });
});

test("a wire-printed exchange symbol outranks name inference", () => {
  const got = tagHeadline("Some Unrecognised Brand Name Announces Q2 (NASDAQ: FIVN)", IDX);
  assert.deepEqual(got, { symbol: "FIVN", how: "wire-symbol" });
});

test("a wire-printed symbol we do not know is NOT trusted", () => {
  // Foreign/unlisted tickers appear constantly on these wires; emitting them would invent coverage.
  assert.equal(tagHeadline("Someco PLC Interim Results (LSE: ZZZZ)", IDX), null);
});

test("a wire symbol found in the body context still tags, but a body NAME does not", () => {
  assert.deepEqual(tagHeadline("Quarterly Update", IDX, "… issued by Five9 (NASDAQ: FIVN) today"),
    { symbol: "FIVN", how: "wire-symbol" });
  // Name matching is deliberately confined to the headline anchor.
  assert.equal(tagHeadline("Quarterly Update", IDX, "a report mentioning Graphic Packaging"), null);
});

// ── the refusals ─────────────────────────────────────────────────────────────────────────────────
test("AMBIGUITY IS A REFUSAL: a prefix claimed by two different CIKs tags nothing", () => {
  // "Applied" is claimed by Applied Digital and Applied Materials. Picking either would be a coin flip.
  assert.equal(IDX.prefix.has("applied"), false);
  assert.equal(tagHeadline("Applied Announces A Thing", IDX), null);
  // …but the disambiguating second token still resolves cleanly.
  assert.deepEqual(tagHeadline("Applied Materials Reports Fourth Quarter Results", IDX),
    { symbol: "AMAT", how: "name-exact" });
});

test("share classes are NOT treated as ambiguity — same CIK collapses to one ticker", () => {
  // The property under test is that a same-CIK collision SURVIVES indexing (two different issuers
  // would have deleted the key). Which class wins is a presentation detail; that it resolves at all
  // is the guarantee.
  assert.ok(IDX.prefix.has("alphabet"), "same-CIK collision must not poison the prefix");
  const got = tagHeadline("Alphabet Announces Third Quarter Results", IDX);
  assert.ok(got, "a share-class name must still tag");
  assert.ok(["GOOG", "GOOGL"].includes(got!.symbol), `expected a GOOG-family ticker, got ${got!.symbol}`);
});

test("ordinary English single tokens never anchor a match", () => {
  // "ON Semiconductor" is real, but a headline opening with the word "on" is a sentence.
  assert.equal(IDX.prefix.has("on"), false);
  assert.equal(tagHeadline("On Track To Deliver Record Volumes, Says Trade Body", IDX), null);
  // The full name still tags.
  assert.deepEqual(tagHeadline("ON Semiconductor Corp Reports Q2", IDX), { symbol: "ON", how: "name-exact" });
});

test("SINGLE-TOKEN PREDICATE GATE: a one-word issuer needs an announcement verb after it", () => {
  // GRAB/TTWO/NWS-shaped risk: real one-word registrant names that are also ordinary English. Audited
  // on the live SEC list, 4,906 one-token prefixes survive ambiguity filtering and many are words.
  const reg: Registrant[] = [
    { ticker: "GRAB", title: "Grab Holdings Ltd",    cik: "0001855612" },
    { ticker: "ZM",   title: "Zoom Communications Inc", cik: "0001585521" },
    { ticker: "VALE", title: "Vale S.A.",            cik: "0000917851" },
  ];
  const i2 = buildNameIndex(reg);

  // Sentence openings must NOT tag, even though the word is a real registrant name.
  assert.equal(tagHeadline("Grab a chance to win tickets this summer", i2), null);
  assert.equal(tagHeadline("Zoom in on the details of the new rules", i2), null);

  // Genuine corporate releases from the same one-word issuers still tag.
  assert.deepEqual(tagHeadline("Zoom Announces Second Quarter Results", i2), { symbol: "ZM", how: "name-prefix" });
  assert.deepEqual(tagHeadline("Vale Reports Record Iron Ore Output", i2), { symbol: "VALE", how: "name-exact" });
  // A reporting-period marker counts as corroboration too ("Vale Q2 2026 Results").
  assert.deepEqual(tagHeadline("Vale Q2 2026 Results", i2), { symbol: "VALE", how: "name-exact" });
  // NOTE "Grab Holdings Ltd" normalises to the single token "grab" — `holdings` is a stripped
  // corporate suffix — so it stays under the gate and a sentence opening still cannot tag it.
  assert.equal(tagHeadline("Grab Holdings a Leader in Regional Delivery", i2), null);
  // A name that is genuinely multi-token after normalisation skips the gate.
  assert.deepEqual(tagHeadline("Zoom Communications a Leader in Video", i2), { symbol: "ZM", how: "name-exact" });
});

test("the 'Issuer: headline' masthead convention corroborates a one-token name", () => {
  // European wires format nearly everything this way and then continue in French, so no English
  // predicate list can reach them. Live examples: "Michelin : Déclaration…", "Casino Group: H1 2026".
  const i2 = buildNameIndex([{ ticker: "MGDDY", title: "Michelin", cik: "0000067222" }]);
  assert.deepEqual(tagHeadline("Michelin : Déclaration des transactions sur actions propres", i2),
    { symbol: "MGDDY", how: "name-exact" });
  assert.deepEqual(tagHeadline("Michelin — Disclosure of trading in own shares", i2),
    { symbol: "MGDDY", how: "name-exact" });
  // Without the colon and without a predicate it is still refused.
  assert.equal(tagHeadline("Michelin tyres are sold at many retailers", i2), null);
});

test("promo classifier does NOT bury an issuer's own legal disclosure", () => {
  // Live 2026-07-30 false positive: a bare /investigation/ rule buried Alstom disclosing an AMF probe.
  assert.equal(isPromo("ALSTOM S.A: Update on the AMF investigation opened in 2021/22"), false);
  assert.equal(isPromo("Acme Discloses SEC Investigation Into Revenue Recognition"), false);
  assert.equal(isPromo("Acme Announces Settlement of Patent Lawsuit"), false);
  // …while the actual solicitations still classify.
  assert.ok(isPromo("PicS N.V. (PICS) Shareholders Who Lost Money Have Opportunity to Lead Suit"));
  assert.ok(isPromo("Capricor Investigation Notice: Levi & Korsinsky Notifies Investors"));
  assert.ok(isPromo("ROSEN, A LEADING FIRM, Encourages Investors to Contact the Firm"));
});

test("a bare one-word headline has nothing to corroborate it", () => {
  const i2 = buildNameIndex([{ ticker: "VALE", title: "Vale S.A.", cik: "0000917851" }]);
  assert.equal(tagHeadline("Vale", i2), null);
});

test("opaque wire category CODES are mapped or dropped, never shown raw", () => {
  // PR Newswire ships "DIV"/"ATY"; GlobeNewswire ships prose. A user must never see "ATY".
  assert.equal(categoryOf("Graphic Packaging Declares Quarterly Dividend", "DIV"), "Dividend");
  assert.equal(categoryOf("Levi & Korsinsky Notifies Investors", "ATY"), "Legal");
  // An UNMAPPED code falls through to the keyword rules rather than being guessed at.
  assert.equal(categoryOf("Acme Announces Pricing of Initial Public Offering", "CXP"), "Offering");
  assert.equal(categoryOf("Something entirely unclassifiable happened", "CXP"), null);
  // Prose from the publisher still wins outright.
  assert.equal(categoryOf("whatever", "Earnings Releases and Operating Results"), "Earnings Releases and Operating Results");
});

test("an empty or symbol-free headline yields null, not a throw", () => {
  assert.equal(tagHeadline("", IDX), null);
  assert.equal(tagHeadline("   ***   ", IDX), null);
});

// ── noise + taxonomy ─────────────────────────────────────────────────────────────────────────────
test("law-firm solicitations classify as promo", () => {
  assert.ok(isPromo("Capricor Investigation Notice: Levi & Korsinsky Notifies Investors of Investigation"));
  assert.ok(isPromo("Labor Law Attorneys, at Blumenthal Nordrehaug Bhowmik De Blouw LLP, File a Lawsuit"));
  assert.ok(isPromo("SHAREHOLDER ALERT: Deadline Alert for Investors"));
  assert.equal(isPromo("Fortis Inc. Announces Third Quarter Dividends"), false);
  assert.equal(isPromo("Algoma Steel Group Inc. Reports Financial Results"), false);
});

test("the wire's own category wins; keywords only fill the gap", () => {
  assert.equal(categoryOf("anything at all", "Dividend Reports and Estimates"), "Dividend Reports and Estimates");
  assert.equal(categoryOf("Hawthorn Bancshares Reports Second Quarter 2026 Results", null), "Earnings");
  assert.equal(categoryOf("Fortis Inc. Announces Third Quarter Dividends", null), "Dividend");
  assert.equal(categoryOf("Reformation Announces Pricing of Initial Public Offering", null), "Offering");
  assert.equal(categoryOf("Five9 Set to Join S&P SmallCap 600", null), "Index change");
  assert.equal(categoryOf("Mockett Introduces the HK40 Hook", null), null);
});

// ── the archive ──────────────────────────────────────────────────────────────────────────────────
const I = (id: string, at: string, symbol: string | null = null): TapeItem => ({
  id, at, source: "PR Newswire", kind: "press", headline: `h-${id}`, url: `https://x/${id}`,
  symbol, tagHow: symbol ? "name-exact" : null, category: null,
});

test("merge dedupes by id and returns newest first", () => {
  const out = mergeTapeAccumulate([I("a", "2026-07-29T10:00:00Z")], [I("b", "2026-07-29T11:00:00Z"), I("a", "2026-07-29T10:00:00Z")]);
  assert.deepEqual(out.map((x) => x.id), ["b", "a"]);
});

test("a re-seen id keeps its ORIGINAL timestamp — first sighting is the most accurate one", () => {
  const out = mergeTapeAccumulate([I("a", "2026-07-29T10:00:00Z")], [I("a", "2026-07-29T23:59:00Z")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].at, "2026-07-29T10:00:00Z");
});

test("a re-seen id MAY upgrade a null symbol as the index improves", () => {
  const out = mergeTapeAccumulate([I("a", "2026-07-29T10:00:00Z", null)], [I("a", "2026-07-29T10:00:00Z", "GPK")]);
  assert.equal(out[0].symbol, "GPK");
  assert.equal(out[0].at, "2026-07-29T10:00:00Z");
});

test("an id collision with a DIFFERENT headline must not graft one row's ticker onto another", () => {
  // The live 2026-07-30 defect: EDGAR emits one entry per party of a filing, all sharing the accession.
  // The filer's row ("SoftVest Advisors") was kept and then upgraded with the subject's ticker (PBT).
  const filer   = { ...I("edgar|0001213900-26-083008", "2026-07-30T01:43:30Z", null),
                    headline: "SCHEDULE 13D/A — SoftVest Advisors, LLC" };
  const subject = { ...I("edgar|0001213900-26-083008", "2026-07-30T01:43:30Z", "PBT"),
                    headline: "SCHEDULE 13D/A — PERMIAN BASIN ROYALTY TRUST" };
  const out = mergeTapeAccumulate([filer], [subject]);
  assert.equal(out.length, 1);
  assert.equal(out[0].headline, "SCHEDULE 13D/A — SoftVest Advisors, LLC");
  assert.equal(out[0].symbol, null, "a ticker must never attach to a headline it did not come from");
});

test("the cap trims the OLDEST so a burst cannot evict itself", () => {
  const prior = [I("old1", "2026-07-01T00:00:00Z"), I("old2", "2026-07-02T00:00:00Z")];
  const fresh = [I("new1", "2026-07-29T00:00:00Z"), I("new2", "2026-07-29T01:00:00Z")];
  const out = mergeTapeAccumulate(prior, fresh, 2);
  assert.deepEqual(out.map((x) => x.id), ["new2", "new1"]);
});

test("rows without an id are dropped rather than colliding on undefined", () => {
  const out = mergeTapeAccumulate([], [I("a", "2026-07-29T10:00:00Z"), { ...I("x", "2026-07-29T12:00:00Z"), id: "" }]);
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});

test("summariseTape counts tag coverage and the last hour", () => {
  const now = Date.parse("2026-07-29T12:00:00Z");
  const s = summariseTape([
    I("a", "2026-07-29T11:40:00Z", "GPK"),
    I("b", "2026-07-29T11:50:00Z", null),
    I("c", "2026-07-28T11:50:00Z", "FIVN"),
  ], now);
  assert.equal(s.total, 3);
  assert.equal(s.tagged, 2);
  assert.equal(s.taggedPct, 67);
  assert.equal(s.inLastHour, 2);
  assert.equal(s.newest, "2026-07-29T11:50:00Z");
  assert.equal(s.bySource["PR Newswire"], 3);
});
