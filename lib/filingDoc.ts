/**
 * Latest 10-K / 10-Q as readable text for AI summarization. Resolves the ticker's
 * CIK, finds the newest annual/quarterly report in EDGAR submissions, fetches its
 * primary document and strips the HTML to text (paragraph breaks preserved).
 *
 * We deliberately do NOT try to surgically isolate MD&A / risk factors here — the
 * summary model has a long context window, so it reads the whole filing and locates
 * the discussion, guidance and risk sections itself. We only bound the size to keep
 * the summary call inside the route's time budget.
 */
import { tickerToCik, getSubmissions, fetchWithRetry } from "./edgar";

const MAX_CHARS = 180_000; // ~45k tokens — the meat of a 10-K (business, risks, MD&A) fits well inside this

export type FilingForm = "10-K" | "10-Q";

export interface FilingDoc { form: string; date: string; url: string; text: string }

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…",
};
const ch = (cp: number) => {
  try {
    return cp >= 32 ? String.fromCodePoint(cp) : " ";
  } catch {
    return " ";
  }
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => ch(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => ch(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (_m, n) => NAMED[n.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The newest 10-K (or 10-Q) as text. Returns null if the ticker has no CIK, no
 *  such filing on file, or the document couldn't be fetched/parsed. */
export async function getFilingDoc(symbol: string, form: FilingForm): Promise<FilingDoc | null> {
  const cik = await tickerToCik(symbol);
  if (!cik) return null;
  let sub: any;
  try {
    sub = await getSubmissions(cik); // cached + retrying (shared with the rest of the EDGAR layer)
  } catch {
    return null;
  }
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  // submissions.recent is newest-first; prefer the clean form, fall back to an amendment.
  let idx = r.form.indexOf(form);
  if (idx < 0) idx = r.form.indexOf(`${form}/A`);
  if (idx < 0) return null;
  const accNo = r.accessionNumber[idx].replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}/${r.primaryDocument[idx]}`;
  try {
    const text = htmlToText(await (await fetchWithRetry(url)).text()).slice(0, MAX_CHARS);
    if (text.length < 1000) return null;
    return { form: r.form[idx], date: r.filingDate[idx], url, text };
  } catch {
    return null;
  }
}
