/**
 * International same-store-sales (Comps Phase 3) — European retailers' like-for-like (LFL) sales.
 *
 * These names don't file SEC 8-Ks, so the US extractor (scripts/refresh-sss.ts, EDGAR-only) can't
 * reach them. Their comp lives in the quarterly RNS "trading statement", which scripts/refresh-sss-intl.ts
 * fetches from Investegate and LLM-extracts into the SAME data/same-store-sales.json — keyed by the
 * Yahoo symbol the app uses (NXT.L) — so the income-statement splice (FinancialsView) and the cross-
 * universe Comps Board pick the rows up with NO UI changes. v1 is the UK/RNS set (reliably fetchable
 * server-side); the shape extends to continental Europe as those sources are wired.
 *
 * CLIENT-SAFE: roster + name/region maps only (no fs/llm/fetch) — imported by the Comps Board view.
 */
export interface IntlCompName {
  yahoo: string; // Yahoo symbol the app/universe uses (e.g. NXT.L) — this is the SSS JSON key
  lse: string; // London Stock Exchange ticker = the Investegate /company/<lse> path
  name: string;
  region: string; // "UK" today (extensible to "Europe")
  industry: string; // a retail bucket for display / consistency with SSS_INDUSTRIES
  metricHint: string; // the issuer's OWN comp label, to steer the extractor (Next uses "full price sales")
}

// Curated UK/European retail roster. The comp metric varies by issuer (LFL, full-price sales,
// comparable store sales) — metricHint steers the LLM; the extractor keeps the issuer's verbatim label.
export const INTL_COMPS: IntlCompName[] = [
  { yahoo: "NXT.L", lse: "NXT", name: "Next", region: "UK", industry: "Apparel Retail", metricHint: "full price sales" },
  { yahoo: "TSCO.L", lse: "TSCO", name: "Tesco", region: "UK", industry: "Food Retail", metricHint: "like-for-like sales (ex-fuel)" },
  { yahoo: "SBRY.L", lse: "SBRY", name: "J Sainsbury", region: "UK", industry: "Food Retail", metricHint: "like-for-like sales (ex-fuel)" },
  { yahoo: "MKS.L", lse: "MKS", name: "Marks & Spencer", region: "UK", industry: "Department Stores", metricHint: "like-for-like sales" },
  { yahoo: "ABF.L", lse: "ABF", name: "Associated British Foods (Primark)", region: "UK", industry: "Apparel Retail", metricHint: "like-for-like sales" },
  { yahoo: "KGF.L", lse: "KGF", name: "Kingfisher", region: "UK", industry: "Home Improvement Retail", metricHint: "like-for-like sales" },
  { yahoo: "JD.L", lse: "JD", name: "JD Sports Fashion", region: "UK", industry: "Apparel Retail", metricHint: "like-for-like sales" },
  { yahoo: "GRG.L", lse: "GRG", name: "Greggs", region: "UK", industry: "Restaurants", metricHint: "like-for-like sales (company-managed shops)" },
  { yahoo: "BME.L", lse: "BME", name: "B&M European Value Retail", region: "UK", industry: "Discount Stores", metricHint: "like-for-like revenue" },
  { yahoo: "BRBY.L", lse: "BRBY", name: "Burberry", region: "UK", industry: "Luxury Goods", metricHint: "comparable store sales" },
  { yahoo: "DNLM.L", lse: "DNLM", name: "Dunelm", region: "UK", industry: "Specialty Retail", metricHint: "like-for-like sales" },
  { yahoo: "SMWH.L", lse: "SMWH", name: "WH Smith", region: "UK", industry: "Specialty Retail", metricHint: "like-for-like sales" },
];

