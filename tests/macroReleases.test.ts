import { test } from "node:test";
import assert from "node:assert/strict";
import { blsReleaseUrl, catOf } from "../lib/macroReleases";

// The "recent economic releases" feed (scripts/refresh-macro-releases.ts) links each BLS indicator from the
// bls_latest rollup. That rollup points at the release table-of-contents (…/empsit.toc.htm) — a page of links,
// which is what Richard hit clicking "Unemployment Rate 4.1%". blsReleaseUrl retargets the news-release page.

test("blsReleaseUrl: toc → nr0 for every major BLS release", () => {
  for (const abbr of ["empsit", "cpi", "ppi", "eci", "prod2", "ximpim"]) {
    assert.equal(
      blsReleaseUrl(`https://www.bls.gov/news.release/${abbr}.toc.htm`),
      `https://www.bls.gov/news.release/${abbr}.nr0.htm`,
    );
  }
});

test("blsReleaseUrl: leaves non-toc links untouched", () => {
  const keep = [
    "https://www.bls.gov/news.release/empsit.nr0.htm", // already the release narrative
    "https://www.bls.gov/news.release/empsit.a.htm", // a specific data table
    "https://www.bls.gov/data/", // the generic fallback
    "https://www.bea.gov/news/2026/gdp-advance-estimate-2nd-quarter-2026", // BEA link
  ];
  for (const u of keep) assert.equal(blsReleaseUrl(u), u);
});

test("catOf: buckets the headline releases", () => {
  assert.equal(catOf("Unemployment Rate: 4.1% in Jul 2026"), "Labor");
  assert.equal(catOf("Consumer Price Index (CPI): +0.1% in Jul 2026"), "Inflation");
  assert.equal(catOf("GDP (Advance Estimate), 2nd Quarter 2026"), "Growth");
  assert.equal(catOf("Personal Income and Outlays, June 2026"), "Income");
  assert.equal(catOf("U.S. International Trade in Goods and Services"), "Trade");
});
