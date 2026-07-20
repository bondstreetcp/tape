/**
 * 13F-overlap crowding for the Portfolio Cockpit — how much of your book sits in the themes hedge funds
 * crowded into this quarter (from 13f-story's theme ticker-lists). High overlap = you're in consensus
 * trades (which can unwind together). Pure + fs-free → unit-tested (tests/crowd13f.test.ts).
 */

export interface Crowd13fTheme { heading: string; tickers: string[] }
export interface Crowd13fOverlap {
  asOf: string;
  overlapGrossPct: number; // share of gross in ANY crowded theme
  totalNames: number; // your distinct names in any theme
  themes: { heading: string; holdings: string[]; grossPct: number }[]; // your names per theme, by exposure
}

export function crowd13fOverlap(
  holdings: { symbol: string; value: number }[],
  themes: Crowd13fTheme[],
  asOf: string,
): Crowd13fOverlap | null {
  if (!holdings.length || !themes.length) return null;
  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const grossOf = new Map<string, number>();
  for (const h of holdings) grossOf.set(h.symbol.toUpperCase(), (grossOf.get(h.symbol.toUpperCase()) ?? 0) + Math.abs(h.value));

  const overlapNames = new Set<string>();
  const rows: { heading: string; holdings: string[]; grossPct: number }[] = [];
  for (const t of themes) {
    const set = new Set(t.tickers.map((x) => x.toUpperCase()));
    const mine = [...grossOf.keys()].filter((s) => set.has(s));
    if (!mine.length) continue;
    mine.forEach((s) => overlapNames.add(s));
    const gross = mine.reduce((a, s) => a + (grossOf.get(s) ?? 0), 0);
    rows.push({ heading: t.heading, holdings: mine.sort((a, b) => (grossOf.get(b) ?? 0) - (grossOf.get(a) ?? 0)), grossPct: gross / totalGross });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.grossPct - a.grossPct);
  const overlapGross = [...overlapNames].reduce((a, s) => a + (grossOf.get(s) ?? 0), 0);
  return { asOf, overlapGrossPct: overlapGross / totalGross, totalNames: overlapNames.size, themes: rows };
}
