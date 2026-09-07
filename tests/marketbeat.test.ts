import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarketBeatReportList, parseMarketBeatReport } from "../lib/marketbeat";

// MarketBeat is the free full-text backfill source (chosen after vetting 6 sources, 2026-09). These pin the
// PURE parsers against its real markup: the ticker earnings page's dated report links, and a report page's
// `.transcript-discussion` speaker turns + "Q# YYYY Earnings Call Transcript" period.

test("parseMarketBeatReportList: dated report URLs, newest first, deduped", () => {
  const html = `
    <a href="/earnings/reports/2025-3-27-lululemon-athletica-inc-stock/">old</a>
    <a href="/earnings/reports/2026-9-3-lululemon-athletica-inc-stock/">new</a>
    <a href="/earnings/reports/2026-9-3-lululemon-athletica-inc-stock/">dup</a>
    <a href="/stocks/NASDAQ/LULU/">not a report</a>`;
  const out = parseMarketBeatReportList(html);
  assert.equal(out.length, 2, "deduped");
  assert.equal(out[0].date, "2026-09-03", "newest first, zero-padded");
  assert.equal(out[1].date, "2025-03-27");
  assert.ok(out[0].url.startsWith("https://www.marketbeat.com/earnings/reports/2026-9-3-"));
});

const turn = (side: string, speaker: string, said: string) =>
  `<div class="transcript-line-${side} pb-4"><div class="transcript-line-speaker">${speaker}</div><div class="transcript-arrow">${said}</div></div>`;

test("parseMarketBeatReport: speaker-labeled text + fiscal period, timestamps + doubled names cleaned", () => {
  const long = "We delivered a strong quarter with revenue growth across all regions. ".repeat(60); // > 3000 chars
  const html = `<html><body>
    <h1>Lululemon Q2 2026 Earnings Report</h1>
    <div>Lululemon athletica Q2 2026 Earnings Call Transcript</div>
    <div class="transcript-discussion mb-4">
      ${turn("left", "Operator Operator 00:00:00", "Operator 00:00:00 Welcome to the call.")}
      ${turn("right", "Calvin McDonald 00:01:12", `${long}`)}
    </div></body></html>`;
  const out = parseMarketBeatReport(html);
  assert.ok(out, "a real transcript parses");
  assert.equal(out!.fiscalPeriod, "2026-Q2");
  assert.ok(out!.text.startsWith("Operator: Welcome to the call."), `speaker deduped + timestamp stripped, got: ${out!.text.slice(0, 40)}`);
  assert.ok(out!.text.includes("Calvin McDonald: We delivered a strong quarter"), "second turn labeled");
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(out!.text), "no timestamps remain");
});

test("parseMarketBeatReport: a results-only page (no real transcript) is null", () => {
  const html = `<html><body><div class="transcript-discussion">${turn("left", "Operator", "Short.")}</div></body></html>`;
  assert.equal(parseMarketBeatReport(html), null); // under the 3000-char floor
});
