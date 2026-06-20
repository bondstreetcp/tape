/**
 * Revenue by business segment / product / geography, parsed from a company's
 * latest 10-K. SEC renders each filing's footnote tables as structured "R-files"
 * (the EDGAR viewer's HTML), and the disaggregation/segment "(Details)" tables
 * follow a consistent shape: a segment-name row (e.g. "iPhone", "Data Center")
 * followed by a "Net sales / Revenue" row with one value per fiscal year. We key
 * off that pattern, which generalizes across most large filers.
 */
import * as cheerio from "cheerio";
import { tickerToCik, getFilings } from "./edgar";

const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };

export interface SegmentRow { name: string; values: (number | null)[] }
export interface SegmentBreakdown { title: string; periods: string[]; rows: SegmentRow[]; total: (number | null)[] | null }
export interface Segments { asOf: string; form: string; url: string; product: SegmentBreakdown | null; geographic: SegmentBreakdown | null }

const parseNum = (s: string): number | null => {
  const m = s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : null;
};

const KEYWORD = /disaggregation|line items|segment reporting|abstract|geographic area|reportable segment|\[member\]/i;
const VALUEROW = /^(net sales|revenues?|total net sales|total revenues?|net revenue|sales)$/i;

function parseTable(html: string): { periods: string[]; rows: SegmentRow[]; total: (number | null)[] | null } {
  const $ = cheerio.load(html);
  const trs = $("table tr")
    .toArray()
    .map((tr) => $(tr).find("td, th").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get().filter((x) => x !== ""));

  let periods: string[] = [];
  for (const cells of trs) {
    const yrs = cells.filter((c) => /\b\d{4}\b/.test(c) && /^[A-Za-z.,'\s\d]+$/.test(c));
    if (yrs.length >= 2) {
      periods = yrs.map((c) => (c.match(/\b\d{4}\b/) || [c])[0]);
      break;
    }
  }

  const rows: SegmentRow[] = [];
  let total: (number | null)[] | null = null;
  let cur: string | null = null;
  for (const cells of trs) {
    if (cells.length === 1) {
      const label = cells[0];
      if (!KEYWORD.test(label) && !VALUEROW.test(label) && !/^[$\d(]/.test(label) && label.length <= 42) cur = label;
      continue;
    }
    if (VALUEROW.test(cells[0])) {
      const vals = cells.slice(1).map(parseNum).filter((v): v is number => v != null);
      if (vals.length) {
        const clean = (cur || "").split(/\s*\|\s*/)[0].trim();
        if (cur && clean && !/^(operating |reportable |business )?segments?$|^total\b|^consolidated$|^all other$/i.test(clean)) {
          rows.push({ name: clean, values: vals });
        } else if (!total) {
          total = vals;
        }
      }
      cur = null;
    }
  }
  return { periods, rows, total };
}

async function fetchReportTable(base: string, file: string, title: string): Promise<SegmentBreakdown | null> {
  try {
    const html = await (await fetch(`${base}/${file}`, { headers: HEADERS })).text();
    const { periods, rows, total } = parseTable(html);
    // Need at least two named segments to be meaningful.
    if (rows.length < 2) return null;
    return { title, periods: periods.slice(0, 4), rows: rows.map((r) => ({ ...r, values: r.values.slice(0, 4) })), total: total?.slice(0, 4) ?? null };
  } catch {
    return null;
  }
}

export async function getSegments(symbol: string): Promise<Segments | null> {
  const cik = await tickerToCik(symbol);
  if (!cik) return null;
  try {
    const { filings } = await getFilings(symbol, 0, 120);
    const filing = filings.find((f) => f.form === "10-K") || filings.find((f) => f.form === "10-Q");
    if (!filing) return null;
    const accNo = filing.acc.replace(/-/g, "");
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}`;

    const fs = await (await fetch(`${base}/FilingSummary.xml`, { headers: HEADERS })).text();
    const reports = [...fs.matchAll(/<Report[^>]*>([\s\S]*?)<\/Report>/g)].map((r) => ({
      name: (r[1].match(/<ShortName>([^<]+)/) || [])[1] || "",
      file: (r[1].match(/<HtmlFileName>([^<]+)/) || [])[1] || "",
    }));
    const pick = (re: RegExp) => reports.find((r) => re.test(r.name) && /\(details\)/i.test(r.name) && r.file);

    const prodR = pick(/disaggregat|by (product|major|type)|net sales by (category|product)/i);
    const geoR = pick(/reportable segment|geographic|by segment|net sales for countries|by reportable/i);

    const [product, geographic] = await Promise.all([
      prodR ? fetchReportTable(base, prodR.file, prodR.name.replace(/\s*\(details\).*/i, "").trim()) : Promise.resolve(null),
      geoR ? fetchReportTable(base, geoR.file, geoR.name.replace(/\s*\(details\).*/i, "").trim()) : Promise.resolve(null),
    ]);
    if (!product && !geographic) return null;

    return { asOf: filing.date, form: filing.form, url: filing.url, product, geographic };
  } catch {
    return null;
  }
}
