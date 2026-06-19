/**
 * Parser for an iShares IWV (Russell 3000 ETF) holdings export, used to build the
 * optional `russell3000` universe. Handles both the plain-CSV download and the
 * "fund.xls" download, which is actually a SpreadsheetML (Office XML) workbook.
 * Kept separate from fetch-constituents so it can be unit-tested.
 *
 * Get the file from the IWV fund page on ishares.com (Holdings → "Detailed
 * Holdings and Analytics" → Download) and save it as data/iwv-holdings.xls
 * (or .csv).
 */
import * as cheerio from "cheerio";

export interface Entry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}

export type Gics = Map<string, { sector: string; industry: string; name: string }>;

export function norm(sym: string): string {
  return sym
    .trim()
    .toUpperCase()
    .replace(/\./g, "-")
    .replace(/[^A-Z0-9-]/g, "");
}

// iShares' "Sector" column is GICS-named except "Communication"; normalize so it
// maps through the app's GICS→ETF table.
const ISHARES_SECTOR_TO_GICS: Record<string, string> = {
  Communication: "Communication Services",
};

/** Split one CSV line, honoring quoted fields and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Rows from a SpreadsheetML (Office XML) workbook — iShares' "fund.xls". */
function rowsFromSpreadsheetML(xml: string): string[][] {
  // Strip the "ss:" namespace prefix so tags/attrs are plain (Row/Cell/Data/Index).
  const $ = cheerio.load(xml.replace(/ss:/g, ""), { xmlMode: true });
  const rows: string[][] = [];
  $("Row").each((_, row) => {
    const cells: string[] = [];
    let idx = 0;
    $(row)
      .children("Cell")
      .each((_, cell) => {
        const ix = $(cell).attr("Index"); // sparse cells skip columns
        if (ix) {
          const n = parseInt(ix, 10) - 1;
          while (idx < n) { cells.push(""); idx++; }
        }
        cells.push($(cell).children("Data").first().text().trim());
        idx++;
      });
    rows.push(cells);
  });
  return rows;
}

/** Normalize either format into rows of string cells. */
export function toRows(text: string): string[][] {
  const t = text.trimStart();
  if (t.startsWith("<?xml") || t.includes("urn:schemas-microsoft-com:office:spreadsheet"))
    return rowsFromSpreadsheetML(text);
  return text.split(/\r?\n/).map(parseCsvLine);
}

/**
 * Parse IWV holdings rows into classified entries. Sub-industry isn't in the
 * file, so symbols already in the GICS map keep their real sub-industry; the rest
 * fall back to sector-level grouping.
 */
export function parseIWV(rows: string[][], gics: Gics): Entry[] {
  let hi = -1;
  let cols: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].map((x) => x.toLowerCase());
    if (c.includes("ticker") && (c.includes("asset class") || c.includes("sector"))) {
      hi = i;
      cols = c;
      break;
    }
  }
  if (hi < 0) throw new Error("IWV holdings: header row (Ticker,…) not found");
  const ix = (n: string) => cols.indexOf(n);
  const tI = ix("ticker"), nI = ix("name"), sI = ix("sector"), aI = ix("asset class");

  const out: Entry[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.length <= tI) continue;
    if (aI >= 0 && cells[aI] && cells[aI].toLowerCase() !== "equity") continue; // skip cash/futures
    const symbol = norm(cells[tI] || "");
    if (!symbol || !/[A-Z]/.test(symbol) || /^(USD|CASH|MARGIN|XTSLA)/.test(symbol)) continue;
    const g = gics.get(symbol);
    const rawSec = sI >= 0 ? cells[sI] || "" : "";
    const ish = ISHARES_SECTOR_TO_GICS[rawSec] || rawSec;
    out.push({
      symbol,
      name: (nI >= 0 ? cells[nI] : "") || g?.name || symbol,
      sector: g?.sector || ish || "",
      industry: g?.industry || ish || "Other",
    });
  }
  if (out.length < 500) throw new Error(`IWV holdings: only parsed ${out.length} equities — wrong file/sheet?`);
  return out;
}
