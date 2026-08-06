import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFinraLine, parseFtdLine, rollShortVol, type FinraShortRow } from "../lib/shortMechanics";

// Parsers pinned to the LIVE file formats (verified 2026-08-06):
//   FINRA CNMSshvol: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
//   SEC FTD:         SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE

test("FINRA line: short + short-exempt = short executions; header and junk rejected", () => {
  assert.deepEqual(parseFinraLine("20260805|AA|911964|5805|1875882|B,Q,N"), { symbol: "AA", shortVol: 917769, totalVol: 1875882 });
  assert.equal(parseFinraLine("Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market"), null);
  assert.equal(parseFinraLine("20260805|BADROW|0|0|0|B"), null); // zero total → unusable
});

test("SEC FTD line: fails + price parsed; header rejected", () => {
  assert.deepEqual(parseFtdLine("20260701|B38564108|CMBT|95572|CMB.TECH NV (BEL)|13.99"), { symbol: "CMBT", fails: 95572, priceUsd: 13.99 });
  assert.equal(parseFtdLine("SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE"), null);
  assert.equal(parseFtdLine("20260701|X|ZZZ|0|NAME|1.00"), null); // zero fails → dropped
});

test("rollShortVol: volume-weighted mean, latest, and trend", () => {
  const daily: FinraShortRow[] = [
    { symbol: "X", shortVol: 40, totalVol: 100 }, // 40%
    { symbol: "X", shortVol: 60, totalVol: 100 }, // 60%
  ];
  const r = rollShortVol(daily, daily[1]);
  assert.equal(r.shortVolPct, 50); // (40+60)/(100+100)
  assert.equal(r.latestShortVolPct, 60);
  assert.equal(r.shortVolTrendPp, 10); // 60 − 50
  assert.equal(r.daysObserved, 2);
});

test("rollShortVol clamps the >100% thin-name artifact (the ALH 105.7% case)", () => {
  const r = rollShortVol([{ symbol: "ALH", shortVol: 1057, totalVol: 1000 }], { symbol: "ALH", shortVol: 1057, totalVol: 1000 });
  assert.equal(r.latestShortVolPct, 100);
  assert.equal(r.shortVolPct, 100);
});

test("rollShortVol: no data → all null, never a divide-by-zero", () => {
  const r = rollShortVol([], null);
  assert.deepEqual(r, { shortVolPct: null, latestShortVolPct: null, shortVolTrendPp: null, daysObserved: 0 });
});
