import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveEvidence, buildSocialEvidence, cryptoExplains, pickPeers, SHORT_VOL_ELEVATED, type PeerRow, type SocialBuzz } from "../lib/moveEvidence";

const R = (symbol: string, ret1d: number | null, industry = "Semiconductors", marketCap = 1e11): PeerRow => ({
  symbol, ret1d, industry, sector: "Information Technology", marketCap,
});

const CTX = (
  rows: PeerRow[],
  sec?: [string, number][],
  shortVol?: [string, { pct: number; trendPp?: number }][],
  social?: [string, SocialBuzz][],
) => ({
  sectorRet1d: new Map(sec ?? []),
  rows,
  shortVol: shortVol ? new Map(shortVol) : undefined,
  social: social ? new Map(social) : undefined,
});

test("sector-sympathy case: small residual reads 'mostly a sector move' with the numbers", () => {
  // AMD +6.5% on a day semis ripped +5.0% → residual +1.5% — the sector explains most of it.
  const ev = buildMoveEvidence({ symbol: "AMD", etf: "XLK", industry: "Semiconductors", ret1d: 6.5 }, CTX([], [["XLK", 5.0]]));
  assert.match(ev, /sector \(XLK\) 1d \+5\.0%/);
  assert.match(ev, /residual \+1\.5%/);
  assert.match(ev, /mostly a sector move/);
});

test("idiosyncratic case: large residual (or opposite sign) reads 'mostly name-specific'", () => {
  // Down 5.9% while the sector was FLAT-to-up → the sector explains nothing.
  const ev = buildMoveEvidence({ symbol: "AVGO", etf: "XLK", ret1d: -5.9 }, CTX([], [["XLK", 0.3]]));
  assert.match(ev, /residual -6\.2%/);
  assert.match(ev, /mostly name-specific/);
});

test("peers: the industry's biggest absolute mover is ALWAYS included (the news leader), even if small-cap", () => {
  const rows = [
    R("NVDA", 3.1, "Semiconductors", 4e12),
    R("MU", 5.8, "Semiconductors", 2e11),
    R("AVGO", -1.0, "Semiconductors", 1.8e12),
    R("TXN", 0.4, "Semiconductors", 1.5e11),
    R("ADI", 0.2, "Semiconductors", 1.0e11),
    R("QCOM", 0.9, "Semiconductors", 1.6e11),
    R("INTC", 1.1, "Semiconductors", 1.2e11),
    R("MRVL", 0.8, "Semiconductors", 0.7e11),
    R("SNDK", 18.2, "Semiconductors", 0.2e11), // tiny cap, huge move — the actual news leader
  ];
  const peers = pickPeers({ symbol: "AMD", industry: "Semiconductors", ret1d: 6.5 }, rows);
  assert.equal(peers[0].symbol, "SNDK", "the leader must surface first");
  assert.ok(peers.length <= 4);
  assert.ok(!peers.some((p) => p.symbol === "AMD"), "never include self");
});

test("short-volume: surfaces only when elevated; quiet names stay silent", () => {
  const hot = buildMoveEvidence({ symbol: "XYZ", ret1d: 9 }, CTX([], [], [["XYZ", { pct: 61, trendPp: 4 }]]));
  assert.match(hot, /short volume 61% of tape \(elevated, \+4pp trend\)/);
  const quiet = buildMoveEvidence({ symbol: "ABC", ret1d: 9 }, CTX([], [], [["ABC", { pct: SHORT_VOL_ELEVATED - 5 }]]));
  assert.equal(quiet, ""); // nothing else computable, below threshold → empty, not noise
});

test("degrades to empty string when no context is computable — never fabricates", () => {
  assert.equal(buildMoveEvidence({ symbol: "ZZZ", ret1d: 7.6 }, CTX([])), "");
});

test("no industry → falls back to sector peers; no sector either → no peers", () => {
  const rows = [R("JPM", 1.0, undefined as any), R("BAC", -0.5, undefined as any)];
  rows.forEach((r) => { r.industry = null; r.sector = "Financials"; });
  const withSector = pickPeers({ symbol: "C", sector: "Financials", industry: null, ret1d: 4 }, rows);
  assert.equal(withSector.length, 2);
  const without = pickPeers({ symbol: "C", sector: null, industry: null, ret1d: 4 }, rows);
  assert.equal(without.length, 0);
});

test("social: a Reddit mention surge surfaces as retail attention on a mover", () => {
  const ev = buildMoveEvidence(
    { symbol: "GME", etf: "XLY", ret1d: 12 },
    CTX([], [["XLY", 0.4]], undefined, [
      ["GME", { redditMentions: 240, redditMentionChangePct: 420, redditRank: 3, redditRankChange: 38 }],
    ]),
  );
  assert.match(ev, /social: Reddit mentions \+420% d\/d, rank #3, climbed 38/);
});

test("social: a quiet name stays silent — a modest mention change adds nothing", () => {
  assert.equal(buildSocialEvidence({ redditMentions: 200, redditMentionChangePct: 5, redditRank: 120, redditRankChange: 2 }), "");
});

test("social: a surge off a tiny base is floored out (3→9 mentions is +200% but meaningless)", () => {
  assert.equal(buildSocialEvidence({ redditMentions: 9, redditMentionChangePct: 200, redditRank: 500, redditRankChange: 5 }), "");
});

test("social: a big rank climb alone qualifies, even with no mention-change base", () => {
  assert.equal(buildSocialEvidence({ redditMentions: 60, redditMentionChangePct: null, redditRank: 22, redditRankChange: 40 }), "social: Reddit rank #22, climbed 40");
});

test("crypto beta: a crypto-linked name on a green crypto tape reads 'crypto beta', not name-specific", () => {
  // COIN +9% while XLF was flat: the sector residual is huge, but BTC +6.2% is the real driver.
  const ev = buildMoveEvidence(
    { symbol: "COIN", etf: "XLF", ret1d: 9.0 },
    { ...CTX([], [["XLF", 0.2]]), crypto: { btc1d: 6.2, eth1d: 7.1 } },
  );
  assert.match(ev, /crypto tape: BTC 1d \+6\.2%, ETH \+7\.1%/);
  assert.match(ev, /tracks the crypto tape \(crypto beta, NOT name-specific\)/);
});

test("crypto beta: a crypto-linked name moving AGAINST the crypto tape stays name-specific", () => {
  // MSTR down 4% while BTC was UP — that's its own story, not the tape.
  const ev = buildMoveEvidence(
    { symbol: "MSTR", etf: "XLK", ret1d: -4.0 },
    { ...CTX([], [["XLK", 0.1]]), crypto: { btc1d: 3.0, eth1d: null } },
  );
  assert.match(ev, /runs against a flat\/opposite crypto tape \(name-specific/);
});

test("crypto beta: a NON-crypto name never gets a crypto line, even on a big BTC move", () => {
  const ev = buildMoveEvidence(
    { symbol: "AAPL", etf: "XLK", ret1d: 3.0 },
    { ...CTX([], [["XLK", 0.5]]), crypto: { btc1d: 6.0, eth1d: 6.0 } },
  );
  assert.doesNotMatch(ev, /crypto tape/);
});

test("cryptoExplains: crypto-linked + material same-direction BTC ⇒ true; flat / opposite / non-crypto ⇒ false", () => {
  assert.equal(cryptoExplains("HOOD", 4.0, 8.0), true);   // up with a green tape
  assert.equal(cryptoExplains("HOOD", -4.0, -6.0), true); // down with a red tape
  assert.equal(cryptoExplains("HOOD", 0.5, 8.0), false);  // BTC basically flat → not the driver
  assert.equal(cryptoExplains("HOOD", 4.0, -8.0), false); // moved opposite the tape → its own story
  assert.equal(cryptoExplains("AAPL", 6.0, 8.0), false);  // not a crypto-linked name
});
