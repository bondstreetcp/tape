/**
 * Parser for an iShares IWV (Russell 3000 ETF) holdings CSV, used to build the
 * optional `russell3000` universe. Kept separate from fetch-constituents so it
 * can be unit-tested without running the Wikipedia scrape.
 *
 * Download the CSV from the IWV fund page on ishares.com ("Detailed Holdings and
 * Analytics" → Holdings → download) and save it as `data/iwv-holdings.csv`.
 */
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

/**
 * Parse IWV holdings text into classified entries. Sub-industry isn't in the CSV,
 * so symbols already in the GICS map keep their real sub-industry; the rest fall
 * back to sector-level grouping.
 */
export function parseIWV(text: string, gics: Gics): Entry[] {
  const lines = text.split(/\r?\n/);
  let hi = -1;
  let cols: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map((c) => c.toLowerCase());
    if (cells.includes("ticker") && (cells.includes("asset class") || cells.includes("sector"))) {
      hi = i;
      cols = cells;
      break;
    }
  }
  if (hi < 0) throw new Error("iwv-holdings.csv: header row (Ticker,…) not found");
  const ix = (n: string) => cols.indexOf(n);
  const tI = ix("ticker"), nI = ix("name"), sI = ix("sector"), aI = ix("asset class");

  const out: Entry[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i]);
    if (cells.length <= tI) continue;
    if (aI >= 0 && cells[aI] && cells[aI].toLowerCase() !== "equity") continue; // skip cash/futures
    const symbol = norm(cells[tI]);
    if (!symbol || !/[A-Z]/.test(symbol) || /^(USD|CASH|MARGIN|XTSLA)/.test(symbol)) continue;
    const g = gics.get(symbol);
    const rawSec = sI >= 0 ? cells[sI] : "";
    const ish = ISHARES_SECTOR_TO_GICS[rawSec] || rawSec;
    out.push({
      symbol,
      name: (nI >= 0 ? cells[nI] : "") || g?.name || symbol,
      sector: g?.sector || ish || "",
      industry: g?.industry || ish || "Other",
    });
  }
  if (out.length < 500) throw new Error(`iwv-holdings.csv: only parsed ${out.length} equities — wrong file?`);
  return out;
}
