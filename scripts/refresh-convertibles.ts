/**
 * Nightly convertible-issuance pipeline → data/convertibles.json. Discovers recent convertible-note
 * offerings on EDGAR, LLM-extracts the terms, computes the implied ISSUE vol (the arb signal) with a
 * credit-spread estimate, and attaches the stock's listed/realized vol where the vol-dislocation feed
 * covers the name. Runs on the NAS (LLM + network); the local clone can't (no keys / gitignored data).
 *   npm run refresh-convertibles
 */
import { promises as fsp } from "fs";
import path from "path";
import { discoverConvertibleFilings, extractConvertibleTerms } from "../lib/convertibleExtract";
import { fetchFilingBodyText, edgarDocUrl } from "../lib/edgarSearch";
import { impliedIssueVol, estimateCreditSpread, creditQuality, type ConvertibleRow, type ConvertiblesData, type ConvertibleTerms, type CreditQuality } from "../lib/convertible";
import { getBorrow } from "../lib/borrow";
import { cachedStats } from "../lib/companyCache";

const DAYS = 180; // look-back window for offerings
const R = 0.04; // risk-free
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function main() {
  const now = Date.now();
  const hits = await discoverConvertibleFilings(iso(now - DAYS * DAY), iso(now));
  console.log(`convertibles: ${hits.length} candidate issuers over the last ${DAYS}d`);

  const rows: ConvertibleRow[] = [];
  for (const h of hits) {
    try {
      const text = await fetchFilingBodyText(h);
      if (text.replace(/\s/g, "").length < 800) continue;
      const t = await extractConvertibleTerms(text);
      if (!t) continue;
      const maturityYears = t.maturity ? (Date.parse(t.maturity) - now) / (365.25 * DAY) : null;
      if (maturityYears == null || maturityYears < 0.1) continue; // undated / already matured → skip
      const coupon = (t.coupon ?? 0) / 100; // percent → decimal
      const premium = t.premium != null ? t.premium / 100 : null;
      const par = t.par && t.par > 0 ? t.par : 1000;
      const creditSpread = estimateCreditSpread(coupon);
      const terms: ConvertibleTerms = { ticker: h.ticker || h.issuer, conversionPrice: t.conversionPrice as number, coupon, maturityYears, par, refPrice: t.refPrice, premium };
      const issueVol = impliedIssueVol(terms, R, creditSpread);
      // Short-leg economics: stock-borrow fee/availability (IBorrowDesk) + the dividend the short pays.
      let borrowFee: number | null = null, borrowAvailable: number | null = null, borrowStale = false, dividendYield: number | null = null;
      let credit: CreditQuality | null = null;
      if (h.ticker) {
        const [bi, st] = await Promise.all([getBorrow(h.ticker).catch(() => null), cachedStats(h.ticker).catch(() => null)]);
        if (bi) { borrowFee = bi.fee != null ? bi.fee / 100 : null; borrowAvailable = bi.available ?? null; borrowStale = !!bi.stale; }
        if (st) {
          dividendYield = st.dividendYield ?? null;
          credit = creditQuality({ totalCash: st.totalCash ?? null, freeCashflow: st.freeCashflow ?? null, marketCap: st.marketCap ?? null, enterpriseValue: st.enterpriseValue ?? null });
        }
      }
      rows.push({
        ticker: h.ticker || "",
        issuer: h.issuer,
        coupon,
        maturity: t.maturity,
        maturityYears: +maturityYears.toFixed(2),
        conversionPrice: t.conversionPrice as number,
        premium,
        refPrice: t.refPrice,
        sizeMM: t.sizeMM,
        cappedCallCap: t.cappedCallCap,
        par,
        creditSpread,
        issueVol: issueVol != null ? +issueVol.toFixed(4) : null,
        listedIV: null,
        realizedVol: null,
        borrowFee,
        borrowAvailable,
        borrowStale,
        dividendYield,
        credit,
        filedDate: h.date,
        filingUrl: edgarDocUrl(h.ciks[0] || "", h.accession, h.doc),
        form: h.form,
        extractedAt: new Date(now).toISOString(),
      });
      console.log(`  ${h.ticker || h.issuer}: conv $${t.conversionPrice}, ${(coupon * 100).toFixed(2)}% cpn, ${maturityYears.toFixed(1)}y → issue vol ${issueVol != null ? (issueVol * 100).toFixed(0) + "%" : "n/a"}`);
    } catch (e) {
      console.warn(`  skip ${h.ticker || h.issuer}: ${String((e as Error)?.message || e).slice(0, 100)}`);
    }
  }

  // Attach the stock's listed ATM IV + realized vol from the nightly vol-dislocation feed where covered.
  try {
    const vd = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "vol-dislocation.json"), "utf8"));
    const byT = new Map<string, any>((vd.rows || []).map((r: any) => [r.symbol, r]));
    for (const row of rows) {
      const v = row.ticker ? byT.get(row.ticker) : null;
      if (v) { row.listedIV = v.atmIV ?? null; row.realizedVol = v.rvol ?? null; }
    }
  } catch { /* no vol feed → listed IV stays null, the view can fetch it live */ }

  rows.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  const data: ConvertiblesData = { generatedAt: new Date(now).toISOString(), rows };
  await fsp.writeFile(path.join(process.cwd(), "data", "convertibles.json"), JSON.stringify(data, null, 2));
  console.log(`convertibles: wrote ${rows.length} rows → data/convertibles.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
