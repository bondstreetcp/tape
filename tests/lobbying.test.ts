import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBills, unwrapClientName, resolveClient, buildNameIndex, buildLeadCounts } from "../lib/lobbying";
import type { Registrant } from "../lib/newsTape";

// Bill-extraction cases are VERBATIM strings from live 2026 LDA filings (recon 2026-08-10) plus the
// traps the regex is hardened against. A missed bill costs one row; a phantom bill ("U.S. 123")
// would put a nonexistent bill on the board — refusal beats guessing, same as the news tape.

test("extractBills: dotted and undotted house bills", () => {
  const bills = extractBills("Issues related to nutrition, the farm bill (H.R.7567), and H.R. 4776.");
  assert.deepEqual(bills.map((b) => b.id), ["hr7567", "hr4776"]);
});

test("extractBills: senate bills with and without space, paired listings", () => {
  const t = "the RESTORE Patents Act (H.R. 1574 / S. 708), the PERA Act (H.R. 3152 / S. 1546), S.1040, Drug Competition Enhancement Act";
  assert.deepEqual(extractBills(t).map((b) => b.id).sort(), ["hr1574", "hr3152", "s1040", "s1546", "s708"]);
});

test("extractBills: resolution forms map to their GovInfo types", () => {
  const t = "support for H. Con. Res. 14 and opposition to S.J. Res. 5; also H. Res. 353";
  assert.deepEqual(extractBills(t).map((b) => b.id).sort(), ["hconres14", "hres353", "sjres5"]);
});

test("extractBills: refuses the U.S.-number trap and public laws", () => {
  assert.deepEqual(extractBills("appropriated under U.S. 123 authority per P.L. 119-21 and PL 117-169"), []);
});

test("extractBills: no boundary inside acronyms (IRS. 456 is not a bill)", () => {
  assert.deepEqual(extractBills("guidance from the IRS. 456 pages of rules."), []);
});

test("extractBills: dedupes repeat mentions and labels correctly", () => {
  const bills = extractBills("H.R. 1 implementation; reconciliation follow-on to H.R. 1");
  assert.equal(bills.length, 1);
  assert.equal(bills[0].label, "H.R. 1");
});

test("unwrapClientName: strips ON BEHALF OF / OBO wrappers", () => {
  assert.equal(unwrapClientName("COVINGTON & BURLING ON BEHALF OF APPLE INC."), "APPLE INC.");
  assert.equal(unwrapClientName("CORNERSTONE GOVERNMENT AFFAIRS OBO GOOGLE CLIENT SERVICES LLC"), "GOOGLE CLIENT SERVICES LLC");
  assert.equal(unwrapClientName("PFIZER, INC"), "PFIZER, INC");
});

const REG: Registrant[] = [
  { cik: "320193", ticker: "AAPL", title: "Apple Inc." },
  { cik: "1045810", ticker: "NVDA", title: "NVIDIA CORP" },
  { cik: "78003", ticker: "PFE", title: "PFIZER INC" },
  { cik: "1652044", ticker: "GOOGL", title: "Alphabet Inc." },
  { cik: "1652044", ticker: "GOOG", title: "Alphabet Inc." },
  // The fabrication set from the first live audit (2026-08-10) — these must all REFUSE their trap:
  { cik: "1", ticker: "CHCO", title: "City Holding Co" },
  { cik: "2", ticker: "NYT", title: "New York Times Co" },
  { cik: "3", ticker: "PLCE", title: "Childrens Place Inc" },
  { cik: "4", ticker: "ASO", title: "Academy Sports & Outdoors Inc" },
  { cik: "5", ticker: "VG", title: "Venture Global Inc" },
  { cik: "6", ticker: "GLDM", title: "World Gold Trust" },
  { cik: "7", ticker: "CSTM", title: "Constellium SE" },
  { cik: "8", ticker: "DAR", title: "Darling Ingredients Inc" },
  { cik: "9", ticker: "AMZN", title: "AMAZON COM INC" },
  // Audit-2 registrants (2026-08-10, at-scale fabrications): suffix-stripping leaves bare generic
  // cores — these names are IN the index precisely so the traps below can try to hit them.
  { cik: "10", ticker: "SO", title: "Southern Co" },
  { cik: "11", ticker: "SCCO", title: "Southern Copper Corp" },
  { cik: "12", ticker: "EML", title: "Eastern Co" },
  { cik: "13", ticker: "BVFL", title: "BV Financial Inc" },
  { cik: "14", ticker: "LUV", title: "Southwest Airlines Co" },
  { cik: "15", ticker: "TDW", title: "Tidewater Inc" },
  { cik: "16", ticker: "AFG", title: "American Financial Group Inc" },
];
const LEADS = buildLeadCounts(REG);

test("resolveClient: punctuation variants of one company all resolve", () => {
  const idx = buildNameIndex(REG);
  for (const v of ["PFIZER, INC", "PFIZER, INC.", "PFIZER INC", "PFIZER INC.", "PFIZER"]) {
    assert.equal(resolveClient(v, idx, LEADS), "PFE", v);
  }
});

test("resolveClient: law-firm wrapper resolves to the principal", () => {
  const idx = buildNameIndex(REG);
  assert.equal(resolveClient("COVINGTON & BURLING ON BEHALF OF APPLE INC.", idx, LEADS), "AAPL");
});

test("resolveClient: unknown and unrelated names refuse", () => {
  const idx = buildNameIndex(REG);
  assert.equal(resolveClient("O.N.E. AMAZON", idx, LEADS), null);
});

// The 2026-08-10 live-audit fabrications — 8 of 21 first-pass resolutions were non-companies
// claimed by generic leading tokens. Every one must refuse forever.
test("resolveClient: municipalities/universities/hospitals cannot be claimed by token overlap", () => {
  const idx = buildNameIndex(REG);
  for (const trap of [
    "CITY OF SOMERTON (AZ)", "CITY OF TERRE HAUTE", "CITY OF LOGAN, WEST VIRGINIA",
    "NEW YORK CITY EMPLOYMENT AND TRAINING COALITION",
    "THE CHILDREN'S HOSPITAL OF PHILADELPHIA",
    "ACADEMY OF NUTRITION AND DIETETICS",
    "VENTURE QUEST CAPITAL PARTNERS",
    "INTEGER LLC ON BEHALF OF WORLD GOLD COUNCIL",
  ]) {
    assert.equal(resolveClient(trap, idx, LEADS), null, trap);
  }
});

// Audit-2 (at-scale, from the shipped store): bare generic cores and entity-word clients. SO was
// 5th on the board partly on shrimp alliances and universities; FINRA resolved to a bank because
// "BV" is a stripped Dutch suffix. Every one must refuse forever.
test("resolveClient: generic suffix-stripped cores cannot claim anything (audit 2)", () => {
  const idx = buildNameIndex(REG);
  for (const trap of [
    "SOUTHERN SHRIMP ALLIANCE", "SOUTHERN WESLEYAN UNIVERSITY", "SOUTHERN UTAH WILDERNESS ALLIANCE",
    "SOUTHERN MINNESOTA BEET SUGAR COOPERATIVE",
    "EASTERN CONNECTICUT STATE UNIVERSITY", "EASTERN MUNICIPAL WATER DISTRICT",
    "SOUTHWEST AIRLINES PILOTS' ASSOCIATION",
    "AMERICAN FINANCIAL SERVICES ASSOCIATION",
    "FINANCIAL INDUSTRY REGULATORY AUTHORITY (FINRA)",
    "FINANCIAL OVERSIGHT AND MANAGEMENT BOARD FOR PUERTO RICO",
    "TIDEWATER COMMUNITY COLLEGE",
    "HIGHWAY 36/CITY OF BOULDER",
  ]) {
    assert.equal(resolveClient(trap, idx, LEADS), null, trap);
  }
});

test("resolveClient: the real companies behind audit-2 still resolve by exact name", () => {
  const idx = buildNameIndex(REG);
  assert.equal(resolveClient("SOUTHERN COMPANY", idx, LEADS), "SO");
  assert.equal(resolveClient("SOUTHWEST AIRLINES CO.", idx, LEADS), "LUV");
  assert.equal(resolveClient("TIDEWATER, INC.", idx, LEADS), "TDW");
  assert.equal(resolveClient("AMERICAN FINANCIAL GROUP, INC.", idx, LEADS), "AFG");
});

test("resolveClient: distinctive leading cores still match subsidiaries and dba names", () => {
  const idx = buildNameIndex(REG);
  assert.equal(resolveClient("CONSTELLIUM ROLLED PRODUCTS RAVENSWOOD, LLC", idx, LEADS), "CSTM");
  assert.equal(resolveClient("DARLING INGREDIENTS INC. AND ITS SUBSIDIARY ENVIROFLIGHT", idx, LEADS), "DAR");
  assert.equal(resolveClient("AMAZON.COM SERVICES LLC", idx, LEADS), "AMZN");
});

test("resolveClient: a 1-token core shared by several SEC names refuses even non-entity clients", () => {
  const idx = buildNameIndex(REG);
  // "southern" leads both Southern Co and Southern Copper — a hypothetical private company
  // starting with it must refuse, entity word or not.
  assert.equal(resolveClient("SOUTHERN PRODUCE DISTRIBUTORS LLC", idx, LEADS), null);
});

test("resolveClient: curated aliases catch names EDGAR can't (Google lobbies as Google)", () => {
  const idx = buildNameIndex(REG);
  assert.equal(resolveClient("GOOGLE LLC", idx, LEADS), "GOOGL");
  assert.equal(resolveClient("CORNERSTONE GOVERNMENT AFFAIRS OBO GOOGLE CLIENT SERVICES LLC", idx, LEADS), "GOOGL");
  assert.equal(resolveClient("AMAZON WEB SERVICES, INC.", idx, LEADS), "AMZN");
});
