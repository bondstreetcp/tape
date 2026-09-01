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
import { impliedIssueVol, estimateCreditSpread, creditQuality, dedupeConvertibleRows, type ConvertibleRow, type ConvertiblesData, type ConvertibleTerms, type CreditQuality } from "../lib/convertible";
import { getBorrow } from "../lib/borrow";
import { cachedStats } from "../lib/companyCache";
import { getTermStructure } from "../lib/options";

const DAYS = 180; // look-back window for offerings
const MAX_FILINGS = 200; // cap the extraction fan-out (newest-first); a busy window won't blow up the nightly LLM spend
const R = 0.04; // risk-free
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function main() {
  const now = Date.now();
  const allHits = await discoverConvertibleFilings(iso(now - DAYS * DAY), iso(now));
  const hits = allHits.slice(0, MAX_FILINGS);
  console.log(`convertibles: ${allHits.length} candidate filings over the last ${DAYS}d${allHits.length > hits.length ? ` (extracting the newest ${hits.length})` : ""}`);

  let rows: ConvertibleRow[] = [];
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
      // Issue vol from the tenor AT ISSUE (maturity − filing date), not the shrinking remaining maturity —
      // so it's a fixed issue-time quantity, stable across nightly refreshes.
      const issueYears = t.maturity && h.date ? Math.max(0.1, (Date.parse(t.maturity) - Date.parse(h.date)) / (365.25 * DAY)) : maturityYears;
      const issueVol = impliedIssueVol(terms, R, creditSpread, 0, issueYears);
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
        cusip: t.cusip,
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

  // Collapse each deal's launch/upsize/pricing filings to one row (newest terms), keeping distinct deals.
  const beforeDedup = rows.length;
  rows = dedupeConvertibleRows(rows);
  if (beforeDedup !== rows.length) console.log(`convertibles: deduped ${beforeDedup} filings → ${rows.length} distinct deals`);

  // Attach the stock's listed ATM IV + realized vol from the nightly vol-dislocation feed where covered.
  try {
    const vd = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "vol-dislocation.json"), "utf8"));
    const byT = new Map<string, any>((vd.rows || []).map((r: any) => [r.symbol, r]));
    for (const row of rows) {
      const v = row.ticker ? byT.get(row.ticker) : null;
      if (v) { row.listedIV = v.atmIV ?? null; row.realizedVol = v.rvol ?? null; }
    }
  } catch { /* no vol feed → fall through to the live per-name IV pull below */ }

  // Fill any still-missing listed IV live (best-effort) so names OUTSIDE the vol-dislocation universe still
  // get a cheap/rich edge — the ~1M ATM IV off the live options chain. The view has no IV feed of its own.
  for (const row of rows) {
    if (row.listedIV != null || !row.ticker) continue;
    try {
      const ts = await getTermStructure(row.ticker, 6);
      const cand = ts.points.filter((p) => p.atmIV != null && p.atmIV > 0.05 && p.atmIV < 3);
      if (cand.length) {
        const pick = cand.reduce((a, b) => (Math.abs(b.dte - 30) < Math.abs(a.dte - 30) ? b : a)); // nearest ~30 DTE
        row.listedIV = +(pick.atmIV as number).toFixed(4);
      }
    } catch { /* no chain → listed IV stays null, the Edge column shows n/a for this name */ }
  }

  rows.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  const data: ConvertiblesData = { generatedAt: new Date(now).toISOString(), rows };
  await fsp.writeFile(path.join(process.cwd(), "data", "convertibles.json"), JSON.stringify(data, null, 2));
  console.log(`convertibles: wrote ${rows.length} rows → data/convertibles.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
