/**
 * Shared EDGAR filing gatherers for the spin-off surfaces — extracted from the spinoff-report and
 * company-briefing routes so the two-entity spin preview reads the SAME documents the single-entity
 * briefings do (Next route files may only export handlers, so shared fetchers live here).
 * SERVER-ONLY (network).
 */
import { getSubmissions, fetchWithRetry, htmlToText } from "./edgar";

export interface FilingText { url: string; date: string; form: string; text: string }

/** Latest Form 10 (10-12B) for a CIK → the info statement text (primary doc + the largest HTML
 *  exhibit, which is where a spin's real disclosure lives), full-length (htmlToText's default cap
 *  hides deep sections). */
export async function gatherForm10(cik: string): Promise<FilingText | null> {
  const sub = await getSubmissions(cik).catch(() => null);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) if (r.form[i] === "10-12B" || r.form[i] === "10-12B/A") { idx = i; break; }
  if (idx < 0) return null;
  const acc = r.accessionNumber[idx].replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
  let text = "";
  try {
    const dir = await (await fetchWithRetry(`${base}/index.json`, 2)).json();
    const items: any[] = dir?.directory?.item || [];
    const htmls = items.filter((f) => /\.html?$/i.test(f.name) && !/^R\d+\.htm/i.test(f.name)).sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
    const picks = [...new Set([r.primaryDocument[idx], htmls[0]?.name].filter(Boolean))].slice(0, 2);
    for (const name of picks) {
      const res = await fetchWithRetry(`${base}/${name}`, 2).catch(() => null);
      if (res?.ok) text += "\n\n" + htmlToText(await res.text(), 1_200_000);
    }
  } catch { /* fall through */ }
  if (text.replace(/\s/g, "").length < 4000) return null;
  return { url: `${base}/${r.primaryDocument[idx]}`, date: r.filingDate[idx], form: r.form[idx], text };
}

/** Latest 10-K (or 20-F) for a CIK → its text (primary doc, full-length — the default cap hides the
 *  deep Item 1/1A/7 sections a 10-K buries hundreds of pages in). 10-K/A amendments count too. */
export async function gather10K(cik: string): Promise<FilingText | null> {
  const sub = await getSubmissions(cik).catch(() => null);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) if (r.form[i] === "10-K" || r.form[i] === "10-K/A" || r.form[i] === "20-F") { idx = i; break; }
  if (idx < 0) return null;
  const acc = r.accessionNumber[idx].replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
  const doc = r.primaryDocument[idx];
  if (!doc) return null;
  try {
    const res = await fetchWithRetry(`${base}/${doc}`, 2);
    if (!res.ok) return null;
    const text = htmlToText(await res.text(), 1_500_000);
    if (text.replace(/\s/g, "").length < 4000) return null;
    return { url: `${base}/${doc}`, date: r.filingDate[idx], form: r.form[idx], text };
  } catch { return null; }
}
