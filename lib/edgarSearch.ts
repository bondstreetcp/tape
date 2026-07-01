/**
 * EDGAR full-text search (efts.sec.gov) — a shared helper for the event-driven monitors that scan for
 * a filing type or phrase market-wide (investor days, buybacks, strategic-alternatives, spin-offs,
 * splits, CEO changes, IPOs). Reuses lib/edgar's retry + SEC User-Agent. Server-only.
 *
 * EFTS quirks: form types use the MODERNIZED names ("SCHEDULE 13D", not "SC 13D"); results are the
 * newest matching filings; each hit's _id is `accession:primaryDoc`; display_names[i] carries the
 * ticker in parentheses.
 */
import { fetchWithRetry } from "@/lib/edgar";

export interface EftsHit {
  accession: string;
  doc: string; // primary document filename
  form: string;
  date: string; // filing date YYYY-MM-DD
  issuer: string; // cleaned name of the tickered party (the public company)
  ticker: string | null;
  others: string; // the other named parties (filer/activist)
  ciks: string[];
}

// "Newegg Commerce, Inc.  (NEGG)  (CIK 0001474627)" → { name, ticker }
export function parseDisplayName(dn: string): { name: string; ticker: string | null } {
  let ticker: string | null = null;
  for (const m of dn.matchAll(/\(([^)]+)\)/g)) {
    const p = m[1].trim();
    if (/^CIK/i.test(p)) continue;
    const first = p.split(",")[0].trim();
    if (/^[A-Z][A-Z0-9.\-]{0,5}$/.test(first)) { ticker = first; break; }
  }
  return { name: dn.replace(/\s*\([^)]*\)/g, "").trim(), ticker };
}

// Build the archive URL for a filing's primary document (try the issuer/filer CIKs in turn upstream).
export function edgarDocUrl(cik: string, accession: string, doc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`;
}

/** Full-text search. Pass `forms` (comma/space form list), and/or `q` (phrase in quotes for exact). */
export async function eftsSearch(opts: { forms?: string; q?: string; startdt: string; enddt: string }): Promise<EftsHit[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.forms) params.set("forms", opts.forms);
  params.set("startdt", opts.startdt);
  params.set("enddt", opts.enddt);
  const url = `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
  let res: Response;
  try { res = await fetchWithRetry(url); } catch { return []; }
  if (!res.ok) return [];
  const j = await res.json().catch(() => null);
  const hits: any[] = j?.hits?.hits || [];
  const out: EftsHit[] = [];
  for (const h of hits) {
    const src = h._source || {};
    const dns: string[] = src.display_names || [];
    const parsed = dns.map(parseDisplayName);
    const iIdx = parsed.findIndex((p) => p.ticker);
    const issuer = parsed[iIdx >= 0 ? iIdx : 0] || { name: dns[0] || "?", ticker: null };
    const others = parsed.filter((_, i) => i !== (iIdx >= 0 ? iIdx : 0)).map((p) => p.name).join(", ");
    const [accession, doc] = String(h._id || "").split(":");
    if (!accession || !doc) continue;
    out.push({ accession, doc, form: src.form || "", date: src.file_date || "", issuer: issuer.name, ticker: issuer.ticker, others, ciks: src.ciks || [] });
  }
  return out;
}

// Fetch a filing document as stripped text — tries each CIK on the filing (issuer/filer both work).
export async function fetchDocText(hit: EftsHit): Promise<string> {
  for (const cik of hit.ciks) {
    try { const res = await fetchWithRetry(edgarDocUrl(cik, hit.accession, hit.doc), 2); if (res.ok) return stripHtml(await res.text()); } catch { /* next */ }
  }
  return "";
}

// Fetch the filing's BODY text — the primary doc PLUS the largest exhibit (an 8-K's real content —
// the press release / deck stating the event date — usually lives in EX-99.1, not the cover doc).
export async function fetchFilingBodyText(hit: EftsHit): Promise<string> {
  for (const cik of hit.ciks) {
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${hit.accession.replace(/-/g, "")}`;
    try {
      const idx = await (await fetchWithRetry(`${base}/index.json`, 2)).json();
      const items: any[] = idx?.directory?.item || [];
      const htmls = items.filter((f) => /\.html?$/i.test(f.name) && !/^R\d+\.htm/i.test(f.name)).sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
      if (!htmls.length) continue;
      const primary = htmls.find((f) => f.name === hit.doc);
      const ex99 = htmls.find((f) => /ex.?99|ex99|press|exhibit/i.test(f.name)) || htmls[0];
      const picks = [...new Set([primary?.name, ex99?.name].filter(Boolean))].slice(0, 2);
      let text = "";
      for (const name of picks) { const r = await fetchWithRetry(`${base}/${name}`, 2); if (r.ok) text += "\n" + stripHtml(await r.text()); }
      if (text.trim()) return text.trim();
    } catch { /* try next cik */ }
  }
  return fetchDocText(hit);
}
export function stripHtml(html: string): string {
  return (html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
