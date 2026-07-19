import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrokerCsv, parseCsvLine } from "../lib/brokerImport";

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
  assert.ok(r.skipped.some((s) => /option/i.test(s)));
  assert.ok(r.skipped.some((s) => /cash/i.test(s))); // SPAXX
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
  assert.ok(r.skipped.some((s) => /option/i.test(s)));
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

test("parseBrokerCsv: Robinhood label + null when no symbol/qty columns", () => {
  const rh = "Robinhood holdings export\nInstrument,Quantity\nF,100\n";
  assert.equal(parseBrokerCsv(rh)!.broker, "Robinhood");
  assert.equal(parseBrokerCsv("Date,Amount\n2024-01-01,50\n"), null); // no symbol/qty → not a positions file
});
