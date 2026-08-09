import { test } from "node:test";
import assert from "node:assert/strict";
import { industryPeersFrom } from "../lib/industryPeers";
import { onCompanyHeadlines } from "../lib/news";
import type { NewsItem } from "../lib/news";

// The VSTS incident, pinned: peers are a CLASSIFICATION fact (VSTS/CTAS/UNF all carry GICS
// "Diversified Support Services"), and headlines about name-similar strangers (a "Vestis" search
// returning VISTRA stories) must never reach the model as this company's context.

const R = (symbol: string, industry: string, marketCap: number, name = symbol, sector = "Industrials") => ({ symbol, name, sector, industry, marketCap });
const UNIVERSE = [
  R("VSTS", "Diversified Support Services", 1.8e9, "Vestis Corporation"),
  R("CTAS", "Diversified Support Services", 90e9, "Cintas Corporation"),
  R("UNF", "Diversified Support Services", 3.2e9, "UniFirst Corporation"),
  R("ARMK", "Diversified Support Services", 10e9, "Aramark"),
  R("VST", "Electric Utilities", 70e9, "Vistra Corp.", "Utilities"),
  R("SMR", "Electric Utilities", 10e9, "NuScale Power", "Utilities"),
];

test("industryPeersFrom: VSTS peers = its GICS industry group by cap — CTAS first, Vistra NEVER", () => {
  const set = industryPeersFrom(UNIVERSE, "VSTS", 4)!;
  assert.equal(set.label, "Diversified Support Services");
  assert.deepEqual(set.peers.map((p) => p.symbol), ["CTAS", "ARMK", "UNF"]);
  assert.ok(!set.peers.some((p) => p.symbol === "VST" || p.symbol === "SMR"), "utilities are not uniform-rental peers");
  assert.equal(set.self.name, "Vestis Corporation");
});

test("industryPeersFrom: self excluded, unknown symbol → null, cap respected", () => {
  const set = industryPeersFrom(UNIVERSE, "CTAS", 2)!;
  assert.deepEqual(set.peers.map((p) => p.symbol), ["ARMK", "UNF"]);
  assert.equal(industryPeersFrom(UNIVERSE, "ZZZZ", 4), null);
});

const N = (title: string): NewsItem => ({ title, publisher: "p", link: "l", time: "2026-08-08T12:00:00Z", tickers: [] });

test("onCompanyHeadlines: the exact VSTS contamination — Vistra + NuScale headlines dropped, Vestis kept", () => {
  const news = [
    N("Vistra Reports Second Quarter 2026 Results"),
    N("Nuclear Stocks Sell Off In Hefty Earnings Week, NuScale Slides"),
    N("Vestis Corporation Announces Third Quarter Results"),
    N("VSTS shares climb after uniform-rental contract win"),
  ];
  const kept = onCompanyHeadlines(news, { symbol: "VSTS", name: "Vestis Corporation" }).map((n) => n.title);
  assert.deepEqual(kept, ["Vestis Corporation Announces Third Quarter Results", "VSTS shares climb after uniform-rental contract win"]);
});

test("onCompanyHeadlines: corp-suffix tokens can't match; ticker matches as a word, not a substring", () => {
  const news = [N("Global Holdings Group announces merger"), N("INVSTS conference recap")];
  assert.deepEqual(onCompanyHeadlines(news, { symbol: "VSTS", name: "Vestis Holdings Group" }), []);
});
