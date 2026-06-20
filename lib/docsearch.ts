/**
 * Full-text search across SEC filings (AlphaSense / Sentieo style). Uses EDGAR's
 * free full-text search API (EFTS, https://efts.sec.gov/LATEST/search-index),
 * which indexes every filing since 2001. Phrases must be quoted; spaces in the
 * query must be %20 (a literal + 500s). The entity filter is `ciks` (10-digit,
 * zero-padded). EFTS returns filing metadata only — no snippets — so we fetch a
 * context snippet from the matched document on demand.
 */
import { tickerToCik } from "./edgar";

const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };

export interface DocHit {
  name: string;
  ticker: string | null;
  cik: string;
  form: string;
  date: string;
  accession: string;
  filename: string;
  url: string;
}

export interface DocSearchResult {
  query: string;
  total: number; // EFTS caps the reported total at 10000
  hits: DocHit[];
  from: number;
  nextFrom: number | null;
}

function parseDisplayName(dn: string): { name: string; ticker: string | null } {
  // e.g. "Apple Inc.  (AAPL)  (CIK 0000320193)"
  const ticker = (dn.match(/\(([A-Z][A-Z.\-]{0,5})\)\s*\(CIK/) || [])[1] || null;
  const name = dn
    .replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
    .replace(/\s*\([A-Z][A-Z.\-]{0,5}\)\s*$/, "")
    .trim();
  return { name, ticker };
}

const PAGE = 100; // EFTS returns up to 100 hits per page

export async function searchFilings(
  q: string,
  opts: { ticker?: string; forms?: string; from?: number } = {},
): Promise<DocSearchResult> {
  const query = q.trim();
  const from = Math.max(0, opts.from || 0);
  if (!query) return { query, total: 0, hits: [], from, nextFrom: null };

  let ciks: string | null = null;
  if (opts.ticker) ciks = await tickerToCik(opts.ticker);

  const params = new URLSearchParams();
  params.set("q", query);
  if (opts.forms) params.set("forms", opts.forms);
  if (ciks) params.set("ciks", ciks);
  if (from) params.set("from", String(from));
  // URLSearchParams encodes spaces as '+', which EFTS rejects inside q.
  const qs = params.toString().replace(/\+/g, "%20");

  try {
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${qs}`, { headers: HEADERS });
    if (!res.ok) return { query, total: 0, hits: [], from, nextFrom: null };
    const j: any = await res.json();
    const total: number = j?.hits?.total?.value ?? 0;
    const hits: DocHit[] = (j?.hits?.hits || []).map((h: any) => {
      const s = h._source || {};
      const { name, ticker } = parseDisplayName((s.display_names || [])[0] || "");
      const cik = String(s.ciks?.[0] || "").replace(/^0+/, "") || "0";
      const [accession, filename] = String(h._id || "").split(":");
      const accNo = (accession || "").replace(/-/g, "");
      return {
        name,
        ticker,
        cik,
        form: s.form || (s.root_forms || [])[0] || "",
        date: s.file_date || "",
        accession: accession || "",
        filename: filename || "",
        url: filename ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}/${filename}` : "",
      };
    });
    // EFTS (Elasticsearch) allows from+size up to 10000.
    const nextFrom = hits.length === PAGE && from + PAGE < Math.min(total, 10000) ? from + PAGE : null;
    return { query, total, hits, from, nextFrom };
  } catch {
    return { query, total: 0, hits: [], from, nextFrom: null };
  }
}

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return " ";
      }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return " ";
      }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A ~360-char context snippet around the query's first occurrence in a filing.
 *  SSRF-guarded to EDGAR archives. Returns null if the doc or term isn't found. */
export async function getDocSnippet(url: string, q: string): Promise<string | null> {
  if (!/^https:\/\/www\.sec\.gov\/Archives\//.test(url)) return null;
  const term = q.replace(/(^["']|["']$)/g, "").trim();
  if (!term) return null;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const text = strip(await res.text());
    const low = text.toLowerCase();
    let i = low.indexOf(term.toLowerCase());
    let len = term.length;
    if (i < 0) {
      const w = term.split(/\s+/)[0];
      i = w ? low.indexOf(w.toLowerCase()) : -1;
      len = w.length;
      if (i < 0) return null;
    }
    const start = Math.max(0, i - 150);
    const end = Math.min(text.length, i + len + 210);
    let s = text.slice(start, end).trim();
    if (start > 0) s = "… " + s;
    if (end < text.length) s += " …";
    return s;
  } catch {
    return null;
  }
}
