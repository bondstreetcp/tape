import test from "node:test";
import assert from "node:assert/strict";
import { pickHeadlines, NEWS_JUNK, CAUSAL_WINDOW_DAYS } from "../lib/news";
import type { NewsItem } from "../lib/news";

const NOW = Date.parse("2026-07-15T20:00:00Z");
const item = (time: string | null, title: string, publisher = "News"): NewsItem =>
  ({ title, publisher, link: "https://x", time: time ? time + "T12:00:00Z" : null, tickers: [] });

/**
 * THE REGRESSION FIXTURE — the real getNews("PayPal Holdings, Inc.") response on 2026-07-15, in the
 * real order it came back. PYPL was +15.6% on a $53bn Stripe/Advent takeover offer; the desk note
 * told GLM "recent news: Venmo global expansion | Canva payment links | securities fraud lawsuit"
 * (real headlines — from MARCH and APRIL) and it duly wrote the takeover up as a Venmo product
 * story. getNews ranks by SOURCE and its press-release query reaches back 120 days, so the wire PR
 * sorts ahead of today's Reuters scoop, which sat at position 10.
 */
const PYPL: NewsItem[] = [
  item("2026-03-23", "200 Million More Friends on Venmo -- Send Money to PayPal Users Around the World", "Business Wire"),
  item("2026-04-09", "PayPal Brings Payment Links to Canva Creators", "Business Wire"),
  item("2026-04-08", "PayPal Holdings, Inc. (PYPL) Shareholders Who Lost Money Have Opportunity to Lead Securities Fraud Lawsuit", "PR Newswire"),
  item("2026-04-12", "PayPal Holdings, Inc. (PYPL) Class Action Lawsuit Seeks Recovery for Investors; April 20, 2026, Deadline", "PR Newswire"),
  item("2026-04-14", "PYPL Shareholder Alert: Investors With Losses May Seek to Lead the Class Action -- The Gross Law Firm", "PR Newswire"),
  item("2026-03-26", "PYPL DEADLINE NOTICE: PayPal Holdings, Inc. Investors Encouraged to Contact Kirby McInerney LLP", "PR Newswire"),
  item("2026-05-05", "PayPal Earnings Beat Estimates. The Stock Is Tumbling Anyway.", "Barron's"),
  item("2026-07-15", "EXCLUSIVE: Stripe, Advent offer to buy PayPal for more than $53 billion, sources say", "Reuters"),
  item("2026-06-16", "Exclusive: PayPal winds down venture arm as fintech giant restructures under new CEO", "Reuters"),
];

test("PYPL 2026-07-15: today's takeover wins over four-month-old press releases", () => {
  const heads = pickHeadlines(PYPL, { nowMs: NOW, windowDays: CAUSAL_WINDOW_DAYS["1d"], limit: 3 });
  assert.equal(heads.length, 1, "only the buyout falls inside a 1-day mover's 5-day window");
  assert.match(heads[0].title, /Stripe, Advent offer to buy PayPal/);
  assert.equal(heads[0].date, "2026-07-15");
});

test("PYPL: the exact fabricated inputs can no longer reach the model", () => {
  const heads = pickHeadlines(PYPL, { nowMs: NOW, windowDays: CAUSAL_WINDOW_DAYS["1d"], limit: 3 });
  const blob = heads.map((h) => h.title).join(" | ");
  assert.doesNotMatch(blob, /Venmo/, "the March Venmo PR explained a July takeover");
  assert.doesNotMatch(blob, /Canva/, "…as did the April Canva PR");
  assert.doesNotMatch(blob, /Lawsuit|Shareholder Alert/, "law-firm spam is not a catalyst");
});

test("the OLD naive selection is what produced the fabrication (documents the bug)", () => {
  const naive = PYPL.slice(0, 3).map((n) => n.title.trim());
  assert.match(naive[0], /Venmo/);
  assert.match(naive[1], /Canva/);
  assert.match(naive[2], /Securities Fraud Lawsuit/);
  assert.ok(!naive.some((t) => /Stripe/.test(t)), "and the buyout never made it in");
});

test("dates survive selection — the model can't weigh recency it can't see", () => {
  // "recent news:" was a LIE in the old prompt: dates were stripped by .map(n => n.title).
  const heads = pickHeadlines(PYPL, { nowMs: NOW, windowDays: 130, limit: 4 });
  for (const h of heads) assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("wider windows still rank newest-first, not by source", () => {
  const heads = pickHeadlines(PYPL, { nowMs: NOW, windowDays: 130, limit: 4 });
  assert.deepEqual(heads.map((h) => h.date), ["2026-07-15", "2026-06-16", "2026-05-05", "2026-04-09"]);
  assert.match(heads[0].title, /Stripe, Advent/, "the takeover leads regardless of window");
});

test("a move with nothing recent yields NOTHING — 'unexplained' is the honest answer", () => {
  const stale = PYPL.filter((n) => n.time && n.time < "2026-05-01");
  assert.deepEqual(pickHeadlines(stale, { nowMs: NOW, windowDays: CAUSAL_WINDOW_DAYS["1d"], limit: 3 }), []);
  // → the caller emits "no catalyst or recent news found" and the note says Unexplained, rather
  //   than reaching for the nearest old headline and inventing a mechanism around it.
});

test("undated items are kept but sink below every dated one, and aren't dressed up as fresh", () => {
  const mixed = [item(null, "Undated something about PayPal"), ...PYPL];
  // limit 6 = the 5 non-junk dated items in a 130d window + the undated one, so it's observable;
  // at a tighter limit the undated correctly gets truncated away entirely, which is the point.
  const heads = pickHeadlines(mixed, { nowMs: NOW, windowDays: 130, limit: 6 });
  assert.equal(heads[heads.length - 1].title, "Undated something about PayPal", "sorts last");
  assert.equal(heads[heads.length - 1].date, "", "renders with no date ⇒ caller marks it [undated]");
  assert.equal(pickHeadlines(mixed, { nowMs: NOW, windowDays: 130, limit: 3 }).some((h) => !h.date), false,
    "and it never displaces a dated headline");
});

test("junk regex catches the real law-firm spam getNews's own filters let through", () => {
  // The REAL fixture strings, not paraphrases — each is caught by an incidental keyword
  // (deadline / shareholder alert / lawsuit) rather than by recognising "law-firm promo" as a
  // category, so it is a keyword net, not a classifier. The date gate is the primary defence;
  // this is the belt to its braces.
  for (const n of PYPL.filter((x) => /Lawsuit|Alert|DEADLINE|Class Action/i.test(x.title))) {
    assert.match(n.title, NEWS_JUNK, `should be junk: ${n.title}`);
  }
  assert.doesNotMatch("EXCLUSIVE: Stripe, Advent offer to buy PayPal for more than $53 billion, sources say", NEWS_JUNK);
  assert.doesNotMatch("PayPal Earnings Beat Estimates. The Stock Is Tumbling Anyway.", NEWS_JUNK);
});

test("pickHeadlines is pure and total", () => {
  const before = JSON.stringify(PYPL);
  pickHeadlines(PYPL, { nowMs: NOW, windowDays: 5, limit: 3 });
  assert.equal(JSON.stringify(PYPL), before, "must not mutate/sort the caller's array in place");
  assert.deepEqual(pickHeadlines([], { nowMs: NOW, windowDays: 5, limit: 3 }), []);
});
