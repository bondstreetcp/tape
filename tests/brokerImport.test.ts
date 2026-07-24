import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrokerCsv, parseCsvLine } from "../lib/brokerImport";
import { parseOptionSymbol, formatLeg, splitBook } from "../lib/optionsBook";

test("parseCsvLine: quoted fields, embedded commas, escaped quotes", () => {
  assert.deepEqual(parseCsvLine('"NVDA","NVIDIA, CORP","1,000"'), ["NVDA", "NVIDIA, CORP", "1,000"]);
  assert.deepEqual(parseCsvLine('A,B,C'), ["A", "B", "C"]);
  assert.deepEqual(parseCsvLine('"a ""x"" b",2'), ['a "x" b', "2"]);
});

test("parseBrokerCsv: Fidelity — footer, SPAXX cash, option, share class", () => {
  const csv = [
    "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Type",
    "X1,Individual,AAPL,APPLE INC,100,333.74,33374,Cash",
    "X1,Individual,MSFT,MICROSOFT CORP,50,500,25000,Cash",
    "X1,Individual,BRK.B,BERKSHIRE HATHAWAY B,10,400,4000,Cash",
    "X1,Individual,SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,1234.56,1,1234.56,Cash",
    "X1,Individual, -AAPL241220C00150000,CALL AAPL DEC 20,2,5,1000,Cash",
    "X1,Individual,Pending Activity,,,,,",
    '"","","","","","","",""',
    '"The data and information in this spreadsheet is provided as-is..."',
  ].join("\n");
  const r = parseBrokerCsv(csv)!;
  assert.equal(r.broker, "Fidelity");
  assert.deepEqual(r.positions, [
    { symbol: "AAPL", shares: 100 },
    { symbol: "MSFT", shares: 50 },
    { symbol: "BRK-B", shares: 10 }, // BRK.B kept (share class)
  ]);
  // the ` -AAPL241220C00150000` row is now IMPORTED as a leg (OCC strike is in thousandths)
  assert.deepEqual(r.options, [
    { symbol: "AAPL", kind: "call", strike: 150, expiry: "2024-12-20", contracts: 2 },
  ]);
  assert.ok(r.skipped.some((s) => /cash/i.test(s))); // SPAXX
  assert.ok(!r.skipped.some((s) => /option/i.test(s)), "options are parsed now, not skipped");
});

test("parseBrokerCsv: Schwab — preamble, Qty (Quantity), short, option, totals", () => {
  const csv = [
    '"Positions for account Individual ...456 as of 08:00 PM ET, 2024/12/20"',
    "",
    '"Symbol","Description","Qty (Quantity)","Price","Market Value","Security Type"',
    '"NVDA","NVIDIA CORP","200","180","36000","Equity"',
    '"TSLA","TESLA INC","-50","250","-12500","Equity"',
    '"BRK/B","BERKSHIRE HATHAWAY","10","400","4000","Equity"',
    '"AAPL 12/20/2024 150.00 C","CALL AAPL","5","2","1000","Option"',
    '"Cash & Cash Investments","","1,234.00","","1234","Cash"',
    '"Account Total","","","","53734",""',
  ].join("\n");
  const r = parseBrokerCsv(csv)!;
  assert.equal(r.broker, "Schwab");
  assert.deepEqual(r.positions, [
    { symbol: "NVDA", shares: 200 },
    { symbol: "TSLA", shares: -50 }, // short preserved
    { symbol: "BRK-B", shares: 10 }, // BRK/B → BRK-B
  ]);
  // Schwab's spaced option symbol is now imported as a leg
  assert.deepEqual(r.options, [
    { symbol: "AAPL", kind: "call", strike: 150, expiry: "2024-12-20", contracts: 5 },
  ]);
});

test("parseBrokerCsv: generic — Symbol/Shares, dupes summed, negative short", () => {
  const csv = "Symbol,Shares\nAMZN,15\nGOOG,-8\nAMZN,5\n";
  const r = parseBrokerCsv(csv)!;
  assert.equal(r.broker, "CSV");
  assert.deepEqual(r.positions, [
    { symbol: "AMZN", shares: 20 }, // 15 + 5
    { symbol: "GOOG", shares: -8 },
  ]);
});

test("parseOptionSymbol: OCC, Fidelity plain-strike, Schwab spaced; rejects plain tickers", () => {
  // OCC canonical — 8-digit strike in thousandths
  assert.deepEqual(parseOptionSymbol("AAPL260116C00250000"), { symbol: "AAPL", kind: "call", strike: 250, expiry: "2026-01-16" });
  // Fidelity: leading dash + plain strike (and a fractional one)
  assert.deepEqual(parseOptionSymbol("-NVDA270115P250"), { symbol: "NVDA", kind: "put", strike: 250, expiry: "2027-01-15" });
  assert.deepEqual(parseOptionSymbol("-SPY270115P250.5"), { symbol: "SPY", kind: "put", strike: 250.5, expiry: "2027-01-15" });
  // Schwab spaced, 2- and 4-digit years
  assert.deepEqual(parseOptionSymbol("AAPL 01/16/2026 250.00 C"), { symbol: "AAPL", kind: "call", strike: 250, expiry: "2026-01-16" });
  assert.deepEqual(parseOptionSymbol("BRK/B 6/19/26 412.5 P"), { symbol: "BRK-B", kind: "put", strike: 412.5, expiry: "2026-06-19" });
  // not options
  assert.equal(parseOptionSymbol("AAPL"), null);
  assert.equal(parseOptionSymbol("BRK.B"), null);
  assert.equal(parseOptionSymbol(""), null);
  assert.equal(parseOptionSymbol("AAPL261316C00250000"), null); // month 13
});

test("parseBrokerCsv: option legs net by contract and round-trip into Prism's book syntax", () => {
  const csv = [
    "Symbol,Description,Quantity",
    "AAPL,APPLE INC,100",
    "AAPL260116C00250000,CALL AAPL,10",
    "AAPL260116C00250000,CALL AAPL,-4", // same contract, partially closed → nets to 6
    "AAPL260116P00200000,PUT AAPL,-3", // written put stays short
  ].join("\n");
  const r = parseBrokerCsv(csv)!;
  assert.deepEqual(r.positions, [{ symbol: "AAPL", shares: 100 }]);
  assert.deepEqual(r.options, [
    { symbol: "AAPL", kind: "call", strike: 250, expiry: "2026-01-16", contracts: 6 },
    { symbol: "AAPL", kind: "put", strike: 200, expiry: "2026-01-16", contracts: -3 },
  ]);
  // the legs render back to the book syntax the cockpit reads, and re-parse identically
  const lines = r.options.map(formatLeg);
  assert.deepEqual(lines, ["AAPL C250 2026-01-16 x6", "AAPL P200 2026-01-16 x-3"]);
  assert.deepEqual(splitBook(lines.join("\n")).legs, r.options);
});

test("parseBrokerCsv: an options-ONLY file still imports", () => {
  const r = parseBrokerCsv("Symbol,Quantity\nSPY260320P00550000,-3\n")!;
  assert.deepEqual(r.positions, []);
  assert.deepEqual(r.options, [{ symbol: "SPY", kind: "put", strike: 550, expiry: "2026-03-20", contracts: -3 }]);
});

test("parseBrokerCsv: Robinhood label + null when no symbol/qty columns", () => {
  const rh = "Robinhood holdings export\nInstrument,Quantity\nF,100\n";
  assert.equal(parseBrokerCsv(rh)!.broker, "Robinhood");
  assert.equal(parseBrokerCsv("Date,Amount\n2024-01-01,50\n"), null); // no symbol/qty → not a positions file
});
