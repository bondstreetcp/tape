/**
 * SERVER-ONLY. Discover convertible-note OFFERINGS on EDGAR (full-text search) and LLM-extract their
 * economic terms from the filing — the data half of the Convertible & Capped-Call Watch. Same pattern
 * as the guidance / spin-off extractors: find the filing, pull the body text, ask the model for ONLY
 * the disclosed figures (never an estimate). Feeds scripts/refresh-convertibles.ts.
 */
import { chatJSON, FLASH_MODEL } from "./llm";
import { eftsSearch, type EftsHit } from "./edgarSearch";

export interface RawConvTerms {
  coupon: number | null; // annual %, as stated (0.50 = 0.50%, 0 = zero-coupon)
  conversionPrice: number | null; // per share, $
  premium: number | null; // conversion premium, % above the reference price
  refPrice: number | null; // reference/last-sale stock price used to set the conversion price, $
  maturity: string | null; // ISO YYYY-MM-DD
  sizeMM: number | null; // aggregate principal, $ millions
  cappedCallCap: number | null; // capped-call / call-spread CAP price (upper strike), $, if any
  par: number | null; // denomination, usually 1000
  cusip: string | null; // the notes' 9-char CUSIP, for the FINRA TRACE lookup
}

const SYSTEM =
  "You extract the economic terms of a CONVERTIBLE NOTE offering from an SEC filing (8-K / 424B / press release). " +
  "Return ONLY figures the document actually states — never estimate or infer a number that isn't there (use null). " +
  "First decide 'isConvertible': true ONLY if this filing is the COMPANY'S OWN convertible senior notes / convertible bond offering (NOT a mention of someone else's, NOT a straight-debt or common-stock offering). If false, set every other field null. Fields: " +
  "'coupon' = annual interest rate in PERCENT (0.50 for 0.50%; 0 for a zero-coupon note). " +
  "'conversionPrice' = the initial conversion price per share, in $. " +
  "'premium' = the conversion premium in PERCENT above the reference/last-sale price (e.g. 35 for ~35%). " +
  "'refPrice' = the reference stock price used to set the conversion price ('the last reported sale price on <date>'), in $. " +
  "'maturity' = the maturity date as ISO YYYY-MM-DD. " +
  "'sizeMM' = aggregate principal in $ MILLIONS (1500 for $1.5 billion; use the total including any greenshoe that the filing states was exercised). " +
  "'cappedCallCap' = if the company entered CAPPED CALL or call-spread / bond-hedge transactions alongside the notes, the CAP price (the upper strike) per share in $; otherwise null. " +
  "'par' = the note denomination, usually 1000. " +
  "'cusip' = the notes' CUSIP (a 9-character alphanumeric identifier for the notes themselves, often near 'CUSIP No.') if the filing states it, else null.";
const SCHEMA =
  '\n\nReturn ONLY JSON: {"isConvertible": boolean, "coupon": number|null, "conversionPrice": number|null, "premium": number|null, "refPrice": number|null, "maturity": string|null, "sizeMM": number|null, "cappedCallCap": number|null, "par": number|null, "cusip": string|null}';

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** LLM-extract convert terms from a filing's body text. null if it isn't a real convertible offering
 *  or has no usable conversion price. */
export async function extractConvertibleTerms(text: string): Promise<RawConvTerms | null> {
  const out = await chatJSON<any>(SYSTEM, text.slice(0, 24000) + SCHEMA, { maxTokens: 700, model: FLASH_MODEL, reasoningEffort: "low", retries: 1 }).catch(() => null);
  if (!out || out.isConvertible !== true) return null;
  const conversionPrice = num(out.conversionPrice);
  if (conversionPrice == null || conversionPrice <= 0) return null; // no conversion price → unusable
  return {
    coupon: num(out.coupon),
    conversionPrice,
    premium: num(out.premium),
    refPrice: num(out.refPrice),
    maturity: typeof out.maturity === "string" && /^\d{4}-\d{2}-\d{2}/.test(out.maturity) ? out.maturity.slice(0, 10) : null,
    sizeMM: num(out.sizeMM),
    cappedCallCap: num(out.cappedCallCap),
    par: num(out.par),
    cusip: typeof out.cusip === "string" && /^[0-9A-Z]{9}$/i.test(out.cusip.trim()) ? out.cusip.trim().toUpperCase() : null,
  };
}

/** Recent convertible-note offerings via EDGAR full-text search — every distinct filing (deduped only on
 *  accession), newest first. We deliberately DON'T collapse per issuer here: a serial issuer (MSTR/COIN)
 *  has several separate deals, and their identity (the maturity) isn't known until the terms are extracted.
 *  refresh-convertibles extracts each, then `dedupeConvertibleRows` collapses a single deal's launch/upsize/
 *  pricing filings by (ticker, maturity). The 424B* pricing prospectus carries the final terms; the 8-K
 *  catches issuers who only press-release. */
export async function discoverConvertibleFilings(startdt: string, enddt: string): Promise<EftsHit[]> {
  const hits = await eftsSearch({ q: '"convertible senior notes"', forms: "424B5,424B2,424B3,8-K", startdt, enddt });
  const byAccession = new Map<string, EftsHit>();
  for (const h of hits) if (!byAccession.has(h.accession)) byAccession.set(h.accession, h);
  return [...byAccession.values()].sort((a, b) => b.date.localeCompare(a.date)); // newest first (so a cap keeps the freshest)
}
