/**
 * Comp OUTLOOK extraction — the comparable-sales guide (upcoming quarter + fiscal year) read from the same
 * 8-K Ex-99.1 text the SSS extractor reads, feeding SssTicker.guide for the 2-yr stack analyzer
 * (lib/compStack). The prompt, the schema, the keyword windowing and the TESTED sanitizer live here (pure,
 * fs-free — see tests/compGuide.test.ts) so scripts/refresh-sss.ts stays an orchestrator and the guards
 * can't drift from it. Doctrine: models propose, code verifies — every % and $ figure must literally
 * appear in the release (numberGroundedIn), a quote must ground or it's dropped, and only a
 * comparable-/same-store-sales metric qualifies (never "net sales growth" or "system-wide sales").
 */
import { boundedNumber, coerceEnum, groundedQuote, numberGroundedIn, str } from "./llmValidate";
import { isCompMetricLabel, type SssGuide, type SssGuideRange } from "./sameStoreSales";

export const COMP_GUIDE_SYSTEM =
  "You extract management's COMPARABLE-SALES OUTLOOK (a.k.a. same-store sales / comps / identical sales / like-for-like guidance) from a retailer's or restaurant's quarterly earnings press release. Return ONE JSON object: {metricLabel, nextQ, fy, ytdComp, netNewUnits, confidence}. " +
  "'nextQ' = the outlook for the single UPCOMING fiscal quarter (the quarter AFTER the one just reported), or null if none is given. " +
  "'fy' = the outlook for the FULL fiscal year — the year the just-reported quarter belongs to; on a FOURTH-QUARTER / year-end release it is the NEXT fiscal year being guided. null if none. " +
  "For each: 'label' = the period as the company frames it, short (e.g. 'Q3 FY26', 'FY2026'). 'compLow'/'compHigh' = the comparable-sales growth range in PERCENT, SIGNED ('+8% to +10%' → 8 / 10; 'approximately 3%' → 3 / 3; 'flat to up 2%' → 0 / 2; 'down 2% to 4%' → -4 / -2). If the outlook is only QUALITATIVE ('low-single-digit', 'modestly positive') set compLow/compHigh = null and keep the words in 'quote' — NEVER convert words to numbers. " +
  "'priorCompLow'/'priorCompHigh' (fy only) = the PRIOR outlook's comparable-sales range when the release shows one (a 'Prior Outlook' column, or 'from X% to Y% previously'); else null. " +
  "'revLowM'/'revHighM' = the NET SALES / REVENUE guide for that same period in MILLIONS of USD ('$5.63 billion to $5.71 billion' → 5630 / 5710; a single point → both); null if none. " +
  "'quote' = the VERBATIM sentence or table fragment stating that outlook. " +
  "'ytdComp' = the year-to-date comparable-sales % if the release explicitly states one for the fiscal year so far (a 26-/39-week figure), else null. " +
  "'netNewUnits' = the planned NET NEW stores / units / restaurants for the fiscal year if stated ('approximately 150 net new stores' → 150), else null. " +
  "'metricLabel' = the company's OWN term for the metric guided (e.g. 'comparable sales', 'same-restaurant sales'). 'confidence' = high | medium | low. " +
  "Use ONLY the comparable-/same-store-sales metric — NOT total net sales growth, system-wide sales, or revenue growth. NEVER compute, infer, annualize, or estimate a number: a figure goes in compLow/compHigh/revLowM/revHighM ONLY if it is written in the text as guidance. If the release gives no comparable-sales outlook at all, return nextQ = null and fy = null.";

export const COMP_GUIDE_SCHEMA =
  'Return ONLY JSON (a single object): {"metricLabel": string|null, "nextQ": {"label": string, "compLow": number|null, "compHigh": number|null, "revLowM": number|null, "revHighM": number|null, "quote": string|null}|null, "fy": {"label": string, "compLow": number|null, "compHigh": number|null, "priorCompLow": number|null, "priorCompHigh": number|null, "revLowM": number|null, "revHighM": number|null, "quote": string|null}|null, "ytdComp": number|null, "netNewUnits": number|null, "confidence": "high"|"medium"|"low"}';

const KW = /outlook|guidance|expect|anticipat|forecast|comparable|same[- ]?(store|restaurant|shop)|identical sales|like[- ]for[- ]like|fiscal 20\d\d|full[- ]year|year[- ]to[- ]date|net new (stores|units|restaurants|locations)|prior outlook/i;

/** Keyword windows around outlook + comp language, with the release header prepended (the dateline says which
 *  quarter was just reported, so the model can name the NEXT one). Same shape as the SSS/guidance windowing. */
export function compGuideWindows(text: string, pad = 1000, cap = 14000): string {
  const hits: [number, number][] = [];
  const re = new RegExp(KW.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + pad);
    if (hits.length && s <= hits[hits.length - 1][1]) hits[hits.length - 1][1] = e;
    else hits.push([s, e]);
    if (hits.reduce((a, [x, y]) => a + (y - x), 0) > cap) break;
  }
  const head = text.slice(0, 1300);
  if (!hits.length) return (head + "\n…\n" + text.slice(0, cap)).slice(0, cap);
  return (head + "\n…\n" + hits.map(([s, e]) => text.slice(s, e)).join("\n…\n")).slice(0, cap);
}

// A comp % must be a plausible comparable-sales figure AND literally present in the release. Zero has no
// digits to ground ("flat"), so it grounds on the word instead.
const pct = (v: unknown) => boundedNumber(v, { absMax: 60 });
const groundedPct = (v: number, text: string): boolean =>
  v === 0 ? /\bflat\b|(?<![\d.])0(?:\.0)?\s?%/i.test(text) : numberGroundedIn(v, text);

/** Both bounds present, ordered, plausible and grounded — else the pair is dropped (a half-range misleads). */
function pctRange(lo: unknown, hi: unknown, text: string): [number, number] | null {
  let a = pct(lo), b = pct(hi);
  if (a == null || b == null) return null;
  if (a > b) [a, b] = [b, a];
  return groundedPct(a, text) && groundedPct(b, text) ? [a, b] : null;
}

/** A revenue guide in $M: within $1M–$1T, ordered, and grounded (numberGroundedIn also accepts the billions form). */
function revRange(lo: unknown, hi: unknown, text: string): [number, number] | null {
  let a = boundedNumber(lo, { min: 1, max: 1_000_000 }), b = boundedNumber(hi, { min: 1, max: 1_000_000 });
  if (a == null || b == null) return null;
  if (a > b) [a, b] = [b, a];
  return numberGroundedIn(a, text) && numberGroundedIn(b, text) ? [a, b] : null;
}

function range(o: unknown, text: string, fallbackLabel: string, compOk: boolean): SssGuideRange | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const comp = compOk ? pctRange(r.compLow, r.compHigh, text) : null;
  const prior = compOk ? pctRange(r.priorCompLow, r.priorCompHigh, text) : null;
  const rev = revRange(r.revLowM, r.revHighM, text);
  const quote = groundedQuote(r.quote, text);
  if (!comp && !rev && !quote) return null; // nothing usable
  return {
    label: str(r.label).slice(0, 16) || fallbackLabel,
    compLow: comp ? comp[0] : null,
    compHigh: comp ? comp[1] : null,
    priorCompLow: prior ? prior[0] : null,
    priorCompHigh: prior ? prior[1] : null,
    revLowM: rev ? rev[0] : null,
    revHighM: rev ? rev[1] : null,
    quote: quote ? quote.slice(0, 400) : null,
  };
}

/**
 * Turn the model's reply into a stored SssGuide. Returns null ONLY when the reply isn't an object at all
 * (a transport / parse failure — the caller must not stamp the accession, so it retries next run). A
 * well-formed reply with nothing usable yields an EMPTY guide (nextQ = fy = null) that IS stamped: "checked,
 * none disclosed" must not re-bill every night.
 */
export function sanitizeCompGuide(raw: unknown, text: string, src: { accession: string; date: string; url: string }): SssGuide | null {
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const metricLabel = str(r.metricLabel).slice(0, 60) || null;
  // A named metric that ISN'T a comp (the model guided "net sales growth") disqualifies the % ranges; the
  // $ ranges and quotes survive. An unnamed metric is accepted — the prompt asks for comps specifically.
  const compOk = metricLabel == null || isCompMetricLabel(metricLabel);
  const nextQ = range(r.nextQ, text, "next quarter", compOk);
  const fy = range(r.fy, text, "fiscal year", compOk);
  const ytd = pct(r.ytdComp);
  const units = boundedNumber(r.netNewUnits, { min: 0, max: 5000 });
  let confidence = coerceEnum(r.confidence, ["high", "medium", "low"] as const, "medium");
  if (confidence === "high" && !nextQ?.quote && !fy?.quote) confidence = "medium"; // "high" without a citable line is not high
  return {
    accession: src.accession,
    date: src.date,
    url: src.url,
    nextQ,
    fy,
    ytdComp: ytd != null && groundedPct(ytd, text) ? ytd : null,
    netNewUnits: units != null && numberGroundedIn(units, text) ? units : null,
    metricLabel,
    confidence,
  };
}
