import { test } from "node:test";
import assert from "node:assert/strict";
import { investingSlugMatches, nameWords, parseInvestingArticle, parseInvestingListing } from "../lib/transcriptSources";

// Investing.com is the only same-day full-transcript source left (2026-09). These pin the pure parsers against
// the page's real markup (data-test attributes, #article paragraphs) and the company-matching rules, so a
// silent markup change fails a test instead of quietly digesting nothing.

test("nameWords / investingSlugMatches: the first two significant name words, in order, as slug tokens", () => {
  assert.deepEqual(nameWords("Five Below, Inc."), ["five", "below"]);
  assert.deepEqual(nameWords("The Campbell's Company"), ["campbells"]);
  assert.deepEqual(nameWords("American Eagle Outfitters Inc"), ["american", "eagle", "outfitters"]);
  assert.equal(investingSlugMatches("earnings-call-transcript-five-below-tops-q2-2026-estimates-and-lifts-outlook-93CH-4886832", "Five Below, Inc."), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-broadcom-tops-q3-2026-estimates-as-ai-sales-surge-93CH-4886849", "Broadcom Inc."), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-campbells-q4-2026-revenue-miss-and-weak-outlook-hit-shares-93CH-4888096", "The Campbell's Company"), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-american-outdoor-brands-jumps-on-strong-q1-2026-93", "American Eagle Outfitters Inc"), false);
  assert.equal(investingSlugMatches("earnings-call-transcript-american-eagle-q2-2026-93", "American Eagle Outfitters Inc"), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-five-star-bancorp-q2-93", "Five Below, Inc."), false);
  // Articles use the SHORT name: a distinctive first word carries on its own; a generic one needs the second.
  assert.equal(investingSlugMatches("earnings-call-transcript-credo-beats-q1-2026-estimates-but-shares-sink-93CH-4884697", "Credo Technology Group Holding Ltd"), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-lululemon-q2-2026-beats-estimates-93", "Lululemon Athletica Inc."), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-hewlett-packard-enterprise-q3-2026-93", "Hewlett Packard Enterprise Company"), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-general-mills-q1-2027-93", "General Dynamics Corporation"), false);
  // The ticker as the article's name ("hpe-…"): an exact token, 3+ letters, not an English word.
  assert.equal(investingSlugMatches("earnings-call-transcript-hpe-tops-q3-2026-estimates-93", "Hewlett Packard Enterprise Company", "HPE"), true);
  assert.equal(investingSlugMatches("earnings-call-transcript-broadcom-tops-q3-2026-estimates-as-ai-sales-surge-93", "Gartner Inc", "IT"), false); // 2 letters → never by ticker
  assert.equal(investingSlugMatches("earnings-call-transcript-acme-beats-q2-2026-and-tops-forecasts-93", "Topsail Corp", "TOPS"), false); // an English word
});

test("parseInvestingArticle: apostrophes don't hide the company (Campbell's counts for campbells)", () => {
  const body = ("Campbell's reported fourth-quarter results. " + "The Campbell's team said volumes softened. ".repeat(80)).trim();
  const html = `<html><body><div id="article"><p>${body}</p><p>Operator: Thank you. ${"Next question. ".repeat(40)}</p></div></body></html>`;
  assert.ok(parseInvestingArticle(html, "CPB", "The Campbell's Company"));
});

const LISTING = `
<html><body>
<article data-test="article-item"><a data-test="article-title-link" href="https://www.investing.com/news/transcripts/earnings-call-transcript-five-below-tops-q2-2026-estimates-and-lifts-outlook-93CH-4886832">Earnings call transcript: Five Below tops Q2 2026 estimates and lifts outlook</a>
  <p data-test="article-description">Five Below…</p><time data-test="article-publish-date" dateTime="2026-09-03 09:12:44" class="x">a day ago</time></article>
<article data-test="article-item"><a data-test="article-title-link" href="https://www.investing.com/news/transcripts/amd-at-ifa-opening-keynote-pushing-personal-ai-to-the-pc-93CH-1">AMD at IFA</a><time data-test="article-publish-date" dateTime="2026-09-04 15:45:08">6 hours ago</time></article>
<article data-test="article-item"><a data-test="article-title-link" href="https://www.investing.com/news/transcripts/earnings-call-transcript-five-below-tops-q2-2026-estimates-and-lifts-outlook-93CH-4886832">dup</a></article>
<div data-test="most-popular-article"><a data-test="article-title-link" href="https://www.investing.com/news/transcripts/earnings-call-transcript-broadcom-tops-q3-2026-estimates-as-ai-sales-surge-93CH-4886849">popular</a></div>
</body></html>`;

test("parseInvestingListing: transcript articles only, deduped, with the publish date", () => {
  const items = parseInvestingListing(LISTING);
  assert.equal(items.length, 1); // the keynote isn't a transcript; the dup and the most-popular box are skipped
  assert.equal(items[0].slug, "earnings-call-transcript-five-below-tops-q2-2026-estimates-and-lifts-outlook-93CH-4886832");
  assert.equal(items[0].date, "2026-09-03");
  assert.equal(items[0].title, "Earnings call transcript: Five Below tops Q2 2026 estimates and lifts outlook");
});

const para = (s: string) => `<p>${s}</p>`;
const ARTICLE = `<html><head><meta property="og:title" content="Earnings call transcript: Five Below tops Q2 2026 estimates and lifts outlook | Investing.com"></head><body>
<div id="article"><div class="article_WYSIWYG__x">
${para("Five Below reported stronger-than-expected second-quarter fiscal 2026 results, with adjusted earnings of $1.68 a share on revenue of $1.26 billion.")}
${para("Operator: Good afternoon and welcome to the Five Below second quarter fiscal 2026 earnings conference call. ".repeat(6))}
${para("Winnie Park, CEO: Comparable sales increased 14.1% in the quarter. FIVE remains on plan. " + "We are raising our outlook. ".repeat(60))}
${para("Analyst: How much of the comp is trading cards? FIVE has cited them before. " + "Thanks. ".repeat(40))}
${para("Winnie Park: Trading cards were a meaningful contributor, but the comp was broad-based across worlds. ".repeat(20))}
${para("Position added successfully to: Watchlist")}
${para("Full transcript - Five Below (FIVE) Q2 2026 earnings call")}
${para("Risk Disclosure: Trading in financial instruments involves high risks including the risk of losing some, or all, of your investment.")}
</div></div></body></html>`;

test("parseInvestingArticle: the #article paragraphs minus boilerplate, cut at the tail, verified as the company", () => {
  const out = parseInvestingArticle(ARTICLE, "FIVE", "Five Below, Inc.");
  assert.ok(out);
  assert.equal(out.title, "Earnings call transcript: Five Below tops Q2 2026 estimates and lifts outlook");
  assert.ok(out.text.startsWith("Five Below reported stronger-than-expected"));
  assert.ok(out.text.includes("Operator: Good afternoon"));
  assert.ok(!out.text.includes("Risk Disclosure"));
  assert.ok(!out.text.includes("Position added"));
  assert.ok(!out.text.includes("Full transcript -"));
  // The same page does NOT verify as another company — a slug match alone must never attach a transcript.
  assert.equal(parseInvestingArticle(ARTICLE, "AVGO", "Broadcom Inc."), null);
});

test("parseInvestingArticle: a stub page (too short) is null", () => {
  assert.equal(parseInvestingArticle(`<html><body><div id="article"><p>Five Below (FIVE) FIVE brief.</p></div></body></html>`, "FIVE", "Five Below"), null);
});
