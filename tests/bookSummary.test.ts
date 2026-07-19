import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeBook } from "../lib/bookSummary";
import { computePortfolio, parsePositions, scenarioPnL, type NameData } from "../lib/portfolio";

test("summarizeBook: concentrated, levered, high-beta book → sentences + warnings", () => {
  const data = new Map<string, NameData>([
    ["AAPL", { symbol: "AAPL", price: 100, sector: "Information Technology", beta: 1.5, marketCap: 3e12 }],
    ["MSFT", { symbol: "MSFT", price: 100, sector: "Information Technology", beta: 1.4, marketCap: 3e12 }],
  ]);
  const stats = computePortfolio(parsePositions("AAPL 900\nMSFT 100"), data, 50000); // $100k gross on $50k equity
  const s = summarizeBook({ stats, risk: null, tilts: [], marketDown10Dollar: scenarioPnL(stats, -10).dollar, crashDollar: -55000 });
  assert.ok(s.headline[0].includes("long-biased") && s.headline[0].includes("2.0×"), s.headline[0]);
  assert.ok(s.headline.some((h) => h.includes("90%")), "concentration mentioned");
  const flagText = s.flags.map((f) => f.text).join(" | ");
  assert.ok(/One name is 90%/.test(flagText), flagText);
  assert.ok(/β 1\.5/.test(flagText), flagText); // high-beta flag
  assert.ok(/Information Technology is 100%/.test(flagText), flagText); // sector flag
  assert.ok(/net long/.test(flagText), flagText); // 200% net long
  assert.ok(s.flags.every((f) => f.level === "warn" || f.level === "info"));
});

test("summarizeBook: well-spread book → an OK flag, no scary warnings", () => {
  const names = Array.from({ length: 15 }, (_, i) => "A" + String.fromCharCode(65 + i)); // AA..AO
  const data = new Map<string, NameData>();
  let txt = "";
  names.forEach((s, i) => { data.set(s, { symbol: s, price: 100, sector: "Sector" + (i % 6), beta: 0.9, marketCap: 5e9 }); txt += `${s} 10\n`; });
  const stats = computePortfolio(parsePositions(txt), data, 200000);
  const s = summarizeBook({ stats, risk: null, tilts: [], marketDown10Dollar: scenarioPnL(stats, -10).dollar, crashDollar: null });
  assert.ok(s.flags.some((f) => f.level === "ok"), JSON.stringify(s.flags));
  assert.ok(!s.flags.some((f) => f.level === "warn"), "no warnings for a spread book");
});

test("summarizeBook: risk sentence appears with predicted risk; empty book handled", () => {
  const data = new Map<string, NameData>([["AAPL", { symbol: "AAPL", price: 100, beta: 1, marketCap: 3e12 }]]);
  const stats = computePortfolio(parsePositions("AAPL 100"), data, 20000);
  const risk = { volAnnPct: 0.18, volAnnDollar: 3600, var95Dollar: 900 } as never; // minimal shape the fn reads
  const s = summarizeBook({ stats, risk, tilts: [], marketDown10Dollar: null, crashDollar: null });
  assert.ok(s.headline.some((h) => h.includes("18%") && h.includes("1-in-20")), s.headline.join(" "));
  const empty = summarizeBook({ stats: computePortfolio([], data), risk: null, tilts: [], marketDown10Dollar: null, crashDollar: null });
  assert.equal(empty.flags.length, 0);
});
