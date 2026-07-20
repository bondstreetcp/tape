/**
 * Custom thematic tags for the Portfolio Cockpit — the user pastes a "SYMBOL theme" map and the book's
 * exposure is grouped by theme. A name can carry several themes, so theme exposures overlap by design
 * (a name can be both "AI" and "Semis"). Pure + fs-free → unit-tested (tests/themes.test.ts).
 */

export function parseTags(text: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // "SYMBOL theme words" | "SYMBOL, theme" | "SYMBOL: theme" — symbol first token, theme the rest.
    const m = line.match(/^([A-Za-z][A-Za-z.\-]{0,9})[\s,:]+(.+)$/);
    if (!m) continue;
    const sym = m[1].toUpperCase().replace(/[./]/g, "-");
    const theme = m[2].trim();
    if (!theme) continue;
    const arr = tags.get(sym) ?? [];
    if (!arr.includes(theme)) arr.push(theme);
    tags.set(sym, arr);
  }
  return tags;
}

export interface ThemeExposure {
  theme: string;
  long: number;
  short: number; // ≤ 0
  net: number;
  gross: number;
  names: number;
  pctGross: number; // theme gross / book gross
}

export function themeExposure(
  holdings: { symbol: string; value: number }[],
  tags: Map<string, string[]>,
): { rows: ThemeExposure[]; coverage: number } {
  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const acc = new Map<string, { long: number; short: number; gross: number; names: number }>();
  const seen = new Set<string>();
  let taggedGross = 0;
  for (const h of holdings) {
    const sym = h.symbol.toUpperCase();
    const themes = tags.get(sym);
    if (!themes?.length) continue;
    if (!seen.has(sym)) { seen.add(sym); taggedGross += Math.abs(h.value); } // count a name once for coverage
    for (const t of themes) {
      const a = acc.get(t) ?? { long: 0, short: 0, gross: 0, names: 0 };
      a.long += Math.max(h.value, 0);
      a.short += Math.min(h.value, 0);
      a.gross += Math.abs(h.value);
      a.names += 1;
      acc.set(t, a);
    }
  }
  const rows: ThemeExposure[] = [...acc.entries()]
    .map(([theme, a]) => ({ theme, long: a.long, short: a.short, net: a.long + a.short, gross: a.gross, names: a.names, pctGross: a.gross / totalGross }))
    .sort((x, y) => y.gross - x.gross);
  return { rows, coverage: taggedGross / totalGross };
}
