import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveEvidence, pickPeers, SHORT_VOL_ELEVATED, type PeerRow } from "../lib/moveEvidence";

const R = (symbol: string, ret1d: number | null, industry = "Semiconductors", marketCap = 1e11): PeerRow => ({
  symbol, ret1d, industry, sector: "Information Technology", marketCap,
});

const CTX = (rows: PeerRow[], sec?: [string, number][], shortVol?: [string, { pct: number; trendPp?: number }][]) => ({
  sectorRet1d: new Map(sec ?? []),
  rows,
  shortVol: shortVol ? new Map(shortVol) : undefined,
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
