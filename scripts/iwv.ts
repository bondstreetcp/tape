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

/**
 * Is this "ticker" actually a date that SpreadsheetML flattened into a string?
 *
 * The IWV export's ticker column holds a maturity date on derivative and cash-management rows, and
 * `norm()` strips the separators, so "30-Apr-2001" arrives as "APR302001". These look enough like
 * symbols to pass a letters-present test — measured 2026-07-30, **313 of them** were sitting in the
 * Russell 3000 constituent list.
 *
 * Matched conservatively: a real ticker is at most 5 characters plus an optional class suffix, so
 * nothing legitimate is 8+ characters beginning with a month abbreviation. The length floor matters —
 * "MAY", "MARCH" and "JUNE" style roots do exist as real symbols and must not be caught.
 */
const MONTH = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";
const DATE_LIKE = new RegExp(`^(?:${MONTH})\\d{4,8}$|^\\d{1,2}(?:${MONTH})\\d{2,4}$|^\\d{6,8}$`);

export function isDateLikeSymbol(symbol: string): boolean {
  return DATE_LIKE.test(symbol);
}

/**
 * Share classes iShares spells without a separator but Yahoo spells WITH a dash.
 *
 * iShares writes "BRKB"; Yahoo (and therefore every price, chart and screen in this repo) needs
 * "BRK-B". `norm()` maps "." → "-" and so rescues a "BRK.B", but it cannot invent a separator that
 * was never there — so these names were quoted under a symbol that does not exist, failed, and were
 * dropped every single night. **Berkshire Hathaway B — $1.1tn — has never been in the Russell 3000
 * universe.** Nothing flagged it, because a dropped row is indistinguishable from a name the index
 * does not list.
 *
 * ⚠ THIS IS A DECLARED MAP AND NOT A RULE, DELIBERATELY. The obvious heuristic — "the holdings name
 * says CLASS A and the symbol ends in A, so insert a dash" — was tested against the live file and is
 * CATASTROPHICALLY WRONG: of 34 rows matching it, **27 are already correct on Yahoo unseparated**
 * (NWSA, FOXA, UAA, LBTYA, CENTA, RUSHA, …) and two would be rewritten into a different company's
 * ticker — META → "MET-A" (MetLife) and MA → "M-A" (Mastercard). Dashed-vs-unseparated is an arbitrary
 * per-name vendor convention with no textual signal, so the only safe source is verification.
 *
 * Each entry below was confirmed by quoting BOTH spellings: the raw one returns nothing, the dashed
 * one returns the right company. Extend it the same way — never by pattern.
 */
export const CLASS_SYMBOL_FIXUPS: Record<string, string> = {
  BRKB: "BRK-B",   // Berkshire Hathaway Class B   $1.1tn
  HEIA: "HEI-A",   // HEICO Class A                $36.6bn
  LENB: "LEN-B",   // Lennar Class B               $20.1bn
  MOGA: "MOG-A",   // Moog Class A                 $12.5bn
  UHALB: "UHAL-B", // U-Haul Holding Series N      $12.4bn
  GEFB: "GEF-B",   // Greif Class B                $4.1bn
  BFA: "BF-A",     // Brown-Forman Class A
  BFB: "BF-B",     // Brown-Forman Class B
};

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
    const raw = norm(cells[tI] || "");
    // Re-spell the handful of share classes Yahoo dashes; see CLASS_SYMBOL_FIXUPS for why this is a
    // verified map and emphatically not a pattern.
    const symbol = CLASS_SYMBOL_FIXUPS[raw] || raw;
    if (!symbol || !/[A-Z]/.test(symbol) || /^(USD|CASH|MARGIN|XTSLA)/.test(symbol)) continue;
    // A DATE IS NOT A TICKER. The holdings export carries derivative/cash rows whose ticker cell holds
    // a maturity date, and SpreadsheetML hands it to us as the bare string "APR302001" / "FEB292016".
    // Those pass the letter test above, so 313 of them entered the Russell 3000 list — 11% of the
    // universe — where they can never resolve: they inflate the expected count (masking real coverage
    // loss), and burn a Yahoo lookup each, every night.
    if (isDateLikeSymbol(symbol)) continue;
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
