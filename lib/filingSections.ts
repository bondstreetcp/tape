/**
 * Shared filing-parsing primitives for the grounded "briefing" routes (spin-off Form 10, company
 * 10-K). Pure string functions — no I/O — so the routes stay DRY. The section-windowing keeps the
 * huge (300k–1.5M-char) filings inside the model's context; namedCompetitors regex-extracts the
 * structured rival list (grounded by construction); grounded()/strList gate LLM strings against the
 * source text. Server/tooling only in practice, but pure + safe to import anywhere.
 */

/** Cut a window at the densest occurrence of `re` (the real section, not its table-of-contents line) —
 * scored by keyword density in the following text. `first` takes the first occurrence above a score
 * floor instead (for a heading that repeats as a running header). `back` pulls in leading context. */
export function section(
  text: string,
  re: RegExp,
  len: number,
  opts: { back?: number; scoreRe?: RegExp; first?: boolean; minScore?: number } = {},
): string {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const scoreRe = opts.scoreRe ?? /\b(market|industry|customer|competitor|revenue|product|segment|demand|growth|supplier)\b/gi;
  let best: { i: number; score: number } | null = null;
  for (let m = g.exec(text); m; m = g.exec(text)) {
    const probe = text.slice(m.index, m.index + Math.min(len, 9000));
    const score = (probe.match(new RegExp(scoreRe.source, scoreRe.flags.includes("g") ? scoreRe.flags : scoreRe.flags + "g")) || []).length;
    if (opts.first) { if (score >= (opts.minScore ?? 4)) { best = { i: m.index, score }; break; } }
    else if (!best || score > best.score) best = { i: m.index, score };
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return best ? text.slice(Math.max(0, best.i - (opts.back ?? 0)), best.i + len) : "";
}

/** Named competitors are a STRUCTURED list in the filing ("competitors are/include A, B and C.",
 * "we compete with A, B and C.") — pull them by regex over the FULL text (grounded by construction,
 * robust to which window the section extractor landed on). Filters possessives + generic descriptors
 * ("Enviri's business segments", "our other divisions"). */
export function namedCompetitors(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:competitors\s+(?:are|include|:|such as(?: those)?)|\bcompete(?:s)?\s+(?:with|against))\s+([A-Z][^.]{5,260}?)\./g;
  const bad = /['’]|\b(businesses?|segments?|operations?|subsidiar|affiliate|divisions?|portfolios?|products?|services?|markets?|industr|customers?|suppliers?|regions?)\b/i;
  for (let m = re.exec(text); m && out.size < 12; m = re.exec(text)) {
    for (const raw of m[1].split(/,|\band\b|\bas well as\b/)) {
      const name = raw.trim().replace(/^(the|other|various|certain|numerous|several|many|both|its|our)\s+/i, "").replace(/\s+(inc|corp|corporation|group|company|co|plc|ltd|systems)\.?$/i, "").trim();
      if (name.length >= 2 && name.length <= 46 && /^[A-Z0-9]/.test(name) && !bad.test(name) && !/^(we|our|its|their|his|her|they|companies|manufacturers?|distributors?|competitors?|others?|both|each|firms?|players?|vendors?|businesses)$/i.test(name)) out.add(name);
    }
  }
  return [...out];
}

export const clean = (s: unknown, max = 900): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** A named entity is grounded when its distinctive words (≥4 chars) all appear in the filing text. */
export function grounded(name: string, textLower: string): boolean {
  const words = norm(name).split(" ").filter((w) => w.length >= 4 && !["corporation", "company", "incorporated", "holdings", "group", "limited"].includes(w));
  if (!words.length) return norm(name).length >= 3 && textLower.includes(norm(name)); // short/acronym names
  return words.every((w) => textLower.includes(w));
}

/** Map an LLM string array → cleaned, capped, optionally grounded-against-the-filing list. */
export const strList = (arr: unknown, textLower: string | null, cap: number, ground = false): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x) => clean(x, 120))
    .filter((x): x is string => !!x && (!ground || !textLower || grounded(x, textLower)))
    .slice(0, cap);
